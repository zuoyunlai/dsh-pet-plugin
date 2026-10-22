#!/usr/bin/env bash
# 一条命令：从 game-material 的 sequence job 视频 → 抠像 → 编码成 assets 里的片段
# 用法：bash tools/build-clip.sh <jobId> <persona> <action>
set -euo pipefail

JOB="$1"
PERSONA="$2"
ACTION="$3"

ROOT="E:/Documents/deepseek-harness/default-workspace/dsh-pet"
JOBS="C:/Users/Zuoyunlai/.dsh/game-material-master/sequence-jobs"
TMP="${TEMP:-/tmp}/clip-${PERSONA}-${ACTION}"

cd "$ROOT"

# 1) 抽 24fps 全帧
rm -rf "$TMP" "$TMP-key"
mkdir -p "$TMP"
ffmpeg -y -v error -i "$JOBS/$JOB/videos/output.mp4" -vf "fps=24" -start_number 0 "$TMP/frame-%03d.png"

# 2) 批量抠像（统一裁切框，520 高）
python tools/batch-key.py "$TMP" "$TMP-key" 520 | tail -1

# 3) 编码 VP9 + alpha
ffmpeg -y -framerate 24 -i "$TMP-key/frame-%03d.png" \
  -vf "unsharp=5:5:0.4:5:5:0" \
  -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 34 \
  -row-mt 1 -deadline good -cpu-used 2 -an \
  "assets/pet-${PERSONA}-${ACTION}.webm" 2>&1 | tail -1

# 4) 报告
SIZE=$(stat -c%s "assets/pet-${PERSONA}-${ACTION}.webm" 2>/dev/null || stat -f%z "assets/pet-${PERSONA}-${ACTION}.webm")
echo "OK assets/pet-${PERSONA}-${ACTION}.webm -> $((SIZE/1024)) KB"
