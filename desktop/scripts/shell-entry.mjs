// 分发目录里的唯一入口文件名。构建壳、分包、开发启动都以这里为准，
// 改名只改这一行（Go 侧见 shell_main.go 的 shellExeName，发版脚本读 BUILD-MANIFEST.json 的 entry）。
export const SHELL_EXE_NAME = 'ZViewerDesktop.exe';
