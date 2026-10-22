package controller

import "testing"

// 面板不再提供信令端口入口：无论传入什么值，保存/加载都要落回主项目的 3336。
func TestValidateFixesLivekitSignalPort(t *testing.T) {
	base := map[string]any{
		"port":           "3333",
		"rtmpPort":       "3334",
		"flvPort":        "3335",
		"livekitPort":    "9999",
		"livekitTcpPort": "3337",
		"bindHost":       "::",
		"https":          false,
		"updateProxyUrl": "",
	}
	cfg, err := Validate(base)
	if err != nil {
		t.Fatalf("Validate 失败: %v", err)
	}
	if cfg.LivekitPort != 3336 {
		t.Fatalf("信令端口应收回 3336，实际 %d", cfg.LivekitPort)
	}
	if cfg.Port != 3333 || cfg.LivekitTcpPort != 3337 {
		t.Fatalf("其他端口被误改: port=%d rtcTcp=%d", cfg.Port, cfg.LivekitTcpPort)
	}

	// 固定 3336 之后，网页端口再选 3336 必须按端口冲突拒绝。
	base["port"] = "3336"
	if _, err := Validate(base); err == nil {
		t.Fatal("网页端口占用 3336 时应报端口重复")
	}
}
