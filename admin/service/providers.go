package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"lobehub/admin/model"
)

var identifier = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)
var providerIdentifier = regexp.MustCompile(`^(?:[1-9][0-9]{0,18}|[a-z][a-z0-9_-]{0,63})$`)

func (s *Service) CreateProvider(ctx context.Context, actor string, input ProviderInput) (ProviderView, error) {
	var id string
	if err := s.DB.WithContext(ctx).Raw("SELECT nextval('admin_provider_id_seq')::text").Scan(&id).Error; err != nil {
		return ProviderView{}, err
	}
	input.Revision = 0
	return s.SaveProvider(ctx, actor, id, input)
}

type Credentials struct {
	APIKey          string `json:"apiKey,omitempty"`
	AccessKeyID     string `json:"accessKeyId,omitempty"`
	SecretAccessKey string `json:"secretAccessKey,omitempty"`
	Region          string `json:"region,omitempty"`
	SessionToken    string `json:"sessionToken,omitempty"`
}
type ProviderInput struct {
	Name    string `json:"name"`
	SDKType string `json:"sdkType"`
	BaseURL string `json:"baseURL"`
	Enabled bool   `json:"enabled"`
	Credentials
	ClearSecrets bool  `json:"clearSecrets"`
	Revision     int64 `json:"revision"`
}
type ProviderView struct {
	model.Provider
	Configured bool   `json:"configured"`
	Region     string `json:"region"`
}
type RuntimeProvider struct {
	ID      string `json:"id"`
	SDKType string `json:"sdkType"`
	BaseURL string `json:"baseURL"`
	Enabled bool   `json:"enabled"`
	Credentials
}

func validURL(value string, optional bool) bool {
	if value == "" {
		return optional
	}
	u, err := url.Parse(value)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" && u.User == nil && u.Fragment == "" && u.RawQuery == ""
}

func (s *Service) providerCredentials(p model.Provider) (Credentials, error) {
	var c Credentials
	raw, err := s.Vault.Decrypt(p.Secret, "provider:"+p.ID)
	if err != nil {
		return c, err
	}
	if raw != "" {
		err = json.Unmarshal([]byte(raw), &c)
	}
	return c, err
}

func (s *Service) Providers(ctx context.Context) ([]ProviderView, error) {
	rows := []model.Provider{}
	result := []ProviderView{}
	if err := s.DB.WithContext(ctx).Order("id").Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, p := range rows {
		c, err := s.providerCredentials(p)
		if err != nil {
			return nil, err
		}
		result = append(result, ProviderView{Provider: p, Configured: usableCredentials(p.SDKType, c), Region: c.Region})
	}
	return result, nil
}

func usableCredentials(sdk string, c Credentials) bool {
	return c.APIKey != "" || (sdk == "bedrock" && c.AccessKeyID != "" && c.SecretAccessKey != "" && c.Region != "") || sdk == "ollama"
}

func (s *Service) SaveProvider(ctx context.Context, actor, id string, input ProviderInput) (ProviderView, error) {
	var result ProviderView
	input.Name = strings.TrimSpace(input.Name)
	input.BaseURL = strings.TrimRight(strings.TrimSpace(input.BaseURL), "/")
	if !providerIdentifier.MatchString(id) || !identifier.MatchString(input.SDKType) || input.Name == "" || len(input.Name) > 128 || !validURL(input.BaseURL, true) {
		return result, ErrInvalid
	}
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var p model.Provider
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&p, "id = ?", id).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			p = model.Provider{ID: id}
		}
		if p.Revision != input.Revision {
			return ErrConflict
		}
		c, err := s.providerCredentials(p)
		if err != nil {
			return err
		}
		if input.ClearSecrets {
			c = Credentials{}
		}
		if strings.TrimSpace(input.APIKey) != "" {
			c.APIKey = strings.TrimSpace(input.APIKey)
		}
		if strings.TrimSpace(input.AccessKeyID) != "" {
			c.AccessKeyID = strings.TrimSpace(input.AccessKeyID)
		}
		if strings.TrimSpace(input.SecretAccessKey) != "" {
			c.SecretAccessKey = strings.TrimSpace(input.SecretAccessKey)
		}
		if strings.TrimSpace(input.SessionToken) != "" {
			c.SessionToken = strings.TrimSpace(input.SessionToken)
		}
		c.Region = strings.TrimSpace(input.Region)
		if input.Enabled && !usableCredentials(input.SDKType, c) {
			return errors.New("credentials are required before enabling this provider")
		}
		raw, err := json.Marshal(c)
		if err != nil {
			return err
		}
		p.Secret, err = s.Vault.Encrypt(string(raw), "provider:"+id)
		if err != nil {
			return err
		}
		p.Name = input.Name
		p.SDKType = input.SDKType
		p.BaseURL = input.BaseURL
		p.Enabled = input.Enabled
		p.Revision++
		if input.Revision == 0 {
			err = tx.Create(&p).Error
		} else {
			err = tx.Save(&p).Error
		}
		if err != nil {
			return err
		}
		if err := audit(tx, actor, "provider.save", id); err != nil {
			return err
		}
		result = ProviderView{Provider: p, Configured: usableCredentials(p.SDKType, c), Region: c.Region}
		return nil
	})
	return result, err
}

func (s *Service) RuntimeProvider(ctx context.Context, id string) (RuntimeProvider, error) {
	var p model.Provider
	var result RuntimeProvider
	if err := s.DB.WithContext(ctx).First(&p, "id = ?", id).Error; err != nil {
		return result, err
	}
	result = RuntimeProvider{ID: p.ID, SDKType: p.SDKType, BaseURL: p.BaseURL, Enabled: p.Enabled}
	if !p.Enabled {
		return result, nil
	}
	c, err := s.providerCredentials(p)
	result.Credentials = c
	return result, err
}
