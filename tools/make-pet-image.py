"""角色立绘 -> 桌宠贴图（去水印 / 抠背景 / 裁边 / 缩放）。

两条路子，自动选：

1. 绿幕（推荐）：整张图背景是纯绿 #00FF00 时，按「绿通道领先红蓝」算 alpha，
   再把边缘的绿色溢出压回去（despill）。皮肤和背景再像也不会互相吃掉。
2. 渐变背景（老图）：按每一行的左右边缘色取背景基准比色差 + 只保留与底部相连的
   主体。这路上「亮 + 低饱和」分不开皮肤和浅色背景，只作兜底。

用法：python make-pet-image.py <输入> <输出.png>
"""
import os
import sys
from PIL import Image, ImageFilter
import numpy as np

src = sys.argv[1]
out = sys.argv[2]

im = Image.open(src).convert('RGB')
w, h = im.size
arr = np.asarray(im).astype(np.float32) / 255.0

# 右下角水印：只对浅色背景那批有意义，绿幕批会把这一步结果冲掉
y0, x0 = int(h * 0.90), int(w * 0.78)
w_region = arr[y0:, x0:]
if w_region.size and w_region[..., 1].mean() < 0.6:
    arr[y0:, x0:] = np.array([0.98, 0.94, 0.95])

border = np.concatenate(
    [
        arr[:24].reshape(-1, 3),
        arr[-24:].reshape(-1, 3),
        arr[:, :24].reshape(-1, 3),
        arr[:, -24:].reshape(-1, 3),
    ]
).mean(axis=0)
is_green = border[1] > 0.55 and border[1] - max(border[0], border[2]) > 0.3

if is_green:
    g = arr[..., 1]
    mg = np.maximum(arr[..., 0], arr[..., 2])
    dom = g - mg
    alpha = np.clip(1.0 - (dom - 0.02) / 0.12, 0.0, 1.0)
    # despill：绿比红蓝都高的像素，把绿压回红蓝的较大值
    spill = g > mg + 0.01
    arr[..., 1] = np.where(spill, mg, g)
    print('mode: chroma green')
else:
    edge = np.concatenate([arr[:, :10, :], arr[:, -10:, :]], axis=1)
    bgrow = edge.mean(axis=1)
    dist = np.sqrt(((arr - bgrow[:, None, :]) ** 2).sum(axis=2))
    alpha = np.where(dist < 0.075, 0.0, 1.0).astype(np.float32)
    print('mode: gradient')

# 收缩 1px + 羽化：去掉 JPEG 边缘那圈光晕
a = Image.fromarray((alpha * 255).astype(np.uint8), 'L')
a = a.filter(ImageFilter.MinFilter(3))
a = a.filter(ImageFilter.GaussianBlur(0.8))
alpha = np.asarray(a).astype(np.float32) / 255.0

# 只保留与底部相连的主体（脚一定在最下面），丢掉碎片
keep = alpha > 0.5
lab = np.zeros((h, w), dtype=np.int32)
cur = 0
sizes = {}
for sy, sx in zip(*np.nonzero(keep)):
    if lab[sy, sx]:
        continue
    cur += 1
    stack = [(sy, sx)]
    lab[sy, sx] = cur
    n = 0
    while stack:
        y, x = stack.pop()
        n += 1
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and keep[ny, nx] and not lab[ny, nx]:
                lab[ny, nx] = cur
                stack.append((ny, nx))
    sizes[cur] = n
if sizes:
    body = set(int(v) for v in np.unique(lab[int(h * 0.9):, :]) if v)
    drop = [k for k in sizes if k not in body]
    if drop:
        alpha[np.isin(lab, drop)] = 0.0
        print('dropped specks:', len(drop))

rgba = np.dstack([np.clip(arr, 0, 1), alpha])
img = Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), 'RGBA')

bbox = a.getbbox()
if bbox:
    img = img.crop(bbox)

target_h = int(os.environ.get('PET_H', '640'))
ratio = target_h / img.height
img = img.resize((max(1, int(img.width * ratio)), target_h), Image.LANCZOS)
img.save(out, 'PNG', optimize=True)
print('saved', out, img.size)
