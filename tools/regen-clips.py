"""按 tools/clip-sources.json 的映射，用线性透射率 alpha 重出全部 20 个片段。

关键：保持每个片段**现有的目标高度**（读现网素材的实际高度），
这样人物在画布里的相对比例不变，只有 alpha 语义变了 —— 画面观感不会突变。

流程（dance/walk/hair）：抽帧 → 抠像 → 补深色空洞(+颜色重建) → 编码
流程（stage）：走 stage-pipeline.py（多一步稳定化 + 横向收边）

用法: python tools/regen-clips.py [--only silver] [--dry]
"""
import os, sys, json, subprocess, tempfile, shutil
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOBS = r"C:/Users/Zuoyunlai/.dsh/game-material-master/sequence-jobs"
OUT_DIR = os.path.join(ROOT, "assets")
WORK = "C:/Users/Zuoyunlai/AppData/Local/Temp/regen"

args = sys.argv[1:]
ONLY = None
ONLY_ACTION = None
for i, a in enumerate(args):
    if a == "--only":
        ONLY = args[i + 1]
    if a == "--action":
        ONLY_ACTION = args[i + 1]
DRY = "--dry" in args

mapping = json.load(open(os.path.join(ROOT, "tools", "clip-sources.json"), encoding="utf-8"))

def probe_wh(f):
    o = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                        "-show_entries", "stream=width,height", "-of", "csv=p=0", f],
                       capture_output=True, text=True, encoding="utf-8", errors="replace").stdout.strip()
    w, h = o.split(",")
    return int(w), int(h)

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print("  !! 失败:", " ".join(str(c) for c in cmd[:3]), r.stderr.strip()[-300:])
    return r.returncode == 0

results = []
for pid in ["violet", "crimson", "indigo", "silver", "azure"]:
    if ONLY and pid != ONLY:
        continue
    pack = json.load(open(os.path.join(ROOT, "pets", pid, "pack.json"), encoding="utf-8"))
    for action, file in (pack.get("clips") or {}).items():
        if ONLY_ACTION and action != ONLY_ACTION:
            continue
        key = "%s/%s" % (pid, action)
        if key not in mapping:
            print("%-18s 映射缺失，跳过" % key)
            continue
        job = mapping[key]["job"]
        src = os.path.join(JOBS, job, "videos", "output.mp4")
        if not os.path.isfile(src):
            print("%-18s 源不存在，跳过" % key)
            continue
        cur = os.path.join(OUT_DIR, file)
        cur_w, cur_h = probe_wh(cur)
        work = os.path.join(WORK, pid, action)
        shutil.rmtree(work, ignore_errors=True)
        os.makedirs(work, exist_ok=True)
        frames = os.path.join(work, "frames")
        os.makedirs(frames, exist_ok=True)
        print("%-18s → %s  (现网 %dx%d)" % (key, job, cur_w, cur_h))

        if action == "stage":
            # stage 有专门的管线（稳定化 + 横向收边）
            out = os.path.join(work, "out.webm")
            r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "stage-pipeline.py"),
                                src, out, "--out-h", str(cur_h), "--crf", "42"],
                               capture_output=True, text=True, encoding="utf-8", errors="replace")
            if r.returncode != 0:
                print("  !! stage-pipeline 失败:", r.stderr.strip()[-300:])
                continue
        else:
            run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", src,
                 "-vf", "fps=24", "-start_number", "0", os.path.join(frames, "%04d.png")])
            keyed = os.path.join(work, "keyed")
            run([sys.executable, os.path.join(ROOT, "tools", "batch-key.py"),
                 frames, keyed, str(cur_h)])
            filled = os.path.join(work, "filled")
            run([sys.executable, os.path.join(ROOT, "tools", "fill-dark-holes.py"),
                 keyed, filled, "--thr", "0.35", "--min-area", "20", "--min-content", "0.02"])
            out = os.path.join(work, "out.webm")
            run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-framerate", "24",
                 "-start_number", "0", "-i", os.path.join(filled, "%04d.png"),
                 "-vf", "unsharp=5:5:0.4:5:5:0",
                 "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "38",
                 "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", "-an", out])

        if not os.path.exists(out):
            continue
        nw, nh = probe_wh(out)
        nsz = os.path.getsize(out)
        csz = os.path.getsize(cur)
        nf = int(subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
                                 "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", out],
                                capture_output=True, text=True, encoding="utf-8", errors="replace").stdout.strip() or 0)
        # 1.26.1 验收门：背景必须透明。抽中段帧量四角 alpha 均值，>10 判不合格，
        # **不覆盖现网素材**。这是 azure 事故的教训：当时只验了帧数和体积，
        # 三个背景半透明（bg-alpha 66~92）的片段照样上线，用户看到「没抠像」。
        # 根因是该源绿幕布光不均（暗绿区 dom≈0.55），线性透射率公式把暗绿判成
        # 40% 不透明 —— 这类源在公式层面无解，只能靠验收门拦下。
        import tempfile as _tf
        _p = os.path.join(_tf.mkdtemp(), "chk.png")
        subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-c:v", "libvpx-vp9", "-i", out,
                        "-vf", "select=eq(n\\,%d)" % min(60, max(0, nf // 2)), "-frames:v", "1", _p],
                       capture_output=True)
        bg = None
        try:
            from PIL import Image as _Img
            import numpy as _np
            _a = _np.asarray(_Img.open(_p).convert("RGBA"))[..., 3]
            _h, _w = _a.shape[:2]
            bg = float(_np.mean([_a[:12, :12], _a[:12, -12:], _a[-12:, :12], _a[-12:, -12:]]))
        except Exception:
            pass
        if bg is None or bg > 10:
            print("    !! 背景不透明 (bg-alpha=%.0f) —— 判不合格，不覆盖现网素材" % (bg if bg is not None else -1))
            results.append((key, out, 0))
            continue
        print("    新: %dx%d %d帧 %dKB bgα=%.0f   (旧 %dKB, %+dKB)" % (
            nw, nh, nf, nsz // 1024, bg, csz // 1024, (nsz - csz) // 1024))
        results.append((key, out, nsz - csz))
        if not DRY:
            shutil.copyfile(out, cur)

print("\n=== 汇总")
tot = 0
for key, _, d in results:
    tot += d
    print("  %-18s %+d KB" % (key, d // 1024))
print("  合计 %+d KB" % (tot // 1024))
if DRY:
    print("  (--dry：只重出到临时目录，未覆盖 assets)")
