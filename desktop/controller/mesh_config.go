package controller

// EasyTier 虚拟组网：EasyTier 免 TUN 模式的配置模型、校验与 TOML 生成。
//
// 设计取舍（实测来自 easytier-core 2.6.4）：
//   - 免管理员：flags.no_tun = true 且必须同时 bind_device = false，
//     否则出站 socket 会尝试绑定到尚未分配的虚拟 IP，connect 报 10049 AddrNotAvailable。
//   - 免账号：EasyTier 只认 network_name + network_secret，不需要任何注册。
//   - 本机拿得到虚拟 IP 不依赖任何对端：首个节点会自己成为该网络的 DHCP 分配者。
//   - 宿主不能主动访问其他节点（no-tun 的固有限制），但其他节点可以按虚拟 IP 访问宿主上的
//     任意端口，正好对应「让朋友的设备连进来看片」。

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"os"
	"regexp"
	"strconv"
	"strings"
)

const (
	// MeshDefaultPort 是 Easytier 约定的组网监听端口，也是官方文档示例端口。
	MeshDefaultPort = 11010
	// meshMaxPeers 限制引导节点数量：面板是给人填的，不是路由器配置。
	meshMaxPeers     = 4
	meshMinSecretLen = 6
	meshMaxSecretLen = 128
)

type MeshConfig struct {
	Enabled     bool     `json:"enabled"`
	NetworkName string   `json:"networkName"`
	Peers       []string `json:"peers"`
	ListenPort  int      `json:"listenPort"`
	// InstanceID 落盘复用，保证重启后 peer_id 不变，虚拟 IP 也更容易沿用。
	InstanceID string `json:"instanceId"`
}

// MeshPublicPeers 是 EasyTier 官方共享节点。
//
// 同一台服务同时监听 TCP 与 UDP，两条都填可以在一种协议被网络拦截时自动换另一条
// （官方文档里"提高可用性"的推荐写法）。与 app.js 的 MESH_OFFICIAL_PEERS 保持一致。
var MeshPublicPeers = []string{
	"tcp://public.easytier.cn:11010",
	"udp://public.easytier.cn:11010",
}

func DefaultMeshConfig() MeshConfig {
	return MeshConfig{ListenPort: MeshDefaultPort, Peers: append([]string{}, MeshPublicPeers...)}
}

var (
	meshNamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*[a-z0-9]$`)
	meshUUIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	meshPeerScheme  = regexp.MustCompile(`^(tcp|udp|ws|wss)://`)
)

// MeshSecretValid 校验网络密钥：允许任意可打印字符（要与官方客户端互通，不能限制字符集），
// 但必须能安全写进 TOML 字符串，且不能是空白。
func MeshSecretValid(secret string) error {
	if secret == "" {
		return errors.New("请填写网络密钥")
	}
	if len([]rune(secret)) < meshMinSecretLen || len([]rune(secret)) > meshMaxSecretLen {
		return fmt.Errorf("网络密钥需要 %d–%d 个字符", meshMinSecretLen, meshMaxSecretLen)
	}
	for _, r := range secret {
		if r < 0x20 || r == 0x7f {
			return errors.New("网络密钥不能包含换行或控制字符")
		}
	}
	return nil
}

// normalizeMeshPeer 把用户填的地址补成 EasyTier 认识的 URI；返回空串表示留空。
func normalizeMeshPeer(raw string) (string, error) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return "", nil
	}
	if !strings.Contains(text, "://") {
		text = "tcp://" + text
	}
	if !meshPeerScheme.MatchString(text) {
		return "", errors.New("对端地址只支持 tcp:// 或 udp://")
	}
	rest := text[strings.Index(text, "://")+3:]
	if strings.ContainsAny(rest, "/?#") {
		return "", errors.New("对端地址只填主机和端口，例如 1.2.3.4:11010")
	}
	host, port, err := net.SplitHostPort(rest)
	if err != nil {
		return "", errors.New("对端地址需要带端口，例如 1.2.3.4:11010")
	}
	value, convErr := strconv.Atoi(port)
	if convErr != nil || value < 1 || value > 65535 {
		return "", errors.New("对端地址的端口需要是 1–65535 的整数")
	}
	if host == "" || !IsHostname(host) {
		return "", errors.New("对端地址的主机名或 IP 无效")
	}
	return text, nil
}

