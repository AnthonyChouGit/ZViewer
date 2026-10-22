package controller

import (
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"
)

// 证书 SAN 必须同时覆盖回环、本机局域网 IPv4，以及显式传入的地址（IPv6 直连）。
func TestEnsureCoversLoopbackLANAndExtraIP(t *testing.T) {
	dir := t.TempDir()
	certs := NewCertificates(dir, func(string, string, string) {})
	extra := "2001:db8::8a2e"
	if _, err := certs.Ensure("localhost", extra); err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	cert := readIssuedCert(t, filepath.Join(dir, "tls", "cert.pem"))
	want := []string{"localhost", "127.0.0.1", "::1", extra}
	for _, host := range want {
		if err := cert.VerifyHostname(host); err != nil {
			t.Errorf("SAN 缺少 %s：%v", host, err)
		}
	}
	for _, ip := range lanIPv4s() {
		if err := cert.VerifyHostname(ip.String()); err != nil {
			t.Errorf("SAN 缺少局域网地址 %s：%v", ip, err)
		}
	}
}

// 已覆盖全部目标时 Ensure 应复用现有证书，而不是每次重签。
func TestEnsureReusesCoveredCertificate(t *testing.T) {
	dir := t.TempDir()
	certs := NewCertificates(dir, func(string, string, string) {})
	if _, err := certs.Ensure("localhost", ""); err != nil {
		t.Fatalf("首次签发: %v", err)
	}
	path := filepath.Join(dir, "tls", "cert.pem")
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := certs.Ensure("localhost", ""); err != nil {
		t.Fatalf("二次 Ensure: %v", err)
	}
	after, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if !after.ModTime().Equal(before.ModTime()) {
		t.Fatal("证书被重复签发：已覆盖的回环与局域网地址应复用现有证书")
	}
}

// 重签时不能丢掉上一次单独签发过的 IPv6 地址。
func TestEnsureKeepsPreviousExtraIP(t *testing.T) {
	dir := t.TempDir()
	certs := NewCertificates(dir, func(string, string, string) {})
	first, second := "2001:db8::1", "2001:db8::2"
	if _, err := certs.Ensure("localhost", first); err != nil {
		t.Fatalf("首次签发: %v", err)
	}
	// 第二个地址不在旧 SAN 里，必然触发重签。
	if _, err := certs.Ensure("localhost", second); err != nil {
		t.Fatalf("按新地址重签: %v", err)
	}
	cert := readIssuedCert(t, filepath.Join(dir, "tls", "cert.pem"))
	for _, want := range []string{first, second} {
		if err := cert.VerifyHostname(want); err != nil {
			t.Errorf("重签后丢了 SAN %s：%v", want, err)
		}
	}
}

func readIssuedCert(t *testing.T, path string) *x509.Certificate {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		t.Fatal("证书不是 PEM 格式")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	return cert
}
