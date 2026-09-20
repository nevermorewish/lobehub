package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"lobehub/admin/model"
)

type ProviderModel struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
}

// Only stable error codes cross the API boundary; upstream bodies may contain secrets.
type ModelListError struct{ Code string }

func (e *ModelListError) Error() string { return e.Code }

var modelBaseURLs = map[string]string{
	"openai": "https://api.openai.com/v1", "anthropic": "https://api.anthropic.com/v1",
	"google": "https://generativelanguage.googleapis.com/v1beta", "deepseek": "https://api.deepseek.com/v1",
	"qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1", "volcengine": "https://ark.cn-beijing.volces.com/api/v3",
	"ollama": "http://localhost:11434", "openrouter": "https://openrouter.ai/api/v1", "moonshot": "https://api.moonshot.cn/v1",
}

func (s *Service) ProviderModels(ctx context.Context, id string) ([]ProviderModel, error) {
	var provider model.Provider
	if err := s.DB.WithContext(ctx).First(&provider, "id = ?", id).Error; err != nil {
		return nil, err
	}
	credentials, err := s.providerCredentials(provider)
	if err != nil {
		return nil, err
	}
	if !usableCredentials(provider.SDKType, credentials) {
		return nil, &ModelListError{Code: "provider_credentials"}
	}
	// A disabled provider may be inspected before publishing it to users.
	return fetchProviderModels(ctx, provider.SDKType, provider.BaseURL, credentials)
}

func fetchProviderModels(ctx context.Context, sdk, baseURL string, credentials Credentials) ([]ProviderModel, error) {
	defaultURL, supported := modelBaseURLs[sdk]
	if !supported {
		return nil, &ModelListError{Code: "provider_models_unsupported"}
	}
	if baseURL == "" {
		baseURL = defaultURL
	}
	u, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil || !validURL(baseURL, false) {
		return nil, &ModelListError{Code: "provider_endpoint"}
	}
	if sdk == "ollama" {
		u.Path = strings.TrimSuffix(u.Path, "/v1") + "/api/tags"
	} else {
		if u.Path == "" || u.Path == "/" {
			if sdk == "google" {
				u.Path = "/v1beta"
			} else {
				u.Path = "/v1"
			}
		}
		u.Path = strings.TrimRight(u.Path, "/") + "/models"
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	client := &http.Client{CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	result := []ProviderModel{}
	seen := map[string]bool{}
	for page := 0; page < 20; page++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		if err != nil {
			return nil, &ModelListError{Code: "provider_endpoint"}
		}
		req.Header.Set("Accept", "application/json")
		switch sdk {
		case "anthropic":
			req.Header.Set("x-api-key", credentials.APIKey)
			req.Header.Set("anthropic-version", "2023-06-01")
		case "google":
			req.Header.Set("x-goog-api-key", credentials.APIKey)
		default:
			if credentials.APIKey != "" {
				req.Header.Set("Authorization", "Bearer "+credentials.APIKey)
			}
		}
		resp, err := client.Do(req)
		if err != nil {
			return nil, &ModelListError{Code: "provider_unavailable"}
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024+1))
		resp.Body.Close()
		if resp.StatusCode == 401 || resp.StatusCode == 403 {
			return nil, &ModelListError{Code: "provider_credentials"}
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, &ModelListError{Code: "provider_endpoint"}
		}
		if readErr != nil || len(body) > 4*1024*1024 {
			return nil, &ModelListError{Code: "provider_models_invalid"}
		}
		var payload struct {
			Data []struct {
				ID          string `json:"id"`
				Name        string `json:"name"`
				DisplayName string `json:"display_name"`
			} `json:"data"`
			Models []struct {
				Name        string `json:"name"`
				Model       string `json:"model"`
				DisplayName string `json:"displayName"`
			} `json:"models"`
			HasMore       bool   `json:"has_more"`
			LastID        string `json:"last_id"`
			NextPageToken string `json:"nextPageToken"`
		}
		if json.Unmarshal(body, &payload) != nil {
			return nil, &ModelListError{Code: "provider_models_invalid"}
		}
		items := []ProviderModel{}
		if sdk == "google" || sdk == "ollama" {
			if payload.Models == nil {
				return nil, &ModelListError{Code: "provider_models_invalid"}
			}
			for _, m := range payload.Models {
				id := strings.TrimPrefix(m.Name, "models/")
				if sdk == "ollama" && m.Model != "" {
					id = m.Model
				}
				items = append(items, ProviderModel{ID: id, DisplayName: m.DisplayName})
			}
		} else {
			if payload.Data == nil {
				return nil, &ModelListError{Code: "provider_models_invalid"}
			}
			for _, m := range payload.Data {
				name := m.DisplayName
				if name == "" {
					name = m.Name
				}
				items = append(items, ProviderModel{ID: m.ID, DisplayName: name})
			}
		}
		for _, item := range items {
			item.ID = strings.TrimSpace(item.ID)
			if item.ID == "" || len(item.ID) > 128 || seen[item.ID] {
				continue
			}
			if item.DisplayName == "" || len(item.DisplayName) > 128 {
				item.DisplayName = item.ID
			}
			seen[item.ID] = true
			result = append(result, item)
		}
		query := u.Query()
		if sdk == "google" && payload.NextPageToken != "" {
			query.Set("pageToken", payload.NextPageToken)
		} else if sdk == "anthropic" && payload.HasMore && payload.LastID != "" {
			query.Set("after_id", payload.LastID)
		} else {
			sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
			return result, nil
		}
		u.RawQuery = query.Encode()
	}
	return nil, &ModelListError{Code: "provider_models_invalid"}
}
