from PIL import Image

W, H = 768, 1344
jobs = []
for pid in ['violet', 'crimson', 'indigo', 'silver']:
    for act, frame in [('walk', 'walk1'), ('hair', 'hair1')]:
        jobs.append((pid, act, f'assets/pet-{pid}-{frame}.webp'))

for pid, act, src_path in jobs:
    src = Image.open(src_path).convert('RGBA')
    canvas = Image.new('RGB', (W, H), (0, 255, 0))
    target_h = int(H * 0.80)
    scale = target_h / src.height
    w = int(src.width * scale)
    body = src.resize((w, target_h), Image.LANCZOS)
    x = (W - w) // 2
    y = H - target_h - int(H * 0.10)
    canvas.paste(body, (x, y), body)
    out = f'C:/Users/Zuoyunlai/AppData/Local/Temp/{pid}-{act}-first.png'
    canvas.save(out)
    print(pid, act, '->', out)
