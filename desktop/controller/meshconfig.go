package controller

// 自定义 EasyTier 配置：允许直接粘贴或导入整份配置并原样运行。
//
// 表单模式生成的 config.toml 每次启动都会重写，所以自定义配置单独存成
// mesh.custom.toml，内容由用户在界面上直接编辑；启动时再转写一份运行时配置。
//
// EasyTier 2.6.4 只解析 TOML（YAML/JSON 会按 TOML 解析并报错），所以这里只支持 TOML。

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// MaxMeshConfigBytes 是导入与保存自定义配置的体积上限。
const MaxMeshConfigBytes = 256 * 1024

// normalizeMeshFormat 把用户输入或文件扩展名归一成 EasyTier 认识的格式。
func normalizeMeshFormat(value string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(strings.TrimPrefix(value, "."))) {
	case "toml":
		return "toml", true
	}
	return "toml", false
}

// meshCustomPath 是自定义配置的落盘位置（与运行时的 config.toml 分开，避免被重写）。
// meshDir 是组网运行目录，即 <数据目录>/mesh。
func meshCustomPath(meshDir string) string {
	return filepath.Join(meshDir, "mesh.custom.toml")
}

// MeshCustomPath 是自定义配置文件的落盘位置。
func (c *Controller) MeshCustomPath() string {
	return meshCustomPath(filepath.Join(c.dir, "mesh"))
}

// MeshConfigFile 读取当前自定义配置；文件不存在时返回空内容。
func (c *Controller) MeshConfigFile() (map[string]any, error) {
	path := c.MeshCustomPath()
	content := ""
	raw, err := os.ReadFile(path)
	if err == nil {
		content = string(raw)
	} else if !os.IsNotExist(err) {
		return nil, errors.New("无法读取 EasyTier 配置文件：" + err.Error())
	}
	return map[string]any{
		"content": content,
		"path":    path,
		"format":  "toml",
		"mode":    c.store.Value.Mesh.Mode,
	}, nil
}

// SaveMeshConfigFile 保存自定义配置并切到配置文件模式；运行中的节点会按新配置重新入网。
func (c *Controller) SaveMeshConfigFile(content, format string) (map[string]any, error) {
	if strings.TrimSpace(content) == "" {
		return nil, errors.New("请先粘贴或导入 EasyTier 配置文件")
	}
	if len(content) > MaxMeshConfigBytes {
		return nil, errors.New("配置文件不能超过 256 KB")
	}
	if strings.ContainsRune(content, 0) {
		return nil, errors.New("配置文件包含无法识别的字符")
	}
	if _, ok := normalizeMeshFormat(format); !ok {
		return nil, errors.New("组网配置文件只支持 TOML")
	}
	// 真正能不能跑由 easytier 启动时判定；这里只挡住「明显不是配置」的输入。
	if !strings.Contains(content, "network_identity") {
		return nil, errors.New("配置里缺少 [network_identity] 段，无法确定网络名称与密钥")
	}
	dir := filepath.Join(c.dir, "mesh")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	path := c.MeshCustomPath()
	if err := Atomic(path, content); err != nil {
		return nil, err
	}
	config, err := c.store.Save(map[string]any{"mesh": map[string]any{"mode": "config", "format": "toml"}}, nil)
	if err != nil {
		return nil, err
	}
	c.log("已保存 EasyTier 配置文件 "+filepath.Base(path), "mesh", "INFO")
	// 运行中改配置要立即生效，否则用户得先停止再入网。
	if c.mesh.Running() {
		secret, _ := c.store.MeshSecret()
		if _, err := c.mesh.Restart(config.Mesh, secret); err != nil {
			return nil, err
		}
	}
	return map[string]any{
		"content": content,
		"path":    path,
		"format":  "toml",
		"mode":    "config",
	}, nil
}

// MeshConfigTemplate 按当前图形配置生成一份完整 TOML，供「按图形配置填充」使用。
func (c *Controller) MeshConfigTemplate() (map[string]any, error) {
	secret, err := c.store.MeshSecret()
	if err != nil {
		return nil, errors.New("组网密钥无法解密，请重新填写网络密钥")
	}
	if secret == "" {
		return nil, errors.New("请先在图形配置里填写网络密钥")
	}
	cfg := c.store.Value.Mesh
	if cfg.NetworkName == "" {
		cfg.NetworkName = "zviewer-home"
	}
	return map[string]any{
		"content": MeshTOML(cfg, secret, meshHostname()),
		"format":  "toml",
	}, nil
}

// meshRuntimeConfig 把用户配置改写成能直接运行的样子，原始文件不动：
//  1. instance_id 为空会让 easytier-core 拒绝加载整份配置，补一个；
//  2. 本机以 no_tun 方式运行（免管理员、不建虚拟网卡），[flags] 里强制打开
//     no_tun 并关掉 bind_device，缺段时补上整段。
func meshRuntimeConfig(content string) string {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	lines = ensureMeshInstanceID(lines)
	return strings.Join(ensureMeshFlags(lines), "\n")
}

