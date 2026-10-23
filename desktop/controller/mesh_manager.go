package controller

// EasyTier 虚拟组网进程管理：托管 easytier-core，并用 easytier-cli 读回节点状态。
//
// 进程同样走 ZViewer.ProcessHost.exe，GUI 退出后由 Job Object 一并回收；
// 面板只经由 Go 命令读取状态（前端 CSP 禁止直连本地端口）。

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const meshReadyTimeout = 15 * time.Second

// meshWaitingMessage 是「进程已起来、但还没有虚拟 IP」时的固定文案：
// DHCP 要等有对端接入才分配，这不是错误。
const meshWaitingMessage = "已加入网络，等待其他设备接入后分配虚拟 IP"

// meshPeerErrorMessage 只在真的连不上对端地址时出现；一旦看见其他节点就清掉，
// 否则首页那行红字会一直挂着。
const meshPeerErrorMessage = "有对端地址连不上，检查地址与端口是否正确"

type MeshManager struct {
	dir      string
	binDir   string
	hostExe  string
	kill     func(*Proc, string) error
	log      func(message, source, level string)
	onUpdate func()

	mu       sync.Mutex
	child    *Proc
	state    string
	stopping bool
	cfg      MeshConfig
	secret   string
	hostname string
	rpcPort  int
	node     MeshNode
	peers    []MeshPeer
	lanPeers []string
	lanPort  int
	message  string
	pollStop chan struct{}
	polling  bool

	stopMu sync.Mutex
}

func NewMeshManager(root, dir, hostExe string, kill func(*Proc, string) error,
	logFn func(message, source, level string), onUpdate func()) *MeshManager {
	return &MeshManager{
		dir:      dir,
		binDir:   filepath.Join(root, "mesh"),
		hostExe:  hostExe,
		kill:     kill,
		log:      logFn,
		onUpdate: onUpdate,
		state:    "stopped",
		cfg:      DefaultMeshConfig(),
		hostname: meshHostname(),
	}
}

func (m *MeshManager) corePath() string { return filepath.Join(m.binDir, "easytier-core.exe") }
func (m *MeshManager) cliPath() string  { return filepath.Join(m.binDir, "easytier-cli.exe") }

// Available 表示分出包里带了组网组件。
func (m *MeshManager) Available() bool {
	return fileExists(m.corePath()) && fileExists(m.cliPath())
}

func (m *MeshManager) update() {
	if m.onUpdate != nil {
		m.onUpdate()
	}
}

func (m *MeshManager) Snapshot() MeshStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.snapshotLocked()
}

func (m *MeshManager) snapshotLocked() MeshStatus {
	out := MeshStatus{
		State:     m.state,
		Available: m.Available(),
		Pid:       processPid(m.child),
		VirtualIP: virtualIPv4(m.node.IPv4),
		Hostname:  m.node.Hostname,
		Version:   m.node.Version,
		Message:   m.message,
		Peers:     make([]MeshPeer, len(m.peers)),
		LanPeers:  m.lanPeersLocked(),
	}
	if out.Hostname == "" {
		out.Hostname = m.hostname
	}
	copy(out.Peers, m.peers)
	return out
}

// lanPeersLocked 复用上一次的地址列表：net.Interfaces 每次快照都调一遍没必要，
// 只有监听端口变了才重新算。
func (m *MeshManager) lanPeersLocked() []string {
	if m.lanPeers != nil && m.lanPort == m.cfg.ListenPort {
		return m.lanPeers
	}
	list := []string{}
	for _, address := range meshLanIPv4s() {
		list = append(list, "tcp://"+address+":"+strconv.Itoa(m.cfg.ListenPort))
	}
	m.lanPeers, m.lanPort = list, m.cfg.ListenPort
	return list
}

// Running 供保存配置时判断是否需要重启。
func (m *MeshManager) Running() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.child != nil
}

// handleLine 只挑用户能看懂的事件记录，原始日志不外泄。
func (m *MeshManager) handleLine(line string) {
	lower := strings.ToLower(line)
	switch {
	case strings.Contains(line, "dhcp ip changed"):
		m.mu.Lock()
		m.message = ""
		m.mu.Unlock()
	case strings.Contains(lower, "connect to peer error"), strings.Contains(lower, "dns lookup_ip failed"):
		m.mu.Lock()
		m.message = meshPeerErrorMessage
		m.mu.Unlock()
		m.update()
	}
}

