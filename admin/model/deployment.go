package model

import "time"

type Deployment struct {
	ID           string    `gorm:"primaryKey;size:64" json:"id"`
	Actor        string    `json:"actor"`
	Status       string    `gorm:"index;size:32" json:"status"`
	ConfigSecret string    `json:"-"`
	Failure      string    `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

func (Deployment) TableName() string { return "admin_deployments" }
