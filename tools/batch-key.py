"""批量绿幕抠像：把一个目录里的帧全部抠成带 alpha 的 PNG。

和 tools/make-pet-image.py 同一套判定（角落法判绿幕 + 绿通道领先算 alpha + despill），
但整批在同一个进程里跑，124 帧几秒钟就完。
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

written = 0
sizes = []
for f in files:
    im = Image.open(f).convert("RGB")
    w, h = im.size
    arr = np.asarray(im).astype(np.float32) / 255.0

    corners = [
        patch_green(arr, 0, 0),
        patch_green(arr, 0, max(0, w - 48)),
        patch_green(arr, max(0, h - 48), 0),
        patch_green(arr, max(0, h - 48), max(0, w - 48)),
    ]
    if max(corners) <= 0.6:
        print("skip (not green):", os.path.basename(f))
        continue

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
    if bbox:
        rgba = rgba.crop(bbox)

    scale = target_h / rgba.height
    if abs(scale - 1.0) > 0.001:
        rgba = rgba.resize((max(1, int(round(rgba.width * scale))), target_h), Image.LANCZOS)

    name = os.path.splitext(os.path.basename(f))[0] + ".png"
    rgba.save(os.path.join(out_dir, name))
    written += 1
    sizes.append(rgba.size)

print("keyed %d frames -> %s" % (written, out_dir))
print("size range: %dx%d .. %dx%d" % (
    min(s[0] for s in sizes), min(s[1] for s in sizes),
    max(s[0] for s in sizes), max(s[1] for s in sizes)))
