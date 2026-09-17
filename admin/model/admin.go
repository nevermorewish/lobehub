package model

import "time"

// Admin tables are separate from LobeHub's schema. Never AutoMigrate users or auth tables.
type Administrator struct {
	Username     string    `gorm:"primaryKey;size:128" json:"username"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
}

func (Administrator) TableName() string { return "admin_administrators" }

type Session struct {
	TokenHash string    `gorm:"primaryKey;size:64" json:"-"`
	Username  string    `gorm:"index"`
	ExpiresAt time.Time `gorm:"index"`
}

func (Session) TableName() string { return "admin_sessions" }

type Provider struct {
	ID        string    `gorm:"primaryKey;size:64" json:"id"`
	Name      string    `gorm:"size:128;not null" json:"name"`
	SDKType   string    `gorm:"size:64;not null" json:"sdkType"`
	BaseURL   string    `json:"baseURL"`
	Enabled   bool      `json:"enabled"`
	Secret    string    `json:"-"`
	Revision  int64     `gorm:"not null;default:1" json:"revision"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (Provider) TableName() string { return "admin_providers" }

type Price struct {
	ID                         string     `gorm:"primaryKey;size:64" json:"id"`
	Provider                   string     `gorm:"index:admin_price_lookup;size:64;not null" json:"provider"`
	ModelID                    string     `gorm:"index:admin_price_lookup;size:128;not null" json:"modelId"`
	DisplayName                string     `gorm:"size:128" json:"displayName"`
	PromptCreditsPerKToken     int64      `gorm:"not null;check:admin_prompt_nonnegative,prompt_credits_per_k_token >= 0" json:"promptCreditsPerKToken"`
	CompletionCreditsPerKToken int64      `gorm:"not null;check:admin_completion_nonnegative,completion_credits_per_k_token >= 0" json:"completionCreditsPerKToken"`
	ContextWindow              int        `json:"contextWindow"`
	Vision                     bool       `json:"vision"`
	FunctionCall               bool       `json:"functionCall"`
	IsActive                   bool       `json:"isActive"`
	Note                       string     `gorm:"size:512" json:"note"`
	ArchivedAt                 *time.Time `json:"archivedAt"`
	CreatedAt                  time.Time  `json:"createdAt"`
}

func (Price) TableName() string { return "admin_model_prices" }

type Payment struct {
	ID        string    `gorm:"primaryKey;size:32" json:"id"`
	Enabled   bool      `json:"enabled"`
	Config    string    `gorm:"type:jsonb;not null;default:'{}'" json:"-"`
	Secret    string    `json:"-"`
	Revision  int64     `gorm:"not null;default:1" json:"revision"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (Payment) TableName() string { return "admin_payments" }

type Audit struct {
	ID        uint64    `gorm:"primaryKey" json:"id"`
	Actor     string    `json:"actor"`
	Action    string    `json:"action"`
	Target    string    `json:"target"`
	CreatedAt time.Time `gorm:"index" json:"createdAt"`
}

func (Audit) TableName() string { return "admin_audit_events" }

type User struct {
	ID           string     `json:"id"`
	Username     *string    `json:"username"`
	Email        *string    `json:"email"`
	FullName     *string    `json:"fullName"`
	Avatar       *string    `json:"avatar"`
	Role         *string    `json:"role"`
	Banned       bool       `json:"banned"`
	BanReason    *string    `json:"banReason"`
	BanExpires   *time.Time `json:"banExpires"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
	LastActiveAt time.Time  `json:"lastActiveAt"`
}

func (User) TableName() string { return "users" }

type Page[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}
