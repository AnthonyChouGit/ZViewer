#!/bin/sh
# ZViewer 一键启动脚本（单文件 exe 版，Linux）
# 命令：start | stop | restart | status | logs | cert | https | help | menu
# 无参数时进入交互菜单。
#
# 统一端口：前后端共用同一端口（默认 3333），由后端 exe 托管 frontend/dist 静态文件，
# 无需独立的前端 exe。

cd "$(dirname "$0")" || exit 1

ROOT_DIR=$(pwd)
BACKEND_BIN="$ROOT_DIR/zviewer-backend"
LOG_DIR="$ROOT_DIR/log"
PIDS_FILE="$ROOT_DIR/.prod.pids.json"
ENV_FILE="$ROOT_DIR/.env"

DEFAULT_PORT=3333
DEFAULT_RTMP_PORT=3334
DEFAULT_FLV_PORT=3335
BACKEND_PORT="${BACKEND_PORT:-}"
BACKEND_ONLY=0
HTTPS_MODE=0
CERT_HOST=""
CERT_FORCE=""

# ==================== 工具函数 ====================

# 从 .env / 环境变量读取端口，优先级：环境变量 > .env > 默认值
# 统一端口 PORT（默认 3333）、RTMP/HTTP-FLV（默认 3334/3335）
env_port_value() {
  local key="$1"
  local default="$2"
  local val="${!key:-}"
  if [ -z "$val" ] && [ -f "$ENV_FILE" ]; then
    val=$(grep -E "^${key}=" "$ENV_FILE" | head -n 1 | cut -d= -f2- | tr -d '"' | xargs)
  fi
  if [ -z "$val" ]; then
    val="$default"
  fi
  echo "$val"
}

resolve_ports() {
  if [ -z "$BACKEND_PORT" ]; then
    BACKEND_PORT="$(env_port_value PORT "$DEFAULT_PORT")"
  fi
  RTMP_PORT="$(env_port_value RTMP_PORT "$DEFAULT_RTMP_PORT")"
  HTTP_FLV_PORT="$(env_port_value HTTP_FLV_PORT "$DEFAULT_FLV_PORT")"
}

write_pids() {
  # $1=backend_pid
  printf '{"backend":{"pid":%s},"frontend":null}\n' "$1" > "$PIDS_FILE"
}

read_pid() { # $1=backend|frontend
  [ -f "$PIDS_FILE" ] || return 1
  sed -n "s/.*\"$1\":{\"pid\":\([0-9][0-9]*\).*/\1/p" "$PIDS_FILE" | head -n 1
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    ss -lnt "sport = :$port" 2>/dev/null | grep -q LISTEN
  else
    return 1
  fi
}

# 等待端口开始监听（后端初始化需要数秒）
wait_port_ready() {
  local port="$1"
  local timeout="${2:-30}"
  local waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if port_in_use "$port"; then
      return 0
    fi
    sleep 0.5
    waited=$((waited + 1))
  done
  return 1
}

kill_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | xargs -r kill 2>/dev/null
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k "$port/tcp" >/dev/null 2>&1
  fi
}

has_exe() {
  if [ ! -f "$1" ]; then
    echo "  [错误] 未找到 $2 : $1"
    echo "         请先运行 build-all 编译（含单文件可执行程序）"
    return 1
  fi
  return 0
}

# ==================== 证书 ====================

# 交互输入要签发证书的主机（localhost / 内网 IP / 域名，均使用本地自签证书）
select_cert_host() {
  echo ""
  echo "  请输入要签发证书的主机（localhost / IP / 域名，直接回车默认 localhost）"
  echo "  [提示] 使用本地自签证书，SAN 始终包含 localhost / 127.0.0.1 / ::1"
  printf "  请输入主机（回车默认 localhost）: "
  read CERT_HOST
  CERT_HOST=$(echo "$CERT_HOST" | tr -d ' ')
  if [ -z "$CERT_HOST" ]; then
    CERT_HOST="localhost"
  fi
}

issue_cert() {
  # 返回码由 $CERT_RC 携带
  if ! has_exe "$BACKEND_BIN" "后端程序 zviewer-backend"; then CERT_RC=1; return; fi
  echo "  [证书] 签发类型: $CERT_HOST"
  if [ -n "$CERT_FORCE" ]; then
    "$BACKEND_BIN" --gen-cert "$CERT_HOST" --force
  else
    "$BACKEND_BIN" --gen-cert "$CERT_HOST"
  fi
  CERT_RC=$?
}

do_cert() {
  if [ -z "$CERT_HOST" ]; then
    select_cert_host
  fi
  issue_cert
  echo ""
  if [ "$CERT_RC" -ne 0 ]; then
    echo "  [证书] 签发失败（退出码 $CERT_RC）"
    return 1
  fi
  echo "  [证书] 签发完成，证书位于 config/ssl/"
  return 0
}

# ==================== 启动 ====================

