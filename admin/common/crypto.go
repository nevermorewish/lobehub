package common

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
)

type Vault struct{ cipher cipher.AEAD }

func NewVault(key []byte) (*Vault, error) {
	b, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	a, err := cipher.NewGCM(b)
	if err != nil {
		return nil, err
	}
	return &Vault{cipher: a}, nil
}

func (v *Vault) Encrypt(value, scope string) (string, error) {
	nonce := make([]byte, v.cipher.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(v.cipher.Seal(nonce, nonce, []byte(value), []byte(scope))), nil
}

func (v *Vault) Decrypt(value, scope string) (string, error) {
	if value == "" {
		return "", nil
	}
	b, err := base64.StdEncoding.DecodeString(value)
	if err != nil || len(b) < v.cipher.NonceSize() {
		return "", errors.New("invalid encrypted value")
	}
	n := v.cipher.NonceSize()
	plain, err := v.cipher.Open(nil, b[:n], b[n:], []byte(scope))
	if err != nil {
		return "", errors.New("unable to decrypt stored credentials")
	}
	return string(plain), nil
}

func RandomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func Hash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
