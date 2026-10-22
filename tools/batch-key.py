"""批量绿幕抠像：把一个目录里的帧全部抠成带 alpha 的 PNG。

和 tools/make-pet-image.py 同一套判定（角落法判绿幕 + 绿通道领先算 alpha + despill）。

**关键**：所有帧必须用同一个裁切框、同一个缩放比例输出。
逐帧按内容裁剪会让每帧尺寸不同，编码器会把它们强行缩放到第一帧的尺寸，
手臂张开的那几帧就被横向压扁（1.16.0 的真实翻车点：帧宽 244~434，画布 254）。

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
    alpha = np.clip(1.0 - (dom - 0.02) / 0.12, 0.0, 1.0)
    spill = g > mg + 0.01
    arr[..., 1] = np.where(spill, mg, g)

    a = Image.fromarray((alpha * 255).astype(np.uint8), "L")
    a = a.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))

    rgba = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8), "RGB")
    rgba.putalpha(a)
    bbox = rgba.split()[-1].point(lambda v: 255 if v > 8 else 0).getbbox()
    return rgba, bbox


# 第一遍：抠像 + 求全片内容并集，得到一个固定裁切框
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

crop_w = r - l
crop_h = b - t
scale = target_h / crop_h
out_w = max(1, int(round(crop_w * scale)))

for f, img in keyed:
    canvas = img.crop((l, t, r, b))
    canvas = canvas.resize((out_w, target_h), Image.LANCZOS)
    canvas.save(os.path.join(out_dir, os.path.splitext(os.path.basename(f))[0] + ".png"))

print("keyed %d frames -> %s" % (len(keyed), out_dir))
print("裁切框 %dx%d @ (%d,%d) · 统一缩放 x%.3f -> 每帧 %dx%d" % (crop_w, crop_h, l, t, scale, out_w, target_h))
