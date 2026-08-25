#!/bin/sh
# 《极光》AURORA 飞船模型启动脚本
# 用法: ./run.sh [端口]   默认端口 8080
cd "$(dirname "$0")" || exit 1
PORT="${1:-8080}"
echo "AURORA 星舰模型服务已启动： http://localhost:${PORT}/"
python3 -m http.server "$PORT"
