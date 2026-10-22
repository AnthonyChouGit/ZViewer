package controller

// 证书层：与 desktop/lib/certificates.cjs 等价。
// 本机 CA + 域名/内网 IP 服务端证书，全部用标准库生成，不再依赖 @peculiar/x509。

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type CertPaths struct {
	Cert  string
	Key   string
	CA    string
	CAKey string
}

type CertInfo struct {
	Exists      bool   `json:"exists"`
	Valid       bool   `json:"valid"`
	Subject     string `json:"subject"`
	SAN         string `json:"san"`
	ValidTo     string `json:"validTo"`
	Fingerprint string `json:"fingerprint"`
	Thumbprint  string `json:"thumbprint"`
	CA          bool   `json:"ca"`
}

type Certificates struct {
	dir string
	log func(message, source, level string)
}

func NewCertificates(dir string, log func(message, source, level string)) *Certificates {
	return &Certificates{dir: filepath.Join(dir, "tls"), log: log}
}

func (c *Certificates) Paths() CertPaths {
	return CertPaths{
		Cert:  filepath.Join(c.dir, "cert.pem"),
		Key:   filepath.Join(c.dir, "key.pem"),
		CA:    filepath.Join(c.dir, "root-ca.pem"),
		CAKey: filepath.Join(c.dir, "root-ca.key"),
	}
}

func (c *Certificates) Inspect() CertInfo {
	paths := c.Paths()
	certPEM, err := os.ReadFile(paths.Cert)
	if err != nil {
		return CertInfo{Exists: false, Valid: false}
	}
	caPEM, err := os.ReadFile(paths.CA)
	if err != nil {
		return CertInfo{Exists: false, Valid: false}
	}
	keyPEM, err := os.ReadFile(paths.Key)
	if err != nil {
		return CertInfo{Exists: false, Valid: false}
	}
	return inspectPEM(certPEM, caPEM, keyPEM)
}

func inspectPEM(certPEM, caPEM, keyPEM []byte) CertInfo {
	cert, err := parseCertificate(certPEM)
	if err != nil {
		return CertInfo{Exists: false, Valid: false}
	}
	root, err := parseCertificate(caPEM)
	if err != nil {
		return CertInfo{Exists: false, Valid: false}
	}
	key, err := parsePrivateKey(keyPEM)
	if err != nil {
		return CertInfo{Exists: false, Valid: false}
	}
	now := time.Now()
	valid := !now.Before(cert.NotBefore) &&
		cert.NotAfter.After(now.Add(24*time.Hour)) &&
		cert.CheckSignatureFrom(root) == nil &&
		keyMatches(cert, key)

	netIPs := make([]string, 0, len(cert.IPAddresses))
	for _, ip := range cert.IPAddresses {
		netIPs = append(netIPs, "IP Address:"+ip.String())
	}
	names := make([]string, 0, len(cert.DNSNames))
	for _, name := range cert.DNSNames {
		names = append(names, "DNS:"+name)
	}
	sum := sha256.Sum256(root.Raw)
	thumb := sha1.Sum(root.Raw)
	return CertInfo{
		Exists:      true,
		Valid:       valid,
		Subject:     cert.Subject.String(),
		SAN:         strings.Join(append(names, netIPs...), ", "),
		ValidTo:     cert.NotAfter.Format("2006-01-02 15:04:05"),
		Fingerprint: colonHex(sum[:]),
		Thumbprint:  strings.ToUpper(hex.EncodeToString(thumb[:])),
		CA:          root.IsCA,
	}
}

func parseCertificate(raw []byte) (*x509.Certificate, error) {
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, errors.New("证书不是 PEM 格式")
	}
	return x509.ParseCertificate(block.Bytes)
}

func parsePrivateKey(raw []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, errors.New("私钥不是 PEM 格式")
	}
	if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		if typed, ok := key.(*rsa.PrivateKey); ok {
			return typed, nil
		}
		return nil, errors.New("私钥类型不受支持")
	}
	return x509.ParsePKCS1PrivateKey(block.Bytes)
}

func keyMatches(cert *x509.Certificate, key *rsa.PrivateKey) bool {
	public, ok := cert.PublicKey.(*rsa.PublicKey)
	if !ok {
		return false
	}
	return public.Equal(&key.PublicKey)
}

