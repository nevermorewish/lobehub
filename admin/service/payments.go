package service

import (
	"context"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"lobehub/admin/model"
)

type PaymentConfig struct {
	AppID          string `json:"appId"`
	MerchantID     string `json:"merchantId"`
	NotifyURL      string `json:"notifyURL"`
	ReturnURL      string `json:"returnURL"`
	PublishableKey string `json:"publishableKey"`
	Sandbox        bool   `json:"sandbox"`
	Currency       string `json:"currency"`
	CreditsPerUnit int64  `json:"creditsPerUnit"`
}
type PaymentSecrets struct {
	PrivateKey    string `json:"privateKey,omitempty"`
	PublicKey     string `json:"publicKey,omitempty"`
	SecretKey     string `json:"secretKey,omitempty"`
	WebhookSecret string `json:"webhookSecret,omitempty"`
}
type PaymentInput struct {
	Enabled      bool           `json:"enabled"`
	Config       PaymentConfig  `json:"config"`
	Secrets      PaymentSecrets `json:"secrets"`
	ClearSecrets bool           `json:"clearSecrets"`
	Revision     int64          `json:"revision"`
}
type PaymentView struct {
	model.Payment
	Config     PaymentConfig   `json:"config"`
	Configured map[string]bool `json:"configured"`
}

func paymentID(id string) bool { return id == "alipay" || id == "stripe" }

func validatePayment(id string, c PaymentConfig, s PaymentSecrets, enabled bool) error {
	if !paymentID(id) || len(c.AppID) > 128 || len(c.MerchantID) > 128 || c.CreditsPerUnit < 1 || c.CreditsPerUnit > 1000000000 || (c.Currency != "CNY" && c.Currency != "USD") || !validURL(c.NotifyURL, true) || !validURL(c.ReturnURL, true) {
		return ErrInvalid
	}
	if s.PrivateKey != "" {
		if _, err := parsePrivateKey(s.PrivateKey); err != nil {
			return err
		}
	}
	if s.PublicKey != "" {
		if _, err := parsePublicKey(s.PublicKey); err != nil {
			return err
		}
	}
	if !enabled {
		return nil
	}
	if id == "alipay" && (c.AppID == "" || c.MerchantID == "" || c.NotifyURL == "" || c.ReturnURL == "" || s.PrivateKey == "" || s.PublicKey == "" || c.Currency != "CNY") {
		return errors.New("Alipay requires App ID, seller PID, callback URLs, RSA2 keys and CNY currency")
	}
	if id == "stripe" && (!strings.HasPrefix(s.SecretKey, "sk_") || !strings.HasPrefix(s.WebhookSecret, "whsec_") || !strings.HasPrefix(c.PublishableKey, "pk_") || c.NotifyURL == "" || c.ReturnURL == "") {
		return errors.New("Stripe requires publishable, secret and webhook keys and callback URLs")
	}
	if !c.Sandbox && (!strings.HasPrefix(c.NotifyURL, "https://") || !strings.HasPrefix(c.ReturnURL, "https://")) {
		return errors.New("production payment callbacks require HTTPS")
	}
	return nil
}

// Runtime credentials are exposed only through the authenticated internal API.
// Disabled configurations remain readable for verifying payments already in flight.
func (s *Service) RuntimePayment(ctx context.Context, id string) (map[string]any, error) {
	var p model.Payment
	if id != "alipay" {
		return nil, ErrInvalid
	}
	if err := s.DB.WithContext(ctx).First(&p, "id = ?", id).Error; err != nil {
		return nil, err
	}
	c, secrets, err := s.paymentData(p)
	if err != nil {
		return nil, err
	}
	return map[string]any{"enabled": p.Enabled, "config": c, "privateKey": secrets.PrivateKey, "publicKey": secrets.PublicKey}, nil
}

