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

func (s *Service) Users(ctx context.Context, search, status string, page, size int) (model.Page[model.User], error) {
	result := model.Page[model.User]{Items: []model.User{}, Page: page, PageSize: size}
	q := s.DB.WithContext(ctx).Model(&model.User{})
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
	err := q.Order("created_at DESC, id ASC").Limit(size).Offset((page - 1) * size).Find(&result.Items).Error
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
