# ZViewer

> 多人一起观影、听歌、语音聊天和屏幕分享平台。

**[English](README.en.md)** | 中文

<p align="left">  
  <a href="LICENSE">  
    <img src="https://img.shields.io/github/license/Zero-wyc/ZViewer?style=flat-square&logo=github&label=LICENSE&labelColor=333&color=blue" alt="MIT">  
  </a>  
  <img src="https://img.shields.io/github/stars/Zero-wyc/ZViewer?style=flat-square&logo=github&label=Stars&labelColor=333&color=blue" alt="Stars">  
  <a href="https://github.com/Zero-wyc/ZViewer/releases">  
    <img src="https://img.shields.io/github/v/release/Zero-wyc/ZViewer?style=flat-square&logo=github&label=RELEASE&labelColor=333&color=green" alt="Release">  
  </a>  
  <img src="https://img.shields.io/github/contributors/Zero-wyc/ZViewer?style=flat-square&logo=github&label=Contributors&labelColor=333&color=brightgreen" alt="Contributors">  
  <img src="https://img.shields.io/github/repo-size/Zero-wyc/ZViewer?style=flat-square&logo=github&label=Size&labelColor=333&color=yellow" alt="Repo Size">  
  <img src="https://img.shields.io/github/last-commit/Zero-wyc/ZViewer?style=flat-square&logo=github&label=Last%20Commit&labelColor=inactive" alt="Last Commit">  
  <img src="https://img.shields.io/github/languages/top/Zero-wyc/ZViewer?style=flat-square&logo=typescript&labelColor=333&color=3178C6" alt="Top Language">  
  <a href="https://t.me/Zero_251">  
    <img src="https://img.shields.io/badge/Telegram-26A5E4?style=flat-square&logo=telegram&logoColor=white" alt="Telegram">  
  </a>  
</p>

---

