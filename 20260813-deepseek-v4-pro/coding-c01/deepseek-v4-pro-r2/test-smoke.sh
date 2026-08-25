#!/bin/sh
# 静态冒烟测试：确认交付物与本地依赖完整
cd "$(dirname "$0")" || exit 1
set -e
for f in index.html js/main.js vendor/three.module.js vendor/OrbitControls.js; do
  [ -f "$f" ] || { echo "缺失文件: $f"; exit 1; }
done
grep -q 'importmap' index.html || { echo "importmap 缺失"; exit 1; }
grep -q 'OrbitControls' js/main.js || { echo "轨道控制器缺失"; exit 1; }
echo "SMOKE OK: 静态依赖完整。请运行 ./run.sh 8080 并在浏览器中执行 README 第 3 节的交互验收清单。"
