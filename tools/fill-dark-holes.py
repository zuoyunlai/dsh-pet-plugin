"""补回「深色封闭空洞」——绿幕反光被误判成背景后，鞋面上留下的透底。

判据（三段联合，缺一不可）：
  1. alpha 上是被包住的透明区（不与画面边界连通）—— 排除外部背景
  2. 该区在源图里的平均亮度 < --thr —— 排除腿缝等真实镂空（那些是亮绿背景 luma≈0.5~0.7）
  3. 面积 >= --min-area —— 排除孤立噪点

实测分离度（银发雪 stage）：误扣区 luma 0.108~0.276，真实镂空 0.533~0.723，
所以默认阈值 0.35 足够安全。

颜色不需要重建：batch-key 保留下来的就是那个像素自身（已做过 despill）的颜色，
只是 alpha 被误判；把 alpha 补满即可。

用法: python fill-dark-holes.py <输入目录> <输出目录> [--thr 0.35] [--min-area 20]
"""
import os, sys, glob
import numpy as np
import cv2
from PIL import Image

thr = 0.35
min_area = 20
min_content = 0.02   # despill 后 max(R,B) 的均值下限：低于它就是纯背景，不填
args = list(sys.argv[1:])
if "--thr" in args:
    i = args.index("--thr"); thr = float(args[i + 1]); del args[i:i + 2]
if "--min-area" in args:
    i = args.index("--min-area"); min_area = int(args[i + 1]); del args[i:i + 2]
if "--min-content" in args:
    i = args.index("--min-content"); min_content = float(args[i + 1]); del args[i:i + 2]
if len(args) < 2:
    raise SystemExit("用法: fill-dark-holes.py <输入目录> <输出目录> [--thr 0.35] [--min-area 20]")

src_dir, out_dir = args[0], args[1]
os.makedirs(out_dir, exist_ok=True)
files = sorted(glob.glob(os.path.join(src_dir, "*.png")))
if not files:
    raise SystemExit("no frames in " + src_dir)

LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
tot_dark = tot_light = 0
filled_px = 0

for f in files:
    im = Image.open(f).convert("RGBA")
    arr = np.asarray(im).copy()
    a = arr[..., 3]
    rgb = arr[..., :3].astype(np.float32) / 255.0
    luma = rgb @ LUMA

    inv = (a <= 128).astype(np.uint8)
    n, labels = cv2.connectedComponents(inv, connectivity=4)
    if n <= 1:
        Image.fromarray(arr, "RGBA").save(os.path.join(out_dir, os.path.basename(f)))
        continue
    border = set(labels[0, :].tolist()) | set(labels[-1, :].tolist()) | \
             set(labels[:, 0].tolist()) | set(labels[:, -1].tolist())
    areas = np.bincount(labels.ravel())

    fill_mask = np.zeros(a.shape, dtype=np.uint8)
    for l in range(1, n):
        if l in border:
            continue
        area = int(areas[l])
        if area < min_area:
            continue
        m = labels == l
        ml = float(luma[m].mean())
        if ml >= thr:
            tot_light += 1
            continue
        # 关键护栏：despill 之后**纯绿背景的 R=B=0**（绿被压回 max(R,B)=0），
        # 而带主体内容的区域 R 或 B > 0（黑鞋的反光是 (60,60,40) 这种）。
        # 不加这条，线性 alpha 之后腿缝（纯绿，despill 后全黑）会被当成
        # 「深色空洞」填掉，两腿之间就多一坨黑楔子（实测 f96 腿缝 4448px 被填）。
        mg = np.maximum(rgb[..., 0], rgb[..., 2])[m]
        if float(mg.mean()) < min_content:
            tot_light += 1     # 其实是纯背景，不该填
            continue
        fill_mask[m] = 1
        filled_px += area
        tot_dark += 1

    if fill_mask.any():
        # 关键：补 alpha 之外**必须重建颜色**。
        # 这些像素的颜色是绿幕反光（一片绿），只补 alpha 会得到「实心的绿色块」——
        # 数字上洞没了，视觉上更糟（用户 2026-10-28 反馈「还是没有修好」）。
        # 用 inpaint 从四周（黑鞋）把颜色重建回来，鞋底才是黑鞋。
        bgr = cv2.cvtColor(arr[..., :3], cv2.COLOR_RGB2BGR)
        rep = cv2.inpaint(bgr, fill_mask, 3, cv2.INPAINT_TELEA)
        arr[..., :3] = cv2.cvtColor(rep, cv2.COLOR_BGR2RGB)
        arr[..., 3][fill_mask > 0] = 255

    Image.fromarray(arr, "RGBA").save(os.path.join(out_dir, os.path.basename(f)))

print("fill-dark-holes: %d 帧, 补回深色空洞 %d 处 / %d px, 保留亮色镂空 %d 处 (thr=%.2f)"
      % (len(files), tot_dark, filled_px, tot_light, thr))
