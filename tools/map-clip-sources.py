"""建立「现有片段 → 源视频 job」的映射表。

方法：用剪影 IoU 匹配（颜色分不出 walk/hair/dance，同角色的剪影/姿态能分）。
  - 源视频：抠像后取第 0 帧的人像剪影，裁到 bbox、缩到 64x64
  - 现有片段：取第 0 帧的 alpha 剪影，同样裁剪归一化
  - 逐对算 IoU，取最大者

产出 tools/clip-sources.json（人像管线可复用，以后重出素材不用再猜源）。
"""
import os, sys, json, glob, subprocess, tempfile
import numpy as np, cv2
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # 仓库根（本脚本在 tools/ 下）
JOBS = r"C:/Users/Zuoyunlai/.dsh/game-material-master/sequence-jobs"
N = 64

# 复用 batch-key 的 key_frame
src_code = open(os.path.join(ROOT, "tools", "batch-key.py"), encoding="utf-8").read()
head = src_code.split("# 第一遍")[0]
ns = {}
ti = tempfile.mkdtemp(); to = tempfile.mkdtemp()
Image.new("RGB", (1, 1), (0, 255, 0)).save(os.path.join(ti, "dummy.png"))
saved = sys.argv
sys.argv = ["batch-key.py", ti, to, "400"]
try:
    exec(compile(head, "bk", "exec"), ns)
finally:
    sys.argv = saved
key_frame = ns["key_frame"]

def norm_mask(mask):
    """二值掩码 → 裁 bbox → 缩到 NxN"""
    ys, xs = np.where(mask > 0)
    if not len(ys):
        return None
    sub = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    img = Image.fromarray((sub > 0).astype(np.uint8) * 255)
    img = img.resize((N, N), Image.BILINEAR)
    return np.asarray(img) > 127

def iou(a, b):
    if a is None or b is None:
        return 0.0
    inter = (a & b).sum()
    union = (a | b).sum()
    return float(inter) / max(1, union)

def frame_mask_from_png(p):
    rgba, _ = key_frame(p)
    if rgba is None:
        return None
    return norm_mask(np.asarray(rgba)[..., 3])

def frame_mask_from_webm(webm, fr=0):
    tmp = tempfile.mkdtemp()
    p = os.path.join(tmp, "f.png")
    subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-c:v", "libvpx-vp9", "-i", webm,
                    "-vf", "select=eq(n\\,%d)" % fr, "-frames:v", "1", p], check=True)
    a = np.asarray(Image.open(p).convert("RGBA"))[..., 3]
    return norm_mask(a)

# ---- 1) 所有候选源的多帧剪影 ----
print("=== 候选源（%d 个）" % len(glob.glob(os.path.join(JOBS, "*"))))
FR = [0, 15, 30, 45, 60, 75, 90, 105]
cands = []
for d in sorted(glob.glob(os.path.join(JOBS, "*"))):
    v = os.path.join(d, "videos", "output.mp4")
    if not os.path.isfile(v):
        continue
    info = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                           "-show_entries", "stream=width,height,nb_frames", "-of", "csv=p=0", v],
                          capture_output=True, text=True).stdout.strip().split(",")
    if len(info) < 3:
        continue
    tmp = tempfile.mkdtemp()
    masks = []
    for fr in FR:
        p = os.path.join(tmp, "f%d.png" % fr)
        subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", v,
                        "-vf", "select=eq(n\\,%d)" % fr, "-frames:v", "1", p], check=True)
        m = frame_mask_from_png(p)
        if m is not None:
            masks.append(m)
    cands.append({"job": os.path.basename(d), "wh": "%sx%s" % (info[0], info[1]),
                  "frames": int(info[2]), "masks": masks})
print("  已取剪影 %d 个" % len(cands))

# ---- 2) 现有 20 个片段的多帧剪影 ----
print("\n=== 匹配现有片段")
mapping = {}
for pid in ["violet", "crimson", "indigo", "silver", "azure"]:
    pack = json.load(open(os.path.join(ROOT, "pets", pid, "pack.json"), encoding="utf-8"))
    for action, file in (pack.get("clips") or {}).items():
        webm = os.path.join(ROOT, "assets", file)
        if not os.path.exists(webm):
            continue
        # 现有片段的帧数（决定它对应几帧的源）
        nf = int(subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
                                  "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", webm],
                                 capture_output=True, text=True).stdout.strip() or 0)
        # 只跟帧数相近的候选比：124 帧的片段（dance/walk/hair）不能匹配 243 帧的 stage 源
        pool = [c for c in cands if abs(c["frames"] - nf) <= 2]
        if not pool:
            pool = cands
        mine = []
        for fr in FR:
            if fr >= nf:
                break
            m = frame_mask_from_webm(webm, fr)
            if m is not None:
                mine.append(m)
        scores = []
        for c in pool:
            pairs = list(zip(mine, c["masks"]))[:len(mine)]
            if not pairs:
                continue
            sc = sum(iou(a, b) for a, b in pairs) / len(pairs)
            scores.append((sc, c))
        scores.sort(key=lambda t: -t[0])
        best = scores[0]
        key = "%s/%s" % (pid, action)
        mapping[key] = {"job": best[1]["job"], "iou": round(best[0], 3),
                        "src": best[1]["wh"], "src_frames": best[1]["frames"],
                        "runner_up": [(c["job"], round(v, 3)) for v, c in scores[1:3]]}
        print("  %-18s → %-18s IoU %.3f  (次选 %s)" % (
            key, best[1]["job"], best[0],
            ", ".join("%s:%.3f" % (c["job"], v) for v, c in scores[1:3])))

out = os.path.join(ROOT, "tools", "clip-sources.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(mapping, f, indent=2, ensure_ascii=False)
print("\n写入", out)
