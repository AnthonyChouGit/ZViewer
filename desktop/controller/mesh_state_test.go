package controller

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fixture 来自 easytier-core 2.6.4（Windows）实测输出。
func TestParseMeshNodeFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "mesh-node.json"))
	if err != nil {
		t.Fatalf("读取 fixture 失败：%v", err)
	}
	node, err := ParseMeshNode(raw)
	if err != nil {
		t.Fatalf("解析节点状态失败：%v", err)
	}
	if node.IPv4 != "10.126.126.1/24" {
		t.Fatalf("虚拟地址解析错误：%q", node.IPv4)
	}
	if node.PeerID == "" || node.Version == "" {
		t.Fatalf("缺少 peer_id 或 version：%+v", node)
	}
	if virtualIPv4(node.IPv4) != "10.126.126.1" {
		t.Fatalf("带掩码的地址应被裁掉，得到 %q", virtualIPv4(node.IPv4))
	}
}

func TestParseMeshPeersFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "mesh-peer.json"))
	if err != nil {
		t.Fatalf("读取 fixture 失败：%v", err)
	}
	peers, err := ParseMeshPeers(raw)
	if err != nil {
		t.Fatalf("解析对端列表失败：%v", err)
	}
	if len(peers) != 2 {
		t.Fatalf("应有 2 个对端，得到 %d", len(peers))
	}
	if !peers[0].Self || peers[1].Self {
		t.Fatal("cost=Local 的应标记为本机，且只有一个本机")
	}
	if !peers[1].Direct || peers[1].Cost != "p2p" {
		t.Fatalf("p2p 应视为直连：%+v", peers[1])
	}
	if peers[1].Latency != "0.09" || peers[1].Tunnel != "tcp" {
		t.Fatalf("对端延迟或通道解析错误：%+v", peers[1])
	}
	// "-" 之类的占位符要原样保留，界面据此显示「—」。
	if peers[0].Latency != "-" {
		t.Fatalf("本机延迟占位符应保留，得到 %q", peers[0].Latency)
	}
}

func TestParseMeshPeersToleratesEmpty(t *testing.T) {
	peers, err := ParseMeshPeers([]byte("[]"))
	if err != nil {
		t.Fatalf("空对端列表不应报错：%v", err)
	}
	if len(peers) != 0 {
		t.Fatalf("空对端列表应返回 0 条，得到 %d", len(peers))
	}
	if _, err := ParseMeshNode([]byte("not json")); err == nil {
		t.Fatal("非法输出应报错")
	}
}

func TestMeshAccessURL(t *testing.T) {
	cases := []struct {
		ip     string
		port   int
		https  bool
		expect string
	}{
		{"10.126.126.1/24", 3333, false, "http://10.126.126.1:3333/"},
		{"10.126.126.1/24", 3333, true, "https://10.126.126.1:3333/"},
		{"", 3333, false, ""},
		{"10.126.126.1", 0, false, ""},
	}
	for _, item := range cases {
		if got := MeshAccessURL(item.ip, item.port, item.https); got != item.expect {
			t.Fatalf("MeshAccessURL(%q,%d,%v) = %q，期望 %q", item.ip, item.port, item.https, got, item.expect)
		}
	}
}

func TestMeshInviteContainsCredentials(t *testing.T) {
	cfg := MeshConfig{NetworkName: "zviewer-home", Peers: []string{"tcp://1.2.3.4:11010"}}
	text := meshInvite(cfg, "s3cret", MeshStatus{VirtualIP: "10.126.126.1"}, 3333)
	for _, want := range []string{"zviewer-home", "s3cret", "tcp://1.2.3.4:11010", "http://10.126.126.1:3333/"} {
		if !strings.Contains(text, want) {
			t.Fatalf("邀请文本缺少 %q：\n%s", want, text)
		}
	}
}
