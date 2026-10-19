package controller

// CLI 高画质代理：与 desktop/lib/cli.cjs 等价。
// 上游设置页自己处理 Cookie / 扫码登录，这里只负责拉起进程与暴露设置页地址。

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type CliSnapshot struct {
	State      string `json:"state"`
	Pid        *int   `json:"pid"`
	ActivePort int    `json:"activePort"`
	Available  bool   `json:"available"`
	Version    string `json:"version"`
	Connected  bool   `json:"connected"`
}

type CliProxy struct {
	root       string
	executable string
	hostExe    string
	cwd        string
	kill       func(*Proc, string) error
	verify     func(pid, port int) error
	log        func(message, source, level string)
	onUpdate   func()

	mu           sync.Mutex
	child        *Proc
	state        string
	activePort   int
	version      string
	connected    bool
	stopMu       sync.Mutex
	stopping     bool
	lastErrorLog time.Time
}

func NewCliProxy(root, executable, hostExe string, kill func(*Proc, string) error,
	verify func(pid, port int) error, log func(message, source, level string), onUpdate func()) *CliProxy {
	if executable == "" {
		executable = filepath.Join(root, "zviewer-cli-windows-amd64.exe")
	}
	return &CliProxy{
		root: root, executable: executable, hostExe: hostExe, cwd: filepath.Dir(executable),
		kill: kill, verify: verify, log: log, onUpdate: onUpdate, state: "stopped",
	}
}

func (c *CliProxy) Snapshot() CliSnapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := CliSnapshot{
		State: c.state, ActivePort: c.activePort, Version: c.version, Connected: c.connected,
		Available: fileExists(c.executable),
	}
	if c.child != nil && !c.child.Exited() {
		pid := c.child.Pid()
		out.Pid = &pid
	}
	return out
}

func (c *CliProxy) update() {
	if c.onUpdate != nil {
		c.onUpdate()
	}
}

// URL 拼接上游设置页地址；server 必须是 HTTP(S) 且不带凭据。
func (c *CliProxy) URL(serverURL, user string, embedded bool) (string, error) {
	c.mu.Lock()
	port, state := c.activePort, c.state
	c.mu.Unlock()
	if port == 0 || state != "running" {
		return "", errors.New("请先启动 CLI 高画质代理")
	}
	address, err := url.Parse(fmt.Sprintf("http://127.0.0.1:%d/", port))
	if err != nil {
		return "", err
	}
	query := address.Query()
	if serverURL != "" {
		parsed, err := url.Parse(serverURL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
			return "", errors.New("CLI 后端地址必须是 HTTP 或 HTTPS 地址")
		}
		query.Set("server", serverURL)
	}
	if trimmed := strings.TrimSpace(user); trimmed != "" {
		if len([]rune(trimmed)) > 120 {
			trimmed = string([]rune(trimmed)[:120])
		}
		query.Set("user", trimmed)
	}
	if embedded {
		query.Set("desktop", "1")
	}
	address.RawQuery = query.Encode()
	return address.String(), nil
}

func (c *CliProxy) handleLine(line string) {
	switch {
	case line == "[ZViewer CLI] [CLI] 已注册到服务器（全局，所有房间可用）":
		c.mu.Lock()
		c.connected = true
		c.mu.Unlock()
		c.log("CLI 已注册到服务器，所有房间可用", "cli", "INFO")
		c.update()
	case line == "[ZViewer CLI] 已断开服务器连接" || strings.HasPrefix(line, "[ZViewer CLI] Socket 断开:"):
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		c.log("CLI 与服务器的连接已断开", "cli", "INFO")
		c.update()
	case strings.Contains(line, "失败") || strings.Contains(line, "异常"):
		// 上游日志可能带播放地址与远端错误，只记固定文案并限流。
		if time.Since(c.lastErrorLog) > 10*time.Second {
			c.lastErrorLog = time.Now()
			c.log("CLI 报告连接或解析错误，可打开代理设置查看状态", "cli", "WARN")
		}
	}
}