func parsePrivateKey(value string) (*rsa.PrivateKey, error) {
	b, _ := pem.Decode([]byte(value))
	if b == nil {
		return nil, errors.New("private key must be RSA PEM")
	}
	key, err := x509.ParsePKCS8PrivateKey(b.Bytes)
	if err != nil {
		key, err = x509.ParsePKCS1PrivateKey(b.Bytes)
	}
	if err != nil {
		return nil, errors.New("private key must be RSA PEM")
	}
	r, ok := key.(*rsa.PrivateKey)
	if !ok || r.N.BitLen() < 2048 {
		return nil, errors.New("RSA private key must be at least 2048 bits")
	}
	return r, nil
}
func parsePublicKey(value string) (*rsa.PublicKey, error) {
	b, _ := pem.Decode([]byte(value))
	if b == nil {
		return nil, errors.New("public key must be RSA PEM")
	}
	key, err := x509.ParsePKIXPublicKey(b.Bytes)
	if err != nil {
		key, err = x509.ParsePKCS1PublicKey(b.Bytes)
	}
	if err != nil {
		return nil, errors.New("public key must be RSA PEM")
	}
	r, ok := key.(*rsa.PublicKey)
	if !ok || r.N.BitLen() < 2048 {
		return nil, errors.New("RSA public key must be at least 2048 bits")
	}
	return r, nil
}

func (s *Service) paymentData(p model.Payment) (PaymentConfig, PaymentSecrets, error) {
	c := PaymentConfig{Currency: "CNY", CreditsPerUnit: 1000}
	var secrets PaymentSecrets
	if p.Config != "" {
		if err := json.Unmarshal([]byte(p.Config), &c); err != nil {
			return c, secrets, err
		}
	}
	raw, err := s.Vault.Decrypt(p.Secret, "payment:"+p.ID)
	if err != nil {
		return c, secrets, err
	}
	if raw != "" {
		err = json.Unmarshal([]byte(raw), &secrets)
	}
	return c, secrets, err
}
func paymentView(p model.Payment, c PaymentConfig, secrets PaymentSecrets) PaymentView {
	return PaymentView{Payment: p, Config: c, Configured: map[string]bool{"privateKey": secrets.PrivateKey != "", "publicKey": secrets.PublicKey != "", "secretKey": secrets.SecretKey != "", "webhookSecret": secrets.WebhookSecret != ""}}
}

func (s *Service) Payments(ctx context.Context) ([]PaymentView, error) {
	result := []PaymentView{}
	for _, id := range []string{"alipay", "stripe"} {
		p := model.Payment{ID: id}
		if err := s.DB.WithContext(ctx).First(&p, "id = ?", id).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		c, secrets, err := s.paymentData(p)
		if err != nil {
			return nil, err
		}
		result = append(result, paymentView(p, c, secrets))
	}
	return result, nil
}

func (s *Service) SavePayment(ctx context.Context, actor, id string, input PaymentInput) (PaymentView, error) {
	var result PaymentView
	if !paymentID(id) {
		return result, ErrInvalid
	}
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p := model.Payment{ID: id}
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&p, "id = ?", id).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if p.Revision != input.Revision {
			return ErrConflict
		}
		_, secrets, err := s.paymentData(p)
		if err != nil {
			return err
		}
		if input.ClearSecrets {
			secrets = PaymentSecrets{}
		}
		if strings.TrimSpace(input.Secrets.PrivateKey) != "" {
			secrets.PrivateKey = strings.TrimSpace(input.Secrets.PrivateKey)
		}
		if strings.TrimSpace(input.Secrets.PublicKey) != "" {
			secrets.PublicKey = strings.TrimSpace(input.Secrets.PublicKey)
		}
		if strings.TrimSpace(input.Secrets.SecretKey) != "" {
			secrets.SecretKey = strings.TrimSpace(input.Secrets.SecretKey)
		}
		if strings.TrimSpace(input.Secrets.WebhookSecret) != "" {
			secrets.WebhookSecret = strings.TrimSpace(input.Secrets.WebhookSecret)
		}
		if err := validatePayment(id, input.Config, secrets, input.Enabled); err != nil {
			return err
		}
		raw, err := json.Marshal(secrets)
		if err != nil {
			return err
		}
		p.Secret, err = s.Vault.Encrypt(string(raw), "payment:"+id)
		if err != nil {
			return err
		}
		public, err := json.Marshal(input.Config)
		if err != nil {
			return err
		}
		p.Config = string(public)
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
		if err := audit(tx, actor, "payment.save", id); err != nil {
			return err
		}
		result = paymentView(p, input.Config, secrets)
		return nil
	})
	return result, err
}
