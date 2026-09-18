package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strconv"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"lobehub/admin/model"
)

// An explicit allowlist prevents settings from changing bootstrap/authentication secrets.
var settingKeys = map[string][]string{
	"deployment": {"DEPLOY_HOST", "DEPLOY_PORT", "DEPLOY_USER", "DEPLOY_PASSWORD", "DEPLOY_HOST_KEY", "DEPLOY_REPOSITORY", "DEPLOY_BRANCH", "DEPLOY_DIRECTORY"},
	"storage":    {"S3_ENDPOINT", "S3_INTERNAL_ENDPOINT", "S3_BUCKET", "S3_REGION", "S3_PUBLIC_DOMAIN", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENABLE_PATH_STYLE", "S3_SET_ACL", "S3_PREVIEW_URL_EXPIRE_IN"},
	"system":     {"APP_URL", "INTERNAL_APP_URL", "SEARXNG_URL", "LLM_VISION_IMAGE_USE_BASE64"},
}

type SettingsInput struct {
	Values   map[string]string `json:"values"`
	Revision int64             `json:"revision"`
}

type SettingsView struct {
	Values     map[string]string `json:"values"`
	Revision   int64             `json:"revision"`
	Configured bool              `json:"configured"`
}

func secretSetting(key string) bool {
	return key == "S3_ACCESS_KEY_ID" || key == "S3_SECRET_ACCESS_KEY" || key == "DEPLOY_PASSWORD"
}

func (s *Service) decodeSettings(row model.Setting) (map[string]string, error) {
	values := map[string]string{}
	raw, err := s.Vault.Decrypt(row.Secret, "settings:"+row.ID)
	if err == nil && raw != "" {
		err = json.Unmarshal([]byte(raw), &values)
	}
	return values, err
}

func settingsView(row model.Setting, values map[string]string) SettingsView {
	public := map[string]string{}
	for key, value := range values {
		if !secretSetting(key) {
			public[key] = value
		}
	}
	return SettingsView{Values: public, Revision: row.Revision, Configured: row.Revision > 0}
}

func (s *Service) Settings(ctx context.Context, id string) (SettingsView, error) {
	if _, ok := settingKeys[id]; !ok {
		return SettingsView{}, ErrInvalid
	}
	row := model.Setting{ID: id}
	err := s.DB.WithContext(ctx).First(&row, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return settingsView(row, map[string]string{}), nil
	}
	if err != nil {
		return SettingsView{}, err
	}
	values, err := s.decodeSettings(row)
	return settingsView(row, values), err
}

func validateSettings(id string, values map[string]string) error {
	keys, ok := settingKeys[id]
	if !ok {
		return ErrInvalid
	}
	allowed := map[string]bool{}
	for _, key := range keys {
		allowed[key] = true
	}
	for key, value := range values {
		if !allowed[key] || len(value) > 4096 || strings.ContainsAny(value, "\x00\r\n") {
			return ErrInvalid
		}
		switch key {
		case "APP_URL", "INTERNAL_APP_URL", "SEARXNG_URL", "S3_ENDPOINT", "S3_INTERNAL_ENDPOINT", "S3_PUBLIC_DOMAIN":
			if !validURL(value, true) {
				return ErrInvalid
			}
			if key == "APP_URL" && value != "" {
				u, _ := url.Parse(value)
				if u.Path != "" && u.Path != "/" {
					return ErrInvalid
				}
			}
		case "S3_ENABLE_PATH_STYLE", "S3_SET_ACL", "LLM_VISION_IMAGE_USE_BASE64":
			if value != "0" && value != "1" {
				return ErrInvalid
			}
		case "S3_PREVIEW_URL_EXPIRE_IN":
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 || n > 604800 {
				return ErrInvalid
			}
		}
	}
	if id == "system" && values["APP_URL"] == "" {
		return ErrInvalid
	}
	if id == "deployment" {
		return validateDeployment(values)
	}
	if id == "storage" {
		for _, key := range []string{"S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"} {
			if values[key] == "" {
				return ErrInvalid
			}
		}
	}
	return nil
}

func (s *Service) SaveSettings(ctx context.Context, actor, id string, input SettingsInput) (SettingsView, error) {
	var result SettingsView
	keys, ok := settingKeys[id]
	if !ok || input.Revision < 0 {
		return result, ErrInvalid
	}
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Serialize creation as well as updates; locking a missing row is insufficient.
		if err := tx.Exec("SELECT pg_advisory_xact_lock(742819322)").Error; err != nil {
			return err
		}
		row := model.Setting{ID: id}
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "id = ?", id).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if row.Revision != input.Revision {
			return ErrConflict
		}
		previous, err := s.decodeSettings(row)
		if err != nil {
			return err
		}
		values := map[string]string{}
		for key, value := range input.Values {
			if secretSetting(key) {
				values[key] = value
			} else {
				values[key] = strings.TrimSpace(value)
			}
		}
		for _, key := range keys {
			if secretSetting(key) && values[key] == "" {
				values[key] = previous[key]
			}
		}
		if err := validateSettings(id, values); err != nil {
			return err
		}
		// Materialize optional values so clearing a field also clears the old environment value.
		for _, key := range keys {
			if _, exists := values[key]; !exists {
				values[key] = ""
			}
		}
		raw, err := json.Marshal(values)
		if err != nil {
			return err
		}
		row.Secret, err = s.Vault.Encrypt(string(raw), "settings:"+id)
		if err != nil {
			return err
		}
		row.Revision++
		if err := tx.Save(&row).Error; err != nil {
			return err
		}
		if err := audit(tx, actor, "settings.save", id); err != nil {
			return err
		}
		result = settingsView(row, values)
		return nil
	})
	return result, err
}

// RuntimeSettings is available only to the authenticated server integration.
func (s *Service) RuntimeSettings(ctx context.Context) (map[string]string, error) {
	var rows []model.Setting
	if err := s.DB.WithContext(ctx).Find(&rows).Error; err != nil {
		return nil, err
	}
	result := map[string]string{}
	for _, row := range rows {
		if row.ID == "deployment" {
			continue
		}
		values, err := s.decodeSettings(row)
		if err != nil {
			return nil, err
		}
		for _, key := range settingKeys[row.ID] {
			result[key] = values[key]
		}
	}
	return result, nil
}
