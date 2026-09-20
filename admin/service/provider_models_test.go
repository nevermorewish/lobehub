package service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFetchProviderModels(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" || r.Header.Get("Authorization") != "Bearer private-key" {
			t.Errorf("wrong model-list request")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data":[{"id":"z-model"},{"id":"a-model","name":"A model"},{"id":"a-model"},{"id":""}]}`))
	}))
	defer upstream.Close()
	for _, base := range []string{upstream.URL, upstream.URL + "/v1", upstream.URL + "/v1/"} {
		models, err := fetchProviderModels(context.Background(), "openai", base, Credentials{APIKey: "private-key"})
		if err != nil || len(models) != 2 || models[0].ID != "a-model" || models[0].DisplayName != "A model" {
			t.Fatalf("models: %+v %v", models, err)
		}
	}
}

func TestModelDiscoveryErrorsNeverExposeSecrets(t *testing.T) {
	for _, tc := range []struct {
		status     int
		body, code string
	}{
		{401, `private-key`, "provider_credentials"}, {403, `private-key`, "provider_credentials"},
		{500, `private-key`, "provider_endpoint"}, {200, `<html>private-key</html>`, "provider_models_invalid"},
		{200, `{}`, "provider_models_invalid"}, {302, `private-key`, "provider_endpoint"},
	} {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Location", "https://example.com")
			w.WriteHeader(tc.status)
			w.Write([]byte(tc.body))
		}))
		_, err := fetchProviderModels(context.Background(), "openai", upstream.URL, Credentials{APIKey: "private-key"})
		upstream.Close()
		var target *ModelListError
		if !errors.As(err, &target) || target.Code != tc.code {
			t.Fatalf("unexpected error: %v", err)
		}
	}
}

func TestAnthropicModelsPagination(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "test" || r.Header.Get("anthropic-version") == "" {
			t.Error("missing authentication headers")
		}
		if r.URL.Query().Get("after_id") == "first" {
			w.Write([]byte(`{"data":[{"id":"second"}],"has_more":false}`))
			return
		}
		w.Write([]byte(`{"data":[{"id":"first","display_name":"First"}],"has_more":true,"last_id":"first"}`))
	}))
	defer upstream.Close()
	models, err := fetchProviderModels(context.Background(), "anthropic", upstream.URL, Credentials{APIKey: "test"})
	if err != nil || len(models) != 2 {
		t.Fatalf("pagination: %+v %v", models, err)
	}
}
