package service

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"lobehub/admin/common"
	"lobehub/admin/model"
)

func revokeUserSessions(tx *gorm.DB, id string, includeKeys bool) error {
	tables := []string{"auth_sessions", "nextauth_sessions"}
	if includeKeys {
		tables = append(tables, "api_keys")
	}
	for _, table := range tables {
		if tx.Migrator().HasTable(table) {
			if err := tx.Exec("DELETE FROM "+table+" WHERE user_id = ?", id).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) RevokeUserSessions(ctx context.Context, actor, id string) error {
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user model.User
		if err := tx.First(&user, "id = ?", id).Error; err != nil {
			return err
		}
		if err := revokeUserSessions(tx, id, false); err != nil {
			return err
		}
		return audit(tx, actor, "user.sessions.revoke", id)
	})
}

func (s *Service) DeleteUser(ctx context.Context, actor, id string, updatedAt time.Time) error {
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(742819322)").Error; err != nil {
			return err
		}
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", id).Error; err != nil {
			return err
		}
		if !user.UpdatedAt.Equal(updatedAt) {
			return ErrConflict
		}
		if user.Role != nil && *user.Role == "admin" && !user.Banned {
			var count int64
			if err := tx.Model(&model.User{}).Where("role = 'admin' AND COALESCE(banned,false) = false").Count(&count).Error; err != nil {
				return err
			}
			if count <= 1 {
				return ErrLastAdmin
			}
		}
		if err := tx.Create(&model.DeletedUser{UserID: id, Actor: actor}).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.User{}).Where("id = ?", id).Updates(map[string]any{"banned": true, "ban_reason": "Account deleted by administrator", "ban_expires": nil, "updated_at": time.Now().UTC()}).Error; err != nil {
			return err
		}
		if err := revokeUserSessions(tx, id, true); err != nil {
			return err
		}
		return audit(tx, actor, "user.delete", id)
	})
}

func (s *Service) UserWallet(ctx context.Context, actor, id string) (BillingWalletView, error) {
	var result BillingWalletView
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("NOT EXISTS (SELECT 1 FROM admin_deleted_users d WHERE d.user_id=users.id)").First(&user, "id = ?", id).Error; err != nil {
			return err
		}
		account, err := common.RandomToken()
		if err != nil {
			return err
		}
		wallet, err := common.RandomToken()
		if err != nil {
			return err
		}
		if err := tx.Exec("INSERT INTO billing_accounts(id,user_id,currency) VALUES (?,?,'CNY') ON CONFLICT(user_id) DO NOTHING", account, id).Error; err != nil {
			return err
		}
		if err := tx.Raw("SELECT id FROM billing_accounts WHERE user_id=?", id).Scan(&account).Error; err != nil {
			return err
		}
		if err := tx.Exec("INSERT INTO wallets(id,billing_account_id) VALUES (?,?) ON CONFLICT(billing_account_id) DO NOTHING", wallet, account).Error; err != nil {
			return err
		}
		if err := tx.Raw("SELECT b.id,b.user_id,u.email,b.status,w.available::text,w.reserved::text FROM billing_accounts b JOIN wallets w ON w.billing_account_id=b.id JOIN users u ON u.id=b.user_id WHERE b.id=?", account).Scan(&result).Error; err != nil {
			return err
		}
		return audit(tx, actor, "user.wallet.open", id)
	})
	return result, err
}
