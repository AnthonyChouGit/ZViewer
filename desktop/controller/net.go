package controller

// 网络探测：端口占用检查、后端健康检查、LiveKit 就绪检查、CLI 健康检查。

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

func portAvailable(port int, host string) error {
	listener, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return fmt.Errorf("端口 %d 已被占用；不会停止占用它的其他程序", port)
	}
	_ = listener.Close()
	return nil
}

func udpAvailable(port int, host string) error {
	base := "udp4"
	if strings.Contains(host, ":") {
		base = "udp6"
	}
	conn, err := net.ListenPacket(base, net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return fmt.Errorf("语音 UDP 端口 %d 已被占用；不会停止占用它的其他程序", port)
	}
	_ = conn.Close()
	return nil
}

func httpClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout:   timeout,
		Transport: &http.Transport{DisableKeepAlives: true},
	}
}

// livekitReady 只要信令端口回 200 即可认为进程已经开始服务。
func livekitReady(port int) bool {
	client := httpClient(1 * time.Second)
	response, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/", port))
	if err != nil {
		return false
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	return response.StatusCode == 200
}

// probeBackend 命中 /health，HTTPS 模式下用本机 CA 校验证书链。
func probeBackend(port int, secure bool, caPath string) bool {
	client := httpClient(1200 * time.Millisecond)
	if secure {
		raw, err := os.ReadFile(caPath)
		if err != nil {
			return false
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(raw) {
			return false
		}
		client = &http.Client{
			Timeout: 1200 * time.Millisecond,
			Transport: &http.Transport{
				DisableKeepAlives: true,
				TLSClientConfig:   &tls.Config{RootCAs: pool, ServerName: "localhost"},
			},
		}
	}
	scheme := "http"
	if secure {
		scheme = "https"
	}
	response, err := client.Get(fmt.Sprintf("%s://127.0.0.1:%d/health", scheme, port))
	if err != nil {
		return false
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	text := string(body)
	return response.StatusCode == 200 && (strings.Contains(text, "ok") || strings.Contains(text, "status"))
}

type cliHealth struct {
	Version string
}

// cliHealthProbe 校验响应体确实来自 zcontrol-cli，避免误判占用端口的其他程序。
func cliHealthProbe(port int) (cliHealth, bool) {
	client := httpClient(1 * time.Second)
	response, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/health", port))
	if err != nil {
		return cliHealth{}, false
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 4096))
	if err != nil || response.StatusCode != 200 {
		return cliHealth{}, false
	}
	var payload struct {
		OK      bool   `json:"ok"`
		Agent   string `json:"agent"`
		Version string `json:"version"`
	}
	if json.Unmarshal(body, &payload) != nil || !payload.OK || payload.Agent != "zcontrol-cli" {
		return cliHealth{}, false
	}
	version := payload.Version
	if len(version) > 32 {
		version = version[:32]
	}
	return cliHealth{Version: version}, true
}
