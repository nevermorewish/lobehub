package service

import (
	"context"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"lobehub/admin/common"
	"lobehub/admin/model"
)

func (s *Service) Prices(ctx context.Context, search string, archived bool, page, size int) (model.Page[model.Price], error) {
	result := model.Page[model.Price]{Items: []model.Price{}, Page: page, PageSize: size}
	q := s.DB.WithContext(ctx).Model(&model.Price{})
	if !archived {
		q = q.Where("archived_at IS NULL")
	}
	if search != "" {
		pattern := "%" + strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(search) + "%"
		q = q.Where("model_id ILIKE ? OR provider ILIKE ? OR display_name ILIKE ?", pattern, pattern, pattern)
	}
	if err := q.Count(&result.Total).Error; err != nil {
		return result, err
	}
	err := q.Order("provider, model_id, created_at DESC").Limit(size).Offset((page - 1) * size).Find(&result.Items).Error
	return result, err
}

func (s *Service) SavePrice(ctx context.Context, actor string, input model.Price) (model.Price, error) {
	if input.ModelType == "" {
		input.ModelType = "chat"
	}
	if input.ModelType != "chat" && input.ModelType != "image" && input.ModelType != "video" {
		return input, ErrInvalid
	}
	if input.RequestCreditsFlat < 0 || input.RequestCreditsFlat > 1000000000 {
		return input, ErrInvalid
	}
	input.ModelID = strings.TrimSpace(input.ModelID)
	if !identifier.MatchString(input.Provider) || input.ModelID == "" || len(input.ModelID) > 128 || len(input.DisplayName) > 128 || len(input.Note) > 512 || input.ContextWindow < 0 || input.ContextWindow > 100000000 || input.PromptCreditsPerKToken < 0 || input.CompletionCreditsPerKToken < 0 || input.PromptCreditsPerKToken > 1000000000 || input.CompletionCreditsPerKToken > 1000000000 {
		return input, ErrInvalid
	}
	var err error
	input.ID, err = common.RandomToken()
	if err != nil {
		return input, err
	}
	input.ArchivedAt = nil
	input.CreatedAt = time.Time{}
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Lock the owning provider, including when there is no previous price row.
		var provider model.Provider
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&provider, "id = ?", input.Provider).Error; err != nil {
			return err
		}
		if input.IsActive {
			if err := tx.Model(&model.Price{}).Where("provider = ? AND model_id = ? AND is_active = true AND archived_at IS NULL", input.Provider, input.ModelID).Updates(map[string]any{"is_active": false, "archived_at": time.Now().UTC()}).Error; err != nil {
				return err
			}
		}
		if err := tx.Create(&input).Error; err != nil {
			return err
		}
		return audit(tx, actor, "price.create", input.ID)
	})
	return input, err
}

func (s *Service) ArchivePrice(ctx context.Context, actor, id string) error {
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		r := tx.Model(&model.Price{}).Where("id = ?", id).Updates(map[string]any{"is_active": false, "archived_at": time.Now().UTC()})
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return audit(tx, actor, "price.archive", id)
	})
}

type Catalog struct {
	Providers []ProviderView `json:"providers"`
	Prices    []model.Price  `json:"prices"`
}

func (s *Service) Catalog(ctx context.Context) (Catalog, error) {
	p, err := s.Providers(ctx)
	if err != nil {
		return Catalog{}, err
	}
	prices := []model.Price{}
	err = s.DB.WithContext(ctx).Where("is_active = true AND archived_at IS NULL").Order("provider, model_id").Find(&prices).Error
	return Catalog{Providers: p, Prices: prices}, err
}
