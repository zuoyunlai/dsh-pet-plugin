"""量一量「换编码格式能不能改善 alpha 边缘」——这是审计 O11 的结论依据。

两个模式：

  python tools/measure-alpha-loss.py resolution
      画一张 1px 交替的 alpha 测试图，编成 VP9 yuva420p 再解回来，
      看 alpha 是否仍能分辨 1px 条纹（验证 A 通道是不是全分辨率）。

  python tools/measure-alpha-loss.py crf <抠像关键帧目录>
      拿真实素材按 crf 28/30/34/38/42 各编一遍，报告 alpha 的平均绝对误差
      与文件体积（验证当前 crf38 还有没有画质余量）。

依赖环境变量 FFMPEG（或 ffmpeg 在 PATH 上）。

2026-10-22 结论（可复现）：
  · yuva420p 的 alpha 是**全分辨率**——4:2:0 只作用于色度。1px 条纹编解码后对比度仍 255/255。
  · libaom-av1 不接受 alpha：喂 yuva420p 会静默输出 yuv420p，解码后 alpha 全 255。
  · crf 28→42 的 alpha MAE 从 0.25 涨到 0.47（满量程 255），即 0.2%——编码器不是瓶颈，
    真正的软来自源视频像素与抠像算法。
"""
import os
import subprocess
import sys

import numpy as np
from PIL import Image

FF = os.environ.get('FFMPEG', 'ffmpeg')
TMP = os.environ.get('TEMP', '/tmp').replace('\\', '/') + '/measure-alpha'


def resolution_test():
    os.makedirs(TMP, exist_ok=True)
    w = h = 400
    rgb = np.zeros((h, w, 3), dtype=np.uint8)
    rgb[..., 0] = 200
    rgb[..., 1] = 30
    rgb[..., 2] = 30
    alpha = np.zeros((h, w), dtype=np.uint8)
    alpha[:, 0::2] = 255
    src = f'{TMP}/pattern.png'
    Image.fromarray(np.dstack([rgb, alpha[..., None]]), 'RGBA').save(src)

    webm = f'{TMP}/pattern.webm'
    subprocess.run([FF, '-y', '-v', 'error', '-i', src, '-c:v', 'libvpx-vp9',
                    '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '4',
                    '-auto-alt-ref', '0', '-an', webm], check=True)

    dec = f'{TMP}/pattern-dec.png'
    subprocess.run([FF, '-y', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', webm,
                    '-frames:v', '1', '-pix_fmt', 'rgba', dec], check=True)

    a = np.asarray(Image.open(dec).convert('RGBA'))[..., 3].astype(np.int16)
    odd, even = a[100:300, 0::2].mean(), a[100:300, 1::2].mean()
    print('alpha 奇列 %.1f / 偶列 %.1f / 对比度 %.1f' % (odd, even, odd - even))
    print('判定:', 'alpha 全分辨率' if (odd - even) > 120 else 'alpha 被降采样')


def crf_test(keyed_dir):
    os.makedirs(TMP, exist_ok=True)
    frames = sorted(f for f in os.listdir(keyed_dir) if f.endswith('.png'))[:24]
    if not frames:
        raise SystemExit('no png in ' + keyed_dir)
    for i, name in enumerate(frames):
        Image.open(os.path.join(keyed_dir, name)).save(f'{TMP}/in-{i:03d}.png')
    src = np.stack([
        np.asarray(Image.open(f'{TMP}/in-{i:03d}.png').convert('RGBA'))[..., 3]
        for i in range(len(frames))
    ]).astype(np.int16)

    print('%5s %10s %10s' % ('crf', 'size', 'alpha MAE'))
    for crf in (28, 30, 34, 38, 42):
        out = f'{TMP}/out-{crf}.webm'
        subprocess.run([FF, '-y', '-v', 'error', '-framerate', '24', '-i', f'{TMP}/in-%03d.png',
                        '-vf', 'unsharp=5:5:0.4:5:5:0', '-c:v', 'libvpx-vp9',
                        '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', str(crf),
                        '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-an', out], check=True)
        d = f'{TMP}/dec-{crf}'
        os.makedirs(d, exist_ok=True)
        subprocess.run([FF, '-y', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', out,
                        '-pix_fmt', 'rgba', f'{d}/f-%03d.png'], check=True)
        dec = np.stack([
            np.asarray(Image.open(os.path.join(d, f)).convert('RGBA'))[..., 3]
            for f in sorted(os.listdir(d))[:len(frames)]
        ]).astype(np.int16)
        n = min(len(src), len(dec))
        mae = np.abs(src[:n] - dec[:n]).mean()
        print('%5d %8.0f KB %10.2f' % (crf, os.path.getsize(out) / 1024, mae))


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'resolution'
    if mode == 'resolution':
        resolution_test()
    elif mode == 'crf':
        crf_test(sys.argv[2])
    else:
        raise SystemExit('usage: measure-alpha-loss.py [resolution|crf <dir>]')
