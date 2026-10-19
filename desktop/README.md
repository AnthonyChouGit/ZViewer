# ZViewer Windows GUI

独立 Electron 桌面控制台，管理现有 Windows 运行包，保留服务端网页。0.4.1 用带头像图标的 `ZViewer.exe` 作为目录入口，分发目录根部只保留这一个用户启动 EXE；支持系统托盘、端口配置持久化、localhost HTTPS、自建 FRP 和内置 ZViewerCLI 哔哩哔哩高画质代理。CLI 设置、扫码登录与连接操作直接在 GUI 右侧完成。

## 双击 EXE 打开 GUI

双击运行目录中的 `ZViewer.exe`，直接显示现有控制台窗口。默认先打开 GUI；服务、代理和浏览器由用户在界面内点击相应按钮启动，也可沿用已保存的自动启动偏好。文件本身、桌面窗口和系统托盘均使用应用头像图标。

同一 Windows 用户只运行一个正常 GUI 实例。再次双击入口会恢复并聚焦已打开的窗口，最小化或收在托盘时也会唤回，不创建第二套受管服务。

这是一个小型目录启动器，直接运行 `app/ZViewer.exe`，使用 `app/runtime` 内的后端组件。整个文件夹复制或解压后即可使用，无需安装 Node.js，不执行安装或自动解包步骤，也不将运行包迁移到用户缓存目录。分发包不包含 `.bat` 启动脚本。

| 内容 | 位置 |
| --- | --- |
| 带图标的 GUI 入口 | 运行目录中的 `ZViewer.exe` |
| Electron GUI 及依赖 | 同目录 `app/` |
| 后端、LiveKit、FRP、CLI 与网页 | `app/runtime` 内的程序和 `frontend/dist` |
| 后端环境与业务数据 | 分发版 `app/runtime/.env`、`app/runtime/config`；工作区版沿用原根目录 |
| GUI 设置、证书、FRP 凭据与日志 | `%APPDATA%/ZViewerDesktop` |
| ZViewerCLI 自身的登录配置 | `%USERPROFILE%/.zviewer/config.json` |

当前开发工作区根目录的 `ZViewer.exe` 使用已构建的 `desktop/release/v0.4.1/ZViewer-win32-x64/ZViewer.exe`，并继续复用用户已经使用的后端运行目录和 GUI 配置目录，沿用已有 `.env`、`config`、证书和设置；FRP 与 CLI 辅助程序可使用构建包内组件。分发目录则通过 `app/ZViewer.exe` 使用 `app/runtime`，整目录可移动。

更新前先退出控制台并备份对应运行目录的 `.env`、`config` 和用户配置。替换程序时保留这些数据，不要把配置或数据库当作分发文件。当前 EXE 未配置代码签名，普通用户权限即可运行，不创建系统服务或修改系统防火墙。

旧 0.3.0 自解包方案已经弃用。若旧缓存保存过实际数据，先备份并核对后再迁移；当前目录入口不会自动搬移或删除用户数据。

## 高画质代理 · ZViewerCLI

