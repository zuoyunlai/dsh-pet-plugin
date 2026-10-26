import os
import subprocess

from PIL import Image, ImageDraw

FF = os.environ['FFMPEG']
T = os.environ['TEMP'].replace('\\', '/')
ROOT = 'E:/Documents/deepseek-harness/default-workspace/dsh-pet'

pairs = [
    (f'{ROOT}/assets/pet-violet-dance.webm', '768P source -> 400px (current)'),
    (f'{T}/violet-dance-2k-400.webm', '2K source -> 400px (new)'),
]

# 同一时刻各抽一帧
frames = []
for i, (path, label) in enumerate(pairs):
    out = f'{T}/cmp-frame-{i}.png'
    subprocess.run([FF, '-y', '-v', 'error', '-c:v', 'libvpx-vp9', '-ss', '2.4',
                    '-i', path, '-frames:v', '1', '-pix_fmt', 'rgba', out], check=True)
    frames.append((out, label))


def checker(size, cell=8):
    o = Image.new('RGB', size, (55, 55, 58))
    px = o.load()
    for y in range(size[1]):
        for x in range(size[0]):
            if ((x // cell) + (y // cell)) % 2 == 0:
                px[x, y] = (105, 105, 108)
    return o


tiles = []
for path, label in frames:
    im = Image.open(path).convert('RGBA')
    # 1) 真实显示尺寸 200px 高
    h = 200
    w = int(im.width * h / im.height)
    small = im.resize((w, h), Image.LANCZOS)
    b = checker((w, h)).convert('RGBA')
    b.alpha_composite(small)
    tiles.append((b.convert('RGB').resize((w * 3, h * 3), Image.NEAREST), label + ' @200px x3'))

sheet = Image.new('RGB', (sum(t.width for t, _ in tiles) + 30, tiles[0][0].height + 40), (25, 25, 28))
d = ImageDraw.Draw(sheet)
x = 10
for t, label in tiles:
    sheet.paste(t, (x, 30))
    d.text((x, 8), label, fill=(215, 230, 255))
    x += t.width + 10
sheet.save(f'{ROOT}/preview-2k-vs-768p.png')

# 2) 头部 1:1 裁切（看发丝/指尖细节）
crops = []
for path, label in frames:
    im = Image.open(path).convert('RGBA')
    a = im.split()[-1]
    bbox = a.point(lambda v: 255 if v > 30 else 0).getbbox()
    # 取头部：内容顶部往下 1/4
    x0, y0 = bbox[0], bbox[1]
    cw = min(90, bbox[2] - x0)
    ch = min(110, bbox[3] - y0)
    c = im.crop((x0, y0, x0 + cw, y0 + ch))
    base = checker((cw, ch), cell=6).convert('RGBA')
    base.alpha_composite(c)
    crops.append((base.convert('RGB').resize((cw * 4, ch * 4), Image.NEAREST), label))

sheet2 = Image.new('RGB', (sum(c.width for c, _ in crops) + 30, crops[0][0].height + 40), (25, 25, 28))
d2 = ImageDraw.Draw(sheet2)
x = 10
for t, label in crops:
    sheet2.paste(t, (x, 30))
    d2.text((x, 8), label + ' 1:1 x4 (head)', fill=(215, 230, 255))
    x += t.width + 10
sheet2.save(f'{ROOT}/preview-2k-detail.png')
print('ok', sheet.size, sheet2.size)