func colonHex(raw []byte) string {
	parts := make([]string, len(raw))
	for index, value := range raw {
		parts[index] = strings.ToUpper(hex.EncodeToString([]byte{value}))
	}
	return strings.Join(parts, ":")
}

func privatePEM(key *rsa.PrivateKey) (string, error) {
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return "", err
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})), nil
}

func randomSerial() (*big.Int, error) {
	limit := new(big.Int).Lsh(big.NewInt(1), 128)
	return rand.Int(rand.Reader, limit)
}

// protect 收紧 TLS 目录权限：只有当前用户与 SYSTEM 可访问。
func (c *Certificates) protect() error {
	if !isWindows() {
		return nil
	}
	out, err := exec.Command("whoami.exe", "/user", "/fo", "csv", "/nh").Output()
	if err != nil {
		return fmt.Errorf("无法确认当前 Windows 用户，停止保存私钥")
	}
	match := regexpSID.FindString(string(out))
	if match == "" {
		return errors.New("无法确认当前 Windows 用户，停止保存私钥")
	}
	cmd := exec.Command("icacls.exe", c.dir, "/inheritance:r", "/grant:r",
		"*"+match+":(OI)(CI)F", "*S-1-5-18:(OI)(CI)F")
	hideWindow(cmd)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("设置私钥目录权限失败：%w", err)
	}
	return nil
}

func (c *Certificates) ensureCA(paths CertPaths, before time.Time) (*x509.Certificate, *rsa.PrivateKey, error) {
	hasCA := fileExists(paths.CA)
	hasKey := fileExists(paths.CAKey)
	if hasCA || hasKey {
		if !hasCA || !hasKey {
			return nil, nil, errors.New("本地 CA 文件不完整，请恢复备份；不会自动替换已信任的 CA")
		}
		rawCert, err := os.ReadFile(paths.CA)
		if err != nil {
			return nil, nil, err
		}
		root, err := parseCertificate(rawCert)
		if err != nil {
			return nil, nil, errors.New("本地 CA 无效或临近过期，需要手动轮换")
		}
		rawKey, err := os.ReadFile(paths.CAKey)
		if err != nil {
			return nil, nil, err
		}
		key, err := parsePrivateKey(rawKey)
		if err != nil {
			return nil, nil, errors.New("本地 CA 无效或临近过期，需要手动轮换")
		}
		if !root.IsCA || root.NotAfter.Before(time.Now().Add(400*24*time.Hour)) || !keyMatches(root, key) {
			return nil, nil, errors.New("本地 CA 无效或临近过期，需要手动轮换")
		}
		return root, key, nil
	}

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, nil, err
	}
	serial, err := randomSerial()
	if err != nil {
		return nil, nil, err
	}
	suffix := make([]byte, 5)
	_, _ = rand.Read(suffix)
	template := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "ZViewer Local CA " + hex.EncodeToString(suffix), Organization: []string{"ZViewer Desktop"}},
		NotBefore:             before,
		NotAfter:              time.Now().Add(3650 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLen:            0,
		MaxPathLenZero:        true,
		SubjectKeyId:          subjectKeyID(&key.PublicKey),
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return nil, nil, err
	}
	root, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, nil, err
	}
	keyText, err := privatePEM(key)
	if err != nil {
		return nil, nil, err
	}
	if err := Atomic(paths.CAKey, keyText); err != nil {
		return nil, nil, err
	}
	if err := Atomic(paths.CA, string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))); err != nil {
		return nil, nil, err
	}
	c.log("已创建本机专用 CA，尚未安装系统信任", "cert", "INFO")
	return root, key, nil
}

func subjectKeyID(public *rsa.PublicKey) []byte {
	der, err := x509.MarshalPKIXPublicKey(public)
	if err != nil {
		return nil
	}
	sum := sha1.Sum(der)
	return sum[:]
}

