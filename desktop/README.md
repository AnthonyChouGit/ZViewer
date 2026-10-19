# ZViewer Windows GUI

独立 Electron 桌面控制台，管理现有 Windows 运行包，保留服务端网页。支持系统托盘、端口配置持久化、localhost HTTPS、自建 FRP 和默认浏览器网页入口。

## 从上游源码构建

在 Windows x64 使用 Node.js 24 或更高版本、npm 与系统 .NET Framework 4.x。先按上游方式生成运行包，再构建桌面程序：

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

运行源码 GUI 前需执行 `npm --prefix desktop ci`。开发状态保存在 `desktop/.runtime/profile-live`；便携程序使用当前用户 APPDATA，互不覆盖。

构建会校验固定 Electron 44.9.0、FRP 0.71.1 的下载 SHA-256，在本机编译 `native/ProcessHost.cs`，输出 `desktop/release/ZViewer-win32-x64`。输出已存在时拒绝覆盖，避免破坏用户运行数据。构建只复制后端、LiveKit 和静态网页，不复制 `.env`、数据库或证书。执行 `python desktop/scripts/package-release.py` 生成 ZIP 和校验值需要 Python 3.11+；更新头像 ICO 时可用 Pillow 执行 `desktop/scripts/make-icon.py`。

## 源码检查

```powershell
npm --prefix desktop run check
npm --prefix desktop test
```

可选真实运行包验收：`node desktop/scripts/integration.cjs`，需要空闲测试端口与 Windows 运行包。脚本在 `desktop/artifacts` 使用独立目录，只停止自己启动的进程，不安装系统信任或修改防火墙。公网 VPS 与跨设备媒体另行验收。

## 架构与数据边界

- 渲染器启用 sandbox/contextIsolation，通过受限 IPC 操作主进程，外部网页只由默认浏览器打开。
- 后端与 LiveKit 分别由 Job Object 监管，先请求正常退出，超时后只结束自己的进程树。
- LiveKit 使用外置模式，UDP 跟随网页端口，信令和 RTC TCP 由 GUI 下发；随机 API 凭据只存在于内存与子进程环境。
- FRP Token 使用 Windows DPAPI 保存，导出 TOML 通过环境变量读取 Token；私钥留在当前用户配置目录。
- HTTPS 签发不自动安装根证书；安装当前用户信任时需核对指纹并明确确认。

## 便携版使用

完整解压后双击 `ZViewer.exe`，保留整个目录，无需安装 Node.js。默认不会自动启动服务。

首页“打开网页端”与“启动服务”使用相同按钮样式。点击后会先确保本机服务就绪，再用默认浏览器打开当前 HTTP/HTTPS 和端口对应的首页。管理入口继续访问 `/admin`。默认首页 `http://localhost:3333/`，管理页 `http://localhost:3333/admin`。使用文档入口：https://docx.zviewer.zero251.xyz/ 。

## 端口、配置与托盘

“应用设置”可调整网页、RTMP、HTTP-FLV 端口及网页/信令监听范围。HTTPS 使用独立滑块，点击“保存配置”后才应用。LiveKit UDP 始终跟随网页端口；内部信令默认 3336、RTC TCP 默认 3337，均可调整。TCP 端口不可重复，UDP 与网页 TCP 可以使用相同端口号。保存后重启服务生效，下次打开自动恢复。

本机模式启用 UDP 回环监听，使 localhost 与 FRP 的回环转发可达；公布公网地址时保留媒体转发所需的网卡。网页/信令监听范围不限制 LiveKit RTC TCP 的底层网卡监听。程序不修改系统防火墙、路由器、hosts 或 DNS。

正式版配置位于 `%APPDATA%/ZViewerDesktop/settings.json`。FRP Token 由当前用户 DPAPI 加密，换电脑或用户后需重新填写。登录启动、GUI 启动时自动启动服务默认关闭。

关闭窗口默认收起到系统托盘，头像图标可恢复；右键菜单提供服务启停、网页端、管理页与退出。第二次启动恢复已有窗口。选择“退出并停止受管服务”会依次停止 FRP、后端和独立 LiveKit，不按端口强杀其他程序。

## localhost HTTPS 与内网域名

在“证书与域名”点击“签发并启用 HTTPS”，生成包含 localhost、127.0.0.1、::1 的服务器证书。然后点击“安装本机信任”，核对 CA 指纹并明确确认，最后打开网页或管理页。未安装信任时会引导回证书页，不绕过浏览器安全检查。

CA、私钥与服务器证书保存在当前用户配置目录的 `tls`，目录权限限制为当前用户和 SYSTEM。CA 有效期约十年，服务器证书一年。可导出公开 CA，也可撤销当前用户信任；禁止分享私钥或整个 `tls` 文件夹。

高级内网模式可填写自定义域名与 IP，加入证书 SAN。域名解析需在访问设备 hosts 或内网 DNS 配置；其他设备还需自行信任公开 CA，并开启适合的网页监听范围。

## 自建 FRP

包中提供 FRP 0.71.1。填写 VPS IP/域名、控制端口、Token，保存后部署对应平台同版本 frps，使用导出 TOML 并设置 `FRP_TOKEN` 环境变量。启动本地服务后连接 FRP。传输 TLS 与浏览器网页 HTTPS 分别配置。

外网语音需填写 VPS 公网 IPv4 作为公布地址，并重启服务；远端 UDP 需与当前本地网页/语音 UDP 端口一致，远端语音 TCP 需与当前 RTC TCP 端口一致。网页与信令共用网页入口，无需额外暴露内部信令端口。默认映射随相应本地端口变更，手动设置的其他远端映射保留，请自行放行 VPS 安全组/防火墙。

“代理已注册”只表示 frps 接受代理，不代表跨设备语音、推流或公网访问已完成验收。本机 CA 也不会被外部访问设备自动信任。

## 日志、数据与更新

日志位于用户配置目录 `logs`，按来源、级别、关键字过滤；独立 LiveKit 为 `voice` 来源。文件达到 2 MB 后滚动，界面保留最近 500 条，已知敏感值脱敏。

首次启动新运行包时生成独立随机 JWT 密钥，后端数据留在运行目录 `config`。更换版本前保留旧 `runtime/config`、`runtime/.env` 和用户配置目录。便携包不分发真实 `.env`、数据库、日志、私钥或信任状态。

GUI 与进程监管组件由源码构建；已有后端、LiveKit 和网页复用指定运行包。当前未配置代码签名。`BUILD-MANIFEST.json` 记录版本和主要文件 SHA-256。
