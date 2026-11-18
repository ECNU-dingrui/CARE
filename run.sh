#!/usr/bin/env bash
#
# 运行脚本
#
# 用法：
#   ./run.sh                    构建并启动 DSH Web，自动安装 Runtime + CARE 插件
#   ./run.sh --demo             以演示模式启动（跳过真实 CARE 与模型）
#   ./run.sh --debug            不启动 DSH，直接本地调试插件
#   ./run.sh --debug --demo     本地调试 + 演示模式
#   ./run.sh --open             启动 DSH Web 并尝试打开浏览器
#
# 可用环境变量：DSH_HOME、DSH_PROFILE、DSH_HOST、DSH_PORT、DSH_BIN、DSH_VERSION、
#               CARE_ROOT、CARE_PYTHON、CARE_DEMO
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN="$ROOT/dsh-plugin"
RUNTIME="$PLUGIN/runtime-release/software-factory-runtime"
VENV="$ROOT/.venv"

MODE="dsh"
DEMO="${CARE_DEMO:-0}"
OPEN_BROWSER=0
PROFILE="${DSH_PROFILE:-web}"
HOST="${DSH_HOST:-127.0.0.1}"
PORT="${DSH_PORT:-8080}"
VERSION="${DSH_VERSION:-0.2.1-alpha.2}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --debug) MODE="debug" ;;
    --demo) DEMO=1 ;;
    --open) OPEN_BROWSER=1 ;;
    --profile) PROFILE="${2:?--profile 需要参数}"; shift ;;
    --profile=*) PROFILE="${1#*=}" ;;
    --host) HOST="${2:?--host 需要参数}"; shift ;;
    --host=*) HOST="${1#*=}" ;;
    --port) PORT="${2:?--port 需要参数}"; shift ;;
    --port=*) PORT="${1#*=}" ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数：$1" >&2
      exit 2
      ;;
  esac
  shift
done

log() { printf '>>> %s\n' "$*"; }
die() { printf '错误：%s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "缺少 node，请先安装 Node.js"

if [ ! -f "$PLUGIN/lib/index.js" ] || [ ! -f "$PLUGIN/lib/business.js" ] || [ ! -f "$PLUGIN/client.js" ]; then
  log "未找到构建产物，先执行 ./build.sh"
  "$ROOT/build.sh"
fi

if [ -x "$VENV/bin/python" ] && [ -z "${CARE_PYTHON:-}" ]; then
  export CARE_PYTHON="$VENV/bin/python"
fi
export CARE_ROOT="${CARE_ROOT:-$ROOT}"
export CARE_DEMO="$DEMO"

if [ "$MODE" = "debug" ]; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$NODE_MAJOR" -lt 22 ]; then
    die "本地调试需要 Node.js 22+（scripts/debug.ts 使用 --experimental-strip-types）"
  fi
  log "本地调试 CARE 插件（CARE_ROOT=$CARE_ROOT，CARE_DEMO=$CARE_DEMO）"
  cd "$ROOT"
  exec node --experimental-strip-types "$PLUGIN/scripts/debug.ts"
fi

[ -d "$RUNTIME" ] || die "Runtime 目录不存在：$RUNTIME"
export DSH_HOME="${DSH_HOME:-$ROOT/.dsh-home}"
mkdir -p "$DSH_HOME"

DSH_CMD=()
if [ -n "${DSH_BIN:-}" ]; then
  [ -x "$DSH_BIN" ] || die "DSH_BIN 不可执行：$DSH_BIN"
  DSH_CMD=("$DSH_BIN")
elif command -v dsh >/dev/null 2>&1; then
  DSH_CMD=("$(command -v dsh)")
elif [ -x "$PLUGIN/node_modules/.bin/dsh" ]; then
  DSH_CMD=("$PLUGIN/node_modules/.bin/dsh")
elif [ -x "$ROOT/node_modules/.bin/dsh" ]; then
  DSH_CMD=("$ROOT/node_modules/.bin/dsh")
else
  command -v npx >/dev/null 2>&1 || die "未找到 dsh，也没有 npx；请安装 @deepseek-ai/dsh@$VERSION"
  log "未找到 dsh，使用 npx 运行 @deepseek-ai/dsh@$VERSION"
  DSH_CMD=(npx --yes -p "@deepseek-ai/dsh@$VERSION" dsh)
fi

dsh_run() { "${DSH_CMD[@]}" "$@"; }

INSTALL_LOG="$DSH_HOME/plugin-install.log"
: > "$INSTALL_LOG"
install_plugin() {
  local spec="$1" label="$2"
  if ! dsh_run plugin --profile "$PROFILE" add "$spec" >>"$INSTALL_LOG" 2>&1; then
    printf '错误：安装 %s 失败。最近日志（%s）：\n' "$label" "$INSTALL_LOG" >&2
    tail -n 80 "$INSTALL_LOG" >&2 || true
    exit 1
  fi
}

log "DSH_HOME=$DSH_HOME"
log "初始化 profile：$PROFILE"
dsh_run --profile "$PROFILE" --dump-default-config >/dev/null

log "安装 Runtime：$RUNTIME"
dsh_run plugin --profile "$PROFILE" remove "@software-factory/runtime" >/dev/null 2>&1 || true
install_plugin "file:$RUNTIME" "Runtime"

log "安装 CARE 插件：$PLUGIN"
dsh_run plugin --profile "$PROFILE" remove "@local/care-dsh-plugin" >/dev/null 2>&1 || true
install_plugin "file:$PLUGIN" "CARE 插件"

log "启动 DSH Web：http://$HOST:$PORT"
echo "    首次使用请在插件页配置 CARE 仓库根目录与 Python 解释器。"
echo "    按 Ctrl-C 停止。"

if [ "$OPEN_BROWSER" = "1" ]; then
  dsh_run --profile "$PROFILE" --host "$HOST" --port "$PORT"
else
  dsh_run --profile "$PROFILE" --no-open --host "$HOST" --port "$PORT"
fi
