package main

import (
	"embed"
	"io/fs"
)

// 直接嵌入 desktop/ui：界面不依赖任何运行时资源文件，
// 单文件 EXE 即可完整渲染，也省掉打包时的静态目录同步。
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
