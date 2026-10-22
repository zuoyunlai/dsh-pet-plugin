"""批量绿幕抠像：把一个目录里的帧全部抠成带 alpha 的 PNG。

算法（v5，2026-10-22 定稿）：
- alpha：绿通道相对红蓝的领先量 → 窄过渡带 → smoothstep（边缘顺、细结构不断）
- despill：绿比红蓝都高时压回 max(r,b) —— 只做这一次；
  **不要**去掉它、也**不要**用「绿底反预乘」代替：反预乘会把低 alpha 像素算亮，
  指尖会泛黄绿（v3/v4 实测翻车）
- 羽化：GaussianBlur(0.55)，**不用 MinFilter 腐蚀**——3×3 最小值会啃掉 1px 手指
- 所有帧用同一个裁切框、同一个缩放比例（逐帧按内容裁剪会让编码器强行拉伸，见 1.16.1）

用法：python batch-key.py <输入目录> <输出目录> [目标高度]
"""
import glob
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

src_dir = sys.argv[1]
out_dir = sys.argv[2]
target_h = int(sys.argv[3]) if len(sys.argv) > 3 else 640

os.makedirs(out_dir, exist_ok=True)
files = sorted(glob.glob(os.path.join(src_dir, "*.png")))
if not files:
    raise SystemExit("no frames in " + src_dir)


def patch_green(arr, y, x, size=48):
    p = arr[y:y + size, x:x + size].reshape(-1, 3)
    return float(((p[:, 1] > 0.55) & (p[:, 1] - np.maximum(p[:, 0], p[:, 2]) > 0.3)).mean())


def key_frame(path):
    """只做抠像，不裁不缩；返回 (RGBA, 内容 bbox)。"""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    arr = np.asarray(im).astype(np.float32) / 255.0

    corners = [
        patch_green(arr, 0, 0),
        patch_green(arr, 0, max(0, w - 48)),
        patch_green(arr, max(0, h - 48), 0),
        patch_green(arr, max(0, h - 48), max(0, w - 48)),
    ]
    if max(corners) <= 0.6:
        return None, None

    g = arr[..., 1]
    mg = np.maximum(arr[..., 0], arr[..., 2])
    dom = g - mg

    alpha = np.clip((0.14 - dom) / 0.14, 0.0, 1.0)
    alpha = alpha * alpha * (3.0 - 2.0 * alpha)

    spill = g > mg + 0.01
    arr[..., 1] = np.where(spill, mg, g)

    a_img = Image.fromarray((alpha * 255).astype(np.uint8), "L")
    a_img = a_img.filter(ImageFilter.GaussianBlur(0.55))
    alpha = np.asarray(a_img).astype(np.float32) / 255.0

    rgba = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8), "RGB")
    rgba.putalpha(Image.fromarray((alpha * 255).astype(np.uint8), "L"))
    bbox = rgba.split()[-1].point(lambda v: 255 if v > 8 else 0).getbbox()
    return rgba, bbox


# 第一遍：抠像 + 求全片内容并集（同一裁切框，帧间相对位移才保得住）
keyed = []
union = None
for f in files:
    img, bbox = key_frame(f)
    if img is None:
        print("skip (not green):", os.path.basename(f))
        continue
    keyed.append((f, img))
    if bbox:
        union = bbox if union is None else (
            min(union[0], bbox[0]), min(union[1], bbox[1]),
            max(union[2], bbox[2]), max(union[3], bbox[3]),
        )

if not keyed or union is None:
    raise SystemExit("nothing keyed")

pad = 6
w0, h0 = Image.open(files[0]).size
l = max(0, union[0] - pad)
t = max(0, union[1] - pad)
r = min(w0, union[2] + pad)
b = min(h0, union[3] + pad)
scale = target_h / (b - t)
out_w = max(1, int(round((r - l) * scale)))

for f, img in keyed:
    c = img.crop((l, t, r, b)).resize((out_w, target_h), Image.LANCZOS)
    c.save(os.path.join(out_dir, os.path.splitext(os.path.basename(f))[0] + ".png"))

print("keyed %d frames -> %dx%d（裁切框 %dx%d @ (%d,%d)）" % (
    len(keyed), out_w, target_h, r - l, b - t, l, t))
