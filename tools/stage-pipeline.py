#!/usr/bin/env python3
"""一条「走进来 → 中间跳舞 → 走回去」的单镜头片段 → 可用的桌面宠物 alpha 片段。

固定四步（和 1.20.0 里手工跑的顺序一致，这里固化下来免得每次手敲）：

  1. 量主体：从绿幕母版里量出人物的竖向范围（决定裁切高度，保证输出身高一致）
  2. 抠像：tools/batch-key.py（v9：死区 + 暗部保护，无洞填充）
  3. 钉轨迹：tools/stage-stabilize.py（逐帧按脚部锚点反打平移，消掉模型自己的横向漂移）
  4. 编码：libvpx-vp9 + alpha，参数与其余片段一致

用法：
    python tools/stage-pipeline.py <母版.mp4> <输出.webm> [--out-h 640] [--subject-h 583] [--crf 38]

`--subject-h` 是「人物在成片里占多少像素高」，默认 583（与既有 12 条片段一致，
切换时不会突然变大变小）。`--crf` 1.25.0 起可调：960 高的重出用 42——
母版单代 + 3.9× 过采样，42 的观感仍远好于旧的两代 640。
"""
import glob
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        sys.stderr.write(r.stdout + r.stderr)
        raise SystemExit("failed: " + " ".join(cmd[:3]))
    return r.stdout


def subject_box(mp4, step=12):
    """用绿幕掩膜量主体的竖向范围（每隔 step 帧采一次，取全片并集）。"""
    tmp = tempfile.mkdtemp(prefix="stage-box-")
    run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", mp4, "-vf", "fps=2", os.path.join(tmp, "%04d.png")])
    top, bot = 10**9, -1
    for f in sorted(glob.glob(os.path.join(tmp, "*.png"))):
        a = np.asarray(Image.open(f).convert("RGB")).astype(np.int16)
        g = a[..., 1] - np.maximum(a[..., 0], a[..., 2])
        ys = np.where((g < 80).any(axis=1))[0]
        if len(ys):
            top = min(top, int(ys.min()))
            bot = max(bot, int(ys.max()))
    shutil.rmtree(tmp, ignore_errors=True)
    return top, bot


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    src, out = sys.argv[1], sys.argv[2]
    out_h = int(sys.argv[sys.argv.index("--out-h") + 1]) if "--out-h" in sys.argv else 640
    subj_h = int(sys.argv[sys.argv.index("--subject-h") + 1]) if "--subject-h" in sys.argv else 583
    crf = sys.argv[sys.argv.index("--crf") + 1] if "--crf" in sys.argv else "38"

    probe = run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=height", "-of", "csv=p=0", src,
        ]
    ).strip()
    src_h = int(probe.split(",")[0])

    top, bot = subject_box(src)
    span = bot - top
    crop_h = int(round(span * out_h / subj_h))
    if crop_h > src_h:
        # 抬手/跃起的片段全片并集会顶满画幅：这时退回全画幅，人物自然大一点，
        # 不要为了凑目标身高把画布撑破（会裁掉手或脚）。
        print("span %d 太高（crop_h %d > %d），退回全画幅" % (span, crop_h, src_h))
        crop_h = src_h
    t = max(0, top - (crop_h - span) // 2)
    if t + crop_h > src_h:
        t = src_h - crop_h
    print("subject y[%d,%d] span=%d -> crop_h=%d t=%d" % (top, bot, span, crop_h, t))

    work = tempfile.mkdtemp(prefix="stage-clip-")
    frames, keyed, stable = (os.path.join(work, d) for d in ("frames", "keyed", "stable"))
    for d in (frames, keyed, stable):
        os.makedirs(d)

    run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", src, "-vf", "fps=24", os.path.join(frames, "%04d.png")])
    run([sys.executable, os.path.join(HERE, "batch-key.py"), frames, keyed, str(out_h),
         "--crop", "0,%d,1440,%d" % (t, t + crop_h)])
    run([sys.executable, os.path.join(HERE, "stage-stabilize.py"), keyed, stable])

    # 钉完之后按内容边界再横向收一刀，免得画布两侧全是透明边
    files = sorted(glob.glob(os.path.join(stable, "*.png")))
    lo, hi = 10**9, -1
    for f in files:
        xs = np.where((np.asarray(Image.open(f))[..., 3] > 10).any(axis=0))[0]
        if len(xs):
            lo, hi = min(lo, int(xs.min())), max(hi, int(xs.max()))
    mid = (lo + hi) // 2
    half = max(mid - lo, hi - mid) + 8
    w, h = Image.open(files[0]).size
    l, r = max(0, mid - half), min(w, mid + half)

    run([
        "ffmpeg", "-nostdin", "-y", "-v", "error", "-framerate", "24", "-start_number", "0",
        "-i", os.path.join(stable, "%04d.png"),
        "-vf", "crop=%d:%d:%d:0,unsharp=5:5:0.4:5:5:0" % (r - l, h, l),
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", crf,
        "-cpu-used", "0", "-auto-alt-ref", "0", "-lag-in-frames", "0",
        "-row-mt", "1", "-tile-columns", "2", "-threads", "8",
        "-aq-mode", "2", "-sharpness", "3", out,
    ])
    shutil.rmtree(work, ignore_errors=True)
    print("%s  %dx%d  %d bytes" % (out, r - l, h, os.path.getsize(out)))


if __name__ == "__main__":
    main()
