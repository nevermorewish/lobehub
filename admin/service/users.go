package service

import (
	"context"
	"errors"
	"net/mail"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"lobehub/admin/model"
)

type UserUpdate struct {
	Username  *string   `json:"username"`
	Email     *string   `json:"email"`
	FullName  *string   `json:"fullName"`
	Role      string    `json:"role"`
	Banned    bool      `json:"banned"`
	BanReason string    `json:"banReason"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type UserView struct {
	model.User
	BillingReady     bool    `json:"billingReady"`
	BillingAccountID *string `json:"billingAccountId"`
	Available        string  `json:"available"`
	Reserved         string  `json:"reserved"`
	Spent            string  `json:"spent"`
	RequestCount     string  `json:"requestCount"`
}

func (s *Service) Users(ctx context.Context, search, status string, page, size int) (model.Page[UserView], error) {
	result := model.Page[UserView]{Items: []UserView{}, Page: page, PageSize: size}
	q := s.DB.WithContext(ctx).Model(&model.User{}).Where("NOT EXISTS (SELECT 1 FROM admin_deleted_users d WHERE d.user_id = users.id)")
	if search != "" {
		pattern := "%" + strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(search) + "%"
		q = q.Where("email ILIKE ? OR username ILIKE ? OR full_name ILIKE ? OR id = ?", pattern, pattern, pattern, search)
	}
	if status == "banned" {
		q = q.Where("banned = true")
	} else if status == "active" {
		q = q.Where("COALESCE(banned, false) = false")
	}
	if err := q.Count(&result.Total).Error; err != nil {
		return result, err
	}
	err := q.Select("users.*").Order("created_at DESC, id ASC").Limit(size).Offset((page - 1) * size).Find(&result.Items).Error
	if err != nil || len(result.Items) == 0 {
		return result, err
	}
	if s.DB.Migrator().HasTable("billing_accounts") {
		ids := make([]string, 0, len(result.Items))
		for _, user := range result.Items {
			ids = append(ids, user.ID)
		}
		var balances []struct {
			UserID                                   string
			BillingAccountID                         *string
			Available, Reserved, Spent, RequestCount string
		}
		err = s.DB.WithContext(ctx).Raw(`SELECT u.id AS user_id,b.id AS billing_account_id,COALESCE(w.available,0)::text AS available,COALESCE(w.reserved,0)::text AS reserved,
 (SELECT COALESCE(sum(credits_charged),0)::text FROM usage_records WHERE user_id=u.id) AS spent,
 (SELECT count(*)::text FROM usage_records WHERE user_id=u.id) AS request_count
 FROM users u LEFT JOIN billing_accounts b ON b.user_id=u.id LEFT JOIN wallets w ON w.billing_account_id=b.id WHERE u.id IN ?`, ids).Scan(&balances).Error
		if err != nil {
			return result, err
		}
		for i := range result.Items {
			for _, b := range balances {
				if b.UserID == result.Items[i].ID {
					result.Items[i].BillingReady = true
					result.Items[i].BillingAccountID = b.BillingAccountID
					result.Items[i].Available = b.Available
					result.Items[i].Reserved = b.Reserved
					result.Items[i].Spent = b.Spent
					result.Items[i].RequestCount = b.RequestCount
				}
			}
		}
	}
	return result, err
}

func (s *Service) UpdateUser(ctx context.Context, actor, id string, input UserUpdate) (model.User, error) {
	var result model.User
	if input.Role != "admin" && input.Role != "user" {
		return result, ErrInvalid
	}
	if input.Email != nil {
		value := strings.ToLower(strings.TrimSpace(*input.Email))
		input.Email = &value
		parsed, err := mail.ParseAddress(value)
		if err != nil || parsed.Address != value || len(value) > 254 {
			return result, errors.New("a valid email is required")
		}
	}
	if input.Username != nil {
		value := strings.TrimSpace(*input.Username)
		if len(value) > 128 {
			return result, ErrInvalid
		}
		input.Username = &value
	}
	if input.FullName != nil && len(*input.FullName) > 256 {
		return result, ErrInvalid
	}
	if input.Banned && (strings.TrimSpace(input.BanReason) == "" || len(input.BanReason) > 512) {
		return result, errors.New("a ban reason is required (maximum 512 characters)")
	}
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Serialize role changes to preserve at least one active LobeHub administrator.
		if err := tx.Exec("SELECT pg_advisory_xact_lock(742819322)").Error; err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&result, "id = ?", id).Error; err != nil {
			return err
		}
		if !result.UpdatedAt.Equal(input.UpdatedAt) {
			return ErrConflict
		}
		var deleted int64
		if err := tx.Model(&model.DeletedUser{}).Where("user_id = ?", id).Count(&deleted).Error; err != nil {
			return err
		}
		if deleted > 0 {
			return ErrConflict
		}
		if result.Role != nil && *result.Role == "admin" && !result.Banned && (input.Role != "admin" || input.Banned) {
			var count int64
			if err := tx.Model(&model.User{}).Where("role = 'admin' AND COALESCE(banned,false) = false").Count(&count).Error; err != nil {
				return err
			}
			if count <= 1 {
				return errors.New("the last active LobeHub administrator cannot be demoted or banned")
			}
		}
		values := map[string]any{"role": input.Role, "banned": input.Banned, "ban_expires": nil, "ban_reason": nil, "updated_at": time.Now().UTC()}
		if input.Username != nil {
			if *input.Username == "" {
				values["username"] = nil
			} else {
				values["username"] = *input.Username
			}
		}
		if input.Email != nil {
			values["email"] = *input.Email
			values["normalized_email"] = *input.Email
			if result.Email == nil || *result.Email != *input.Email {
				values["email_verified"] = false
				values["email_verified_at"] = nil
			}
		}
		if input.FullName != nil {
			values["full_name"] = *input.FullName
		}
		if input.Banned {
			values["ban_reason"] = strings.TrimSpace(input.BanReason)
		}
		if err := tx.Model(&model.User{}).Where("id = ?", id).Updates(values).Error; err != nil {
			return err
		}
		// Revocation is required for bans and role changes, not only new logins.
		if input.Banned || result.Role == nil || *result.Role != input.Role {
			for _, table := range []string{"auth_sessions", "nextauth_sessions"} {
				if tx.Migrator().HasTable(table) {
					if err := tx.Exec("DELETE FROM "+table+" WHERE user_id = ?", id).Error; err != nil {
						return err
					}
				}
			}
		}
		if err := audit(tx, actor, "user.update", id); err != nil {
			return err
		}
		return tx.First(&result, "id = ?", id).Error
	})
	return result, err
}
