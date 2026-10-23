package controller

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNormalizeMeshMode(t *testing.T) {
	// 默认走图形配置；配置文件模式下名称与密钥由文件决定，面板为空也不能拦。
	cfg, err := NormalizeMesh(map[string]any{}, DefaultMeshConfig(), false, nil)
	if err != nil {
		t.Fatalf("未预期的错误：%v", err)
	}
	if cfg.Mode != "form" || cfg.Format != "toml" {
		t.Fatalf("默认应为 form/toml，得到 %q/%q", cfg.Mode, cfg.Format)
	}
	cfg, err = NormalizeMesh(map[string]any{"mode": "config", "enabled": true}, DefaultMeshConfig(), false, nil)
	if err != nil {
		t.Fatalf("配置文件模式在没填名称密钥时也应能保存：%v", err)
	}
	if cfg.Mode != "config" {
		t.Fatalf("模式应保持 config，得到 %q", cfg.Mode)
	}
	if _, err := NormalizeMesh(map[string]any{"mode": "raw"}, DefaultMeshConfig(), false, nil); err == nil {
		t.Fatal("非法配置方式应被拒绝")
	}
	if _, err := NormalizeMesh(map[string]any{"format": "yaml"}, DefaultMeshConfig(), false, nil); err == nil {
		t.Fatal("EasyTier 只认 TOML，其他格式应被拒绝")
	}
}

func TestMeshRuntimeConfigInjectsFlags(t *testing.T) {
	base := "hostname = \"pc\"\n\n[network_identity]\nnetwork_name = \"zuecle\"\nnetwork_secret = \"secret\"\n"
	out := meshRuntimeConfig(base)
	for _, want := range []string{"[flags]", "no_tun = true", "bind_device = false", `network_name = "zuecle"`} {
		if !strings.Contains(out, want) {
			t.Fatalf("转换结果缺少 %q：\n%s", want, out)
		}
	}
	if strings.Count(out, "[flags]") != 1 {
		t.Fatalf("[flags] 不应重复：\n%s", out)
	}

	// 已有 [flags] 段：值被纠正，缺的键插到段首，其他段不被破坏。
	withFlags := "hostname = \"pc\"\n\n[flags]\nenable_kcp_proxy = true\nno_tun = false\n\n[[peer]]\nuri = \"tcp://1.2.3.4:11010\"\n"
	out = meshRuntimeConfig(withFlags)
	if strings.Contains(out, "no_tun = false") {
		t.Fatalf("no_tun 应被强制为 true：\n%s", out)
	}
	if !strings.Contains(out, "bind_device = false") || !strings.Contains(out, "enable_kcp_proxy = true") {
		t.Fatalf("应补上 bind_device 并保留原有键：\n%s", out)
	}
	if !strings.Contains(out, "[[peer]]") {
		t.Fatalf("对端段应保留：\n%s", out)
	}
	if strings.Index(out, "[[peer]]") < strings.Index(out, "bind_device") {
		t.Fatalf("补齐的键要留在 flags 段内：\n%s", out)
	}
}

func TestMeshRuntimeConfigFillsEmptyInstanceID(t *testing.T) {
	out := meshRuntimeConfig("instance_id = \"\"\nhostname = \"pc\"\n")
	if strings.Contains(out, `instance_id = ""`) {
		t.Fatalf("空实例标识应被补上：\n%s", out)
	}
	if !meshUUIDPattern.MatchString(meshTOMLString(out, "instance_id")) {
		t.Fatalf("补的实例标识应是合法 UUID：\n%s", out)
	}
}

func TestMeshIdentityAndPortFromTOML(t *testing.T) {
	content := "hostname = \"pc\"\nlisteners = [\n    \"tcp://0.0.0.0:11010\",\n    \"udp://0.0.0.0:11010\",\n]\n\n[network_identity]\nnetwork_name = \"zuecle\"\nnetwork_secret = \"sec\\\"ret\"\n\n[[peer]]\nuri = \"tcp://1.2.3.4:11010\"\n"
	name, secret := meshIdentityFromTOML(content)
	if name != "zuecle" || secret != `sec"ret` {
		t.Fatalf("名称/密钥解析不对：%q / %q", name, secret)
	}
	if port := meshListenerPort(content); port != 11010 {
		t.Fatalf("监听端口应为 11010，得到 %d", port)
	}
	if port := meshListenerPort("hostname = \"pc\"\n"); port != 0 {
		t.Fatalf("没有 listeners 时应返回 0，得到 %d", port)
	}
}

