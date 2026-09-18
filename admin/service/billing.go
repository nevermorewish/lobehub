package service

import (
	"context"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"lobehub/admin/common"
	"lobehub/admin/model"
)

// Financial tables are owned by Drizzle migrations; do not AutoMigrate them.
type BillingWalletView struct {
	ID        string  `json:"id"`
	UserID    string  `json:"userId"`
	Email     *string `json:"email"`
	Status    string  `json:"status"`
	Available string  `json:"available"`
	Reserved  string  `json:"reserved"`
}

func (s *Service) BillingWallets(ctx context.Context, search string, page, size int) (model.Page[BillingWalletView], error) {
	result := model.Page[BillingWalletView]{Items: []BillingWalletView{}, Page: page, PageSize: size}
	q := s.DB.WithContext(ctx).Table("billing_accounts b").Joins("JOIN wallets w ON w.billing_account_id = b.id").Joins("JOIN users u ON u.id = b.user_id")
	if search != "" {
		q = q.Where("b.user_id = ? OR u.email = ?", search, search)
	}
	if err := q.Count(&result.Total).Error; err != nil {
		return result, err
	}
	err := q.Select("b.id, b.user_id, u.email, b.status, w.available::text, w.reserved::text").Order("b.created_at DESC, b.id").Limit(size).Offset((page - 1) * size).Scan(&result.Items).Error
	return result, err
}

type BillingOrderView struct {
	ID              string     `json:"id"`
	UserID          string     `json:"userId"`
	OrderNo         string     `json:"orderNo"`
	AmountMinor     string     `json:"amountMinor"`
	CreditGrant     string     `json:"creditGrant"`
	Status          string     `json:"status"`
	PaymentProvider string     `json:"paymentProvider"`
	ProviderTradeNo *string    `json:"providerTradeNo"`
	CreatedAt       time.Time  `json:"createdAt"`
	PaidAt          *time.Time `json:"paidAt"`
}

func (s *Service) BillingOrders(ctx context.Context, search string, page, size int) (model.Page[BillingOrderView], error) {
	result := model.Page[BillingOrderView]{Items: []BillingOrderView{}, Page: page, PageSize: size}
	q := s.DB.WithContext(ctx).Table("orders")
	if search != "" {
		q = q.Where("order_no = ? OR user_id = ? OR provider_trade_no = ?", search, search, search)
	}
	if err := q.Count(&result.Total).Error; err != nil {
		return result, err
	}
	err := q.Select("id, user_id, order_no, amount_minor::text, price_snapshot->>'creditGrant' AS credit_grant, status, payment_provider, provider_trade_no, created_at, paid_at").Order("created_at DESC, id").Limit(size).Offset((page - 1) * size).Scan(&result.Items).Error
	return result, err
}

type AdjustmentInput struct {
	Delta          string `json:"delta"`
	Reason         string `json:"reason"`
	IdempotencyKey string `json:"idempotencyKey"`
}

func (s *Service) AdjustWallet(ctx context.Context, actor, account string, input AdjustmentInput) (map[string]string, error) {
	delta, err := strconv.ParseInt(input.Delta, 10, 64)
	if err != nil || delta == 0 || delta > 1000000000 || delta < -1000000000 || len(input.IdempotencyKey) != 36 || strings.TrimSpace(input.Reason) == "" || len(input.Reason) > 200 {
		return nil, ErrInvalid
	}
	result := map[string]string{}
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var wallet struct {
			ID        string
			Available int64
		}
		if err := tx.Raw("SELECT id, available FROM wallets WHERE billing_account_id = ? FOR UPDATE", account).Scan(&wallet).Error; err != nil {
			return err
		}
		if wallet.ID == "" {
			return gorm.ErrRecordNotFound
		}
		key := "admin:" + input.IdempotencyKey
		var existing struct {
			ID               string
			Delta            int64
			BillingAccountID string
			Reason           string
		}
		if err := tx.Raw("SELECT id, delta, billing_account_id, reason FROM ledger_entries WHERE idempotency_key = ?", key).Scan(&existing).Error; err != nil {
			return err
		}
		if existing.ID != "" {
			if existing.Delta != delta || existing.BillingAccountID != account || existing.Reason != input.Reason {
				return ErrConflict
			}
			result["ledgerId"] = existing.ID
			return nil
		}
		if wallet.Available+delta < 0 {
			return ErrInsufficientCredits
		}
		id, err := common.RandomToken()
		if err != nil {
			return err
		}
		kind := "credit"
		if delta < 0 {
			kind = "debit"
		}
		if err := tx.Exec("UPDATE wallets SET available = available + ?, version = version + 1, updated_at = now() WHERE id = ?", delta, wallet.ID).Error; err != nil {
			return err
		}
		if err := tx.Exec("INSERT INTO ledger_entries (id, billing_account_id, kind, delta, available_delta, reserved_delta, balance_after, idempotency_key, reason) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)", id, account, kind, delta, delta, wallet.Available+delta, key, input.Reason).Error; err != nil {
			return err
		}
		result["ledgerId"] = id
		return audit(tx, actor, "billing.adjust", id)
	})
	return result, err
}