[Telegram](https://t.me/Zero_251) [QQ](https://qm.qq.com/q/MuKPRVz8wc)

---

项目文档：[docx.zviewer.zero251.xyz](https://docx.zviewer.zero251.xyz)

| ![](https://raw.githubusercontent.com/Zero-wyc/Image/main/All/20261003200919255.webp) | ![](https://raw.githubusercontent.com/Zero-wyc/Image/main/All/20261003200942428.webp) |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| ![](https://raw.githubusercontent.com/Zero-wyc/Image/main/All/20261003200643035.webp) | ![](https://raw.githubusercontent.com/Zero-wyc/Image/main/All/20261003200707122.webp) |
| ![](https://raw.githubusercontent.com/Zero-wyc/Image/main/All/20260930211758831.webp) | ![](https://raw.githubusercontent.com/Zero-wyc/Image/main/All/20261003201053941.webp) |
| ![](https://raw.githubusercontent.com/Zero-wyc/Image/main/All/20261003200715093.webp) | ![](https://raw.githubusercontent.com/Zero-wyc/Image/main/All/20261003201139524.webp) |

## Star History

<a href="https://star-history.com/#Zero-wyc/ZViewer&Zero-wyc/ZViewerCLI&Zero-wyc/ZViewerAPP&Date">
 <picture>  
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Zero-wyc/ZViewer,Zero-wyc/ZViewerCLI,Zero-wyc/ZViewerAPP&type=Date&theme=dark&v=2" />  
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Zero-wyc/ZViewer,Zero-wyc/ZViewerCLI,Zero-wyc/ZViewerAPP&type=Date&v=2" />  
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Zero-wyc/ZViewer,Zero-wyc/ZViewerCLI,Zero-wyc/ZViewerAPP&type=Date&v=2" />  
 </picture>  
</a>

## 浏览器要求

> 建议使用 Chrome / Edge 等内核 130+ 的 Chromium 浏览器。Safari 与 Firefox 对 MSE / MKV 解码支持不完整，可能出现卡顿、无法解码、字幕异常。

#### PS：另有正处于开发状态的[Zviewer手机端](https://github.com/Zero-wyc/ZViewerAPP)　|　并由[FredQin](https://github.com/fredqin2006-X)开发

## 目录

- [功能一览](#功能一览)
- [安装与启动](#安装与启动)
  - [交互菜单](#交互菜单)
- [Docker 部署](#docker-部署)
- [部署配置](#部署配置)

---

## Docker 用户升级提示（v4.3.6 以下必读）

> **v4.3.6 以下版本使用 Docker 部署的用户**：请**不要**通过管理面板「基础设置 → 一键更新」升级，请按最新 docker compose 重新部署。

## 功能一览

- **一起看**：多人同步观影，房主控播，观众可申请暂停 / 快进
- **视频源**：Bilibili（分 P、清晰度、大会员画质）、MP4 直链、WebDAV / FTP / OpenList、Emby / Jellyfin、服务器本地目录
- **格式兼容**：MKV / AVI / TS / WMV、DTS / AC3 / EAC3 等浏览器不原生支持的格式
- **播放模式**：CLI 本地代理（高画质、不耗服务器流量）、服务器 DASH 转发、MP4 直链（最高 720P），按需切换
- **弹幕与字幕**：B 站官方 / DandanPlay / 本地 XML·JSON（可多轨）；SRT / ASS / SSA / VTT / SMI / SUB
- **互动与推流**：评论、语音聊天、WebRTC 屏幕共享、OBS 推流
- **一起听**：网易云音乐 × 哔哩哔哩，歌单自动补位推荐、双收藏夹一键收藏、MV 歌词页背景
- **个性化**：Material You 动态主题、自定义主题色与背景、玻璃拟态、弹幕字幕字号独立调节
- **运维**：一键自动更新，Docker / 单文件版开箱即用

## ZViewerCLI

[ZViewerCLI](https://github.com/Zero-wyc/ZViewerCLI)（Go）是运行在用户本地的代理程序：用你自己的 Bilibili Cookie 在本地解析并代理视频流，让房间内所有人共享大会员画质，且几乎不消耗服务器带宽。适用于既要高画质、又想节省服务器流量的场景（服务器 DASH 转发会大量消耗带宽）。

## 安装与启动

首次启动自动创建 ROOT 管理员：用户名 `root`，密码 `root`。**安装后请立即修改密码。**

### 单文件版（推荐）

从 [Releases](https://github.com/Zero-wyc/ZViewer/releases) 下载对应平台压缩包，解压后：

- **Windows**：双击 `start.bat`，进入交互菜单
- **Linux**：执行 `./start.sh`（不带参数），进入交互菜单

在菜单中选择 `1` 启动服务，完成后访问 `http://localhost:3333`。

也可以跳过菜单直接带命令执行，如 `start.bat start` / `./start.sh start`；完整命令见 `start.bat help`。

#### 交互菜单

```text
  1) 启动服务              2) 仅启动后端
  3) 停止服务              4) 重启服务
  5) 查看状态              6) 查看日志
  7) 一键签发 SSL 证书     8) HTTPS 启动（自动签发证书）
  0) 退出
```

| 编号 | 功能       | 说明                                                     |
| -- | -------- | ------------------------------------------------------ |
| 1  | 启动服务     | HTTP 启动，端口取 `.env` 的 `PORT`（默认 3333）                     |
| 2  | 仅启动后端    | 先选 HTTP / HTTPS；跳过前端产物校验，适合前后端分离调试                      |
| 3  | 停止服务     | 按记录的 PID 停止，端口被占用时兜底清理                                 |
| 4  | 重启服务     | 停止后重新启动                                                |
| 5  | 查看状态     | 端口监听、进程 PID、程序与证书是否齐全                                  |
| 6  | 查看日志     | 输出 `log/backend.log` 末 50 行                             |
| 7  | 签发 SSL 证书 | 本地自签证书（`localhost` / IP / 域名均可，SAN 始终含 `localhost` / `127.0.0.1` / `::1`，10 年有效期） |
| 8  | HTTPS 启动 | 签发证书后以 HTTPS 启动                                        |
| 0  | 退出       | 只关闭菜单窗口，后台服务继续运行；需要停止请选 `3`                            |

> 每次操作结束后按回车返回菜单。

> **正式环境不建议使用自签证书**：自签证书浏览器会提示「不安全」（需手动信任）。对外服务建议把域名交给 **Cloudflare、ESA、EdgeOne** 等支持自动签发与续期的边缘服务，或使用 **宝塔、1Panel** 等面板统一申请续期，再反向代理到 ZViewer 的 3333 端口。

### 源码

```bash
npm install             # 安装依赖
npm run build           # 生产构建
npm start               # 启动
```

或使用脚本完成依赖安装、构建与启动：

```powershell
.\start-prod.bat start    # Windows
./start-prod.sh start     # Linux / macOS
```

支持命令：`start` / `backend` / `stop` / `restart` / `status` / `logs` / `build` / `cert` / `https` / `help`。

### 端口

| 端口     | 用途                                                         |
| -------- | ------------------------------------------------------------ |
| 3333/tcp | 统一入口：HTTP/HTTPS API、WebSocket、前端页面、`/live` FLV 代理 |
| 3333/udp | LiveKit 语音聊天                                             |
| 3334     | OBS 推流                                                     |
| 3337/tcp | 语音 TCP 模式                                                |

## Docker 部署

```bash
docker run -d \
  --name zviewer \
  --restart unless-stopped \
  -p 3333:3333 \
  -p 3333:3333/udp \
  -p 3334:3334 \
  -v zviewer-data:/app/config \
  zerowyc0721/zviewer:latest
```

或 docker compose：

```yaml
services:
  zviewer:
    image: zerowyc0721/zviewer:latest
    ports:
      - "3333:3333"      # API + WebSocket + 前端页面 + /live FLV 代理 + /rtc 语音信令反代
      - "3333:3333/udp"  # LiveKit WebRTC 媒体传输
      - "3334:3334"      # RTMP 推流（OBS）
      - "3337:3337"      # 语音 TCP 模式
    volumes:
      - zviewer-data:/app/config
    restart: unless-stopped
```

- 请将 `zviewer-data` 替换为实际数据目录
- 镜像以 HTTP 模式启动，HTTPS 需自行配置：推荐 Cloudflare、ESA、EdgeOne 等边缘服务，或宝塔、1Panel 等面板自动签发并续期，再反代到 3333（不建议用命令行自助签发正式证书）
- `/app/config` 含数据库（`dev.sqlite`）、证书（`ssl/`）、上传文件（`uploads/`）、推流切片（`media/`）
- Docker 模式下仍可使用网页更新

## 部署配置

### 环境变量

| 变量                       | 说明                                    | 默认值                     |
| ------------------------ | ------------------------------------- | ----------------------- |
| `PORT`                   | 后端端口                                  | `3333`                  |
| `HOST`                   | 监听地址                                  | 空（双栈）                   |
| `CONFIG_DIR`             | 数据根目录                                 | `<project-root>/config` |
| `DATABASE_URL`           | SQLite 路径或 PostgreSQL 连接串             | `<config>/dev.sqlite`   |
| `CORS_ORIGIN`            | CORS 来源，逗号分隔                          | `*`                     |
| `JWT_ACCESS_SECRET`      | Access 密钥（生产必须修改）                     | —                       |
| `JWT_REFRESH_SECRET`     | Refresh 密钥（生产必须修改）                    | —                       |
| `RTMP_PORT`              | RTMP 推流端口                             | `3334`                  |
| `HTTP_FLV_PORT`          | FLV 拉流端口（内部）                          | `3335`                  |
| `LIVEKIT_EXTERNAL`       | `1` 时使用外置 LiveKit，跳过内嵌               | `0`                     |
| `LIVEKIT_NODE_IP`        | ICE 广播地址；NAT 复杂或无出网环境可手动指定公网 IP       | 空（自动 STUN）             |
| `LIVEKIT_RTC_TCP_PORT`   | ICE/TCP 端口（语音传输模式 = TCP 时使用）          | `3337`                  |
| `LIVEKIT_TURN_DOMAIN`    | TURN/TLS 域名                           | —                       |
| `LIVEKIT_TURN_CERT`      | TURN TLS 证书路径                         | —                       |
| `LIVEKIT_TURN_KEY`       | TURN TLS 私钥路径                         | —                       |

### 语音传输

- 默认音频走 3333/udp，防火墙需放行；可在管理端切换为 TCP，需额外放行 3337/tcp（Docker 需补端口映射）
- 纯内网 / 特殊 NAT 环境 STUN 探测失败时，用 `LIVEKIT_NODE_IP` 指定服务器公网 IP
- 需要 TURN/TLS 中继时，在 compose 中补 `5349` 端口并配置 `LIVEKIT_TURN_*` 三项变量

## Windows 桌面控制台（可选）

Windows 用户可构建带头像图标的目录 GUI，双击分发目录唯一的 `ZViewer.exe` 打开控制台，组件放在 `app/`，无需安装或自解包。控制台提供系统托盘、本机 HTTPS、自建 FRP、可保存的监听端口，以及直接在 GUI 内配置和扫码登录的 ZViewerCLI 高画质代理。构建和使用步骤见 [desktop/README.md](desktop/README.md)，现有服务端网页与命令行源码保持兼容。
