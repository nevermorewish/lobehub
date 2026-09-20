package service

import (
	"context"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"lobehub/admin/model"
)

type BulkPriceInput struct {
	Provider string        `json:"provider"`
	Prices   []model.Price `json:"prices"`
}

type BulkPriceResult struct {
	Created []model.Price `json:"created"`
	Skipped []string      `json:"skipped"`
}

// AddPrices only adds missing models. Existing current prices (including drafts)
// are never replaced, making retries and concurrent imports safe.
func (s *Service) AddPrices(ctx context.Context, actor string, input BulkPriceInput) (BulkPriceResult, error) {
	result := BulkPriceResult{Created: []model.Price{}, Skipped: []string{}}
	if !providerIdentifier.MatchString(input.Provider) || len(input.Prices) == 0 || len(input.Prices) > 200 {
		return result, ErrInvalid
	}
	prepared := make([]model.Price, 0, len(input.Prices))
	ids := make([]string, 0, len(input.Prices))
	seen := map[string]bool{}
	for _, price := range input.Prices {
		price.Provider = input.Provider
		price, err := preparePrice(price)
		if err != nil {
			return result, err
		}
		if seen[price.ModelID] {
			return result, ErrInvalid
		}
		seen[price.ModelID] = true
		prepared = append(prepared, price)
		ids = append(ids, price.ModelID)
	}
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var provider model.Provider
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&provider, "id = ?", input.Provider).Error; err != nil {
			return err
		}
		var existing []string
		if err := tx.Model(&model.Price{}).Where("provider = ? AND model_id IN ? AND archived_at IS NULL", input.Provider, ids).Pluck("model_id", &existing).Error; err != nil {
			return err
		}
		present := map[string]bool{}
		for _, id := range existing {
			present[id] = true
		}
		for _, price := range prepared {
			if present[price.ModelID] {
				result.Skipped = append(result.Skipped, price.ModelID)
				continue
			}
			if err := createPrice(tx, actor, &price); err != nil {
				return err
			}
			result.Created = append(result.Created, price)
		}
		return nil
	})
	if err != nil {
		return BulkPriceResult{}, err
	}
	return result, nil
}
