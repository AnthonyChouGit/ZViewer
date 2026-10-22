package controller

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNormalizeFrpFormat(t *testing.T) {
	cases := []struct {
		in    string
		want  string
		valid bool
	}{
		{"toml", "toml", true},
		{".TOML", "toml", true},
		{"yaml", "yaml", true},
		{"yml", "yaml", true},
		{".yml", "yaml", true},
		{"json", "json", true},
		{"ini", "toml", false},
		{"", "toml", false},
	}
	for _, item := range cases {
		got, ok := normalizeFrpFormat(item.in)
		if got != item.want || ok != item.valid {
			t.Fatalf("normalizeFrpFormat(%q)=(%q,%v), want (%q,%v)", item.in, got, ok, item.want, item.valid)
		}
	}
}

func TestCountFrpProxies(t *testing.T) {
	toml := "serverAddr = \"x\"\n\n[[proxies]]\nname = \"a\"\n\n[[proxies]]\nname = \"b\"\n"
	if got := countFrpProxies(toml, "toml"); got != 2 {
		t.Fatalf("toml proxies=%d, want 2", got)
	}
	jsonText := `{"serverAddr":"x","proxies":[{"name":"a"},{"name":"b"},{"name":"c"}]}`
	if got := countFrpProxies(jsonText, "json"); got != 3 {
		t.Fatalf("json proxies=%d, want 3", got)
	}
	yaml := "serverAddr: x\nproxies:\n  - name: a\n    type: tcp\n  # 注释不算\n  - name: b\n    type: udp\nvisitors:\n  - name: v\n"
	if got := countFrpProxies(yaml, "yaml"); got != 2 {
		t.Fatalf("yaml proxies=%d, want 2", got)
	}
	if got := countFrpProxies("serverAddr = \"x\"\n", "toml"); got != 0 {
		t.Fatalf("没有 proxies 时应为 0，得到 %d", got)
	}
}

func TestValidateFrpConfigMode(t *testing.T) {
	config, err := Validate(map[string]any{"frp": map[string]any{"mode": "config", "format": "yml"}})
	if err != nil {
		t.Fatalf("自定义配置模式应通过校验：%v", err)
	}
	if config.Frp.Mode != "config" || config.Frp.Format != "yaml" {
		t.Fatalf("unexpected frp mode/format: %+v", config.Frp)
	}
	if _, err := Validate(map[string]any{"frp": map[string]any{"mode": "raw"}}); err == nil {
		t.Fatal("未知配置方式应被拒绝")
	}
	if _, err := Validate(map[string]any{"frp": map[string]any{"format": "ini"}}); err == nil {
		t.Fatal("未知配置格式应被拒绝")
	}
}

func TestSaveFrpConfigFileSwitchesMode(t *testing.T) {
	dir := t.TempDir()
	controller, err := New(Options{StateDir: dir, Root: dir, Frpc: filepath.Join(dir, "frpc.exe"), Cipher: Dpapi{}})
	if err != nil {
		t.Fatalf("new controller: %v", err)
	}
	if controller.Store().Value.Frp.Mode != "form" {
		t.Fatal("默认应停留在表单模式")
	}
	if _, err := controller.SaveFrpConfigFile("  \n", "toml", nil); err == nil {
		t.Fatal("空配置应被拒绝")
	}
	if _, err := controller.SaveFrpConfigFile("serverAddr = \"vps\"\n", ".toml", nil); err != nil {
		t.Fatalf("save toml: %v", err)
	}
	if controller.Store().Value.Frp.Mode != "config" || controller.FrpConfigFormat() != "toml" {
		t.Fatalf("保存后应切到配置文件模式：%+v", controller.Store().Value.Frp)
	}
	if _, err := controller.SaveFrpConfigFile("proxies:\n  - name: a\n", "yaml", nil); err != nil {
		t.Fatalf("save yaml: %v", err)
	}
	if fileExists(filepath.Join(dir, "frp", "frpc.custom.toml")) {
		t.Fatal("换格式后旧扩展名文件应被清理")
	}
	file, err := controller.FrpConfigFile()
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if file["format"] != "yaml" || !strings.Contains(file["content"].(string), "- name: a") {
		t.Fatalf("unexpected custom config: %+v", file)
	}
	// 配置内容只落在 frp 目录，settings.json 里不应出现明文。
	raw, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err != nil {
		t.Fatalf("read settings: %v", err)
	}
	if strings.Contains(string(raw), "name: a") {
		t.Fatal("自定义配置不应明文写进 settings.json")
	}
}
