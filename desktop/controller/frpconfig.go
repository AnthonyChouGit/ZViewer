package controller

// 自定义 frpc 配置：允许直接粘贴或导入整份 frpc 配置文件并原样运行。
//
// 表单模式生成的 frpc.toml 每次连接都会重写，所以自定义配置单独存成
// frpc.custom.<ext>，内容由用户在界面上直接编辑；frpc 按扩展名识别格式。

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// MaxFrpConfigBytes 是导入与保存自定义配置的体积上限。
const MaxFrpConfigBytes = 256 * 1024

// normalizeFrpFormat 把用户输入或文件扩展名归一成 frpc 认识的三种格式。
func normalizeFrpFormat(value string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(strings.TrimPrefix(value, "."))) {
	case "toml":
		return "toml", true
	case "yaml", "yml":
		return "yaml", true
	case "json":
		return "json", true
	}
	return "toml", false
}

func frpFormatExt(format string) string {
	switch format {
	case "yaml":
		return ".yaml"
	case "json":
		return ".json"
	}
	return ".toml"
}

// FrpConfigFormat 返回当前自定义配置的格式。
func (c *Controller) FrpConfigFormat() string {
	format, ok := normalizeFrpFormat(c.store.Value.Frp.Format)
	if !ok {
		return "toml"
	}
	return format
}

// FrpCustomPath 是自定义配置文件的落盘位置。
func (c *Controller) FrpCustomPath() string {
	return filepath.Join(c.dir, "frp", "frpc.custom"+frpFormatExt(c.FrpConfigFormat()))
}

// FrpConfigFile 读取当前自定义配置；文件不存在时返回空内容。
func (c *Controller) FrpConfigFile() (map[string]any, error) {
	path := c.FrpCustomPath()
	content := ""
	raw, err := os.ReadFile(path)
	if err == nil {
		content = string(raw)
	} else if !os.IsNotExist(err) {
		return nil, errors.New("无法读取 FRP 配置文件：" + err.Error())
	}
	return map[string]any{
		"content": content,
		"path":    path,
		"format":  c.FrpConfigFormat(),
		"mode":    c.store.Value.Frp.Mode,
	}, nil
}

// SaveFrpConfigFile 保存自定义配置并切到配置文件模式；token 为 nil 表示沿用已保存的密钥。
func (c *Controller) SaveFrpConfigFile(content, format string, token *string) (map[string]any, error) {
	if strings.TrimSpace(content) == "" {
		return nil, errors.New("请先粘贴或导入 frpc 配置文件")
	}
	if len(content) > MaxFrpConfigBytes {
		return nil, errors.New("配置文件不能超过 256 KB")
	}
	if strings.ContainsRune(content, 0) {
		return nil, errors.New("配置文件包含无法识别的字符")
	}
	normalized, ok := normalizeFrpFormat(format)
	if !ok {
		return nil, errors.New("只支持 TOML、YAML 与 JSON 格式的 frpc 配置")
	}
	dir := filepath.Join(c.dir, "frp")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "frpc.custom"+frpFormatExt(normalized))
	if err := Atomic(path, content); err != nil {
		return nil, err
	}
	// 换格式后清掉旧扩展名的文件，磁盘和界面上都不会同时存在两份内容。
	for _, ext := range []string{".toml", ".yaml", ".json"} {
		if ext != frpFormatExt(normalized) {
			_ = os.Remove(filepath.Join(dir, "frpc.custom"+ext))
		}
	}
	if _, err := c.store.Save(map[string]any{"frp": map[string]any{"mode": "config", "format": normalized}}, token); err != nil {
		return nil, err
	}
	c.log("已保存 FRP 配置文件 "+filepath.Base(path), "frp", "INFO")
	return map[string]any{
		"content": content,
		"path":    path,
		"format":  normalized,
		"mode":    "config",
	}, nil
}

var tomlProxyBlock = regexp.MustCompile(`(?m)^\s*\[\[proxies\]\]`)

// countFrpProxies 估算配置里声明的代理数量，用来判断“全部代理已注册”。
// 解析不出来时返回 0，调用方按单个代理处理。
func countFrpProxies(content, format string) int {
	switch format {
	case "json":
		var parsed struct {
			Proxies []json.RawMessage `json:"proxies"`
		}
		if json.Unmarshal([]byte(content), &parsed) != nil {
			return 0
		}
		return len(parsed.Proxies)
	case "yaml":
		return countYamlProxies(content)
	}
	return len(tomlProxyBlock.FindAllStringIndex(content, -1))
}

// countYamlProxies 只数 proxies 段的直接子项，注释与空行跳过。
func countYamlProxies(content string) int {
	count, indent, inside := 0, -1, false
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimRight(line, "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		current := len(line) - len(strings.TrimLeft(line, " "))
		if strings.HasPrefix(trimmed, "proxies:") {
			inside, indent, count = true, -1, 0
			continue
		}
		if !inside {
			continue
		}
		if current == 0 {
			// 回到顶层键，proxies 段结束。
			inside = false
			continue
		}
		if strings.HasPrefix(trimmed, "- ") || trimmed == "-" {
			if indent < 0 {
				indent = current
			}
			if current == indent {
				count++
			}
		}
	}
	return count
}