func ensureMeshInstanceID(lines []string) []string {
	for index, line := range lines {
		key, value, ok := splitMeshTOMLAssign(line)
		if !ok || key != "instance_id" {
			continue
		}
		if strings.TrimSpace(strings.SplitN(value, "#", 2)[0]) == `""` ||
			strings.TrimSpace(strings.SplitN(value, "#", 2)[0]) == "''" {
			indent := line[:len(line)-len(strings.TrimLeft(line, " \t"))]
			lines[index] = indent + "instance_id = " + tomlString(NewMeshInstanceID())
		}
		break
	}
	return lines
}

func ensureMeshFlags(lines []string) []string {
	start := -1
	for index, line := range lines {
		if isMeshTOMLTable(strings.TrimSpace(line), "flags") {
			start = index
			break
		}
	}
	if start < 0 {
		out := append([]string{}, lines...)
		for len(out) > 0 && strings.TrimSpace(out[len(out)-1]) == "" {
			out = out[:len(out)-1]
		}
		return append(out, "", "[flags]", "no_tun = true", "bind_device = false", "")
	}
	end := len(lines)
	for index := start + 1; index < len(lines); index++ {
		if strings.HasPrefix(strings.TrimSpace(lines[index]), "[") {
			end = index
			break
		}
	}
	seen := map[string]bool{}
	for index := start + 1; index < end; index++ {
		key, value, ok := splitMeshTOMLAssign(lines[index])
		if !ok || (key != "no_tun" && key != "bind_device") {
			continue
		}
		seen[key] = true
		if strings.TrimSpace(strings.SplitN(value, "#", 2)[0]) != "true" {
			indent := lines[index][:len(lines[index])-len(strings.TrimLeft(lines[index], " \t"))]
			lines[index] = indent + key + " = true"
		}
	}
	insert := []string{}
	if !seen["no_tun"] {
		insert = append(insert, "no_tun = true")
	}
	if !seen["bind_device"] {
		insert = append(insert, "bind_device = false")
	}
	if len(insert) == 0 {
		return lines
	}
	out := make([]string, 0, len(lines)+len(insert))
	out = append(out, lines[:start+1]...)
	out = append(out, insert...)
	out = append(out, lines[start+1:]...)
	return out
}

// splitMeshTOMLAssign 取出 `key = value` 的键与值；表头、注释与空行返回 false。
func splitMeshTOMLAssign(line string) (key, value string, ok bool) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "[") {
		return "", "", false
	}
	index := strings.Index(trimmed, "=")
	if index <= 0 {
		return "", "", false
	}
	return strings.TrimSpace(trimmed[:index]), strings.TrimSpace(trimmed[index+1:]), true
}

// isMeshTOMLTable 判断一行是不是 [name] 表头（行内注释也认）。
func isMeshTOMLTable(trimmed, name string) bool {
	if !strings.HasPrefix(trimmed, "[") || strings.HasPrefix(trimmed, "[[") {
		return false
	}
	if index := strings.Index(trimmed, "#"); index >= 0 {
		trimmed = strings.TrimSpace(trimmed[:index])
	}
	if !strings.HasSuffix(trimmed, "]") {
		return false
	}
	return strings.TrimSpace(trimmed[1:len(trimmed)-1]) == name
}

// meshTOMLString 读顶层或段内的字符串键（只认 `key = "value"` 形式）。
func meshTOMLString(content, key string) string {
	pattern := regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(key) + `\s*=\s*"((?:\\.|[^"\\])*)"`)
	match := pattern.FindStringSubmatch(content)
	if match == nil {
		return ""
	}
	return unescapeMeshTOML(match[1])
}

func unescapeMeshTOML(value string) string {
	var builder strings.Builder
	escaped := false
	for _, r := range value {
		if escaped {
			switch r {
			case 'n':
				builder.WriteByte('\n')
			case 't':
				builder.WriteByte('\t')
			default:
				builder.WriteRune(r)
			}
			escaped = false
			continue
		}
		if r == '\\' {
			escaped = true
			continue
		}
		builder.WriteRune(r)
	}
	return builder.String()
}

// meshIdentityFromTOML 取出网络名称与密钥，「复制入网说明」在配置模式下要用。
func meshIdentityFromTOML(content string) (name, secret string) {
	return meshTOMLString(content, "network_name"), meshTOMLString(content, "network_secret")
}

var meshListenerPattern = regexp.MustCompile(`"(?:tcp|udp|ws|wss)://[^"/]*:(\d+)"`)

// meshListenerPort 从 listeners 段里取监听端口；取不到返回 0。
func meshListenerPort(content string) int {
	index := strings.Index(content, "listeners")
	if index < 0 {
		return 0
	}
	rest := content[index:]
	if end := strings.Index(rest, "]"); end >= 0 {
		rest = rest[:end]
	}
	match := meshListenerPattern.FindStringSubmatch(rest)
	if match == nil {
		return 0
	}
	port, err := strconv.Atoi(match[1])
	if err != nil || port < 1 || port > 65535 {
		return 0
	}
	return port
}