内置 [Zero-wyc/ZViewerCLI](https://github.com/Zero-wyc/ZViewerCLI) 0.2.1，固定来源提交 `101659b01a3a9248cea8b32c7eb18b6f76d842f1`。CLI 从该提交源码使用固定 Go 1.26.9 工具链构建为 Windows amd64 程序，并随包保留 MIT 许可证、来源记录和 SHA-256。集成版本附带本地来源保护补丁，限制配置和认证接口的跨来源访问；来源记录包含补丁信息。

1. 在侧栏进入“高画质代理”，查看只读的“后端地址 · 自动跟随本地服务”。网页账号为可选项，填写并保存与网页端一致的账号有助于识别代理归属；也可按需调整默认代理端口 `9333`。代理仅监听本机 `127.0.0.1`。
2. 点击“启动代理”，右侧直接显示 CLI 自带的内置设置，自动填写后端地址。如已保存网页账号，也会一同带入；账号留空仍可配置。
3. 在右侧使用官方二维码登录，再点击连接服务器，然后回到 ZViewer 网页端使用高画质代理。扫码登录与连接仍由用户操作。

后端运行时使用当前实际协议和端口；尚未运行时使用已保存的服务配置。例如服务正在 `http://localhost:33331/` 运行，内置设置就会填写该地址。只保存了新端口但还没重启服务时，继续使用当前实际运行地址。

GUI 提供独立启动、停止、端口保存和“随 ZViewer 服务启动”滑块；自动启动默认关闭。修改端口后，下次启动代理生效，不能与其他 TCP 服务端口重复。“运行中”表示受管代理进程和本机健康检查就绪；服务器关联指示来自受限状态信号，登录及账号绑定详情显示在右侧设置中。

扫码、Cookie 校验与服务器连接由用户在内置的官方 CLI 设置中完成；如填写了可选归属账号，GUI 将保存值传入。桌面主进程不调用 `/api/config` 获取 Cookie，也不通过 IPC、进程参数或日志传递 Cookie。现有 `%USERPROFILE%/.zviewer/config.json` 保留，由 CLI 继续管理其登录配置。当前上游 CLI 不持久化服务器地址与网页账号绑定，重新启动代理后需要在内置设置中重新连接；GUI 会再次带入本机服务器地址和已保存的可选网页账号。

后台日志或运行状态刷新会保留当前内置设置，不重置 Cookie 输入和扫码状态。修改实际后端地址或已保存的网页账号时会更新设置地址；切换侧栏后返回继续保留当前设置和扫码状态。布局预览不会连接真实本机 CLI。

关闭窗口仍可留在托盘运行。选择托盘“退出并停止受管服务”时，控制台会停止自己启动的 CLI、FRP、后端和 LiveKit，不接管用户另行启动的 CLI。

## 从源码构建

Windows x64 需要 Node.js 24 或更高版本、npm、Python 3.11+、Go 1.26.9，以及系统 .NET Framework 4.x 的 C# 编译器。已有 Go 安装可通过 Go 工具链机制获取构建所需的固定版本；首次准备 CLI 需要联网下载源码、工具链和依赖。GUI、ProcessHost 和小型目录启动器从本仓库源码构建。在完整上游源码仓库先生成 Windows 运行包，再构建桌面程序：

```powershell
npm ci
node build-all.js --win
npm --prefix desktop ci
npm --prefix desktop run build
```

GUI 自动寻找 `dist/win`，也兼容后端 exe 与 `frontend/dist` 放在仓库根目录的独立运行包。其他目录可传入 `--runtime-root=绝对或相对路径`，或设置 `ZVIEWER_RUNTIME_ROOT`。路径相对于命令的工作目录解析，推荐使用绝对路径：

```powershell
npm --prefix desktop start -- --runtime-root=C:/ZViewer/dist/win
npm --prefix desktop run build -- --runtime-root=C:/ZViewer/dist/win
```

只有独立运行包时，不在缺少后端源码的根目录运行上游构建；仅执行 `npm --prefix desktop ci`，再按上例指定已有运行包目录。运行源码 GUI 前需执行 `npm --prefix desktop ci` 和 `node desktop/scripts/prepare-cli.mjs`。开发状态保存在 `desktop/.runtime/profile-live`；正式程序使用当前用户 APPDATA，互不覆盖。CLI 仍沿用自己的用户配置目录。

构建会校验固定 Electron 44.9.0、FRP 0.71.1 的下载 SHA-256，并编译 `native/ProcessHost.cs`。`scripts/prepare-cli.mjs` 获取固定官方提交的 CLI 源码与许可证，使用 Go 1.26.9 编译后缓存至 `desktop/.runtime/tools/zviewer-cli`；后续使用缓存仍核验文件 SHA-256，构建自动调用该脚本。CLI 来源、构建工具链与摘要写入 `ZViewerCLI-PROVENANCE.json` 和 `BUILD-MANIFEST.json`。固定源码需要 Go 1.26.5 或更新版本，不采用上游 README 中已过时的 Go 1.22.5 要求或陈旧 dist 文件。

0.4.1 默认输出：

- 完整目录分发包：`desktop/release/ZViewer-Windows-GUI-v0.4.1-x64`，双击其根目录 `ZViewer.exe`。
- 标准 Electron 构建目录：`desktop/release/v0.4.1/ZViewer-win32-x64`，供工作区根目录入口使用。
- 构建来源与主要文件摘要：分发包中的 `BUILD-MANIFEST.json`。

完整目录的结构如下，分发或移动时保留整个文件夹：

```text
ZViewer-Windows-GUI-v0.4.1-x64/
  ZViewer.exe                      # 唯一用户启动 EXE
  app/
    ZViewer.exe                    # Electron GUI
    runtime/                       # 后端、LiveKit、FRP、CLI 与网页
  许可证、使用说明与构建清单
```

输出已存在时拒绝覆盖，避免破坏用户运行数据。构建只复制指定程序、网页、许可证和来源记录，不复制真实 `.env`、数据库、证书或登录配置。更新头像 ICO 可使用 Python 与 Pillow 执行 `desktop/scripts/make-icon.py`。

## 源码检查

```powershell
npm --prefix desktop run check
npm --prefix desktop test
```

可选真实运行包验收：`node desktop/scripts/integration.cjs`，需要空闲测试端口与 Windows 运行包。脚本在 `desktop/artifacts` 使用独立目录，只停止自己启动的进程，不安装系统信任或修改防火墙。公网 VPS 与跨设备媒体另行验收。

## 架构与数据边界

- 渲染器启用 sandbox/contextIsolation，通过受限 IPC 操作主进程，外部网页只由默认浏览器打开。
- CLI 设置内嵌官方本机页面，仅允许 `http://127.0.0.1` 来源；受限 iframe 允许脚本、表单和同源操作，不授予 Node、顶层导航或弹窗权限。
- 后端与 LiveKit 分别由 Job Object 监管，先请求正常退出，超时后只结束自己的进程树。
- LiveKit 使用外置模式，UDP 跟随网页端口，信令和 RTC TCP 由 GUI 下发；随机 API 凭据只存在于内存与子进程环境。
- FRP Token 使用 Windows DPAPI 保存，导出 TOML 通过环境变量读取 Token；私钥留在当前用户配置目录。
- HTTPS 签发不自动安装根证书；安装当前用户信任时需核对指纹并明确确认。

## 网页与管理入口

完整复制或解压分发文件夹后，双击根目录唯一的 `ZViewer.exe` 打开 GUI；保持旁边的 `app/` 文件夹完整，不需要 `.bat`。

首页“打开网页端”与“启动服务”使用相同按钮样式。点击后会先确保本机服务就绪，再用默认浏览器打开当前 HTTP/HTTPS 和端口对应的首页。首页及证书页的“打开管理页面”继续访问 `/admin`；托盘只保留“打开网页端”网页入口。默认首页 `http://localhost:3333/`，管理页 `http://localhost:3333/admin`。使用文档入口：https://docx.zviewer.zero251.xyz/ 。

## 端口、配置与托盘

“应用设置”可调整网页、RTMP、HTTP-FLV 端口及网页/信令监听范围。HTTPS 使用独立滑块，点击“保存配置”后才应用。LiveKit UDP 始终跟随网页端口；内部信令默认 3336、RTC TCP 默认 3337，均可调整。TCP 端口不可重复，UDP 与网页 TCP 可以使用相同端口号。保存后重启服务生效，下次打开自动恢复。

本机模式启用 UDP 回环监听，使 localhost 与 FRP 的回环转发可达；公布公网地址时保留媒体转发所需的网卡。网页/信令监听范围不限制 LiveKit RTC TCP 的底层网卡监听。程序不修改系统防火墙、路由器、hosts 或 DNS。

正式版配置位于 `%APPDATA%/ZViewerDesktop/settings.json`。FRP Token 由当前用户 DPAPI 加密，换电脑或用户后需重新填写。登录启动默认关闭；根目录 EXE 入口只显示界面，服务由界面按钮启动。

关闭窗口默认收起到系统托盘，头像图标可恢复；右键菜单提供服务启停、打开网页端、日志与退出。第二次启动恢复已有窗口。选择“退出并停止受管服务”会停止受管 CLI、FRP、后端和独立 LiveKit，不按端口强杀其他程序。

## localhost HTTPS 与内网域名

在“证书与域名”点击“签发并启用 HTTPS”，生成包含 localhost、127.0.0.1、::1 的服务器证书。然后点击“安装本机信任”，核对 CA 指纹并明确确认，最后打开网页或管理页。未安装信任时会引导回证书页，不绕过浏览器安全检查。

CA、私钥与服务器证书保存在当前用户配置目录的 `tls`，目录权限限制为当前用户和 SYSTEM。CA 有效期约十年，服务器证书一年。可导出公开 CA，也可撤销当前用户信任；禁止分享私钥或整个 `tls` 文件夹。

高级内网模式可填写自定义域名与 IP，加入证书 SAN。域名解析需在访问设备 hosts 或内网 DNS 配置；其他设备还需自行信任公开 CA，并开启适合的网页监听范围。

## 自建 FRP

包中提供 FRP 0.71.1。填写 VPS IP/域名、控制端口、Token，保存后部署对应平台同版本 frps，使用导出 TOML 并设置 `FRP_TOKEN` 环境变量。启动本地服务后连接 FRP。传输 TLS 与浏览器网页 HTTPS 分别配置。

外网语音需填写 VPS 公网 IPv4 作为公布地址，并重启服务；远端 UDP 需与当前本地网页/语音 UDP 端口一致，远端语音 TCP 需与当前 RTC TCP 端口一致。网页与信令共用网页入口，无需额外暴露内部信令端口。默认映射随相应本地端口变更，手动设置的其他远端映射保留，请自行放行 VPS 安全组/防火墙。

“代理已注册”只表示 frps 接受代理，不代表跨设备语音、推流或公网访问已完成验收。本机 CA 也不会被外部访问设备自动信任。

## 日志、数据与更新

日志位于用户配置目录 `logs`，按来源、级别、关键字过滤；独立 LiveKit 为 `voice` 来源，高画质代理为 `cli` 来源。文件达到 2 MB 后滚动，界面保留最近 500 条，已知敏感值脱敏。

首次启动新运行包时生成独立随机 JWT 密钥，分发版后端数据留在 `app/runtime/config`，环境配置位于 `app/runtime/.env`。已有工作区继续使用入口明确指定的现有运行目录与 GUI 配置，不迁移到缓存目录。更换版本前保留这些文件和用户配置目录。分发包不包含真实 `.env`、数据库、日志、私钥或信任状态。

GUI、进程监管组件、目录启动器和 CLI 由源码构建；已有后端、LiveKit 和网页复用指定运行包。若网页包含 Windows CLI 下载文件，打包时同步替换为本次构建的同一 CLI，不修改原运行包。当前未配置代码签名。`BUILD-MANIFEST.json` 记录版本和主要文件 SHA-256。

## 上游贡献

贡献内容应仅包含源码、应用图标、构建脚本、源码测试用例和文档。排除本机配置、登录资料、数据库、证书私钥、运行时与下载缓存、测试输出和分发二进制。

## 原生壳（Wails / Go）迁移进度

Electron 壳的控制器已完整移植到 Go，作为体积更小的替代壳运行：`desktop/` 下的 `go.mod` + `shell_*.go` 是入口，`desktop/controller/` 是控制层。两个壳共用同一份 `ui/`，界面不需要分叉。

| 模块 | 状态 |
| --- | --- |
| 配置校验与 `settings.json`（含 schema 1→2 迁移） | 已移植，错误文案逐条对齐 |
| FRP Token DPAPI 加密（可直接解开 Electron 旧密文） | 已移植 |
| 后端 / LiveKit 启动、端口预检、45s 健康检查与进程树归属校验 | 已移植 |
| 停止、重启、退出时回收受管进程（Job Object） | 已移植 |
| 本地 CA 与服务端证书签发、`certutil` 信任开关 | 已移植（标准库 x509，不再依赖 `@peculiar/x509`） |
| 高画质代理 CLI 托管与设置页地址 | 已移植 |
| FRP 配置生成、版本校验、代理注册判定 | 已移植 |
| 系统托盘（菜单、提示、关闭到托盘） | 已移植（Shell_NotifyIcon 直连，无第三方依赖） |
| 单实例、开机启动、导出、外部浏览器打开 | 已移植 |

构建：`npm run shell:build`，产物 `desktop/build/bin/ZViewerShell.exe`（约 18 MB，Electron 版约 200 MB）。运行包位置按 `--runtime-root=` / `ZVIEWER_RUNTIME_ROOT` / 可执行文件周边顺序探测。

调试开关：`ZVIEWER_SHELL_OPAQUE=1` 关闭 Mica 透明（无重定向位图的窗口无法用 GDI 截屏），`ZVIEWER_SHELL_AUTOSTART=1` 启动即拉起本地服务，`ZVIEWER_STATE_DIR` 指定独立配置目录。

尚未完成：Electron 分发链（`scripts/package-release.py`）仍只产出 Electron 包；安装器条目、图标资源、代码签名与发布校验需要在切壳时一并调整。

### 托盘实现的注意点

`Shell_NotifyIcon` 的回调按**线程消息队列**投递，所以托盘窗口的 `CreateWindowEx` 与 `GetMessage` 循环必须在同一个被 `LockOSThread` 固定的线程里（`shell_tray.go` 的 `start`/`createWindow`/`messageLoop`）。如果分开写，窗口建在 A 线程、消息循环跑在 B 线程，图标能显示但左键点击永远不会触发——这正是初版「点了托盘没反应」的原因。

另外两处 Win32 细节：
- `DestroyWindow` 只能由创建窗口的线程调用，退出时用 `PostMessage(WM_CLOSE)` 让托盘线程自己收尾；函数导出名是 `DestroyWindow`，没有 `W` 后缀。
- 唤醒主窗口时先走 Wails 的 `WindowShow`，再用原生 `ShowWindow` + 置顶翻转 + 前台线程挂靠兜底，否则后台进程调用 `SetForegroundWindow` 会被前台锁静默拒绝。
