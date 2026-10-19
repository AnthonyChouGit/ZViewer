//go:build !windows

package controller

import (
	"os/exec"
	"regexp"
)

var regexpSID = regexp.MustCompile(`S-1-5-[\d-]+`)

func isWindows() bool { return false }

func hideWindow(cmd *exec.Cmd) {}
