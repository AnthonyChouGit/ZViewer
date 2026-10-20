package main

// App 是暴露给前端的绑定对象：方法经 Wails 生成 window.go.main.App，
// 再由 ui/bridge.js 包装成界面唯一认的 window.zviewerDesktop。

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"zviewer/desktop/controller"
)

type App struct {
	ctx context.Context

	exeDir   string
	stateDir string
	root     string
	helper   string
	frpc     string
	cli      string
	hostExe  string
	version  string
	packaged bool

	ctrl     *controller.Controller
	quitting atomic.Bool
	tray     *trayIcon
}

func (a *App) bootstrap() error {
	ctrl, err := controller.New(controller.Options{
		Root:          a.root,
		StateDir:      a.stateDir,
		Frpc:          a.frpc,
		CliExecutable: a.cli,
		HostExe:       a.hostExe,
		Helper:        a.helper,
		Version:       a.version,
		Cipher:        controller.Dpapi{},
		OnUpdate:      a.emitUpdate,
	})
	if err != nil {
		return err
	}
	a.ctrl = ctrl
	return nil
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.tray = newTray(a)
	go a.afterStartup()
}

// afterStartup 恢复本机信任状态，并按配置自动启动服务。
func (a *App) afterStartup() {
	cert := a.ctrl.Certificates().Inspect()
	if cert.Valid && cert.CA {
		if err := exec.Command("certutil.exe", "-user", "-store", "Root", cert.Thumbprint).Run(); err == nil {
			a.ctrl.SetTrusted(true)
			a.emitUpdate()
		}
	}
	if a.ctrl.Store().Value.AutoStart || os.Getenv("ZVIEWER_SHELL_AUTOSTART") == "1" {
		if _, err := a.ctrl.Start(); err != nil {
			a.ctrl.Log(err.Error(), "backend", "ERROR")
		}
	}
	go a.checkUpdatesPeriodically()
}

// checkUpdatesPeriodically 启动后延迟检查一次，此后每 6 小时复检；只检查，不自动下载。
func (a *App) checkUpdatesPeriodically() {
	timer := time.NewTimer(6 * time.Second)
	defer timer.Stop()
	for {
		<-timer.C
		if a.quitting.Load() {
			return
		}
		if a.ctrl.Store().Value.AutoCheckUpdate {
			report := a.ctrl.CheckUpdate(false)
			if report.Available {
				a.ctrl.Log("发现新版本 "+report.Latest+"（当前 "+report.Current+"）", "update", "INFO")
			}
		}
		timer.Reset(6 * time.Hour)
	}
}

func (a *App) emitUpdate() {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "desktop-update", a.snapshotMap())
	if a.tray != nil {
		a.tray.refresh()
	}
}

func (a *App) snapshotMap() map[string]any {
	raw, err := json.Marshal(a.ctrl.Snapshot())
	if err != nil {
		return map[string]any{}
	}
	out := map[string]any{}
	if json.Unmarshal(raw, &out) != nil {
		return map[string]any{}
	}
	return out
}

