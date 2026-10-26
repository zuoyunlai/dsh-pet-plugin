#!/usr/bin/env python3
"""把「走进来→跳舞→走回去」的单镜头片段在水平方向钉死在原地。

为什么需要：视频模型不能保证人物横向位置稳定（同一段里会先右移、再回退、
跳舞时又继续漂移）。插件在播放这条片段时自己按相位做平移，如果片段内部
同时在漂，两者叠加就会看到「走两步退一步」。

做法：逐帧测出脚部锚点的 x，然后把整帧水平平移，让锚点固定在一个位置；
画布两侧按最大位移留出透明边，所以不会有内容被裁掉。垂直方向不动 ——
呼吸起伏、踏步的上下浮动是表演的一部分。

用法：
    python tools/stage-stabilize.py <keyed_dir> <out_dir> [--anchor bottom|cx]

输入是 batch-key.py 输出的 RGBA PNG 序列（0000.png ...），输出同样命名。
"""
import glob
import os
import sys

import numpy as np
from PIL import Image


def anchor_x(rgba, mode):
    a = rgba[..., 3].astype(np.float32) / 255.0
    m = a > 0.5
    if not m.any():
        return None
    ys, xs = np.where(m)
    if mode == "cx":
        return float(xs.mean())
    # 脚部：取最底部 4% 高度内的像素（芭蕾/跳跃时脚会离地，用底边带更稳）
    band = ys.max() - max(3, int((ys.max() - ys.min()) * 0.04))
    sel = ys >= band
    return float(xs[sel].mean())


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    src, dst = sys.argv[1], sys.argv[2]
    mode = "bottom"
    if "--anchor" in sys.argv:
        mode = sys.argv[sys.argv.index("--anchor") + 1]
    files = sorted(glob.glob(os.path.join(src, "*.png")))
    if not files:
        sys.exit("no frames in " + src)
    os.makedirs(dst, exist_ok=True)

    anchors = []
    for f in files:
        im = Image.open(f).convert("RGBA")
        anchors.append(anchor_x(np.asarray(im), mode))
    valid = [a for a in anchors if a is not None]
    if not valid:
        sys.exit("empty frames")
    target = float(np.median(valid))
    shifts = [0.0 if a is None else target - a for a in anchors]
    pad = int(np.ceil(max(abs(s) for s in shifts))) + 2

    w, h = Image.open(files[0]).size
    for f, dx in zip(files, shifts):
        im = Image.open(f).convert("RGBA")
        canvas = Image.new("RGBA", (w + 2 * pad, h), (0, 0, 0, 0))
        canvas.paste(im, (int(round(pad + dx)), 0), im)
        canvas.save(os.path.join(dst, os.path.basename(f)))

    lo, hi = min(shifts), max(shifts)
    print(
        "stabilized %d frames -> %dx%d (pad %d)  anchor target x=%.1f  shift range %.1f..%.1f"
        % (len(files), w + 2 * pad, h, pad, target, lo, hi)
    )


if __name__ == "__main__":
    main()