func TestSaveMeshConfigFile(t *testing.T) {
	store, dir := newMeshTestStore(t)
	controller := &Controller{dir: dir, store: store, mesh: NewMeshManager(dir, filepath.Join(dir, "mesh"), "",
		func(*Proc, string) error { return nil }, func(string, string, string) {}, func() {})}

	if _, err := controller.SaveMeshConfigFile("hostname = \"pc\"\n", "toml"); err == nil {
		t.Fatal("缺少 network_identity 的配置应被拒绝")
	}
	if _, err := controller.SaveMeshConfigFile("x = 1\n", "yaml"); err == nil {
		t.Fatal("非 TOML 格式应被拒绝")
	}
	content := "[network_identity]\nnetwork_name = \"zuecle\"\nnetwork_secret = \"secret-123\"\n"
	saved, err := controller.SaveMeshConfigFile(content, "toml")
	if err != nil {
		t.Fatalf("保存配置失败：%v", err)
	}
	if saved["mode"] != "config" {
		t.Fatalf("保存后应切到配置文件模式：%v", saved["mode"])
	}
	raw, err := os.ReadFile(controller.MeshCustomPath())
	if err != nil || string(raw) != content {
		t.Fatalf("配置内容应原样落盘：%v\n%s", err, raw)
	}
	if store.Value.Mesh.Mode != "config" {
		t.Fatalf("配置里应记录 config 模式，得到 %q", store.Value.Mesh.Mode)
	}
	loaded, err := controller.MeshConfigFile()
	if err != nil || loaded["content"] != content {
		t.Fatalf("读取自定义配置失败：%v", err)
	}
}

// 配置文件模式下真的把用户那份 TOML 拉起来：缺 [flags] 时自动补 no_tun。
func TestMeshManagerStartsFromCustomConfig(t *testing.T) {
	if !isWindows() {
		t.Skip("组网组件只有 Windows 版本")
	}
	core, host := meshTestBinaries(t)
	manager := newMeshTestNode(t, core, host)
	port := freeTCPPort(t)
	content := fmt.Sprintf("hostname = \"zviewer-file\"\nlisteners = [\n    \"tcp://0.0.0.0:%d\",\n    \"udp://0.0.0.0:%d\",\n]\n\n[network_identity]\nnetwork_name = \"zviewer-file\"\nnetwork_secret = \"secret-123456\"\n", port, port)
	if err := os.MkdirAll(manager.dir, 0o700); err != nil {
		t.Fatalf("创建组网目录失败：%v", err)
	}
	if err := os.WriteFile(manager.customPath(), []byte(content), 0o600); err != nil {
		t.Fatalf("写入自定义配置失败：%v", err)
	}
	cfg := DefaultMeshConfig()
	cfg.Mode = "config"
	status, err := manager.Start(cfg, "")
	if err != nil {
		t.Fatalf("配置文件模式应能启动：%v（%s）", err, status.Message)
	}
	defer func() { _, _ = manager.Stop() }()
	if status.State != "running" {
		t.Fatalf("状态应为 running，得到 %q（%s）", status.State, status.Message)
	}
	if status.Message != meshWaitingMessage {
		t.Fatalf("单节点应提示等待接入，得到 %q", status.Message)
	}
	// 运行时配置里必须有免 TUN 的两个开关，用户原文件保持不动。
	runtime, err := os.ReadFile(filepath.Join(manager.dir, "config.toml"))
	if err != nil || !strings.Contains(string(runtime), "no_tun = true") {
		t.Fatalf("运行时配置缺少 no_tun：%v\n%s", err, runtime)
	}
	user, err := os.ReadFile(manager.customPath())
	if err != nil || string(user) != content {
		t.Fatalf("用户配置文件不应被改写：%v\n%s", err, user)
	}
}

