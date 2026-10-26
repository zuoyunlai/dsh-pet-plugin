"""批量绿幕抠像：把一个目录里的帧全部抠成带 alpha 的 PNG。

算法（v9，2026-10-23：死区 + 暗部保护，不做洞填充）：
- alpha：绿通道相对红蓝的领先量 → 窄过渡带 → smoothstep（边缘顺、细结构不断）
- despill：绿比红蓝都高时压回 max(r,b) —— 只做这一次；
  **不要**去掉它、也**不要**用「绿底反预乘」代替：反预乘会把低 alpha 像素算亮，
  指尖会泛黄绿（v3/v4 实测翻车）
- 羽化：GaussianBlur(0.55)，**不用 MinFilter 腐蚀**——3×3 最小值会啃掉 1px 手指
- 所有帧用同一个裁切框、同一个缩放比例（逐帧按内容裁剪会让编码器强行拉伸，见 1.16.1）

用法：python batch-key.py <输入目录> <输出目录> [目标高度] [--crop l,t,r,b]

`--crop` 给一个固定裁切框（源像素坐标）时不再自动求并集。同一个人物的多条片段
（walk / dance / hair）必须传同一个框：各自自动裁会让画幅、缩放比例都不同，
插件在片段之间切换时人物会突然平移或变大 —— 看起来就是"抖了一下"。
"""
import glob
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

argv = sys.argv[1:]
force_crop = None
if "--crop" in argv:
    i = argv.index("--crop")
    force_crop = tuple(int(v) for v in argv[i + 1].split(","))
    del argv[i:i + 2]
if len(argv) < 2:
    raise SystemExit("用法：batch-key.py <输入目录> <输出目录> [目标高度] [--crop l,t,r,b]")

src_dir = argv[0]
out_dir = argv[1]
target_h = int(argv[2]) if len(argv) > 2 else 640

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

    # v9：暗部保护。黑缎的高光是**绿幕反射**——绿光强、红蓝被压暗，
    # 胸口那道反光带的像素是 (r,g,b)≈(15,37,10)、luma≈0.12、dom≈0.087，
    # 正好落在 (0.05,0.12) 这段最陡的过渡带上 → alpha 被判成 0.06~0.72，
    # 白底就从反光里透了出来（用户报「绯跳舞时胸部下方有透底」）。
    #
    # 用**亮度**这条独立信号救回来，而不是继续放宽 dom 阈值（那会伤到真绿边）。
    # 阈值按**本帧四角实测的绿幕亮度**归一化：各角色绿幕亮度差很多
    # （薇 0.32、绯 0.69），写死会一头过一头不够。
    #
    # 形状要选对：不能是线性 ramp。黑缎高光的像素是 (r,g,b)=(0,22,0)、
    # luma=0.062，用 1-luma/0.347 只得到 0.82，仍是半透明 —— 白底照样透出来。
    # 判据必须是「明显暗于绿幕 ⇒ 主体」，给满值；只有靠近阈值的一小段才渐变。
    luma = arr @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    g_luma = float(np.mean([luma[:12, :12].mean(), luma[:12, -12:].mean(),
                            luma[-12:, :12].mean(), luma[-12:, -12:].mean()]))
    t_dark = max(0.2, g_luma * 0.5)          # 绿幕的一半
    t_full = max(0.12, g_luma * 0.35)        # 到这里就判满（离绿幕够远）
    dark = 1.0 - np.clip((luma - t_full) / max(1e-6, t_dark - t_full), 0.0, 1.0)
    alpha = np.maximum(alpha, dark)

    # v8：**不做内部洞填充**（v7 的回归已移除）。
    #
    # 背景：v7 为修「高光透底」加了「填掉封闭的小洞」。但跳舞时手臂张开，
    # 手臂与身体之间的镂空在 1/4 分辨率灌水时被判成「与边界不连通的封闭区域」，
    # 整块镂空被填上颜色 —— 用户报「镂空处有紫色填充，四个角色都有，程度不同」
    # （跳舞视频独有，静止立绘不走这条管线，所以立绘正常）。
    #
    # 为什么能直接去掉：亮部半透明的实测对照（12 个采样帧，有/无填充）只差
    # 0~0.4 个百分点；真正解决高光透底的是上面那条**死区**公式，不是洞填充。
    # 少一层猜测 = 少一类回归。

    spill = g > mg + 0.01
    arr[..., 1] = np.where(spill, mg, g)

    a_img = Image.fromarray((alpha * 255).astype(np.uint8), "L")
    a_img = a_img.filter(ImageFilter.GaussianBlur(0.55))
    alpha = np.asarray(a_img).astype(np.float32) / 255.0
    # v9 补刀：羽化会把高光带形状外圈的像素稀释成半透明（实测该区域
    # 3.3% → 4.7%），所以 blur 之后再 clamp 一次。luma 在 blur 里没参与运算，
    # 直接复用上面算好的 dark 即可，不影响边缘抗锯齿（那里 alpha 本来就低）。
    alpha = np.maximum(alpha, dark)

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
if force_crop:
    l, t, r, b = force_crop
    assert 0 <= l < r <= w0 and 0 <= t < b <= h0, "crop 越界：%r vs %dx%d" % (force_crop, w0, h0)
else:
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
