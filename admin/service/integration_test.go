package service

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"lobehub/admin/common"
	"lobehub/admin/model"
)

// Tests create a fresh schema, never truncate or migrate the application's schema.
func testService(t *testing.T) *Service {
	t.Helper()
	dsn := os.Getenv("ADMIN_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set ADMIN_TEST_DATABASE_URL to run PostgreSQL integration tests")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	token, err := common.RandomToken()
	if err != nil {
		t.Fatal(err)
	}
	schema := "admin_test_" + common.Hash(token)[:16]
	if err := db.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	s, err := New(common.Config{DatabaseURL: dsn + sep + "search_path=" + schema, Username: "operator", Password: "test-password-1234", EncryptionKey: []byte(strings.Repeat("x", 32)), IntegrationToken: strings.Repeat("t", 40), Origin: "http://localhost:3211"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = s.Close()
		_ = db.Exec("DROP SCHEMA " + schema + " CASCADE").Error
		pool, _ := db.DB()
		_ = pool.Close()
	})
	return s
}

func TestProviderSecretsAndOptimisticLock(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	p, err := s.SaveProvider(ctx, "operator", "openai", ProviderInput{Name: "OpenAI", SDKType: "openai", Enabled: true, Credentials: Credentials{APIKey: "private-api-key"}})
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(p)
	if strings.Contains(string(encoded), "private-api-key") {
		t.Fatal("secret exposed")
	}
	var stored model.Provider
	if err := s.DB.First(&stored, "id = ?", "openai").Error; err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored.Secret, "private-api-key") {
		t.Fatal("plaintext persisted")
	}
	p, err = s.SaveProvider(ctx, "operator", "openai", ProviderInput{Name: "Renamed", SDKType: "openai", Enabled: true, Revision: p.Revision})
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := s.RuntimeProvider(ctx, "openai")
	if err != nil || runtime.APIKey != "private-api-key" {
		t.Fatal("blank overwrote stored secret", err)
	}
	_, err = s.SaveProvider(ctx, "operator", "openai", ProviderInput{Name: "stale", SDKType: "openai", Revision: 1})
	if !errors.Is(err, ErrConflict) {
		t.Fatal("stale update accepted", err)
	}
	_, err = s.SaveProvider(ctx, "operator", "openai", ProviderInput{Name: "Cleared", SDKType: "openai", Revision: p.Revision, ClearSecrets: true})
	if err != nil {
		t.Fatal(err)
	}
	runtime, err = s.RuntimeProvider(ctx, "openai")
	if err != nil || runtime.APIKey != "" || runtime.Enabled {
		t.Fatal("clear/disable did not take effect")
	}
}

func TestGeneratedProviderIDsAndPriceAssociation(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	ids := make(chan string, 6)
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, err := s.CreateProvider(ctx, "operator", ProviderInput{Name: "Automatic", SDKType: "openai", Enabled: true, Credentials: Credentials{APIKey: "test-key"}})
			if err != nil {
				t.Error(err)
				return
			}
			ids <- p.ID
		}()
	}
	wg.Wait()
	close(ids)
	seen := map[string]bool{}
	for id := range ids {
		if id == "" || strings.Trim(id, "0123456789") != "" || seen[id] {
			t.Fatalf("invalid generated id: %q", id)
		}
		seen[id] = true
		if _, err := s.SavePrice(ctx, "operator", model.Price{Provider: id, ModelID: "test-model", IsActive: true}); err != nil {
			t.Fatal(err)
		}
	}
	if len(seen) != 6 {
		t.Fatalf("created %d providers", len(seen))
	}
}

func TestConcurrentPriceActivationKeepsOneVersion(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	_, err := s.SaveProvider(ctx, "operator", "openai", ProviderInput{Name: "OpenAI", SDKType: "openai"})
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	failures := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			_, err := s.SavePrice(ctx, "operator", model.Price{Provider: "openai", ModelID: "test-model", PromptCreditsPerKToken: int64(n), CompletionCreditsPerKToken: 2, IsActive: true})
			failures <- err
		}(i)
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	var active, total int64
	s.DB.Model(&model.Price{}).Count(&total)
	s.DB.Model(&model.Price{}).Where("is_active = true AND archived_at IS NULL").Count(&active)
	if total != 8 || active != 1 {
		t.Fatalf("total=%d active=%d", total, active)
	}
	catalog, err := s.Catalog(ctx)
	if err != nil || len(catalog.Prices) != 1 {
		t.Fatal("catalog did not resolve active version", err)
	}
	if err := s.ArchivePrice(ctx, "operator", catalog.Prices[0].ID); err != nil {
		t.Fatal(err)
	}
	catalog, err = s.Catalog(ctx)
	if err != nil || len(catalog.Prices) != 0 {
		t.Fatal("archived price still active")
	}
}