// DebugLog 是开发期诊断通道：页面把关键状态写回配置目录下的 probe.log。
func (a *App) DebugLog(message string) error {
	file, err := os.OpenFile(filepath.Join(a.stateDir, "probe.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = file.WriteString(message + "\n")
	return err
}

// Info 返回完整快照，对应 preload 的 info()。
func (a *App) Info() (map[string]any, error) {
	out := a.snapshotMap()
	out["native"] = true
	out["live"] = true
	out["tray"] = a.tray != nil
	out["version"] = a.version
	return out, nil
}

func payloadConfig(payload map[string]any) map[string]any {
	if raw, ok := payload["config"].(map[string]any); ok {
		return raw
	}
	return map[string]any{}
}

func payloadString(payload map[string]any, key string) string {
	if raw, ok := payload[key].(string); ok {
		return raw
	}
	return ""
}

// Command 对应 preload 的 command(action, payload)。
func (a *App) Command(action string, payload map[string]any) (any, error) {
	if payload == nil {
		payload = map[string]any{}
	}
	result, err := a.dispatch(action, payload)
	if err != nil {
		a.ctrl.Log(err.Error(), "console", "ERROR")
		return nil, err
	}
	return result, nil
}

func (a *App) dispatch(action string, payload map[string]any) (any, error) {
	switch action {
	case "start":
		return a.ctrl.Start()
	case "stop":
		return a.ctrl.Stop()
	case "restart":
		return a.ctrl.Restart()
	case "save":
		patch := payloadConfig(payload)
		if !a.packaged {
			if flag, ok := patch["launchAtLogin"].(bool); ok && flag {
				return nil, errors.New("开机启动请在已构建的桌面程序中设置")
			}
		}
		var token *string
		if text := payloadString(payload, "token"); text != "" {
			token = &text
		}
		config, err := a.ctrl.Save(patch, token)
		if err != nil {
			return nil, err
		}
		if a.packaged {
			_ = setLoginItem(config.LaunchAtLogin)
		}
		return config, nil
	case "https":
		return a.ctrl.EnableHTTPS(payloadString(payload, "domain"), payloadString(payload, "ip"))
	case "trust":
		info := a.ctrl.Certificates().Inspect()
		answer, err := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
			Type:          runtime.QuestionDialog,
			Title:         "信任 ZViewer 本机证书",
			Message:       "安装到当前 Windows 用户的受信任根证书存储？",
			Buttons:       []string{"取消", "安装本机 CA 信任"},
			DefaultButton: "取消",
			CancelButton:  "取消",
		})
		if err != nil {
			return nil, err
		}
		if answer != "安装本机 CA 信任" {
			return map[string]any{"canceled": true}, nil
		}
		if _, err := a.ctrl.Certificates().Trust(true); err != nil {
			_ = info
			return nil, err
		}
		a.ctrl.SetTrusted(true)
		a.emitUpdate()
		return map[string]any{"trusted": true}, nil
	case "untrust":
		if _, err := a.ctrl.Certificates().Trust(false); err != nil {
			return nil, err
		}
		a.ctrl.SetTrusted(false)
		a.emitUpdate()
		return map[string]any{"trusted": false}, nil
	case "open-manager":
		if err := a.openLocalPage(true); err != nil {
			return nil, err
		}
		return true, nil
	case "open-web":
		if err := a.openLocalPage(false); err != nil {
			return nil, err
		}
		return true, nil
	case "cli-start":
		return a.ctrl.StartCli()
	case "cli-stop":
		return a.ctrl.StopCli()
	case "cli-save":
		return a.ctrl.SaveCli(payload)
	case "cli-open":
		url, err := a.ctrl.CliSettingsURL()
		if err != nil {
			return nil, err
		}
		return map[string]any{"url": url}, nil
	case "frp-start":
		return a.ctrl.StartFrp()
	case "frp-stop":
		if err := a.ctrl.StopFrp(); err != nil {
			return nil, err
		}
		a.emitUpdate()
		return true, nil
	case "probe-ipv6":
		return a.ctrl.ProbeIPv6(true), nil
	case "tunnel-start":
		return a.ctrl.StartTunnel()
	case "tunnel-stop":
		if err := a.ctrl.StopTunnel(); err != nil {
			return nil, err
		}
		a.emitUpdate()
		return true, nil
	case "update-check":
		return a.ctrl.CheckUpdate(true), nil
	case "update-download":
		return a.ctrl.StartUpdateDownload()
	case "update-apply":
		return a.applyUpdate()
	case "update-page":
		target := a.ctrl.UpdateReport().PageURL
		if target == "" {
			target = "https://github.com/Zero-wyc/ZViewer/releases"
		}
		runtime.BrowserOpenURL(a.ctx, target)
		return true, nil
	case "export":
		return a.exportFile(payloadString(payload, "kind"))
	case "open-data":
		return a.openDataDir()
	}
	return nil, errors.New("不支持的操作")
}

// applyUpdate 交给独立脚本接管：本进程退出后解压覆盖运行目录，再启动新版本。
func (a *App) applyUpdate() (bool, error) {
	exe := filepath.Join(a.exeDir, "ZViewerShell.exe")
	script, err := a.ctrl.PrepareUpdate(a.exeDir, exe, os.Getpid())
	if err != nil {
		return false, err
	}
	cmd := exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script)
	hideWindow(cmd)
	if err := cmd.Start(); err != nil {
		return false, fmt.Errorf("无法启动更新程序：%w", err)
	}
	a.ctrl.Log("更新包已就绪，程序即将退出并安装", "update", "INFO")
	go func() {
		sleep(600)
		a.quit()
	}()
	return true, nil
}

