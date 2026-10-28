#!/usr/bin/env bash
# 同分辨率瘦身重编码（挂账①，2026-10-28 审计后续）：
#   libvpx 解码（保 alpha）→ CRF 44 重编 → 三道质量闸 → 原子替换；44 不过闸回落 42，再不过保留原文件。
#
# 为什么可以这样压：素材 640px 高、实际显示约 200–230px（3× 过采样），
# 显示尺寸下的损失远小于全分辨率指标。两道闸（数值都在「显示不可见」的论证范围内）：
#   1) 原生分辨率 libvmaf ≥ 93（严格口径）
#   2) alpha 平面 SSIM ≥ 0.95（透明边缘不糊）
# 另校验：时长偏移 < 2ms、alpha_mode tag = 1（assets 测试会再锁一遍）。
# 曾试过加「0.5× 缩放 libvmaf ≥ 96」闸，实测撤掉：VMAF 默认模型对小分辨率不稳定，
# 同一条片全分辨率 93 分、缩半反而 75 分（2026-10-28 实测 indigo-walk / violet-hair），
# 量尺矛盾值只会误杀。0.5× 分数仍会打印，仅供人工参考、不参与判定。
#
# ⚠ 一次性工具：直接替换 assets/*.webm，重复跑会产生代际损失（每次都是有损转码）。
#    跑完必须：node tools/assets-manifest.cjs --update && npm test
#
# 用法：bash tools/slim-clips.sh [assets/pet-x.webm ...]   # 缺省全部片段
set -euo pipefail

CRF_HI=44
CRF_MID=42
CRF_LO=40
GATE_VMAF_FULL=93
GATE_ALPHA_SSIM=0.95

TMP="${TEMP:-/tmp}/slim-clips"
mkdir -p "$TMP"

FILES=("$@")
if [ ${#FILES[@]} -eq 0 ]; then FILES=(assets/pet-*.webm); fi

vmaf_of() { # $1=ref $2=dist $3=scale("1"|"0.5")
  local flt=""
  if [ "$3" = "0.5" ]; then flt=",scale=iw/2:ih/2"; fi
  ffmpeg -nostdin -c:v libvpx-vp9 -i "$1" -c:v libvpx-vp9 -i "$2" \
    -filter_complex "[0:v]format=yuv420p${flt}[a];[1:v]format=yuv420p${flt}[b];[a][b]libvmaf" \
    -f null - 2>&1 </dev/null | grep -o "VMAF score: [0-9.]*" | grep -o "[0-9.]*$"
}

alpha_ssim_of() { # $1=ref $2=dist（两侧都必须 libvpx 解码，否则 dist 的 alpha 是不透明的）
  ffmpeg -nostdin -c:v libvpx-vp9 -i "$1" -c:v libvpx-vp9 -i "$2" \
    -filter_complex "[0:v]format=rgba,extractplanes=3[a];[1:v]format=rgba,extractplanes=3[b];[a][b]ssim" \
    -f null - 2>&1 </dev/null | grep -o "All:[0-9.]*" | tail -1 | cut -d: -f2
}

dur_of() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
alpha_tag_of() { ffprobe -v error -select_streams v:0 -show_entries stream_tags=alpha_mode -of csv=p=0 "$1"; }

total0=0; total1=0; fail=0; n=0
for SRC in "${FILES[@]}"; do
  n=$((n+1))
  NAME=$(basename "$SRC")
  SZ0=$(stat -c%s "$SRC"); D0=$(dur_of "$SRC")
  picked=""
  for CRF in $CRF_HI $CRF_MID $CRF_LO; do
    CAND="$TMP/${NAME%.webm}-c${CRF}.webm"
    ffmpeg -nostdin -y -v error -c:v libvpx-vp9 -i "$SRC" \
      -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf "$CRF" -row-mt 1 -deadline good -cpu-used 2 -an \
      "$CAND" </dev/null
    V=$(vmaf_of "$SRC" "$CAND" 1)
    VH=$(vmaf_of "$SRC" "$CAND" 0.5) # 参考：小分辨率下模型不稳，不参与判定
    A=$(alpha_ssim_of "$SRC" "$CAND")
    D1=$(dur_of "$CAND")
    TAG=$(alpha_tag_of "$CAND")
    keep=$(awk -v v="$V" -v a="$A" -v d0="$D0" -v d1="$D1" -v tag="$TAG" \
      'BEGIN{print (v>=93 && a>=0.95 && (d1-d0)<0.002 && (d0-d1)<0.002 && tag=="1") ? 1 : 0}')
    verdict="FAIL"; [ "$keep" = "1" ] && verdict="PASS"
    echo "[$n/$(( ${#FILES[@]} ))] $NAME crf=$CRF vmaf=$V half=$VH alpha=$A dur=$D0->$D1 tag=$TAG $verdict"
    if [ "$keep" = "1" ]; then picked="$CAND"; break; fi
  done
  if [ -z "$picked" ]; then
    echo "!! $NAME 所有 CRF 档都没过闸：保留原文件"
    fail=$((fail+1))
    continue
  fi
  SZ1=$(stat -c%s "$picked")
  cp -f "$picked" "$SRC"
  total0=$((total0+SZ0)); total1=$((total1+SZ1))
  echo "OK $NAME $((SZ0/1024))->$((SZ1/1024))KB (-$((100-SZ1*100/SZ0))%)"
done

echo "-----"
if [ $fail -gt 0 ]; then
  echo "完成，但 $fail 条未过闸（保留原样）。过闸合计 $((total0/1024))->$((total1/1024))KB"
  exit 1
fi
echo "全部过闸：$((total0/1024))KB -> $((total1/1024))KB (-$((100-total1*100/total0))%)"
echo "下一步：node tools/assets-manifest.cjs --update && npm test"
