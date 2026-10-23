package controller

// 组网密钥与 FRP 密钥是两份独立的密文：任何一次保存都不能把另一份冲掉。

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type plainCipher struct{}

func (plainCipher) Encrypt(value string) (string, error) { return "enc:" + value, nil }
func (plainCipher) Decrypt(value string) (string, error) {
	return strings.TrimPrefix(value, "enc:"), nil
}

func newMeshTestStore(t *testing.T) (*Store, string) {
	t.Helper()
	dir := t.TempDir()
	store, err := NewStore(dir, dir, plainCipher{})
	if err != nil {
		t.Fatalf("创建配置失败：%v", err)
	}
	return store, dir
}

func TestStoreSaveMeshKeepsBothSecrets(t *testing.T) {
	store, dir := newMeshTestStore(t)
	frp := "frp-token-value"
	if _, err := store.Save(map[string]any{}, &frp); err != nil {
		t.Fatalf("保存 FRP 密钥失败：%v", err)
	}
	secret := "mesh-network-secret"
	config, err := store.SaveMesh(map[string]any{
		"enabled":     true,
		"networkName": "zviewer-home",
		"peers":       []any{"1.2.3.4:11010"},
	}, &secret)
	if err != nil {
		t.Fatalf("保存组网配置失败：%v", err)
	}
	if !config.Mesh.Enabled || config.Mesh.NetworkName != "zviewer-home" {
		t.Fatalf("组网配置未落盘：%+v", config.Mesh)
	}
	if len(config.Mesh.Peers) != 1 || config.Mesh.Peers[0] != "tcp://1.2.3.4:11010" {
		t.Fatalf("对端地址未归一化：%v", config.Mesh.Peers)
	}

	// 重新打开，模拟下次启动。
	reopened, err := NewStore(dir, dir, plainCipher{})
	if err != nil {
		t.Fatalf("重新读取配置失败：%v", err)
	}
	if token, err := reopened.Token(); err != nil || token != frp {
		t.Fatalf("FRP 密钥应保留，得到 %q（%v）", token, err)
	}
	if value, err := reopened.MeshSecret(); err != nil || value != secret {
		t.Fatalf("组网密钥应保留，得到 %q（%v）", value, err)
	}
	if !reopened.Value.Mesh.Enabled {
		t.Fatal("启用状态应保留")
	}
}

// 保存普通设置不能顺手清掉组网密钥或组网配置（persist 要整份写回）。
func TestStoreSaveKeepsMeshSettings(t *testing.T) {
	store, _ := newMeshTestStore(t)
	secret := "mesh-network-secret"
	if _, err := store.SaveMesh(map[string]any{"enabled": true, "networkName": "zviewer-home"}, &secret); err != nil {
		t.Fatalf("保存组网配置失败：%v", err)
	}
	if _, err := store.Save(map[string]any{"closeToTray": false}, nil); err != nil {
		t.Fatalf("保存普通设置失败：%v", err)
	}
	if value, err := store.MeshSecret(); err != nil || value != secret {
		t.Fatalf("组网密钥被覆盖，得到 %q（%v）", value, err)
	}
	if store.Value.Mesh.NetworkName != "zviewer-home" || !store.Value.Mesh.Enabled {
		t.Fatalf("组网配置被覆盖：%+v", store.Value.Mesh)
	}
}

// 局部补丁只改提交的字段，不会把网络名称或对端地址清空。
func TestStoreSaveMeshPartialPatch(t *testing.T) {
	store, _ := newMeshTestStore(t)
	secret := "mesh-network-secret"
	if _, err := store.SaveMesh(map[string]any{
		"enabled": true, "networkName": "zviewer-home", "peers": []any{"1.2.3.4:11010"},
	}, &secret); err != nil {
		t.Fatalf("保存组网配置失败：%v", err)
	}
	config, err := store.SaveMesh(map[string]any{"enabled": false}, nil)
	if err != nil {
		t.Fatalf("局部保存失败：%v", err)
	}
	if config.Mesh.Enabled {
		t.Fatal("启用状态应被关闭")
	}
	if config.Mesh.NetworkName != "zviewer-home" || len(config.Mesh.Peers) != 1 {
		t.Fatalf("其余字段应保持不变：%+v", config.Mesh)
	}
	if value, err := store.MeshSecret(); err != nil || value != secret {
		t.Fatalf("未提交密钥时应沿用，得到 %q（%v）", value, err)
	}
}

func TestStoreSaveMeshRejectsShortSecret(t *testing.T) {
	store, _ := newMeshTestStore(t)
	short := "abc"
	if _, err := store.SaveMesh(map[string]any{"enabled": true, "networkName": "zviewer-home"}, &short); err == nil {
		t.Fatal("过短的密钥应被拒绝")
	}
}

// 老配置里没有实例标识（升级前存的），读取时要补上并落盘：
// 空值会让 easytier-core 拒绝加载配置，每次启动重新生成又会让 peer_id 一直变。
func TestStoreHealsLegacyEmptyMeshInstanceID(t *testing.T) {
	dir := t.TempDir()
	legacy := `{"schema":2,"config":{"mesh":{"enabled":false,"networkName":"zuecle",` +
		`"peers":["tcp://1.2.3.4:11010"],"listenPort":11010,"instanceId":""}},` +
		`"frpToken":"","meshSecret":"enc:mesh-network-secret"}`
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(legacy), 0o600); err != nil {
		t.Fatalf("写入老配置失败：%v", err)
	}
	store, err := NewStore(dir, dir, plainCipher{})
	if err != nil {
		t.Fatalf("读取老配置失败：%v", err)
	}
	healed := store.Value.Mesh.InstanceID
	if !meshUUIDPattern.MatchString(healed) {
		t.Fatalf("应从老配置补出实例标识，得到 %q", healed)
	}
	if store.Value.Mesh.NetworkName != "zuecle" || len(store.Value.Mesh.Peers) != 1 {
		t.Fatalf("其余组网字段应保留：%+v", store.Value.Mesh)
	}
	if _, err := store.SaveMesh(map[string]any{"enabled": true}, nil); err != nil {
		t.Fatalf("保存组网配置失败：%v", err)
	}
	reopened, err := NewStore(dir, dir, plainCipher{})
	if err != nil {
		t.Fatalf("重新读取配置失败：%v", err)
	}
	if reopened.Value.Mesh.InstanceID != healed {
		t.Fatalf("实例标识应落盘复用，得到 %q（期望 %q）", reopened.Value.Mesh.InstanceID, healed)
	}
}