func TestPaymentPersistsMaskedSecretsAndValidatesActivation(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	input := PaymentInput{Enabled: true, Config: PaymentConfig{Currency: "USD", CreditsPerUnit: 1000, Sandbox: true, NotifyURL: "http://localhost:3211/notify", ReturnURL: "http://localhost:3210", PublishableKey: "pk_test_fixture"}, Secrets: PaymentSecrets{SecretKey: "sk_test_private", WebhookSecret: "whsec_private"}}
	p, err := s.SavePayment(ctx, "operator", "stripe", input)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(p)
	if strings.Contains(string(encoded), "sk_test_private") || !p.Configured["secretKey"] {
		t.Fatal("secrets not masked")
	}
	input.Revision = p.Revision
	input.Secrets = PaymentSecrets{}
	p, err = s.SavePayment(ctx, "operator", "stripe", input)
	if err != nil || !p.Configured["secretKey"] {
		t.Fatal("blank overwrite", err)
	}
	input.Revision = p.Revision
	input.ClearSecrets = true
	if _, err := s.SavePayment(ctx, "operator", "stripe", input); err == nil {
		t.Fatal("enabled without credentials")
	}
	input.Enabled = false
	if _, err := s.SavePayment(ctx, "operator", "stripe", input); err != nil {
		t.Fatal(err)
	}
	list, err := s.Payments(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[1].Enabled || list[1].Configured["secretKey"] {
		t.Fatal("clear not persisted")
	}
}

func TestUserUpdatesRevokeSessionsAndRejectStaleWrites(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	ddl := `CREATE TABLE users (id text PRIMARY KEY, username text UNIQUE, email text UNIQUE, normalized_email text UNIQUE, full_name text, avatar text, role text, banned boolean DEFAULT false, ban_reason text, ban_expires timestamptz, email_verified boolean DEFAULT false, email_verified_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), last_active_at timestamptz DEFAULT now()); CREATE TABLE auth_sessions (id text PRIMARY KEY,user_id text); CREATE TABLE nextauth_sessions (id text PRIMARY KEY,user_id text);`
	if err := s.DB.Exec(ddl).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.DB.Exec("INSERT INTO users (id,email,role) VALUES ('u1','user@example.com','user'),('a1','admin@example.com','admin'); INSERT INTO auth_sessions VALUES ('s1','u1'); INSERT INTO nextauth_sessions VALUES ('s2','u1')").Error; err != nil {
		t.Fatal(err)
	}
	var user model.User
	s.DB.First(&user, "id = ?", "u1")
	input := UserUpdate{Role: "user", Banned: true, BanReason: "test moderation", UpdatedAt: user.UpdatedAt}
	result, err := s.UpdateUser(ctx, "operator", "u1", input)
	if err != nil || !result.Banned {
		t.Fatal("ban failed", err)
	}
	for _, table := range []string{"auth_sessions", "nextauth_sessions"} {
		var count int64
		s.DB.Table(table).Count(&count)
		if count != 0 {
			t.Fatal("session not revoked")
		}
	}
	if _, err := s.UpdateUser(ctx, "operator", "u1", input); !errors.Is(err, ErrConflict) {
		t.Fatal("stale edit accepted", err)
	}
	s.DB.First(&user, "id = ?", "a1")
	if _, err := s.UpdateUser(ctx, "operator", "a1", UserUpdate{Role: "user", UpdatedAt: user.UpdatedAt}); err == nil {
		t.Fatal("last admin demoted")
	}
	page, err := s.Users(ctx, "%", "", 1, 25)
	if err != nil || page.Total != 0 {
		t.Fatal("search wildcard was not escaped", err)
	}
}

func TestAuthenticationAndLogout(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	if _, err := s.Login(ctx, "operator", "wrong"); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("wrong password accepted")
	}
	token, err := s.Login(ctx, "operator", "test-password-1234")
	if err != nil {
		t.Fatal(err)
	}
	if actor, err := s.Authenticate(ctx, token); err != nil || actor != "operator" {
		t.Fatal("session rejected", err)
	}
	var session model.Session
	s.DB.First(&session)
	if session.TokenHash == token {
		t.Fatal("session plaintext stored")
	}
	if err := s.Logout(ctx, token); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Authenticate(ctx, token); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("logged out session accepted")
	}
	token, err = s.Login(ctx, "operator", "test-password-1234")
	if err != nil {
		t.Fatal(err)
	}
	s.DB.Model(&model.Session{}).Where("token_hash = ?", common.Hash(token)).Update("expires_at", time.Now().Add(-time.Minute))
	if _, err := s.Authenticate(ctx, token); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("expired session accepted")
	}
}
