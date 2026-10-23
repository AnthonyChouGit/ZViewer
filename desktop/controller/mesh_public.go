package controller

// EasyTier 公共中继节点：内置候选列表 + 可用性探测。
//
// 这些节点由社区维护，随时可能下线，所以一律只作为候选展示：
// 默认配置里不写任何对端地址，用户点「填入可用节点」才会真正落到配置。
// 探测只做「到 host:port 能不能建 TCP 连接」，不做 EasyTier 握手——握手需要网络名称与
// 密钥，公开节点不会为测试单独响应。对 tcp/ws/wss 来说，能建连就说明服务在监听，
// 精度足够判断「这个节点还活着吗」。

import (
	"errors"
	"net"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// meshProbeTimeout 是单节点探测上限：公共节点多在国内，3 秒已经足够区分「慢」和「死」。
const meshProbeTimeout = 3 * time.Second

// meshPublicPeers 是社区维护的公共中继节点（2026-10 实测可连通的一批）。
// 全部用 tcp:// ：既是 EasyTier 支持最广的协议，也是本面板唯一能自动测出可用性的协议。
var meshPublicPeers = []string{
	"tcp://ros.scpsl.com.cn:11010",
	"tcp://et.basd1.de:11010",
	"tcp://183.230.36.171:11010",
	"tcp://225284.xyz:11010",
	"tcp://us01.225284.xyz:11010",
	"tcp://easytier.weiai.org.cn:11010",
}

// MeshPublicPeers 返回内置公共节点候选（拷贝，调用方改了也不影响下次展示）。
func MeshPublicPeers() []string {
	return append([]string{}, meshPublicPeers...)
}

// MeshPeerProbe 是单个节点的探测结果。State 取 ok / fail / unknown：
// unknown 用于 UDP 这类无法在入网前验证的协议，界面显示「未测试」而不是判死。
type MeshPeerProbe struct {
	URI       string `json:"uri"`
	State     string `json:"state"`
	LatencyMs int    `json:"latencyMs"`
	Reason    string `json:"reason"`
}

// ProbeMeshPeers 并发探测一组对端地址，返回顺序与入参一致。
func ProbeMeshPeers(uris []string) []MeshPeerProbe {
	out := make([]MeshPeerProbe, len(uris))
	var wg sync.WaitGroup
	for index, uri := range uris {
		wg.Add(1)
		go func(index int, uri string) {
			defer wg.Done()
			out[index] = probeMeshPeer(uri)
		}(index, uri)
	}
	wg.Wait()
	return out
}

func probeMeshPeer(uri string) MeshPeerProbe {
	result := MeshPeerProbe{URI: uri}
	scheme, host, port, err := splitMeshURI(uri)
	if err != nil {
		result.State = "fail"
		result.Reason = err.Error()
		return result
	}
	if scheme == "udp" {
		// UDP 没有握手可探，只能确认域名能解析；是否可用要到真正入网才知道。
		result.State = "unknown"
		result.Reason = "UDP 无法在入网前探测"
		if _, err := net.LookupHost(host); err != nil {
			result.State = "fail"
			result.Reason = "域名解析失败"
		}
		return result
	}
	start := time.Now()
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(port)), meshProbeTimeout)
	if err != nil {
		result.State = "fail"
		result.Reason = meshProbeReason(err)
		return result
	}
	result.LatencyMs = int(time.Since(start).Milliseconds())
	result.State = "ok"
	_ = conn.Close()
	return result
}

// splitMeshURI 取出协议、主机与端口；EasyTier 默认端口是 11010。
func splitMeshURI(uri string) (scheme, host string, port int, err error) {
	text := strings.TrimSpace(uri)
	if !strings.Contains(text, "://") {
		text = "tcp://" + text
	}
	parsed, parseErr := url.Parse(text)
	if parseErr != nil || parsed.Hostname() == "" {
		return "", "", 0, errors.New("地址格式无效")
	}
	scheme = strings.ToLower(parsed.Scheme)
	switch scheme {
	case "tcp", "udp", "ws", "wss":
	default:
		return "", "", 0, errors.New("只支持 tcp / udp / ws / wss")
	}
	port = MeshDefaultPort
	if raw := parsed.Port(); raw != "" {
		value, convErr := strconv.Atoi(raw)
		if convErr != nil || value < 1 || value > 65535 {
			return "", "", 0, errors.New("端口需要是 1–65535 的整数")
		}
		port = value
	}
	return scheme, parsed.Hostname(), port, nil
}

// meshProbeReason 把网络错误换成一眼能懂的说法。
func meshProbeReason(err error) string {
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return "域名解析失败"
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return "连接超时"
	}
	text := err.Error()
	if strings.Contains(text, "refused") {
		return "端口未开放"
	}
	if strings.Contains(text, "no such host") {
		return "域名解析失败"
	}
	return "无法连接"
}

// MeshBestPeers 从探测结果里挑出可用的节点：按延迟排序，最多 limit 个。
// 没测过的节点不参与——「一键填写」只写已验证能连上的地址。
func MeshBestPeers(results []MeshPeerProbe, limit int) []string {
	usable := make([]MeshPeerProbe, 0, len(results))
	for _, item := range results {
		if item.State == "ok" {
			usable = append(usable, item)
		}
	}
	sort.SliceStable(usable, func(i, j int) bool { return usable[i].LatencyMs < usable[j].LatencyMs })
	out := make([]string, 0, len(usable))
	for _, item := range usable {
		if len(out) >= limit {
			break
		}
		out = append(out, item.URI)
	}
	return out
}
