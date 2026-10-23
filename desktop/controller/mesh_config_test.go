package controller

import (
	"strings"
	"testing"
)

func TestDefaultMeshHasNoPublicPeers(t *testing.T) {
	// EasyTier 官方公共节点已停服，默认配置不能带任何对端地址，
	// 否则每次入网都会先报「对端地址连不上」。
	cfg := DefaultMeshConfig()
	if len(cfg.Peers) != 0 {
		t.Fatalf("默认配置不应内置对端地址，得到 %v", cfg.Peers)
	}
	if cfg.ListenPort != MeshDefaultPort {
		t.Fatalf("默认监听端口应为 %d，得到 %d", MeshDefaultPort, cfg.ListenPort)
	}
	if text := MeshTOML(cfg, "secret123", "host"); strings.Contains(text, "[[peer]]") {
		t.Fatalf("没有对端时不应生成 [[peer]]：\n%s", text)
	}
}

func TestNormalizeMeshDropsRetiredPublicPeers(t *testing.T) {
	// 老配置里残留的官方公共节点地址要在校验时清掉，否则每次入网都先报连不上。
	cfg, err := NormalizeMesh(map[string]any{
		"networkName": "zviewer-home",
		"peers":       []any{"tcp://public.easytier.cn:11010", "udp://public.easytier.top:11010", "tcp://1.2.3.4:11010"},
	}, DefaultMeshConfig(), true, nil)
	if err != nil {
		t.Fatalf("未预期的错误：%v", err)
	}
	if len(cfg.Peers) != 1 || cfg.Peers[0] != "tcp://1.2.3.4:11010" {
		t.Fatalf("应只保留自建节点，得到 %v", cfg.Peers)
	}
}

func TestNormalizeMeshAcceptsPeerWithoutScheme(t *testing.T) {
	cfg, err := NormalizeMesh(map[string]any{
		"networkName": "ZViewer-Home",
		"peers":       []any{"1.2.3.4:11010", "udp://example.com:11010", "  1.2.3.4:11010  "},
		"listenPort":  float64(11010),
	}, DefaultMeshConfig(), true, []int{3333, 3334, 3335, 3336, 3337})
	if err != nil {
		t.Fatalf("未预期的错误：%v", err)
	}
	if cfg.NetworkName != "zviewer-home" {
		t.Fatalf("网络名称应转小写，得到 %q", cfg.NetworkName)
	}
	if len(cfg.Peers) != 2 {
		t.Fatalf("重复地址应合并，得到 %v", cfg.Peers)
	}
	if cfg.Peers[0] != "tcp://1.2.3.4:11010" {
		t.Fatalf("缺省协议应补 tcp，得到 %q", cfg.Peers[0])
	}
	if cfg.ListenPort != 11010 {
		t.Fatalf("监听端口应为 11010，得到 %d", cfg.ListenPort)
	}
}

func TestNormalizeMeshRejectsBadInput(t *testing.T) {
	reserved := []int{3333, 3334, 3335, 3336, 3337}
	cases := []struct {
		name  string
		input map[string]any
		want  string
	}{
		{"名称太短", map[string]any{"networkName": "ab"}, "网络名称"},
		{"名称带大写以外的符号", map[string]any{"networkName": "zviewer_home"}, "网络名称"},
		{"对端缺端口", map[string]any{"networkName": "zviewer-home", "peers": []any{"1.2.3.4"}}, "端口"},
		{"对端协议不支持", map[string]any{"networkName": "zviewer-home", "peers": []any{"quic://1.2.3.4:11010"}}, "tcp://"},
		{"监听端口冲突", map[string]any{"networkName": "zviewer-home", "listenPort": float64(3336)}, "重复"},
		{"启用但没密钥", map[string]any{"networkName": "zviewer-home", "enabled": true}, "网络密钥"},
	}
	for _, item := range cases {
		if _, err := NormalizeMesh(item.input, DefaultMeshConfig(), false, reserved); err == nil ||
			!strings.Contains(err.Error(), item.want) {
			t.Fatalf("%s：期望包含 %q 的错误，得到 %v", item.name, item.want, err)
		}
	}
}

func TestNormalizeMeshEnabledNeedsSecret(t *testing.T) {
	input := map[string]any{"networkName": "zviewer-home", "enabled": true}
	if _, err := NormalizeMesh(input, DefaultMeshConfig(), true, nil); err != nil {
		t.Fatalf("已有密钥时不应报错：%v", err)
	}
}

func TestMeshSecretValid(t *testing.T) {
	for _, valid := range []string{"abcdef", "0123456789abcdef0123456789abcdef", `p@ss"word`} {
		if err := MeshSecretValid(valid); err != nil {
			t.Fatalf("%q 应被接受：%v", valid, err)
		}
	}
	for _, invalid := range []string{"", "abc", "abc\ndef"} {
		if err := MeshSecretValid(invalid); err == nil {
			t.Fatalf("%q 应被拒绝", invalid)
		}
	}
}

// 免 TUN 必须同时关掉设备绑定，否则 Windows 上出站 socket 会绑定到虚拟 IP 并报 10049。
func TestMeshTOMLKeepsNoTunFlags(t *testing.T) {
	cfg := MeshConfig{
		NetworkName: "zviewer-home",
		Peers:       []string{"tcp://1.2.3.4:11010"},
		ListenPort:  11010,
		InstanceID:  "11111111-2222-4333-8444-555555555555",
	}
	text := MeshTOML(cfg, `sec"ret`, "my-pc")
	for _, want := range []string{
		"no_tun = true",
		"bind_device = false",
		`network_name = "zviewer-home"`,
		`network_secret = "sec\"ret"`,
		`uri = "tcp://1.2.3.4:11010"`,
		`"tcp://0.0.0.0:11010"`,
		`"udp://0.0.0.0:11010"`,
		`instance_id = "11111111-2222-4333-8444-555555555555"`,
		"dhcp = true",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("生成的配置缺少 %q：\n%s", want, text)
		}
	}
	if strings.Contains(text, "rpc_portal") {
		t.Fatal("配置里不写 rpc_portal：实测不生效，RPC 端口由命令行 -r 传入")
	}
}

func TestRandomMeshCredentials(t *testing.T) {
	name, secret := RandomMeshName(), RandomMeshSecret()
	if _, err := NormalizeMesh(map[string]any{"networkName": name}, DefaultMeshConfig(), false, nil); err != nil {
		t.Fatalf("随机网络名称应合法：%v", err)
	}
	if err := MeshSecretValid(secret); err != nil {
		t.Fatalf("随机密钥应合法：%v", err)
	}
	if RandomMeshName() == name || RandomMeshSecret() == secret {
		t.Fatal("两次生成不应相同")
	}
	if !meshUUIDPattern.MatchString(NewMeshInstanceID()) {
		t.Fatalf("实例标识格式不对：%s", NewMeshInstanceID())
	}
}
