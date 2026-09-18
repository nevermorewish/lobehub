package service

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func seedBilling(t *testing.T, s *Service) {
	t.Helper()
	if err := s.DB.Exec("CREATE TABLE users (id text PRIMARY KEY,email text); INSERT INTO users VALUES ('buyer','buyer@example.test');").Error; err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../../packages/database/migrations/0166_commercial_billing.sql")
	if err != nil {
		t.Fatal(err)
	}
	// testService installs a private search_path; never reference public fixtures.
	for _, statement := range strings.Split(strings.ReplaceAll(string(migration), `"public".`, ""), "--> statement-breakpoint") {
		if strings.TrimSpace(statement) != "" {
			if err := s.DB.Exec(statement).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := s.DB.Exec("INSERT INTO billing_accounts(id,user_id) VALUES ('account','buyer'); INSERT INTO wallets(id,billing_account_id) VALUES ('wallet','account')").Error; err != nil {
		t.Fatal(err)
	}
}

func TestBillingAdjustmentsAreAtomicAndIdempotent(t *testing.T) {
	s := testService(t)
	seedBilling(t, s)
	ctx := context.Background()
	input := AdjustmentInput{Delta: "100", Reason: "Test credit", IdempotencyKey: "11111111-1111-4111-8111-111111111111"}
	var wg sync.WaitGroup
	failures := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := s.AdjustWallet(ctx, "operator", "account", input); failures <- err }()
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	wallets, err := s.BillingWallets(ctx, "buyer@example.test", 1, 25)
	if err != nil || len(wallets.Items) != 1 || wallets.Items[0].Available != "100" || wallets.Items[0].Reserved != "0" {
		t.Fatalf("wallet mismatch: %+v %v", wallets, err)
	}
	ledger, err := s.BillingLedger(ctx, "account", 1, 25)
	if err != nil || ledger.Total != 1 || ledger.Items[0].Delta != "100" {
		t.Fatalf("ledger mismatch: %+v %v", ledger, err)
	}
	input.Delta = "101"
	if _, err = s.AdjustWallet(ctx, "operator", "account", input); !errors.Is(err, ErrConflict) {
		t.Fatal("changed retry accepted", err)
	}
	input.IdempotencyKey = "22222222-2222-4222-8222-222222222222"
	input.Delta = "-101"
	if _, err = s.AdjustWallet(ctx, "operator", "account", input); !errors.Is(err, ErrInsufficientCredits) {
		t.Fatal("overdraw accepted", err)
	}
	input.Delta = "-40"
	if _, err = s.AdjustWallet(ctx, "operator", "account", input); err != nil {
		t.Fatal(err)
	}
	wallets, _ = s.BillingWallets(ctx, "buyer", 1, 25)
	if wallets.Items[0].Available != "60" {
		t.Fatal("balance after adjustment", wallets)
	}
	var audits int64
	if err = s.DB.Table("admin_audit_events").Where("action = ?", "billing.adjust").Count(&audits).Error; err != nil {
		t.Fatal(err)
	}
	if audits != 2 {
		t.Fatal("adjustment audit count", audits)
	}
}

func TestCreditPackRevisionsAndOrderSnapshot(t *testing.T) {
	s := testService(t)
	seedBilling(t, s)
	ctx := context.Background()
	pack := CreditPackInput{Slug: "starter", Name: "Starter", Credits: "500", AmountMinor: "990", Status: "active"}
	if err := s.SaveCreditPack(ctx, "operator", pack); err != nil {
		t.Fatal(err)
	}
	rows, err := s.CreditPacks(ctx)
	if err != nil || len(rows) != 1 || rows[0].Credits != "500" || rows[0].AmountMinor != "990" {
		t.Fatalf("pack mismatch: %+v %v", rows, err)
	}
	original := rows[0]
	if err := s.DB.Exec(`INSERT INTO orders(id,order_no,billing_account_id,user_id,plan_price_id,amount_minor,currency,idempotency_key,payment_app_id,payment_seller_id,payment_sandbox,price_snapshot) VALUES ('order','LH-test','account','buyer',?,990,'CNY','checkout','app','seller',true,'{"creditGrant":"500"}')`, original.PriceID).Error; err != nil {
		t.Fatal(err)
	}
	pack.PriceID = original.PriceID
	pack.Credits = "700"
	pack.AmountMinor = "1290"
	if err := s.SaveCreditPack(ctx, "operator", pack); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveCreditPack(ctx, "operator", pack); !errors.Is(err, ErrConflict) {
		t.Fatal("stale pack overwrite accepted", err)
	}
	rows, _ = s.CreditPacks(ctx)
	if len(rows) != 1 || rows[0].Credits != "700" || rows[0].PriceID == original.PriceID {
		t.Fatal("price revision not created", rows)
	}
	orders, err := s.BillingOrders(ctx, "LH-test", 1, 25)
	if err != nil || len(orders.Items) != 1 || orders.Items[0].CreditGrant != "500" || orders.Items[0].AmountMinor != "990" {
		t.Fatalf("order snapshot changed: %+v %v", orders, err)
	}
}

func TestUserBillingDeletionPreservesFinancialHistory(t *testing.T) {
	s := testService(t)
	seedBilling(t, s)
	ctx := context.Background()
	if err := s.DB.Exec(`ALTER TABLE users ADD COLUMN username text,ADD COLUMN full_name text,ADD COLUMN avatar text,ADD COLUMN role text DEFAULT 'user',ADD COLUMN banned boolean DEFAULT false,ADD COLUMN ban_reason text,ADD COLUMN ban_expires timestamptz,ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN updated_at timestamptz DEFAULT now(),ADD COLUMN last_active_at timestamptz DEFAULT now();
 INSERT INTO users(id,email,role) VALUES ('last-admin','admin@example.test','admin');
 CREATE TABLE auth_sessions(id text,user_id text); CREATE TABLE nextauth_sessions(id text,user_id text); CREATE TABLE api_keys(id text,user_id text);
 INSERT INTO auth_sessions VALUES('session','buyer');INSERT INTO api_keys VALUES('key','buyer');`).Error; err != nil {
		t.Fatal(err)
	}
	wallet, err := s.UserWallet(ctx, "operator", "buyer")
	if err != nil || wallet.ID != "account" {
		t.Fatal("wallet initialization", err)
	}
	if _, err := s.AdjustWallet(ctx, "operator", wallet.ID, AdjustmentInput{Delta: "100", Reason: "test", IdempotencyKey: "11111111-1111-4111-8111-111111111119"}); err != nil {
		t.Fatal(err)
	}
	users, err := s.Users(ctx, "buyer@example.test", "", 1, 25)
	if err != nil || len(users.Items) != 1 || users.Items[0].Available != "100" {
		t.Fatal("user wallet aggregate", err, users)
	}
	user := users.Items[0]
	if err := s.DeleteUser(ctx, "operator", user.ID, user.UpdatedAt.Add(-time.Second)); !errors.Is(err, ErrConflict) {
		t.Fatal("stale deletion accepted", err)
	}
	if err := s.DeleteUser(ctx, "operator", user.ID, user.UpdatedAt); err != nil {
		t.Fatal(err)
	}
	users, err = s.Users(ctx, "buyer@example.test", "", 1, 25)
	if err != nil || users.Total != 0 {
		t.Fatal("deleted user still listed", err)
	}
	var count int64
	for _, table := range []string{"auth_sessions", "api_keys"} {
		s.DB.Table(table).Where("user_id=?", user.ID).Count(&count)
		if count != 0 {
			t.Fatal("credentials not revoked", table)
		}
	}
	s.DB.Table("ledger_entries").Where("billing_account_id=?", wallet.ID).Count(&count)
	if count != 1 {
		t.Fatal("financial history lost")
	}
	var banned bool
	s.DB.Raw("SELECT banned FROM users WHERE id=?", user.ID).Scan(&banned)
	if !banned {
		t.Fatal("deleted user can authenticate")
	}
	users, err = s.Users(ctx, "last-admin", "", 1, 25)
	if err != nil || len(users.Items) != 1 {
		t.Fatal("admin fixture", err)
	}
	if err := s.DeleteUser(ctx, "operator", "last-admin", users.Items[0].UpdatedAt); !errors.Is(err, ErrLastAdmin) {
		t.Fatal("last administrator deleted", err)
	}
}

func TestLedgerModelDetailsAndFilteredTotals(t *testing.T) {
	s := testService(t)
	seedBilling(t, s)
	ctx := context.Background()
	if err := s.DB.Exec(`INSERT INTO ledger_entries(id,billing_account_id,kind,delta,available_delta,reserved_delta,balance_after,idempotency_key,reason) VALUES
 ('hold1','account','hold',0,-20,20,80,'hold:request-one','chat'),
 ('debit1','account','debit',-8,12,-20,92,'debit:request-one','chat');
 INSERT INTO usage_records(id,billing_account_id,user_id,request_id,model_id,provider,prompt_tokens,completion_tokens,total_tokens,credits_charged,settlement_status,price_snapshot,ledger_entry_id)
 VALUES('usage1','account','buyer','request-one','test-chat','openai',1500,500,2000,8,'settled','{"promptPerK":"2","completionPerK":"10","heldCredits":"20","holdId":"hold1"}','debit1');
 UPDATE ledger_entries SET usage_record_id='usage1' WHERE id='debit1';`).Error; err != nil {
		t.Fatal(err)
	}
	result, err := s.FilteredBillingLedger(ctx, LedgerFilter{User: "buyer", Model: "test-chat"}, 1, 1)
	if err != nil || result.Total != 2 || len(result.Items) != 1 || result.Summary.Debited != "8" || result.Summary.TotalTokens != "2000" {
		t.Fatal("filtered totals mismatch", err, result)
	}
	result, err = s.FilteredBillingLedger(ctx, LedgerFilter{Kind: "hold"}, 1, 25)
	if err != nil || result.Total != 1 || result.Items[0].ModelID == nil || *result.Items[0].ModelID != "test-chat" || *result.Items[0].PromptRate != "2" {
		t.Fatal("hold lost request detail", err, result)
	}
	result, err = s.FilteredBillingLedger(ctx, LedgerFilter{Provider: "other"}, 1, 25)
	if err != nil || result.Total != 0 || result.Summary.Debited != "0" {
		t.Fatal("provider filter mismatch", err, result)
	}
}
