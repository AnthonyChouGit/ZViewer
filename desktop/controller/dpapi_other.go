//go:build !windows

package controller

import (
	"encoding/base64"
	"errors"
)

// Dpapi 在非 Windows 平台上仅用于开发期编译，不做真实加密。
type Dpapi struct{}

func (Dpapi) Encrypt(value string) (string, error) {
	return base64.StdEncoding.EncodeToString([]byte(value)), nil
}

func (Dpapi) Decrypt(value string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return "", errors.New("无法解密 FRP Token")
	}
	return string(raw), nil
}
