package model

import "time"

// Keep identity and financial references while permanently disabling the account.
type DeletedUser struct {
	UserID    string `gorm:"primaryKey"`
	Actor     string
	CreatedAt time.Time
}

func (DeletedUser) TableName() string { return "admin_deleted_users" }