// Start 拉起 CLI 并等待 /health 通过。
func (c *CliProxy) Start(port int) (CliSnapshot, error) {
	if port < 1 || port > 65535 {
		return c.Snapshot(), errors.New("CLI 端口必须是 1–65535 的整数")
	}
	if !fileExists(c.executable) {
		return c.Snapshot(), errors.New("缺少 zviewer-cli-windows-amd64.exe，请重新构建或安装完整运行包")
	}
	if isWindows() && !fileExists(c.hostExe) {
		return c.Snapshot(), errors.New("缺少 CLI 进程监管组件")
	}
	c.mu.Lock()
	if c.child != nil {
		c.mu.Unlock()
		return c.Snapshot(), nil
	}
	c.state, c.activePort, c.connected = "starting", port, false
	c.mu.Unlock()
	c.update()

	if err := portAvailable(port, "127.0.0.1"); err != nil {
		c.mu.Lock()
		c.state, c.activePort = "error", 0
		c.mu.Unlock()
		c.update()
		return c.Snapshot(), fmt.Errorf("CLI 端口 %d 已被占用；请修改端口或关闭已有 CLI", port)
	}

	proc, err := startProcess(c.hostExe, c.executable, []string{"-port", strconv.Itoa(port), "-no-open=true"},
		os.Environ(), c.cwd, c.handleLine)
	if err != nil {
		c.mu.Lock()
		c.state, c.activePort = "error", 0
		c.mu.Unlock()
		c.update()
		return c.Snapshot(), err
	}
	c.mu.Lock()
	c.child = proc
	c.stopping = false
	c.mu.Unlock()

	go func() {
		code := proc.Wait()
		c.mu.Lock()
		if c.child != proc {
			c.mu.Unlock()
			return
		}
		intentional := c.stopping
		c.child, c.activePort, c.connected = nil, 0, false
		if intentional {
			c.state = "stopped"
		} else {
			c.state = "error"
		}
		c.mu.Unlock()
		level := "WARN"
		if intentional {
			level = "INFO"
		}
		c.log(fmt.Sprintf("CLI 进程已退出（%d）", code), "cli", level)
		c.update()
	}()

	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		c.mu.Lock()
		current := c.child
		state := c.state
		c.mu.Unlock()
		if current != proc || proc.Exited() || state != "starting" {
			break
		}
		if health, ok := cliHealthProbe(port); ok {
			if isWindows() && c.verify != nil {
				if err := c.verify(proc.Pid(), port); err != nil {
					_ = err
					_, _ = c.Stop()
					c.mu.Lock()
					c.state = "error"
					c.mu.Unlock()
					c.update()
					return c.Snapshot(), errors.New("CLI 监听端口不属于 GUI 启动的进程树")
				}
			}
			c.mu.Lock()
			c.version = health.Version
			c.state = "running"
			c.mu.Unlock()
			c.log(fmt.Sprintf("CLI 高画质代理已就绪：http://127.0.0.1:%d", port), "cli", "INFO")
			c.update()
			return c.Snapshot(), nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	_, _ = c.Stop()
	c.mu.Lock()
	c.state = "error"
	c.mu.Unlock()
	c.update()
	return c.Snapshot(), errors.New("CLI 未能启动，请检查端口或重新安装完整运行包")
}

// Stop 停止 CLI；并发调用会等待同一次停止完成。
func (c *CliProxy) Stop() (CliSnapshot, error) {
	c.stopMu.Lock()
	defer c.stopMu.Unlock()
	c.mu.Lock()
	proc := c.child
	if proc == nil {
		c.state, c.activePort, c.connected = "stopped", 0, false
		c.mu.Unlock()
		c.update()
		return c.Snapshot(), nil
	}
	c.state = "stopping"
	c.stopping = true
	c.mu.Unlock()
	c.update()
	target := c.hostExe
	if !isWindows() {
		target = c.executable
	}
	if c.kill == nil {
		return c.Snapshot(), errors.New("缺少 CLI 进程停止处理")
	}
	if err := c.kill(proc, target); err != nil {
		c.mu.Lock()
		c.state = "error"
		c.mu.Unlock()
		c.update()
		return c.Snapshot(), err
	}
	c.mu.Lock()
	if c.child == proc {
		c.child = nil
	}
	c.state, c.activePort, c.connected = "stopped", 0, false
	c.mu.Unlock()
	c.update()
	return c.Snapshot(), nil
}
