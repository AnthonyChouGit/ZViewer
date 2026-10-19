package main

// Windows 平台细节：错误弹窗、DWM 材质深浅、开机启动项与文件工具。

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const (
	dxgiWaitTimeout = 50 * time.Millisecond
	runKey          = `Software\Microsoft\Windows\CurrentVersion\Run`
	runValueName    = "ZViewer Desktop"
	dwmDarkMode     = 20
	windowTitle     = "ZViewer · Windows 控制台"
)

var (
	user32             = windows.NewLazySystemDLL("user32.dll")
	procMessageBox     = user32.NewProc("MessageBoxW")
	procFindWindowW    = user32.NewProc("FindWindowW")
	dwmapi             = windows.NewLazySystemDLL("dwmapi.dll")
	procDwmSetAttribute = dwmapi.NewProc("DwmSetWindowAttribute")
)

func fileExists(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func sleep(milliseconds int) { time.Sleep(time.Duration(milliseconds) * time.Millisecond) }

func fatalDialog(title, message string) {
	caption, err := windows.UTF16PtrFromString(title)
	if err != nil {
		return
	}
	body, err := windows.UTF16PtrFromString(message)
	if err != nil {
		return
	}
	const mbIconError = 0x10
	_, _, _ = procMessageBox.Call(0, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(caption)), mbIconError)
}

func hideWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
}

// setBackdropTheme 让 Mica 材质的深浅跟随页面主题，
// 否则浅色页面会叠在深色材质上发灰。
func setBackdropTheme(title string, dark bool) bool {
	name, err := windows.UTF16PtrFromString(title)
	if err != nil {
		return false
	}
	hwnd, _, _ := procFindWindowW.Call(0, uintptr(unsafe.Pointer(name)))
	if hwnd == 0 {
		return false
	}
	value := int32(0)
	if dark {
		value = 1
	}
	hr, _, _ := procDwmSetAttribute.Call(hwnd, uintptr(dwmDarkMode),
		uintptr(unsafe.Pointer(&value)), unsafe.Sizeof(value))
	return hr == 0
}

// setLoginItem 写入/清理当前用户的开机启动项。
func setLoginItem(enabled bool) error {
	key, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.SET_VALUE|registry.QUERY_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	if !enabled {
		if err := key.DeleteValue(runValueName); err != nil && err != registry.ErrNotExist {
			return err
		}
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return key.SetStringValue(runValueName, `"`+exe+`"`)
}
