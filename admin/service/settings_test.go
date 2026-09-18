package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"lobehub/admin/model"
)

func TestSettingsValidation(t *testing.T) {
	for _, values := range []map[string]string{
		{"APP_URL": "javascript:alert(1)"},
		{"APP_URL": "https://example.com/path"},
		{"APP_URL": "https://example.com", "NODE_OPTIONS": "--inspect"},
		{"APP_URL": "https://user:password@example.com"},
		{"APP_URL": "https://example.com?token=secret"},
		{"APP_URL": "https://example.com", "LLM_VISION_IMAGE_USE_BASE64": "yes"},
	} {
		if err := validateSettings("system", values); !errors.Is(err, ErrInvalid) {
			t.Fatalf("accepted invalid settings: %v", values)
		}
	}
	if err := validateSettings("system", map[string]string{"APP_URL": "https://example.com", "INTERNAL_APP_URL": "http://lobe:3210"}); err != nil {
		t.Fatal(err)
	}
}

func TestSettingsPersistenceSecretsAndConflict(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	empty, err := s.Settings(ctx, "storage")
	if err != nil || empty.Configured || empty.Revision != 0 {
		t.Fatal("invalid initial state", err)
	}
	values := map[string]string{"S3_BUCKET": "test-bucket", "S3_ENDPOINT": "https://s3.example.com", "S3_ACCESS_KEY_ID": "private-id", "S3_SECRET_ACCESS_KEY": "private-secret", "S3_ENABLE_PATH_STYLE": "1", "S3_SET_ACL": "0", "S3_PREVIEW_URL_EXPIRE_IN": "7200"}
	saved, err := s.SaveSettings(ctx, "operator", "storage", SettingsInput{Values: values})
	if err != nil || saved.Revision != 1 || !saved.Configured {
		t.Fatal("save failed", err)
	}
	encoded, _ := json.Marshal(saved)
	if strings.Contains(string(encoded), "private-") {
		t.Fatal("secret exposed")
	}
	var row model.Setting
	if err := s.DB.First(&row, "id = ?", "storage").Error; err != nil {
		t.Fatal(err)
	}
	if strings.Contains(row.Secret, "private-") {
		t.Fatal("plaintext persisted")
	}
	values["S3_ACCESS_KEY_ID"], values["S3_SECRET_ACCESS_KEY"] = "", ""
	values["S3_PUBLIC_DOMAIN"] = "https://files.example.com"
	saved, err = s.SaveSettings(ctx, "operator", "storage", SettingsInput{Values: values, Revision: saved.Revision})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveSettings(ctx, "operator", "storage", SettingsInput{Values: values, Revision: 1}); !errors.Is(err, ErrConflict) {
		t.Fatal("stale save accepted", err)
	}
	loaded, err := s.Settings(ctx, "storage")
	if err != nil || loaded.Revision != saved.Revision || loaded.Values["S3_PUBLIC_DOMAIN"] != "https://files.example.com" {
		t.Fatal("settings not persisted", err)
	}
	runtime, err := s.RuntimeSettings(ctx)
	if err != nil || runtime["S3_ACCESS_KEY_ID"] != "private-id" || runtime["S3_SECRET_ACCESS_KEY"] != "private-secret" {
		t.Fatal("blank credentials replaced saved credentials", err)
	}
	if _, exists := runtime["S3_INTERNAL_ENDPOINT"]; !exists {
		t.Fatal("optional clear missing")
	}
	var count int64
	s.DB.Model(&model.Audit{}).Where("action = ?", "settings.save").Count(&count)
	if count != 2 {
		t.Fatal("audit missing or conflict was audited")
	}
}