// Start 拉起 easytier-core 并等到虚拟 IP 分配完成。
func (m *MeshManager) Start(cfg MeshConfig, secret string) (MeshStatus, error) {
	if !m.Available() {
		return m.Snapshot(), errors.New("缺少组网组件，请使用完整运行包")
	}
	if isWindows() && !fileExists(m.hostExe) {
		return m.Snapshot(), errors.New("缺少进程监管组件")
	}
	m.mu.Lock()
	if m.child != nil {
		m.mu.Unlock()
		return m.Snapshot(), nil
	}
	m.state, m.cfg, m.secret = "starting", cfg, secret
	m.node, m.peers, m.message = MeshNode{}, nil, ""
	m.mu.Unlock()
	m.update()

	if err := os.MkdirAll(m.dir, 0o700); err != nil {
		m.fail(err)
		return m.Snapshot(), err
	}
	if err := portAvailable(cfg.ListenPort, "0.0.0.0"); err != nil {
		m.fail(fmt.Errorf("组网监听端口 %d 已被占用；请换一个端口", cfg.ListenPort))
		return m.Snapshot(), fmt.Errorf("组网监听端口 %d 已被占用；请换一个端口", cfg.ListenPort)
	}
	if err := udpAvailable(cfg.ListenPort, "0.0.0.0"); err != nil {
		err = fmt.Errorf("组网监听端口 %d 已被占用；请换一个端口", cfg.ListenPort)
		m.fail(err)
		return m.Snapshot(), err
	}
	rpc, err := pickMeshRPCPort(cfg.ListenPort)
	if err != nil {
		m.fail(err)
		return m.Snapshot(), err
	}
	configPath := filepath.Join(m.dir, "config.toml")
	if err := Atomic(configPath, MeshTOML(cfg, secret, m.hostname)); err != nil {
		m.fail(err)
		return m.Snapshot(), err
	}

	proc, err := startProcess(m.hostExe, m.corePath(),
		[]string{"-c", configPath, "-r", fmt.Sprintf("127.0.0.1:%d", rpc)},
		os.Environ(), m.binDir, m.handleLine)
	if err != nil {
		m.fail(err)
		return m.Snapshot(), err
	}
	m.mu.Lock()
	m.child, m.rpcPort, m.stopping = proc, rpc, false
	m.mu.Unlock()

	go m.watchExit(proc)

	// 就绪判定只看「RPC 能读回节点信息」：虚拟 IP 由 DHCP 分配，而 DHCP 要等到
	// 有对端接入才生效（实测单节点永远拿不到地址），所以没有 IP 属于正常中间状态。
	deadline := time.Now().Add(meshReadyTimeout)
	var node MeshNode
	var peers []MeshPeer
	ready := false
	for time.Now().Before(deadline) {
		if proc.Exited() {
			break
		}
		if parsed, parsedPeers, err := m.readNode(rpc); err == nil {
			node, peers, ready = parsed, parsedPeers, true
			break
		}
		time.Sleep(300 * time.Millisecond)
	}

	if ready {
		message := ""
		if node.IPv4 == "" {
			message = meshWaitingMessage
		}
		m.mu.Lock()
		m.node, m.peers = node, peers
		m.state, m.message = "running", message
		m.mu.Unlock()
		m.startPolling(proc, rpc)
		if node.IPv4 != "" {
			m.log("EasyTier 虚拟组网已就绪："+virtualIPv4(node.IPv4), "mesh", "INFO")
		} else {
			m.log("EasyTier 虚拟组网已启动，等待其他设备接入", "mesh", "INFO")
		}
		m.update()
		return m.Snapshot(), nil
	}

	m.mu.Lock()
	message := m.message
	m.mu.Unlock()
	_, _ = m.Stop()
	if message == "" {
		message = "组网节点未能启动；请检查监听端口是否被占用"
	}
	m.mu.Lock()
	m.state, m.message = "error", message
	m.mu.Unlock()
	m.update()
	return m.Snapshot(), errors.New(message)
}

func (m *MeshManager) fail(err error) {
	m.mu.Lock()
	m.state, m.message = "error", err.Error()
	m.mu.Unlock()
	m.update()
}

func (m *MeshManager) watchExit(proc *Proc) {
	code := proc.Wait()
	m.mu.Lock()
	if m.child != proc {
		m.mu.Unlock()
		return
	}
	intentional := m.stopping
	m.child = nil
	if intentional {
		m.state = "stopped"
	} else {
		m.state = "error"
		if m.message == "" {
			m.message = fmt.Sprintf("组网进程已退出（%d）", code)
		}
	}
	m.mu.Unlock()
	if !intentional {
		m.log(fmt.Sprintf("EasyTier 虚拟组网进程已退出（%d）", code), "mesh", "WARN")
	}
	m.update()
}

