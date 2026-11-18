#!/usr/bin/env bash
#
# 构建脚本
#
# 用法：
#   ./build.sh                    安装Node依赖并编译插件
#   ./build.sh --clean            清理node_modules/lib后重新构建
#   ./build.sh --typecheck-only   只做TypeScript类型检查
#   ./build.sh --with-python      同时创建.venv并安装Python依赖
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN="$ROOT/dsh-plugin"
VENV="$ROOT/.venv"

CLEAN=0
TYPECHECK_ONLY=0
WITH_PYTHON=0
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=1 ;;
    --typecheck-only) TYPECHECK_ONLY=1 ;;
    --with-python) WITH_PYTHON=1 ;;
    -h|--help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数：$arg" >&2
      exit 2
      ;;
  esac
done

log() { printf '>>> %s\n' "$*"; }
die() { printf '错误：%s\n' "$*" >&2; exit 1; }

log "0/4 检查环境"
command -v node >/dev/null 2>&1 || die "缺少 node，请安装 Node.js 20+（DSH 建议 24+）"
command -v npm >/dev/null 2>&1 || die "缺少 npm"
command -v python3 >/dev/null 2>&1 || die "缺少 python3"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "Node.js 版本过低：$(node --version)，至少需要 20，DSH 建议 24+"
fi
if [ "$NODE_MAJOR" -lt 24 ]; then
  log "提示：当前 Node.js 为 $(node --version)，DSH 0.2.1 建议使用 24+；本地构建不受影响"
fi
log "Node $(node --version) / npm $(npm --version) / Python $(python3 --version 2>&1 | awk '{print $2}')"

if [ "$CLEAN" = "1" ]; then
  log "清理旧构建产物"
  rm -rf "$PLUGIN/node_modules" "$PLUGIN/lib"
  if [ "$WITH_PYTHON" = "1" ]; then
    rm -rf "$VENV"
  fi
fi

cd "$PLUGIN"

if [ "$TYPECHECK_ONLY" = "1" ]; then
  log "1/1 TypeScript 类型检查"
  npm run --silent typecheck
  log "类型检查通过"
  exit 0
fi

if [ ! -d "$PLUGIN/node_modules" ]; then
  log "1/4 安装 Node 依赖"
  npm install --no-audit --no-fund
else
  log "1/4 Node 依赖已存在（--clean 可强制重装）"
fi

log "2/4 编译 TypeScript 到 dsh-plugin/lib/"
rm -rf "$PLUGIN/lib"
npm run --silent build

[ -f "$PLUGIN/lib/index.js" ] || die "构建失败：未生成 dsh-plugin/lib/index.js"
[ -f "$PLUGIN/lib/business.js" ] || die "构建失败：未生成 dsh-plugin/lib/business.js"
[ -f "$PLUGIN/client.js" ] || die "构建失败：缺少 DSH 配置表单 dsh-plugin/client.js"
node --check "$PLUGIN/client.js"

log "3/4 检查 Python 桥接脚本"
python3 -c 'import ast, sys; ast.parse(open(sys.argv[1], encoding="utf-8").read())' \
  "$PLUGIN/python/care_runner.py"

if [ "$WITH_PYTHON" = "1" ]; then
  log "4/4 创建 Python 虚拟环境并安装 CARE 依赖"
  if [ ! -x "$VENV/bin/python" ]; then
    python3 -m venv "$VENV"
  fi
  "$VENV/bin/python" -m pip install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet --disable-pip-version-check -r "$ROOT/requirements.txt"
  "$VENV/bin/pip" install --quiet -e "$ROOT"
  log "Python 环境：$VENV"
else
  log "4/4 跳过 Python 依赖安装（需要真实 CARE 时使用 --with-python）"
fi

log "构建完成"
echo "    插件入口 : $PLUGIN/lib/index.js"
echo "    配置表单 : $PLUGIN/client.js"
echo "    下一步   : ./run.sh          启动 DSH Web"
echo "               ./run.sh --debug  本地调试插件"
