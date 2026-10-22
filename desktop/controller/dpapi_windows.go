//go:build windows

package controller

// DPAPI 封装：沿用旧版 safeStorage 的密文格式，按当前 Windows 用户加密，
// 因此历史 settings.json 里的 base64 DPAPI 密文可以被直接解开。

import (
	"encoding/base64"
	"errors"
	"unsafe"

	"golang.org/x/sys/windows"
)

const cryptProtectUIForbidden = 0x1

var (
	crypt32                = windows.NewLazySystemDLL("crypt32.dll")
	kernel32               = windows.NewLazySystemDLL("kernel32.dll")
	procCryptProtectData   = crypt32.NewProc("CryptProtectData")
	procCryptUnprotectData = crypt32.NewProc("CryptUnprotectData")
	procLocalFree          = kernel32.NewProc("LocalFree")
)

type dataBlob struct {
	size uint32
	data *byte
}

func newBlob(payload []byte) dataBlob {
	if len(payload) == 0 {
		return dataBlob{}
	}
	return dataBlob{size: uint32(len(payload)), data: &payload[0]}
}

func (b dataBlob) bytes() []byte {
	if b.data == nil || b.size == 0 {
		return nil
	}
	return unsafe.Slice(b.data, b.size)
}

func freeBlob(b dataBlob) {
	if b.data != nil {
		_, _, _ = procLocalFree.Call(uintptr(unsafe.Pointer(b.data)))
	}
}

// Dpapi 是 Cipher 的 Windows 实现。
type Dpapi struct{}

func (Dpapi) Encrypt(value string) (string, error) {
	in := newBlob([]byte(value))
	var out dataBlob
	description, _ := windows.UTF16PtrFromString("ZViewer Desktop")
	result, _, err := procCryptProtectData.Call(
		uintptr(unsafe.Pointer(&in)),
		uintptr(unsafe.Pointer(description)),
		0, 0, 0,
		cryptProtectUIForbidden,
		uintptr(unsafe.Pointer(&out)),
	)
	if result == 0 {
		return "", errors.New("Windows 凭据保护不可用，密钥未保存： " + err.Error())
	}
	defer freeBlob(out)
	return base64.StdEncoding.EncodeToString(out.bytes()), nil
}

func (Dpapi) Decrypt(value string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return "", errors.New("无法解密 FRP 密钥")
	}
	in := newBlob(raw)
	var out dataBlob
	result, _, _ := procCryptUnprotectData.Call(
		uintptr(unsafe.Pointer(&in)),
		0, 0, 0, 0,
		cryptProtectUIForbidden,
		uintptr(unsafe.Pointer(&out)),
	)
	if result == 0 {
		return "", errors.New("无法解密 FRP 密钥")
	}
	defer freeBlob(out)
	return string(out.bytes()), nil
}