// startPolling 每 3 秒读一次节点与对端，只有内容变化时才推送状态。
func (m *MeshManager) startPolling(proc *Proc, rpc int) {
	m.mu.Lock()
	if m.polling {
		m.mu.Unlock()
		return
	}
	stop := make(chan struct{})
	m.pollStop, m.polling = stop, true
	m.mu.Unlock()

	go func() {
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
			}
			if proc.Exited() {
				return
			}
			node, peers, err := m.readNode(rpc)
			if err != nil {
				continue
			}
			m.mu.Lock()
			changed := node.IPv4 != m.node.IPv4 || len(peers) != len(m.peers)
			if !changed {
				for index := range peers {
					if peers[index].Cost != m.peers[index].Cost || peers[index].IPv4 != m.peers[index].IPv4 ||
						peers[index].RX != m.peers[index].RX || peers[index].TX != m.peers[index].TX {
						changed = true
						break
					}
				}
			}
			// 分配完地址就不再提示「等待接入」。
			if node.IPv4 != "" && m.message == meshWaitingMessage {
				m.message = ""
				changed = true
			}
			// 已经看见其他节点，说明对端地址是通的，把之前的连不上提示撤掉。
			if m.message == meshPeerErrorMessage {
				for index := range peers {
					if !peers[index].Self && peers[index].IPv4 != "" {
						m.message = ""
						changed = true
						break
					}
				}
			}
			m.node, m.peers = node, peers
			m.mu.Unlock()
			if changed {
				m.update()
			}
		}
	}()
}

func (m *MeshManager) stopPolling() {
	m.mu.Lock()
	if m.pollStop != nil {
		close(m.pollStop)
		m.pollStop = nil
	}
	m.polling = false
	m.mu.Unlock()
}

func (m *MeshManager) readNode(rpc int) (MeshNode, []MeshPeer, error) {
	raw, err := meshCLI(m.cliPath(), rpc, "node")
	if err != nil {
		return MeshNode{}, nil, err
	}
	node, err := ParseMeshNode(raw)
	if err != nil {
		return MeshNode{}, nil, err
	}
	peers := []MeshPeer{}
	if raw, err := meshCLI(m.cliPath(), rpc, "peer"); err == nil {
		if parsed, parseErr := ParseMeshPeers(raw); parseErr == nil {
			peers = parsed
		}
	}
	return node, peers, nil
}

func meshCLI(executable string, rpc int, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, executable,
		append([]string{"-o", "json", "-p", fmt.Sprintf("127.0.0.1:%d", rpc)}, args...)...)
	hideWindow(cmd)
	return cmd.Output()
}

// Stop 停止组网节点；并发调用会等待同一次停止完成。
func (m *MeshManager) Stop() (MeshStatus, error) {
	m.stopMu.Lock()
	defer m.stopMu.Unlock()
	m.stopPolling()

	m.mu.Lock()
	proc := m.child
	if proc == nil {
		m.state, m.node, m.peers, m.message = "stopped", MeshNode{}, nil, ""
		m.mu.Unlock()
		m.update()
		return m.Snapshot(), nil
	}
	m.state, m.stopping = "stopping", true
	m.mu.Unlock()
	m.update()

	target := m.corePath()
	if isWindows() {
		target = m.hostExe
	}
	if m.kill == nil {
		return m.Snapshot(), errors.New("缺少组网进程停止处理")
	}
	if err := m.kill(proc, target); err != nil {
		m.mu.Lock()
		m.state = "error"
		m.mu.Unlock()
		m.update()
		return m.Snapshot(), err
	}
	m.mu.Lock()
	if m.child == proc {
		m.child = nil
	}
	m.state, m.node, m.peers, m.message = "stopped", MeshNode{}, nil, ""
	m.mu.Unlock()
	m.update()
	return m.Snapshot(), nil
}

// Restart 在配置变化后按新参数重新入网。
func (m *MeshManager) Restart(cfg MeshConfig, secret string) (MeshStatus, error) {
	if _, err := m.Stop(); err != nil {
		return m.Snapshot(), err
	}
	return m.Start(cfg, secret)
}

// Reconfigure 只在运行中且入网参数真的变化时才重启，返回值表示是否发生了重启。
func (m *MeshManager) Reconfigure(cfg MeshConfig, secret string) (MeshStatus, bool, error) {
	m.mu.Lock()
	running := m.child != nil
	changed := !meshConfigEqual(m.cfg, cfg) || m.secret != secret
	m.mu.Unlock()
	if !running || !changed {
		return m.Snapshot(), false, nil
	}
	status, err := m.Restart(cfg, secret)
	return status, true, err
}

func meshConfigEqual(left, right MeshConfig) bool {
	if left.NetworkName != right.NetworkName || left.ListenPort != right.ListenPort ||
		left.InstanceID != right.InstanceID || len(left.Peers) != len(right.Peers) {
		return false
	}
	for index := range left.Peers {
		if left.Peers[index] != right.Peers[index] {
			return false
		}
	}
	return true
}

// pickMeshRPCPort 在监听端口附近找一个空闲的管理端口，避开常用端口。
func pickMeshRPCPort(base int) (int, error) {
	for offset := 1; offset <= 20; offset++ {
		port := base + offset
		if port > 65535 {
			break
		}
		if portAvailable(port, "127.0.0.1") == nil {
			return port, nil
		}
	}
	for offset := 1; offset <= 20; offset++ {
		port := base - offset
		if port < 1024 {
			break
		}
		if portAvailable(port, "127.0.0.1") == nil {
			return port, nil
		}
	}
	return 0, errors.New("找不到可用的组网管理端口")
}