// 原版配置常带 [[peer]]：启动时对端段必须原样留给 easytier，连不上对端也不能拖死进程。
func TestMeshManagerStartsWithPeerInCustomConfig(t *testing.T) {
	if !isWindows() {
		t.Skip("组网组件只有 Windows 版本")
	}
	core, host := meshTestBinaries(t)
	manager := newMeshTestNode(t, core, host)
	port := freeTCPPort(t)
	deadPeer := freeTCPPort(t) // 没人监听，连接被拒
	content := fmt.Sprintf("hostname = \"zviewer-peer\"\nlisteners = [\n    \"tcp://0.0.0.0:%d\",\n    \"udp://0.0.0.0:%d\",\n]\n\n[network_identity]\nnetwork_name = \"zviewer-peer\"\nnetwork_secret = \"secret-123456\"\n\n[[peer]]\nuri = \"tcp://127.0.0.1:%d\"\n", port, port, deadPeer)
	if err := os.MkdirAll(manager.dir, 0o700); err != nil {
		t.Fatalf("创建组网目录失败：%v", err)
	}
	if err := os.WriteFile(manager.customPath(), []byte(content), 0o600); err != nil {
		t.Fatalf("写入自定义配置失败：%v", err)
	}
	cfg := DefaultMeshConfig()
	cfg.Mode = "config"
	status, err := manager.Start(cfg, "")
	if err != nil {
		t.Fatalf("带对端段的配置应能启动：%v（%s）", err, status.Message)
	}
	defer func() { _, _ = manager.Stop() }()
	if status.State != "running" {
		t.Fatalf("状态应为 running，得到 %q（%s）", status.State, status.Message)
	}
	runtime, err := os.ReadFile(filepath.Join(manager.dir, "config.toml"))
	if err != nil {
		t.Fatalf("读取运行时配置失败：%v", err)
	}
	if !strings.Contains(string(runtime), "[[peer]]") || !strings.Contains(string(runtime), fmt.Sprintf("tcp://127.0.0.1:%d", deadPeer)) {
		t.Fatalf("运行时配置应保留对端段：\n%s", runtime)
	}
	if !strings.Contains(string(runtime), "no_tun = true") {
		t.Fatalf("运行时配置缺少 no_tun：\n%s", runtime)
	}
}

// 端到端：保存配置 → 切到配置文件模式 → 入网，走的是界面按钮的同一条链路。
func TestControllerStartsMeshFromSavedConfig(t *testing.T) {
	if !isWindows() {
		t.Skip("组网组件只有 Windows 版本")
	}
	core, host := meshTestBinaries(t)
	manager := newMeshTestNode(t, core, host)
	// Controller 的组网配置目录固定是 <数据目录>/mesh，这里把两者对齐。
	dataDir := filepath.Dir(manager.dir)
	manager.dir = filepath.Join(dataDir, "mesh")
	store, err := NewStore(dataDir, dataDir, plainCipher{})
	if err != nil {
		t.Fatalf("创建配置失败：%v", err)
	}
	controller := &Controller{dir: dataDir, store: store, mesh: manager}
	port := freeTCPPort(t)
	content := fmt.Sprintf("hostname = \"zviewer-e2e\"\nlisteners = [\n    \"tcp://0.0.0.0:%d\",\n    \"udp://0.0.0.0:%d\",\n]\n\n[network_identity]\nnetwork_name = \"zviewer-e2e\"\nnetwork_secret = \"secret-123456\"\n", port, port)
	if _, err := controller.SaveMeshConfigFile(content, "toml"); err != nil {
		t.Fatalf("保存配置失败：%v", err)
	}
	status, err := controller.StartMesh()
	if err != nil {
		t.Fatalf("按配置文件入网失败：%v（%s）", err, status.Message)
	}
	defer func() { _, _ = controller.StopMesh() }()
	if status.State != "running" {
		t.Fatalf("状态应为 running，得到 %q（%s）", status.State, status.Message)
	}
	invite, err := controller.MeshInvite()
	if err != nil {
		t.Fatalf("配置模式下应能生成入网说明：%v", err)
	}
	if !strings.Contains(invite, "zviewer-e2e") || !strings.Contains(invite, "secret-123456") {
		t.Fatalf("入网说明应取自配置文件：\n%s", invite)
	}
}