do_start() {
  resolve_ports
  echo "========================================"
  echo "  ZViewer 启动"
  echo "  端口: $BACKEND_PORT"
  if [ "$HTTPS_MODE" -eq 1 ]; then
    echo "  模式: HTTPS（可信/自签证书）"
  elif [ "$BACKEND_ONLY" -eq 1 ]; then
    echo "  模式: 仅后端（不校验前端产物）"
  else
    echo "  模式: HTTP（后端统一提供 API + 前端静态文件）"
  fi
  echo "========================================"

  if ! has_exe "$BACKEND_BIN" "后端程序 zviewer-backend"; then return 1; fi

  if port_in_use "$BACKEND_PORT"; then
    echo "  [错误] 端口 $BACKEND_PORT 已被占用"
    return 1
  fi

  # 后端统一托管前端静态文件，需 frontend/dist 存在；BackendOnly 模式跳过此检查
  if [ "$BACKEND_ONLY" -ne 1 ]; then
    if [ ! -f "$ROOT_DIR/frontend/dist/index.html" ]; then
      echo "  [错误] 前端构建产物缺失: $ROOT_DIR/frontend/dist/index.html"
      return 1
    fi
  fi

  # HTTPS 模式：先签发证书（后端启动时也会在证书缺失时自动补签，
  # 此处提前签发以支持 host / --force 参数）
  if [ "$HTTPS_MODE" -eq 1 ]; then
    if [ -z "$CERT_HOST" ]; then
      select_cert_host
    fi
    issue_cert
    if [ "$CERT_RC" -ne 0 ]; then
      echo "  [证书] 签发失败，HTTPS 启动中止"
      return 1
    fi
  fi

  mkdir -p "$LOG_DIR"
  : > "$LOG_DIR/backend.log"
  : > "$LOG_DIR/backend.err.log"

  echo "  启动后端..."
  if [ "$HTTPS_MODE" -eq 1 ]; then
    PORT="$BACKEND_PORT" NODE_ENV=production RTMP_PORT="$RTMP_PORT" HTTP_FLV_PORT="$HTTP_FLV_PORT" HTTPS=true \
      nohup "$BACKEND_BIN" >> "$LOG_DIR/backend.log" 2>> "$LOG_DIR/backend.err.log" &
  else
    PORT="$BACKEND_PORT" NODE_ENV=production RTMP_PORT="$RTMP_PORT" HTTP_FLV_PORT="$HTTP_FLV_PORT" \
      nohup "$BACKEND_BIN" >> "$LOG_DIR/backend.log" 2>> "$LOG_DIR/backend.err.log" &
  fi
  local_backend_pid=$!

  # 等待后端就绪（TypeORM 初始化 + NMS 启动需要数秒）
  echo "  等待后端就绪..."
  if ! wait_port_ready "$BACKEND_PORT"; then
    echo "  错误：后端在 30 秒内未就绪，请检查日志: $LOG_DIR/backend.err.log" >&2
    kill "$local_backend_pid" 2>/dev/null || true
    return 1
  fi

  write_pids "$local_backend_pid"
  echo "  后端 PID: $local_backend_pid"
  if [ "$HTTPS_MODE" -eq 1 ]; then
    echo "  访问  : https://localhost:$BACKEND_PORT"
  else
    echo "  访问  : http://localhost:$BACKEND_PORT"
  fi
  echo "  日志  : $LOG_DIR/"
  return 0
}

# ==================== 停止 / 重启 / 状态 / 日志 ====================

do_stop() {
  local bp fp
  bp=$(read_pid backend)
  fp=$(read_pid frontend)
  [ -n "$bp" ] && kill "$bp" 2>/dev/null
  # 兼容旧版 pids 文件中可能记录的前端进程
  [ -n "$fp" ] && kill "$fp" 2>/dev/null
  rm -f "$PIDS_FILE"
  resolve_ports
  kill_port "$BACKEND_PORT"
  echo "  已停止"
}

do_restart() {
  do_stop
  sleep 1
  do_start
}

do_status() {
  echo "========================================"
  echo "  ZViewer 运行状态"
  echo "========================================"
  resolve_ports
  local bp backend_running
  bp=$(read_pid backend)
  backend_running="否"
  if [ -n "$bp" ] && kill -0 "$bp" 2>/dev/null; then backend_running="是"; fi

  echo "  服务:"
  echo "    配置端口: $BACKEND_PORT"
  echo "    端口监听: $(if port_in_use "$BACKEND_PORT"; then echo 是; else echo 否; fi)"
  if [ -n "$bp" ]; then
    echo "    记录 PID: $bp ($(if [ "$backend_running" = "是" ]; then echo 运行中; else echo 未运行; fi))"
  fi

  echo "  程序:"
  echo "    后端: $(if [ -f "$BACKEND_BIN" ]; then echo 存在; else echo 缺失; fi)"
  echo "    前端: $(if [ -f "$ROOT_DIR/frontend/dist/index.html" ]; then echo 存在; else echo 缺失; fi)"
  echo "    证书: $(if [ -f "$ROOT_DIR/config/ssl/cert.pem" ]; then echo 存在; else echo 缺失; fi)"
}