// Ensure 签发（或复用）覆盖目标域名与 IP 的服务端证书。
func (c *Certificates) Ensure(domain, ip string) (CertInfo, error) {
	if !IsHostname(domain) || net.ParseIP(domain) != nil {
		return CertInfo{}, errors.New("证书域名或 IP 无效")
	}
	if ip != "" && net.ParseIP(ip) == nil {
		return CertInfo{}, errors.New("证书域名或 IP 无效")
	}
	paths := c.Paths()
	info := c.Inspect()
	if info.Valid {
		if raw, err := os.ReadFile(paths.Cert); err == nil {
			if cert, err := parseCertificate(raw); err == nil {
				covered := cert.VerifyHostname(domain) == nil
				if ip != "" {
					covered = covered && cert.VerifyHostname(ip) == nil
				}
				if covered {
					return info, nil
				}
			}
		}
	}
	if err := os.MkdirAll(c.dir, 0o700); err != nil {
		return CertInfo{}, err
	}
	if err := c.protect(); err != nil {
		return CertInfo{}, err
	}
	before := time.Now().Add(-5 * time.Minute)
	root, rootKey, err := c.ensureCA(paths, before)
	if err != nil {
		return CertInfo{}, err
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return CertInfo{}, err
	}
	serial, err := randomSerial()
	if err != nil {
		return CertInfo{}, err
	}
	dns := []string{"localhost"}
	if domain != "localhost" {
		dns = append(dns, domain)
	}
	ips := []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")}
	if ip != "" && ip != "127.0.0.1" && ip != "::1" {
		ips = append(ips, net.ParseIP(ip))
	}
	template := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: domain, Organization: []string{"ZViewer Desktop"}},
		NotBefore:             before,
		NotAfter:              time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              dns,
		IPAddresses:           ips,
		AuthorityKeyId:        root.SubjectKeyId,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, root, &key.PublicKey, rootKey)
	if err != nil {
		return CertInfo{}, err
	}
	keyText, err := privatePEM(key)
	if err != nil {
		return CertInfo{}, err
	}
	certText := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))

	check, err := x509.ParseCertificate(der)
	if err != nil {
		return CertInfo{}, err
	}
	if !keyMatches(check, key) || check.CheckSignatureFrom(root) != nil {
		return CertInfo{}, errors.New("证书与私钥校验失败")
	}
	if fileExists(paths.Cert) && fileExists(paths.Key) {
		backup := filepath.Join(c.dir, "backups", fmt.Sprintf("%d", time.Now().UnixMilli()))
		if err := os.MkdirAll(backup, 0o700); err == nil {
			_ = copyFile(paths.Cert, filepath.Join(backup, "cert.pem"))
			_ = copyFile(paths.Key, filepath.Join(backup, "key.pem"))
		}
	}
	if err := Atomic(paths.Key, keyText); err != nil {
		return CertInfo{}, err
	}
	if err := Atomic(paths.Cert, certText); err != nil {
		return CertInfo{}, err
	}
	c.log(fmt.Sprintf("已签发 %s 的本地 HTTPS 证书，有效期 365 天", domain), "cert", "INFO")
	return c.Inspect(), nil
}

// Trusted 检查本机 CA 是否已在当前用户的受信任根证书存储里。
//
// 结论取自系统证书存储，而不是内存标记：GUI 重启后仍能正确显示状态，
// 用户在系统里手动删除信任也能反映出来。
func (c *Certificates) Trusted() bool {
	info := c.Inspect()
	if !info.Valid || !info.CA || strings.TrimSpace(info.Thumbprint) == "" {
		return false
	}
	// 启动路径上会调用一次，加超时避免 certutil 异常时卡住界面。
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "certutil.exe", "-user", "-store", "Root", info.Thumbprint)
	hideWindow(cmd)
	return cmd.Run() == nil
}

// Trust 安装或撤销当前用户对本地 CA 的信任。
func (c *Certificates) Trust(installed bool) (map[string]any, error) {
	info := c.Inspect()
	if !info.Valid || !info.CA {
		return nil, errors.New("请先签发有效本地证书")
	}
	var cmd *exec.Cmd
	if installed {
		cmd = exec.Command("certutil.exe", "-user", "-addstore", "Root", c.Paths().CA)
	} else {
		cmd = exec.Command("certutil.exe", "-user", "-delstore", "Root", info.Thumbprint)
	}
	hideWindow(cmd)
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("证书信任操作失败：%w", err)
	}
	if installed {
		c.log("已安装当前用户的本机 CA 信任", "cert", "INFO")
	} else {
		c.log("已撤销当前用户的本机 CA 信任", "cert", "INFO")
	}
	return map[string]any{"trusted": installed, "fingerprint": info.Fingerprint}, nil
}

func fileExists(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func copyFile(from, to string) error {
	raw, err := os.ReadFile(from)
	if err != nil {
		return err
	}
	return os.WriteFile(to, raw, 0o600)
}
