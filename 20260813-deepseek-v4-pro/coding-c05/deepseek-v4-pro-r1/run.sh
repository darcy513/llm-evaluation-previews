#!/bin/sh
# 启动本地静态服务器并尝试打开默认浏览器
set -e
cd "$(dirname "$0")"
PORT="${PORT:-8000}"
URL="http://localhost:${PORT}/"
echo "Serving 3D 双时区腕表 at ${URL}"
echo "按 Ctrl+C 停止服务。"
if [ "$(uname)" = "Darwin" ]; then
  ( sleep 1 && open "${URL}" ) &
fi
python3 -m http.server "${PORT}"
