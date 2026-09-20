package service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"lobehub/admin/model"
)

func TestDiscoveredModelsMarkOnlyCurrentProviderPrices(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data":[{"id":"active"},{"id":"draft"},{"id":"archived"},{"id":"other"}]}`))
	}))
	defer upstream.Close()
	p, err := s.CreateProvider(ctx, "operator", ProviderInput{Name: "Discovery", SDKType: "openai", BaseURL: upstream.URL, Credentials: Credentials{APIKey: "fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.CreateProvider(ctx, "operator", ProviderInput{Name: "Other", SDKType: "ollama"})
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"active", "draft", "archived"} {
		price, err := s.SavePrice(ctx, "operator", model.Price{Provider: p.ID, ModelID: id, IsActive: id == "active"})
		if err != nil {
			t.Fatal(err)
		}
		if id == "archived" {
			if err := s.ArchivePrice(ctx, "operator", price.ID); err != nil {
				t.Fatal(err)
			}
		}
	}
	if _, err := s.SavePrice(ctx, "operator", model.Price{Provider: other.ID, ModelID: "other", IsActive: true}); err != nil {
		t.Fatal(err)
	}
	models, err := s.ProviderModels(ctx, p.ID)
	if err != nil || len(models) != 4 {
		t.Fatalf("discovery: %+v %v", models, err)
	}
	for _, model := range models {
		if model.Configured != (model.ID == "active" || model.ID == "draft") {
			t.Fatalf("wrong configured flag: %+v", model)
		}
	}
}

func TestBulkPricesAtomicAndRetrySafe(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	p, err := s.CreateProvider(ctx, "operator", ProviderInput{Name: "Bulk", SDKType: "ollama", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	input := BulkPriceInput{Provider: p.ID, Prices: []model.Price{
		{ModelID: "one", PromptCreditsPerKToken: 3, CompletionCreditsPerKToken: 7, IsActive: true},
		{ModelID: "two", PromptCreditsPerKToken: 5, CompletionCreditsPerKToken: 9},
	}}
	result, err := s.AddPrices(ctx, "operator", input)
	if err != nil || len(result.Created) != 2 || len(result.Skipped) != 0 {
		t.Fatalf("create: %+v %v", result, err)
	}
	if result.Created[0].Provider != p.ID || result.Created[1].PromptCreditsPerKToken != 5 {
		t.Fatal("per-row values lost")
	}
	input.Prices[0].PromptCreditsPerKToken = 999
	result, err = s.AddPrices(ctx, "operator", input)
	if err != nil || len(result.Created) != 0 || len(result.Skipped) != 2 {
		t.Fatalf("retry: %+v %v", result, err)
	}
	var original model.Price
	s.DB.First(&original, "provider = ? AND model_id = ?", p.ID, "one")
	if original.PromptCreditsPerKToken != 3 || original.ArchivedAt != nil || !original.IsActive {
		t.Fatal("existing price changed")
	}
	input.Prices = []model.Price{{ModelID: "new"}, {ModelID: "invalid", PromptCreditsPerKToken: -1}}
	if _, err := s.AddPrices(ctx, "operator", input); !errors.Is(err, ErrInvalid) {
		t.Fatal("invalid batch accepted", err)
	}
	var count int64
	s.DB.Model(&model.Price{}).Where("provider = ?", p.ID).Count(&count)
	if count != 2 {
		t.Fatal("invalid batch partially saved", count)
	}
	for _, prices := range [][]model.Price{nil, {{ModelID: "same"}, {ModelID: " same "}}, make([]model.Price, 201)} {
		if _, err := s.AddPrices(ctx, "operator", BulkPriceInput{Provider: p.ID, Prices: prices}); !errors.Is(err, ErrInvalid) {
			t.Fatal("invalid size/duplicate accepted", err)
		}
	}
}

func TestBulkPricesConcurrentAddsDoNotDuplicate(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	p, err := s.CreateProvider(ctx, "operator", ProviderInput{Name: "Concurrent", SDKType: "ollama"})
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.AddPrices(ctx, "operator", BulkPriceInput{Provider: p.ID, Prices: []model.Price{{ModelID: "shared", IsActive: true}}})
			if err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	var count int64
	s.DB.Model(&model.Price{}).Where("provider = ?", p.ID).Count(&count)
	if count != 1 {
		t.Fatal("concurrent duplicates", count)
	}
}
