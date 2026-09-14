#!/bin/zsh
set -e

CONNECTOR_DIR="${0:A:h}"
NODE_BIN="$(command -v node || true)"

if [[ -z "$NODE_BIN" ]]; then
  echo "未找到 Node.js，请先安装 Node.js 后重试。"
  read "?按回车关闭…"
  exit 1
fi

"$NODE_BIN" "$CONNECTOR_DIR/install.mjs"
echo
read "?安装完成，按回车关闭…"