do_logs() {
  # 统一端口后仅保留后端日志（前端静态文件由后端托管，无独立日志）
  local log_file="$LOG_DIR/backend.log"
  if [ -f "$log_file" ]; then
    tail -n 50 "$log_file"
  else
    echo "  日志不存在: $log_file"
  fi
}

# ==================== 帮助 / 菜单 ====================

usage() {
  cat <<EOF
用法: $0 {start|backend|stop|restart|status|logs|cert|https|help|menu} [选项]

命令:
  start              启动服务（加 --https 使用 HTTPS）
  backend            仅启动后端（加 --https 使用 HTTPS）
  stop               停止服务
  restart            重启服务
  status             查看运行状态
  logs               查看后端日志
  cert [host]        一键签发 SSL 证书（本地自签，localhost / IP / 域名）
  https [host]       签发证书后以 HTTPS 启动
  help               显示此帮助
  menu               交互菜单（无参数时自动进入）

start/restart/cert/https 选项:
      --https              start 时使用 HTTPS
      --force              证书强制重新签发

端口: 默认取 .env 的 PORT（否则 3333），前后端共用同一端口

示例:
  ./start.sh                    # 交互菜单
  ./start.sh start              # HTTP 启动
  ./start.sh backend            # 仅启动后端
  ./start.sh https 192.168.1.10  # 自签证书（SAN 含该 IP）后 HTTPS 启动
  ./start.sh cert example.com --force  # 为指定域名强制重新自签

提示: 公网部署需要浏览器可信的正式证书时，请使用 Cloudflare / Nginx /
      Caddy / 宝塔 / 1Panel 等反代签发，再反代到本服务端口。
EOF
}

do_menu() {
  while true; do
    clear 2>/dev/null || true
    echo "========================================"
    echo "  ZViewer 服务管理（单文件版）"
    echo "========================================"
    echo ""
    echo "  1) 启动服务"
    echo "  2) 仅启动后端"
    echo "  3) 停止服务"
    echo "  4) 重启服务"
    echo "  5) 查看状态"
    echo "  6) 查看日志"
    echo "  7) 一键签发 SSL 证书"
    echo "  8) HTTPS 启动（自动签发证书）"
    echo "  0) 退出"
    echo ""
    printf "  请输入编号 (0-8): "
    read CHOICE
    case "$CHOICE" in
      1) BACKEND_ONLY=0; HTTPS_MODE=0; do_start; wait_key ;;
      2) BACKEND_ONLY=1
        printf "  请选择类型 (1=HTTP 2=HTTPS，直接回车默认 HTTP): "
        read BO_CHOICE
        if [ "$BO_CHOICE" = "2" ]; then HTTPS_MODE=1; else HTTPS_MODE=0; fi
        do_start; wait_key ;;
      3) do_stop; wait_key ;;
      4) do_restart; wait_key ;;
      5) do_status; wait_key ;;
      6) do_logs; wait_key ;;
      7) do_cert; wait_key ;;
      8) BACKEND_ONLY=0; HTTPS_MODE=1; do_start; wait_key ;;
      0) return 0 ;;
      *) echo "  无效输入，请重新选择"; sleep 1 ;;
    esac
  done
}

wait_key() {
  echo ""
  printf "  按回车返回菜单: "
  read _DUMMY
}

# ==================== 参数解析 ====================

# start/https 参数：--https/--force/host
parse_start_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --https) HTTPS_MODE=1; shift ;;
      --force) CERT_FORCE="--force"; shift ;;
      *)
        if [ -z "$CERT_HOST" ]; then
          CERT_HOST="$1"; shift
        else
          echo "  未知参数: $1" >&2
          exit 1
        fi
        ;;
    esac
  done
}

# cert 参数：host / --force
parse_cert_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --force|-f) CERT_FORCE="--force"; shift ;;
      *) CERT_HOST="$1"; shift ;;
    esac
  done
}

# ==================== 入口 ====================

CMD="${1:-menu}"
case "$CMD" in
  start)
    shift
    parse_start_args "$@"
    do_start
    ;;
  backend)
    shift
    parse_start_args "$@"
    BACKEND_ONLY=1
    do_start
    ;;
  stop)
    do_stop
    ;;
  restart)
    shift
    parse_start_args "$@"
    do_restart
    ;;
  status)
    do_status
    ;;
  logs)
    do_logs
    ;;
  cert)
    shift
    parse_cert_args "$@"
    do_cert
    ;;
  https)
    shift
    HTTPS_MODE=1
    parse_start_args "$@"
    do_start
    ;;
  help|--help|-h)
    usage
    ;;
  menu)
    do_menu
    ;;
  *)
    usage
    ;;
esac

exit 0
