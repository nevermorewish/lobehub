package common

import (
	"encoding/base64"
	"errors"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	DatabaseURL      string
	Username         string
	Password         string
	EncryptionKey    []byte
	IntegrationToken string
	Origin           string
	Port             string
}

func LoadConfig() (Config, error) {
	c := Config{DatabaseURL: os.Getenv("DATABASE_URL"), Username: os.Getenv("ADMIN_USERNAME"), Password: os.Getenv("ADMIN_PASSWORD"), IntegrationToken: os.Getenv("ADMIN_INTEGRATION_TOKEN"), Origin: strings.TrimRight(os.Getenv("ADMIN_PUBLIC_URL"), "/"), Port: os.Getenv("PORT")}
	if c.Port == "" {
		c.Port = "3211"
	}
	if c.Username == "" {
		c.Username = "admin"
	}
	u, err := url.Parse(c.DatabaseURL)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Host == "" {
		return c, errors.New("DATABASE_URL must be a PostgreSQL URL")
	}
	u, err = url.Parse(c.Origin)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return c, errors.New("ADMIN_PUBLIC_URL must be an HTTP(S) origin without a path")
	}
	if len(c.Password) < 12 || len(c.Password) > 72 {
		return c, errors.New("ADMIN_PASSWORD must be 12–72 bytes")
	}
	if len(c.IntegrationToken) < 32 {
		return c, errors.New("ADMIN_INTEGRATION_TOKEN must contain at least 32 bytes")
	}
	c.EncryptionKey, err = base64.StdEncoding.DecodeString(os.Getenv("ADMIN_ENCRYPTION_KEY"))
	if err != nil || len(c.EncryptionKey) != 32 {
		return c, errors.New("ADMIN_ENCRYPTION_KEY must be a base64 encoded 32-byte key")
	}
	return c, nil
}
