package main

import (
	"embed"
	"io/fs"
)

// 直接嵌入 desktop/ui，Electron 与 Wails 两个壳在迁移期共用同一份界面。
//
//go:embed all:ui
var uiAssets embed.FS

//go:embed lib/windows-process.ps1
var processHelperScript string

//go:embed assets/app.ico
var appIconICO []byte

func uiFS() fs.FS {
	sub, err := fs.Sub(uiAssets, "ui")
	if err != nil {
		panic(err)
	}
	return sub
}
