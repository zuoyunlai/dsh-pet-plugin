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
#    -nostdin 是必须的：这个脚本会被放在 while read 循环里调用，ffmpeg 默认会
#    读 stdin，把循环的输入流吃掉一段，导致后续参数错位（踩过：文件名被截断）。
rm -rf "$TMP" "$TMP-key"
mkdir -p "$TMP"
ffmpeg -nostdin -y -v error -i "$JOBS/$JOB/videos/output.mp4" -vf "fps=24" -start_number 0 "$TMP/frame-%03d.png" </dev/null

# 2) 批量抠像（统一裁切框）
#    400 高是刻意的：宠物在界面上只有约 200px 高，400 仍是 2 倍过采样，
#    实测与 520 高在显示尺寸下肉眼无差，但体积少一半。
python tools/batch-key.py "$TMP" "$TMP-key" 400 </dev/null | tail -1

# 3) 编码 VP9 + alpha
ffmpeg -nostdin -y -framerate 24 -i "$TMP-key/frame-%03d.png" \
  -vf "unsharp=5:5:0.4:5:5:0" \
  -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 38 \
  -row-mt 1 -deadline good -cpu-used 2 -an \
  "assets/pet-${PERSONA}-${ACTION}.webm" </dev/null 2>&1 | tail -1

# 4) 报告
SIZE=$(stat -c%s "assets/pet-${PERSONA}-${ACTION}.webm" 2>/dev/null || stat -f%z "assets/pet-${PERSONA}-${ACTION}.webm")
echo "OK assets/pet-${PERSONA}-${ACTION}.webm -> $((SIZE/1024)) KB"