type CreditPack struct {
	ID          string `json:"id"`
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Status      string `json:"status"`
	Credits     string `json:"credits"`
	AmountMinor string `json:"amountMinor"`
	PriceID     string `json:"priceId"`
}
type CreditPackInput struct {
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Credits     string `json:"credits"`
	AmountMinor string `json:"amountMinor"`
	Status      string `json:"status"`
	PriceID     string `json:"priceId"`
}

func (s *Service) CreditPacks(ctx context.Context) ([]CreditPack, error) {
	rows := []CreditPack{}
	err := s.DB.WithContext(ctx).Raw("SELECT p.id,p.slug,p.name,COALESCE(p.description,'') AS description,p.status,p.token_grant_monthly::text AS credits,pp.amount_minor::text,pp.id AS price_id FROM plans p JOIN plan_prices pp ON pp.plan_id = p.id AND pp.archived_at IS NULL WHERE pp.billing_interval = 'one_time' ORDER BY p.sort_order,p.created_at").Scan(&rows).Error
	return rows, err
}
func (s *Service) SaveCreditPack(ctx context.Context, actor string, input CreditPackInput) error {
	credits, e1 := strconv.ParseInt(input.Credits, 10, 64)
	amount, e2 := strconv.ParseInt(input.AmountMinor, 10, 64)
	if e1 != nil || e2 != nil || credits < 1 || credits > 1000000000 || amount < 1 || amount > 100000000 || !identifier.MatchString(input.Slug) || input.Name == "" || len(input.Name) > 128 || len(input.Description) > 1000 || (input.Status != "active" && input.Status != "archived") {
		return ErrInvalid
	}
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", "credit-pack:"+input.Slug).Error; err != nil {
			return err
		}
		var plan struct{ ID string }
		if err := tx.Raw("SELECT id FROM plans WHERE slug = ? FOR UPDATE", input.Slug).Scan(&plan).Error; err != nil {
			return err
		}
		if plan.ID == "" {
			if input.PriceID != "" {
				return ErrConflict
			}
			id, err := common.RandomToken()
			if err != nil {
				return err
			}
			plan.ID = id
			if err := tx.Exec("INSERT INTO plans (id,slug,name,description,status,token_grant_monthly) VALUES (?,?,?,?,?,?)", id, input.Slug, input.Name, input.Description, input.Status, credits).Error; err != nil {
				return err
			}
		} else {
			var price struct{ ID string }
			if err := tx.Raw("SELECT id FROM plan_prices WHERE plan_id = ? AND archived_at IS NULL", plan.ID).Scan(&price).Error; err != nil {
				return err
			}
			if price.ID != input.PriceID {
				return ErrConflict
			}
			if err := tx.Exec("UPDATE plans SET name=?,description=?,status=?,token_grant_monthly=?,updated_at=now() WHERE id=?", input.Name, input.Description, input.Status, credits, plan.ID).Error; err != nil {
				return err
			}
			if err := tx.Exec("UPDATE plan_prices SET archived_at=now() WHERE plan_id=? AND archived_at IS NULL", plan.ID).Error; err != nil {
				return err
			}
		}
		id, err := common.RandomToken()
		if err != nil {
			return err
		}
		if err := tx.Exec("INSERT INTO plan_prices (id,plan_id,currency,amount_minor,billing_interval) VALUES (?,?,'CNY',?,'one_time')", id, plan.ID, amount).Error; err != nil {
			return err
		}
		return audit(tx, actor, "billing.pack.save", plan.ID)
	})
}
