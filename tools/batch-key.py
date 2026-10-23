"""批量绿幕抠像：把一个目录里的帧全部抠成带 alpha 的 PNG。

算法（v7，2026-10-23：死区 + 内部洞填充）：
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
from PIL import Image, ImageDraw, ImageFilter

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

    # v7：加死区。旧公式 (0.14-dom)/0.14 在 dom=0.03 时就给 0.79，
    # 而黑缎/皮革的反光经常就是 dom 0.01~0.04（绿幕映上去的一点点绿），
    # 结果整片深色面料变成 0.8~0.95 的半透明 —— 叠在浅色页面上就是"高光透底"。
    # 绿幕本体 dom≈0.96，离 0.05 很远，死区不会把背景放进来。
    alpha = np.clip((0.12 - dom) / 0.07, 0.0, 1.0)
    alpha = alpha * alpha * (3.0 - 2.0 * alpha)

    # v7：内部洞填充。缎面高光/发丝反光被抠出的小洞只填「不与画面边界连通」的部分，
    # 边缘的抗锯齿半透明保持不动。
    # 在 1/4 分辨率上灌水：全分辨率约 1MP，PIL 的 floodfill 是逐像素 Python 循环，
    # 124 帧 × 12 条要跑几小时；1/4 分辨率下 0.2s/帧，洞本身是成片的，缩放不丢精度。
    sw, sh = max(1, w // 4), max(1, h // 4)
    small = Image.fromarray(((alpha < 0.5) * 255).astype(np.uint8), "L").resize((sw, sh), Image.BOX).copy()
    for xy in ((0, 0), (sw - 1, 0), (0, sh - 1), (sw - 1, sh - 1)):
        if small.getpixel(xy) == 255:
            ImageDraw.floodfill(small, xy, 128)
    holes_small = np.asarray(small) == 255
    holes = np.asarray(
        Image.fromarray((holes_small * 255).astype(np.uint8), "L").resize((w, h), Image.NEAREST)
    ) > 127
    if holes.any():
        alpha = np.where(holes, 1.0, alpha)
        lum = arr @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        for c in range(3):
            arr[..., c] = np.where(holes, arr[..., c] * 0.25 + lum * 0.75, arr[..., c])

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