// NormalizeMesh 校验前端提交的组网配置；secretPresent 表示密钥已保存（或本次一起提交），
// reserved 用于拒绝与主服务端口冲突的监听端口。
func NormalizeMesh(input map[string]any, current MeshConfig, secretPresent bool, reserved []int) (MeshConfig, error) {
	target := current
	base := toMap(target)
	for key, value := range input {
		base[key] = value
	}

	name, ok := asString(base["networkName"])
	if !ok {
		return target, errors.New("网络名称格式无效")
	}
	name = strings.ToLower(strings.TrimSpace(name))
	if name != "" {
		if len(name) < 4 || len(name) > 32 || !meshNamePattern.MatchString(name) {
			return target, errors.New("网络名称需要 4–32 个小写字母、数字或短横线，且不能以短横线开头或结尾")
		}
	}
	target.NetworkName = name

	peers := []string{}
	switch raw := base["peers"].(type) {
	case nil:
	case []any:
		for _, item := range raw {
			text, isText := asString(item)
			if !isText {
				return target, errors.New("对端地址格式无效")
			}
			peer, err := normalizeMeshPeer(text)
			if err != nil {
				return target, err
			}
			if peer == "" {
				continue
			}
			if containsString(peers, peer) {
				continue
			}
			peers = append(peers, peer)
		}
	case []string:
		for _, item := range raw {
			peer, err := normalizeMeshPeer(item)
			if err != nil {
				return target, err
			}
			if peer != "" && !containsString(peers, peer) {
				peers = append(peers, peer)
			}
		}
	case string:
		for _, item := range strings.Split(raw, "\n") {
			peer, err := normalizeMeshPeer(item)
			if err != nil {
				return target, err
			}
			if peer != "" && !containsString(peers, peer) {
				peers = append(peers, peer)
			}
		}
	default:
		return target, errors.New("对端地址格式无效")
	}
	if len(peers) > meshMaxPeers {
		return target, fmt.Errorf("对端地址最多填 %d 个", meshMaxPeers)
	}
	target.Peers = peers

	if raw, exists := base["listenPort"]; exists {
		port, ok := portOf(raw)
		if !ok {
			return target, errors.New("组网监听端口需要填写 1–65535 的整数")
		}
		if containsInt(reserved, port) {
			return target, fmt.Errorf("组网监听端口不能与本机服务的 %d 端口重复", port)
		}
		target.ListenPort = port
	} else if target.ListenPort == 0 {
		target.ListenPort = MeshDefaultPort
	}
	if containsInt(reserved, target.ListenPort) {
		return target, fmt.Errorf("组网监听端口不能与本机服务的 %d 端口重复", target.ListenPort)
	}

	if raw, exists := base["instanceId"]; exists {
		text, isText := asString(raw)
		if !isText || (text != "" && !meshUUIDPattern.MatchString(text)) {
			return target, errors.New("组网实例标识无效")
		}
		target.InstanceID = text
	}

	target.Enabled = asBool(base["enabled"])
	if target.Enabled {
		if target.NetworkName == "" {
			return target, errors.New("请先填写网络名称")
		}
		if !secretPresent {
			return target, errors.New("请先填写网络密钥")
		}
	}
	return target, nil
}

// RandomMeshName 生成不易撞车的网络名称。
func RandomMeshName() string {
	buffer := make([]byte, 4)
	_, _ = rand.Read(buffer)
	return "zviewer-" + hex.EncodeToString(buffer)
}

// RandomMeshSecret 生成 32 位十六进制密钥，长度足够且不含需要转义的字符。
func RandomMeshSecret() string {
	buffer := make([]byte, 16)
	_, _ = rand.Read(buffer)
	return hex.EncodeToString(buffer)
}

// NewMeshInstanceID 生成稳定的实例标识。
func NewMeshInstanceID() string {
	buffer := make([]byte, 16)
	_, _ = rand.Read(buffer)
	buffer[6] = (buffer[6] & 0x0f) | 0x40
	buffer[8] = (buffer[8] & 0x3f) | 0x80
	hexed := hex.EncodeToString(buffer)
	return hexed[0:8] + "-" + hexed[8:12] + "-" + hexed[12:16] + "-" + hexed[16:20] + "-" + hexed[20:32]
}

func meshHostname() string {
	raw, err := os.Hostname()
	if err != nil {
		return "zviewer"
	}
	cleaned := make([]rune, 0, 32)
	for _, r := range raw {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			cleaned = append(cleaned, r)
		default:
			cleaned = append(cleaned, '-')
		}
		if len(cleaned) >= 32 {
			break
		}
	}
	text := strings.Trim(string(cleaned), "-_")
	if text == "" {
		return "zviewer"
	}
	return text
}

// tomlString 转义进 TOML 基本字符串：EasyTier 用标准 TOML 解析，反斜杠与双引号必须转义。
func tomlString(value string) string {
	var builder strings.Builder
	builder.WriteByte('"')
	for _, r := range value {
		switch r {
		case '\\':
			builder.WriteString(`\\`)
		case '"':
			builder.WriteString(`\"`)
		default:
			builder.WriteRune(r)
		}
	}
	builder.WriteByte('"')
	return builder.String()
}

// MeshTOML 生成 easytier-core 的配置文件内容。
// 不写 rpc_portal：实测配置里的 rpc_portal 不生效，RPC 端口靠命令行 -r 传入。
func MeshTOML(cfg MeshConfig, secret, hostname string) string {
	port := strconv.Itoa(cfg.ListenPort)
	lines := []string{
		"instance_id = " + tomlString(cfg.InstanceID),
		"hostname = " + tomlString(hostname),
		"dhcp = true",
		"listeners = [",
		"    " + tomlString("tcp://0.0.0.0:"+port) + ",",
		"    " + tomlString("udp://0.0.0.0:"+port) + ",",
		"]",
		"",
		"[network_identity]",
		"network_name = " + tomlString(cfg.NetworkName),
		"network_secret = " + tomlString(secret),
	}
	for _, peer := range cfg.Peers {
		lines = append(lines, "", "[[peer]]", "uri = "+tomlString(peer))
	}
	lines = append(lines, "", "[flags]", "no_tun = true", "bind_device = false", "")
	return strings.Join(lines, "\n")
}
