package controller

// 连接方式：公网 IPv6 探测与 Cloudflare Tunnel 快速隧道。
// IPv6 一律经外部接口取得（不读本机网卡），接口只解析 AAAA，
// 请求成功即说明本机确实具备 IPv6 出口；返回值再做公网地址校验。

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// IPv6Report 是一次公网 IPv6 探测的结果。
type IPv6Report struct {
	OK        bool   `json:"ok"`
	Address   string `json:"address"`
	Source    string `json:"source"`
	CheckedAt string `json:"checkedAt"`
	Reason    string `json:"reason"`
}

// TunnelReport 是 cloudflared 快速隧道的状态。
type TunnelReport struct {
	Available bool   `json:"available"`
	State     string `json:"state"`
	URL       string `json:"url"`
	Message   string `json:"message"`
}

// ipv6Sources 均只有 AAAA 记录；按国内可达性排序。
var ipv6Sources = []struct {
	Name string
	URL  string
}{
	{Name: "v6.ident.me", URL: "https://v6.ident.me/"},
	{Name: "ipv6.icanhazip.com", URL: "https://ipv6.icanhazip.com/"},
	{Name: "api6.ipify.org", URL: "https://api6.ipify.org?format=json"},
}

// ipv6Client 强制以 tcp6 拨号：域名无 A 记录，拨不通就代表没有 IPv6 出口。
func ipv6Client() *http.Client {
	dialer := &net.Dialer{Timeout: 3 * time.Second}
	return &http.Client{
		Timeout: 4 * time.Second,
		Transport: &http.Transport{
			DisableKeepAlives: true,
			DialContext: func(ctx context.Context, _, address string) (net.Conn, error) {
				return dialer.DialContext(ctx, "tcp6", address)
			},
		},
	}
}

func readIPv6Body(body []byte) string {
	var payload struct {
		IP string `json:"ip"`
	}
	if json.Unmarshal(body, &payload) == nil && payload.IP != "" {
		return payload.IP
	}
	return strings.TrimSpace(string(body))
}

// publicIPv6 只接受可在公网路由的单播地址。
func publicIPv6(text string) (string, bool) {
	ip := net.ParseIP(strings.TrimSpace(text))
	if ip == nil || ip.To4() != nil {
		return "", false
	}
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsMulticast() {
		return "", false
	}
	lower := strings.ToLower(ip.String())
	// 2001:db8::/32 是文档地址，fec0::/10 是已废弃的站点本地地址。
	if strings.HasPrefix(lower, "2001:db8:") || strings.HasPrefix(lower, "fec0:") {
		return "", false
	}
	return ip.String(), true
}

// ProbeIPv6 查询本机公网 IPv6；一分钟内复用上次结果，force 时重新探测。
// 整体限时 6 秒，避免一处接口无响应拖住界面。
func (c *Controller) ProbeIPv6(force bool) IPv6Report {
	c.ipv6Mu.Lock()
	defer c.ipv6Mu.Unlock()
	if !force && c.ipv6 != nil && time.Since(c.ipv6At) < time.Minute {
		return *c.ipv6
	}
	report := IPv6Report{CheckedAt: time.Now().Format("15:04:05")}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	client := ipv6Client()
	for _, source := range ipv6Sources {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, source.URL, nil)
		if err != nil {
			continue
		}
		response, err := client.Do(request)
		if err != nil {
			if ctx.Err() != nil {
				break
			}
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(response.Body, 1024))
		response.Body.Close()
		if readErr != nil || response.StatusCode != http.StatusOK {
			continue
		}
		if address, ok := publicIPv6(readIPv6Body(body)); ok {
			report.OK, report.Address, report.Source = true, address, source.Name
			c.ipv6, c.ipv6At = &report, time.Now()
			return report
		}
	}
	report.Reason = "没有探测到公网 IPv6：外部接口无法通过 IPv6 访问本机。"
	c.ipv6, c.ipv6At = &report, time.Now()
	return report
}

var tunnelPattern = regexp.MustCompile(`https://[a-z0-9][a-z0-9-]*\.trycloudflare\.com`)

// cloudflared 优先取运行包目录（用户新放入的文件立即生效），其次取 PATH。
func (c *Controller) cloudflared() string {
	candidate := filepath.Join(c.root, "cloudflared.exe")
	if c.root != "" && fileExists(candidate) {
		c.mu.Lock()
		c.tunnelExe = candidate
		c.mu.Unlock()
		return candidate
	}
	c.mu.RLock()
	cached := c.tunnelExe
	c.mu.RUnlock()
	if cached != "" && cached != candidate && fileExists(cached) {
		return cached
	}
	found, err := exec.LookPath("cloudflared")
	if err != nil {
		return ""
	}
	c.mu.Lock()
	c.tunnelExe = found
	c.mu.Unlock()
	return found
}

