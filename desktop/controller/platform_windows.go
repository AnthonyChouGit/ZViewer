//go:build windows

package controller

import (
	"os/exec"
	"regexp"
	"syscall"
)

var regexpSID = regexp.MustCompile(`S-1-5-[\d-]+`)

func isWindows() bool { return true }

// hideWindow 让子进程不弹控制台窗口。
func hideWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
}
