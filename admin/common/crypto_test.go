package common

import (
	"strings"
	"testing"
)

func TestVaultAuthenticatesScopeAndCiphertext(t *testing.T) {
	v, err := NewVault([]byte(strings.Repeat("x", 32)))
	if err != nil {
		t.Fatal(err)
	}
	secret, err := v.Encrypt("private-provider-key", "provider:openai")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(secret, "private-provider-key") {
		t.Fatal("plaintext stored")
	}
	if plain, err := v.Decrypt(secret, "provider:openai"); err != nil || plain != "private-provider-key" {
		t.Fatal("roundtrip failed")
	}
	if _, err := v.Decrypt(secret, "payment:alipay"); err == nil {
		t.Fatal("credential swapping must fail")
	}
	if _, err := v.Decrypt("bad-ciphertext", "provider:openai"); err == nil {
		t.Fatal("tampering must fail")
	}
}
