package service

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
)

func seedBilling(t *testing.T, s *Service) {
	t.Helper()
	if err := s.DB.Exec("CREATE TABLE users (id text PRIMARY KEY,email text); INSERT INTO users VALUES ('buyer','buyer@example.test');").Error; err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../../packages/database/migrations/0161_commercial_billing.sql")
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
