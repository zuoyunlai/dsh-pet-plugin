import os
import subprocess

import numpy as np
from PIL import Image

FF = os.environ['FFMPEG']
T = os.environ['TEMP'].replace('\\', '/')
ROOT = 'E:/Documents/deepseek-harness/default-workspace/dsh-pet'

def edge_width(png):
    im = np.asarray(Image.open(png).convert('RGBA'))
    a = im[..., 3].astype(np.float32) / 255.0
    h, w = a.shape
    widths = []
    for y in range(0, h, 3):
        row = a[y]
        inside = row > 0.02
        if not inside.any():
            continue
        # 找每一段内容（连续的 inside），量它的左右两侧过渡带：从 <=0.02 升到 >=0.95 的像素数
        idx = np.nonzero(inside)[0]
        # 只看该行最外侧两段（手臂边缘）
        for side in (idx.min(), idx.max()):
            lo = max(0, side - 6)
            hi = min(w, side + 7)
            seg = row[lo:hi]
            if seg.size < 3:
                continue
            if seg.max() < 0.9:
                continue
            # 计算 0.02 → 0.9 之间经过的像素数
            n = int(((seg > 0.02) & (seg < 0.9)).sum())
            widths.append(n)
    return float(np.mean(widths)) if widths else float('nan')

rows = []
for label, path in [
    ('768P -> 400px', f'{ROOT}/assets/pet-violet-dance.webm'),
    ('2K   -> 400px', f'{T}/violet-dance-2k-400.webm'),
]:
    png = f'{T}/edge-{label[:4].strip()}.png'
    subprocess.run([FF, '-y', '-v', 'error', '-c:v', 'libvpx-vp9', '-ss', '2.4',
                    '-i', path, '-frames:v', '1', '-pix_fmt', 'rgba', png], check=True)
    ew = edge_width(png)
    rows.append((label, ew, os.path.getsize(path) / 1024))
    print('%-14s 边缘过渡带 %.2f px   体积 %.0f KB' % (label, ew, os.path.getsize(path) / 1024))

print()
print('过渡带越窄 = 边缘越实。差值 <0.3px 基本属于肉眼无感。')
