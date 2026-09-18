package service

import (
	"context"
	"time"

	"gorm.io/gorm"

	"lobehub/admin/model"
)

type BillingLedgerView struct {
	ID               string     `json:"id"`
	BillingAccountID string     `json:"billingAccountId"`
	UserID           string     `json:"userId"`
	Email            *string    `json:"email"`
	Kind             string     `json:"kind"`
	Delta            string     `json:"delta"`
	AvailableDelta   string     `json:"availableDelta"`
	ReservedDelta    string     `json:"reservedDelta"`
	BalanceAfter     string     `json:"balanceAfter"`
	Reason           *string    `json:"reason"`
	OrderID          *string    `json:"orderId"`
	CreatedAt        time.Time  `json:"createdAt"`
	UsageID          *string    `json:"usageId"`
	RequestID        *string    `json:"requestId"`
	ModelID          *string    `json:"modelId"`
	Provider         *string    `json:"provider"`
	PromptTokens     *int64     `json:"promptTokens"`
	CompletionTokens *int64     `json:"completionTokens"`
	TotalTokens      *int64     `json:"totalTokens"`
	CreditsCharged   *string    `json:"creditsCharged"`
	SettlementStatus *string    `json:"settlementStatus"`
	PromptRate       *string    `json:"promptRate"`
	CompletionRate   *string    `json:"completionRate"`
	HeldCredits      *string    `json:"heldCredits"`
	Unit             *string    `json:"unit"`
	ModelType        *string    `json:"modelType"`
	PriceID          *string    `json:"priceId"`
	UsageStartedAt   *time.Time `json:"usageStartedAt"`
	UsageUpdatedAt   *time.Time `json:"usageUpdatedAt"`
	Operator         *string    `json:"operator"`
}

type LedgerFilter struct {
	Account, User, Search, Model, Provider, Kind string
	From, To                                     *time.Time
}

type LedgerSummary struct {
	Debited     string `json:"debited"`
	Credited    string `json:"credited"`
	TotalTokens string `json:"totalTokens"`
}
type BillingLedgerPage struct {
	model.Page[BillingLedgerView]
	Summary LedgerSummary `json:"summary"`
}

func (s *Service) BillingLedger(ctx context.Context, account string, page, size int) (BillingLedgerPage, error) {
	return s.FilteredBillingLedger(ctx, LedgerFilter{Account: account}, page, size)
}

func (s *Service) FilteredBillingLedger(ctx context.Context, filter LedgerFilter, page, size int) (BillingLedgerPage, error) {
	result := BillingLedgerPage{Page: model.Page[BillingLedgerView]{Items: []BillingLedgerView{}, Page: page, PageSize: size}}
	q := s.DB.WithContext(ctx).Table("ledger_entries l").
		Joins("JOIN billing_accounts b ON b.id=l.billing_account_id").
		Joins("LEFT JOIN users person ON person.id=b.user_id").
		Joins(`LEFT JOIN LATERAL (SELECT * FROM usage_records r WHERE r.billing_account_id=l.billing_account_id AND
 (r.id=l.usage_record_id OR (l.usage_record_id IS NULL AND l.kind='hold' AND r.request_id=substring(l.idempotency_key from 6))) LIMIT 1) usage ON true`)
	if filter.Account != "" {
		q = q.Where("l.billing_account_id = ?", filter.Account)
	}
	if filter.User != "" {
		q = q.Where("b.user_id = ?", filter.User)
	}
	if filter.Search != "" {
		q = q.Where("person.email ILIKE ? OR b.user_id=? OR usage.request_id=? OR l.id=? OR l.order_id=?", pattern(filter.Search), filter.Search, filter.Search, filter.Search, filter.Search)
	}
	if filter.Model != "" {
		q = q.Where("usage.model_id ILIKE ?", pattern(filter.Model))
	}
	if filter.Provider != "" {
		q = q.Where("usage.provider = ?", filter.Provider)
	}
	if filter.Kind != "" {
		q = q.Where("l.kind = ?", filter.Kind)
	}
	if filter.From != nil {
		q = q.Where("l.created_at >= ?", *filter.From)
	}
	if filter.To != nil {
		q = q.Where("l.created_at <= ?", *filter.To)
	}
	if err := q.Session(&gorm.Session{}).Count(&result.Total).Error; err != nil {
		return result, err
	}
	if err := q.Session(&gorm.Session{}).Select(`COALESCE(sum(CASE WHEN l.delta<0 THEN -l.delta ELSE 0 END),0)::text AS debited,
 COALESCE(sum(CASE WHEN l.delta>0 THEN l.delta ELSE 0 END),0)::text AS credited,
 COALESCE(sum(CASE WHEN l.kind='debit' THEN usage.total_tokens ELSE 0 END),0)::text AS total_tokens`).Scan(&result.Summary).Error; err != nil {
		return result, err
	}
	err := q.Session(&gorm.Session{}).Select(`l.id,l.billing_account_id,b.user_id,person.email,l.kind,l.delta::text,l.available_delta::text,l.reserved_delta::text,l.balance_after::text,l.reason,l.order_id,l.created_at,
 usage.id AS usage_id,usage.request_id,usage.model_id,usage.provider,usage.prompt_tokens,usage.completion_tokens,usage.total_tokens,usage.credits_charged::text,usage.settlement_status,
 usage.price_snapshot->>'promptPerK' AS prompt_rate,usage.price_snapshot->>'completionPerK' AS completion_rate,usage.price_snapshot->>'heldCredits' AS held_credits,
 usage.price_snapshot->>'unit' AS unit,usage.price_snapshot->>'modelType' AS model_type,usage.price_snapshot->>'priceId' AS price_id,usage.created_at AS usage_started_at,usage.updated_at AS usage_updated_at,
 (SELECT actor FROM admin_audit_events WHERE action='billing.adjust' AND target=l.id ORDER BY id DESC LIMIT 1) AS operator`).
		Order("l.created_at DESC,l.id").Limit(size).Offset((page - 1) * size).Scan(&result.Items).Error
	return result, err
}