func (c *Controller) tunnelReport() TunnelReport {
	c.mu.RLock()
	state, url, message := c.tunnelState, c.tunnelURL, c.tunnelMessage
	c.mu.RUnlock()
	return TunnelReport{Available: c.cloudflared() != "", State: state, URL: url, Message: message}
}

func (c *Controller) setTunnelState(state, message string) {
	c.mu.Lock()
	c.tunnelState, c.tunnelMessage = state, message
	c.mu.Unlock()
}

func (c *Controller) handleTunnelLine(line string) {
	if match := tunnelPattern.FindString(line); match != "" {
		c.mu.Lock()
		changed := c.tunnelURL != match
		c.tunnelURL = match
		if c.tunnelState != "stopping" {
			c.tunnelState = "running"
		}
		c.mu.Unlock()
		if changed {
			c.log("Cloudflare Tunnel 已就绪："+match, "tunnel", "INFO")
			c.emit()
		}
	}
}

// StartTunnel 用 cloudflared 的快速隧道把本机网页端口映射到临时地址。
func (c *Controller) StartTunnel() (any, error) {
	return c.exclusive(func() (any, error) {
		c.mu.RLock()
		proc, state := c.tunnel, c.tunnelState
		active := c.active
		c.mu.RUnlock()
		if proc != nil && state != "error" {
			return c.Snapshot(), nil
		}
		if proc != nil {
			_ = c.stopTunnel()
		}
		exe := c.cloudflared()
		if exe == "" {
			return nil, errors.New("未找到 cloudflared.exe；请下载后放入运行包目录，或加入 PATH")
		}
		config := c.store.Value
		if active != nil {
			config = *active
		}
		if config.Port <= 0 {
			return nil, errors.New("请先在应用设置中确认网页端口")
		}
		scheme := "http"
		if config.Https {
			scheme = "https"
		}
		args := []string{"tunnel", "--url", fmt.Sprintf("%s://127.0.0.1:%d", scheme, config.Port), "--no-autoupdate"}
		if config.Https {
			args = append(args, "--no-tls-verify")
		}
		c.setTunnelState("connecting", "")
		c.mu.Lock()
		c.tunnelURL = ""
		c.mu.Unlock()
		started, err := startProcess("", exe, args, nil, filepath.Dir(exe), func(line string) {
			c.log(line, "tunnel", classifyLevel(line))
			c.handleTunnelLine(line)
		})
		if err != nil {
			c.setTunnelState("error", "无法启动 cloudflared："+err.Error())
			return nil, err
		}
		c.mu.Lock()
		c.tunnel = started
		c.mu.Unlock()
		go func() {
			code := started.Wait()
			c.mu.Lock()
			if c.tunnel != started {
				c.mu.Unlock()
				return
			}
			c.tunnel = nil
			c.tunnelURL = ""
			if c.tunnelState == "stopping" {
				c.tunnelState = "stopped"
			} else {
				c.tunnelState = "error"
			}
			failed := c.tunnelState == "error"
			c.mu.Unlock()
			level := "INFO"
			if failed {
				level = "ERROR"
			}
			c.log(fmt.Sprintf("Cloudflare Tunnel 已退出（%d）", code), "tunnel", level)
			c.emit()
		}()
		c.log("正在建立 Cloudflare 快速隧道，地址稍后显示", "tunnel", "INFO")
		return c.Snapshot(), nil
	})
}

func (c *Controller) stopTunnel() error {
	c.mu.RLock()
	proc := c.tunnel
	c.mu.RUnlock()
	if proc == nil {
		c.setTunnelState("stopped", "")
		return nil
	}
	c.setTunnelState("stopping", "")
	if err := c.kill(proc, c.cloudflared()); err != nil {
		c.setTunnelState("error", "停止 cloudflared 失败")
		return err
	}
	c.mu.Lock()
	c.tunnelURL = ""
	c.mu.Unlock()
	c.setTunnelState("stopped", "")
	return nil
}

// StopTunnel 停止隧道并广播状态。
func (c *Controller) StopTunnel() error {
	err := c.stopTunnel()
	c.emit()
	return err
}

// TunnelReport 供宿主层读取当前隧道状态。
func (c *Controller) TunnelReport() TunnelReport { return c.tunnelReport() }