func (a *App) openLocalPage(manager bool) error {
	snapshot := a.ctrl.Snapshot()
	if snapshot.Backend != "running" {
		if _, err := a.ctrl.Start(); err != nil {
			return err
		}
		snapshot = a.ctrl.Snapshot()
	}
	if snapshot.Active != nil && snapshot.Active.Https && !snapshot.Certificate.Trusted {
		runtime.EventsEmit(a.ctx, "navigate", "cert")
		return errors.New("HTTPS 已就绪，请先在证书页安装本机 CA 信任，再打开管理页面")
	}
	target := a.ctrl.WebURL()
	if manager {
		target = a.ctrl.ManagementURL()
	}
	runtime.BrowserOpenURL(a.ctx, target)
	return nil
}

func (a *App) exportFile(kind string) (bool, error) {
	name, contents, err := a.ctrl.Export(kind)
	if err != nil {
		return false, err
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:            "导出",
		DefaultFilename:  name,
		DefaultDirectory: downloadsDir(),
	})
	if err != nil || path == "" {
		return false, nil
	}
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		return false, err
	}
	return true, nil
}

func (a *App) openDataDir() (bool, error) {
	cmd := exec.Command("explorer.exe", a.stateDir)
	hideWindow(cmd)
	if err := cmd.Start(); err != nil {
		return false, fmt.Errorf("无法打开配置目录：%w", err)
	}
	return true, nil
}

func downloadsDir() string {
	if profile := os.Getenv("USERPROFILE"); profile != "" {
		return filepath.Join(profile, "Downloads")
	}
	return ""
}

// Window 对应 preload 的 window(action)。
func (a *App) Window(action string) error {
	switch action {
	case "minimize":
		runtime.WindowMinimise(a.ctx)
	case "maximize":
		runtime.WindowToggleMaximise(a.ctx)
	case "close":
		a.requestClose()
	case "tray":
		runtime.WindowHide(a.ctx)
	case "tray-menu":
		if a.tray == nil {
			return errors.New("系统托盘不可用")
		}
		a.tray.popup()
	default:
		return errors.New("未知窗口操作")
	}
	return nil
}

// OpenDocs 打开使用文档。
func (a *App) OpenDocs() error {
	runtime.BrowserOpenURL(a.ctx, "https://docx.zviewer.zero251.xyz/")
	return nil
}

// SetTheme 让 DWM 材质的深浅与页面主题保持一致。
func (a *App) SetTheme(dark bool) error {
	setBackdropTheme("ZViewer · Windows 控制台", dark)
	return nil
}

func (a *App) requestClose() {
	if a.tray != nil && a.ctrl.Store().Value.CloseToTray && !a.quitting.Load() {
		runtime.WindowHide(a.ctx)
		return
	}
	a.quit()
}

func (a *App) quit() {
	if !a.quitting.CompareAndSwap(false, true) {
		return
	}
	go func() {
		// 等待正在进行的服务操作结束，最多 60 秒，再回收受管进程。
		for index := 0; index < 600 && a.ctrl.Busy(); index++ {
			sleep(100)
		}
		if err := a.ctrl.Shutdown(); err != nil {
			a.ctrl.Log("停止受管服务失败："+err.Error(), "console", "ERROR")
		}
		if a.tray != nil {
			a.tray.remove()
		}
		runtime.Quit(a.ctx)
	}()
}

func (a *App) beforeClose(context.Context) bool {
	if a.quitting.Load() {
		return false
	}
	a.requestClose()
	return true
}

func (a *App) shutdown(context.Context) {
	if a.tray != nil {
		a.tray.remove()
	}
}

func (a *App) showWindow() {
	if a.ctx == nil {
		return
	}
	runtime.WindowUnminimise(a.ctx)
	runtime.WindowShow(a.ctx)
	bringToFront(mainWindowHandle())
}

// navigate 让界面切换到指定页面（托盘菜单用）。
func (a *App) navigate(page string) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "navigate", page)
}
