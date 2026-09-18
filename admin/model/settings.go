package model

import "time"

// Settings are encrypted as a whole, including storage credentials.
type Setting struct {
	ID        string `gorm:"primaryKey;size:32"`
	Secret    string
	Revision  int64 `gorm:"not null"`
	UpdatedAt time.Time
}

func (Setting) TableName() string { return "admin_settings" }
