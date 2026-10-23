package controller

// EasyTier 虚拟组网的状态解析：把 easytier-cli 的 JSON 输出转成面板用的结构。
// 输出字段会随版本变化，这里的解析一律按「找不到就留空」处理，不用强类型 struct 硬绑。

import (
	"encoding/json"
	"math"
	"net"
	"strconv"
	"strings"
)

type MeshNode struct {
	PeerID    string `json:"peerId"`
	IPv4      string `json:"ipv4"`
	Hostname  string `json:"hostname"`
	Version   string `json:"version"`
	Listeners int    `json:"listeners"`
}

type MeshPeer struct {
	Hostname string `json:"hostname"`
	IPv4     string `json:"ipv4"`
	Cost     string `json:"cost"`
	Latency  string `json:"latency"`
	LossRate string `json:"lossRate"`
	RX       string `json:"rx"`
	TX       string `json:"tx"`
	Tunnel   string `json:"tunnel"`
	NATType  string `json:"natType"`
	Version  string `json:"version"`
	// Self 标记本节点；Direct 表示与其他节点是直连而不是经服务器中继。
	Self   bool `json:"self"`
	Direct bool `json:"direct"`
}

type MeshStatus struct {
	State     string     `json:"state"`
	Available bool       `json:"available"`
	Version   string     `json:"version"`
	Pid       *int       `json:"pid"`
	VirtualIP string     `json:"virtualIp"`
	Hostname  string     `json:"hostname"`
	Peers     []MeshPeer `json:"peers"`
	// LanPeers 是本机在局域网里的接入地址：还没分配虚拟 IP 时，
	// 对方可以把其中一条填进「对端地址」，先连上本机再由 DHCP 分配。
	LanPeers []string `json:"lanPeers"`
	// PublicPeers 是内置的公共中继候选，界面据此渲染「公共对端服务器」卡片。
	PublicPeers []string `json:"publicPeers"`
	Message     string   `json:"message"`
}

// meshLanIPv4s 列出本机可用于接入的局域网 IPv4（跳过回环与 169.254 链路本地地址）。
// 这里直接产出能拼进 tcp:// 的字符串，不复用 net.go 的同名探测：
// 组网要的是候选对端地址，返回类型不必跟随证书模块调整。
func meshLanIPv4s() []string {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	out := []string{}
	for _, item := range interfaces {
		if item.Flags&net.FlagUp == 0 || item.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, addrErr := item.Addrs()
		if addrErr != nil {
			continue
		}
		for _, address := range addresses {
			ipNet, ok := address.(*net.IPNet)
			if !ok {
				continue
			}
			ipv4 := ipNet.IP.To4()
			if ipv4 == nil || ipv4.IsLinkLocalUnicast() || ipv4.IsLoopback() {
				continue
			}
			out = append(out, ipv4.String())
			if len(out) >= 3 {
				return out
			}
		}
	}
	return out
}

// jsonText 把 JSON 里的数字、字符串、布尔统一取成展示用文本。
func jsonText(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case float64:
		if typed == math.Trunc(typed) && math.Abs(typed) < 1e15 {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case bool:
		if typed {
			return "true"
		}
		return "false"
	}
	return ""
}

func jsonObject(raw []byte) (map[string]any, error) {
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ParseMeshNode 解析 `easytier-cli -o json node`。
func ParseMeshNode(raw []byte) (MeshNode, error) {
	object, err := jsonObject(raw)
	if err != nil {
		return MeshNode{}, err
	}
	node := MeshNode{
		PeerID:   jsonText(object["peer_id"]),
		IPv4:     jsonText(object["ipv4_addr"]),
		Hostname: jsonText(object["hostname"]),
		Version:  jsonText(object["version"]),
	}
	if list, ok := object["listeners"].([]any); ok {
		node.Listeners = len(list)
	}
	return node, nil
}

// ParseMeshPeers 解析 `easytier-cli -o json peer`。
func ParseMeshPeers(raw []byte) ([]MeshPeer, error) {
	var list []any
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, err
	}
	peers := make([]MeshPeer, 0, len(list))
	for _, item := range list {
		object, ok := item.(map[string]any)
		if !ok {
			continue
		}
		cost := jsonText(object["cost"])
		peer := MeshPeer{
			Hostname: jsonText(object["hostname"]),
			IPv4:     jsonText(object["ipv4"]),
			Cost:     cost,
			Latency:  jsonText(object["lat_ms"]),
			LossRate: jsonText(object["loss_rate"]),
			RX:       jsonText(object["rx_bytes"]),
			TX:       jsonText(object["tx_bytes"]),
			Tunnel:   jsonText(object["tunnel_proto"]),
			NATType:  jsonText(object["nat_type"]),
			Version:  jsonText(object["version"]),
			Self:     cost == "Local",
			// EasyTier 用 cost 表示路由代价：Local 是本机，p2p 是直连，其他（relay 等）走中继。
			Direct: cost == "p2p" || cost == "Local",
		}
		if peer.IPv4 == "" && peer.Hostname == "" {
			continue
		}
		peers = append(peers, peer)
	}
	return peers, nil
}

// virtualIPv4 只保留地址部分，"10.126.126.1/24" -> "10.126.126.1"。
func virtualIPv4(value string) string {
	if index := strings.IndexByte(value, '/'); index > 0 {
		return value[:index]
	}
	return value
}

// MeshAccessURL 拼接访客在虚拟网里访问本机网页的地址。
func MeshAccessURL(virtualIP string, port int, https bool) string {
	host := virtualIPv4(virtualIP)
	if host == "" || port < 1 {
		return ""
	}
	scheme := "http"
	if https {
		scheme = "https"
	}
	return scheme + "://" + host + ":" + strconv.Itoa(port) + "/"
}

// meshInvite 是发给朋友的组网参数：官方客户端照抄即可入网。
func meshInvite(cfg MeshConfig, secret string, status MeshStatus, webPort int) string {
	lines := []string{
		"ZViewer EasyTier 虚拟组网",
		"网络名称：" + cfg.NetworkName,
		"网络密钥：" + secret,
	}
	if len(cfg.Peers) > 0 {
		lines = append(lines, "对端地址："+strings.Join(cfg.Peers, "、"))
	}
	if ip := virtualIPv4(status.VirtualIP); ip != "" {
		lines = append(lines, "观看地址：http://"+ip+":"+strconv.Itoa(webPort)+"/")
	} else {
		// 还没分配虚拟 IP 时，对方先连到本机的监听地址，再由 DHCP 分配地址。
		for _, address := range meshLanIPv4s() {
			lines = append(lines, "接入地址："+"tcp://"+address+":"+strconv.Itoa(cfg.ListenPort))
		}
	}
	lines = append(lines, "", "入网方式：装 EasyTier 客户端，按上面的网络名称与密钥加入同一网络。")
	return strings.Join(lines, "\n")
}
