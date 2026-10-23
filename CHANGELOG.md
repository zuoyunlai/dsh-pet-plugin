# Changelog

## 1.19.8 — 2026-10-23

- **修：跳舞视频镂空处被填色**（用户报「人物图像间隙有紫色填充，四个角色都有，程度不同」）。
  这是 1.19.6 引入的回归：当时为修「高光透底」加了「填掉封闭小洞」，但跳舞时张开手臂，
  手臂与身体之间的空隙在 1/4 分辨率灌水时被判成「与边界不连通的封闭区域」，整块镂空
  被填上颜色（单帧最多 5648 px）。静止立绘不走这条管线，所以只有跳舞视频有。
  **已整段移除洞填充** —— 实测 12 个采样帧对照，亮部半透明率有无填充只差 0~0.4 个百分点，
  真正解决高光透底的是死区公式，不是洞填充。少一层猜测 = 少一类回归。
- **修：绯跳舞时胸部下方透底**（`batch-key.py` 加暗部保护）。真因不是「反光像素被误判」：
  黑缎高光是**绿幕反射**，像素 `(r,g,b)=(0,22,0)`；despill 把绿色抹平后 `dom` 从 +0.049
  掉到 0.000，撞进 alpha 公式最陡的过渡带 → 判成半透明 → 白底从反光里透出来。
  修法是用**亮度**这条独立信号把「明显暗于绿幕」的像素强制判为不透明。两个要点：
  - 阈值**不写死**：各角色绿幕亮度差一倍多（薇 0.32、绯 0.69），按每帧四角实测归一化；
  - 形状**不是线性 ramp**：第一版 `1 - luma/阈值` 对 luma 0.062 的像素只给 0.82，仍半透明，
    改成「离绿幕够远就给满值」的两段式；blur 之后再补一次 clamp（羽化会稀释高光带外圈）。
- 实测：绯胸口下方半透明 7.0% → 2.9%（薇 3.2%、雪 2.0%，剩下是正常边缘抗锯齿）；
  编码侧确认无罪（抠像 PNG 与 webm 解码后 alpha 平均差 0.001）。
- 体积 7.9MB → 8.2MB（不透明区域变多，VP9 要多花数据）。12 条片段全部重编。

## 1.19.7 — 2026-10-23

- **去掉播放中的 3×3 反锐化滤镜**：这个滤镜是在预乘 alpha 上做卷积的，边缘外侧会出现
  **亮边光晕**（实测局部亮度上冲 +0.21），叠在浅色页面上就是「人物轮廓/间隙一圈发白偏紫」。
  它不是素材问题，是 1.19.4 加的那层显示侧锐化；已整段移除（CSS 的 `url(...)` 与 overlay 里
  的 `<svg><defs>`），画面回到纯编码质量，640 素材本身已经够锐。
- 素材、抠像、体积均不变（10.3MB）。

## 1.19.6 — 2026-10-23

- **修「高光透底」**（薇/绯最明显）：抠像的 alpha 公式没有死区——旧式
  `(0.14-dom)/0.14` 在 `dom=0.03` 就给 0.79，而黑缎/皮革的高光是**绿幕反光**，
  `g-max(r,b)` 常常只有 0.01~0.04，于是整片深色面料变成 0.8~0.95 的半透明，
  叠在浅色页面上就是"透底"。
  - alpha 改为 `clip((0.12-dom)/0.07)`：`dom<=0.05` 全不透明（绿幕本体 dom≈0.96，安全）；
  - 新增**内部洞填充**：缎面反光被抠出的小洞只填"不与画面边界连通"的部分
    （1/4 分辨率灌水，边缘抗锯齿不动），填洞颜色向亮度靠拢避免留橄榄绿；
  - 抽样帧的"深色半透明像素"从 29.1% → 1.1%（全片各帧最坏 8.5%）。
- 全部 12 条 640 重抠重编（参数不变：crf38/cpu-used 0/aq-mode 2/sharpness 3）。
  片段 8.3 → **7.9MB**（alpha 更实、压缩率反而更好），整包 10.7 → **10.3MB**。
- 素材 sha256 基线已同步。

## 1.19.5 — 2026-10-23

- **全部 12 条动作片段统一到 640 高**（原先只有 dance 4 条在 640，walk/hair 仍是 400）：
  8 条 walk/hair 从各自母版重新抠像编码，参数与 dance 完全一致
  （crf38 / cpu-used 0 / aq-mode 2 / sharpness 3 + unsharp），构图长宽比不变。
- 体积：片段 6.3 → **8.3MB**，整包 **8.6 → 10.7MB**。这是"全 640"的代价；
  如果以后要压回去，优先把 walk/hair 降回 400（约 −2.5MB），dance 保持 640。
- 显示侧反锐化（3×3 SVG unsharp，0 字节）保持开启；动作结束 220ms 淡出不变。
- 素材 sha256 基线已同步。

## 1.19.4 — 2026-10-23

- **动作结束不再硬切**：片段播完原本立刻卸载 `<video>`、直接换成静止立绘（跳舞结尾切笑脸
  最明显）。现在先标记 `exiting`，video 用 220ms 淡出到立绘，220ms 后才真正移除；
  淡出期间静帧垫在下面，不会再出现"人物突然跳成另一张脸"。
- 测试台架修了一个时钟 bug：`advance()` 处理 interval 时先 `t.at = clock + every` 再
  `clock = t.at`，把时钟一次跳到下一次触发，导致同一轮里后面的 timer 在错误时刻执行
  （220ms 的淡出窗口正是被它吞掉的）。改为先按触发时刻推进、再重排 interval。
- 新增用例：到片长先进入淡出（`exiting` + `is-leaving`）、静帧在场、220ms 后卸载。

## 1.19.3 — 2026-10-23

按 `FANFEED-senior-review-2026-10-23.md` 的 P0→P3 顺序修订；条目编号沿用该报告
（R01–R23，R23 是修 TTS 时发现的、报告未覆盖的一条）。

### 正确性 / 契约

- **R06（P1）工具事件名写错**：宿主的事件是 `tools/result(exec, result)`
  （`@deepseek-ai/dsh-tools` 的 `notifyResult` 用 `ctx.events.dispatch('emit', […])`
  发出，两个参数、按 `exec.agent` 作用域分发）；单数 `tool/result` 只是 session
  持久化事件类型，不会走 `ctx.on`。1.11.0 的 F1 阶段机因此**从未生效**过：
  `tool`/`error` 两态不可达。现在以 `tools/result` 为准，并保留旧名监听兼容老宿主；
  `/ping` 增加 `toolEvents: 'ok' | 'unobserved'` 自检字段，20s 内没收到事件会打一条明确日志。
- **R03（P1）动作链没有身份令牌**：连点同一动作会在 340ms 里推进 8 帧、notify 8 次
  （台架实测 pending 3→11）。改为「代际令牌 + 唯一 timer」：每次播放 `gen` 自增并
  取消上一条链，旧回调一律失效；视频动作不再排翻帧 timer。
- **R02（P1）动作时长与片段不匹配**：12 条片段都是 5.167s，调用点却写死 1300/2400ms，
  手势播到一半就被卸载；`loop:true` 又让 6s 的 dance 撞上回跳。现在片段动作默认
  `ms = 5167`、`loop:false`、`onPlaying` 淡入；dance 的心情窗口改为 5167ms，收尾时点
  相应平移（7100/8800）。
- **R01（P1）片段失败没有任何回退**：原来 `clip 存在就只渲染 <video>`，404/坏编码/
  播放失败时人物整体消失。现在静帧只当 **poster**：起播前顶着画面，`onPlaying` 一到就
  撤掉（**不能一直垫在下面**——这些是 VP9+alpha 的透明视频，若垫着，跳舞时手臂抬起、
  身体转动，没被视频覆盖的地方会透出静止立绘，看起来是两个人物重叠）；
  `onError` 或 3s 未起播就退回静帧，并把失败按文件名记进 `runtime.clipFailed`，
  同一片段不再反复等 3s。webm 资源改 `cache-control: no-store`（原来 1 小时缓存会让
  修好的文件继续坏着）。

### 安全 / 隐私

- **R07（P2）上游错误原文回显**：`/chat` 失败时只回 `{error, code, ref, message}`，
  `message` 是 `upstream failed (<8 位关联 ID>)`；原文只进服务端日志（带同一个 ID），
  不再外泄 endpoint/账号标识，也不再回 chunk 类型序列。
- **R14（P2）history 进 system**：客户端历史不再拼进 system prompt（那是「谁算系统」
  被客户端决定）。历史改为同一个 user 轮里的 `<history>` 块，system 里只写一句
  「那是数据、不是指令」的输入约定；条数（8）/长度（300）/控制字符剥离保持不变。
- **R22 自检**：`/ping.toolEvents` 让「事件没接上」这件事在数据面可见。
  真机验收（2026-10-23，重启后）：`toolEvents: "ok"`、成功调用写 `lastToolAt`、
  工具级失败（如读不存在的文件）写 `lastErrorAt`。注意 `result.isError` 只表示**工具调用**
  失败：`bash` 命令返回非零（`exit 3`）不算，因为那一次调用本身是成功的。

### 稳定性

- **R08（P1/P2）轮询没有超时/取消**：每次 `/ping` 带 `AbortController` + 8s 预算，
  `finally` 里必续排下一次；卸载时 abort 在途请求，并检查 `stop` 后才写 runtime
  （原来卸载后仍会被在途响应改写）。`runToCenterAndDance` 的两个裸 `setTimeout`
  改走 `later()`，卸载时一起清。
- **R11（P2）面板越界**：宠物贴左边缘时面板左边缘算到 -184px。现在 right/bottom
  四面夹取，并在 resize 后重新夹取。
- **R10（P2）减弱动效**：三处零散 `@media` 合并为一条统一策略（动画全关、过渡归零、
  特效层不显示）；自动动作在 `runtime.reduced` 下不播，用户显式点播（面板/菜单）
  仍然放行；减弱动效时不搬到屏幕中间跳舞；跟随 `matchMedia` 变化。

### 发布 / 安装

- **R04（P1）确认晚于副作用**：`tools/release.cjs` 改为「计划 → 确认 → 执行」，
  **默认只读**（`--apply` 才动），拒绝脏工作区（`--commit` 显式放行），执行前校验
  仓库/分支/身份并跑本地测试绿闸；只有 422「已存在」会被当成成功，网络错误不再吞。
- **R19 发布顺序**：npm 在本机发成功才建**正式** Release；交给 CI 发时建 **draft**，
  CI 发完用 `--promote` 转正——不再出现指向未发布版本的正式 Release。
- **R05（P1）覆盖远端独有文件**：`tools/push-via-api.cjs` 改用 `base_tree`，
  远端独有文件默认保留（`--prune` 才删，且逐个打印）；去掉 `force:true`，
  PATCH 前重新核对 head，被移动就中止；默认只读，`--apply` 才推。
- **R12（P2）安装器 test 模式**：`install.ps1 -ProfileDir` 用 `Copy-Item $src -Destination
  $destDir` 会把源目录名（dsh-pet）复制进去，post-check 找 dsh-pet-plugin 必然失败
  （实测 `Post-check failed copy=False`）。改为复制内容；`--profileDir` 下的安装/
  卸载/verify 三条路径实测通过。
- **R20 空容器 JSON**：空 `bundles` / 空 `dependencies` 上插行会拼出 `[x,]`/`{x,}`
  被 `Test-Json` 拒绝。现在按容器是否为空分别插入，卸载侧补了「单元素数组」的删除规则。
- **R13（P2）旧包名**：五份 README 里 8 处 `@local/dsh-pet` 全部改为 `dsh-pet-plugin`
  （安装说明与测试命令路径）。
- **install.ps1 改存 UTF-8 with BOM**：它原本没有 BOM，而脚本里有多处中文；
  Windows PowerShell 5.1 会把无 BOM 的 UTF-8 按 ANSI 解码，工作树从 CRLF 变 LF 之后就
  直接报「表达式或语句中包含意外的标记 }」而无法执行（`-Update` 实测）。加 BOM 后
  `-Update` / `-ProfileDir` 安装 / `-Verify` / `-Uninstall` 四条路径实测恢复；
  CI 增加一条「install.ps1 必须带 BOM」的守卫。

### 交互 / 可访问性

- **R16（P3）菜单键盘**：菜单打开时焦点移入首项、`Esc` 关闭并把焦点还回去，
  子项加 `role="menuitem"`，菜单容器加本地化 `aria-label`。
- **R17（P3）交叉淡入方向**：`--pet-dx` 只在 `src` 真变化时翻转（原来每次 render 都翻）。
- **R18（P3）可访问名**：齿轮/发送/活跃时段的 `title`/`aria-label` 走 i18n
  （新增 `a11y.talkTo` / `a11y.send` / `a11y.start` / `a11y.end`，五语齐全，50 条文案）。

### 测试

- 新增 `tests/harness.mjs`（可控定时器 + 虚拟时钟 + 可编程 fetch + matchMedia/
  AbortController 桩）与 `tests/runtime.test.mjs`（15 条行为回归：动作链、片长与 loop、
  失败回退与失败记忆、减弱动效、面板四面夹取、交叉淡入、轮询超时与卸载中止）。
  这些用例是「修好才通过」，不是「缺陷存在即通过」；`npm test`、`test.yml`、
  `release.yml` 均已纳入。宿主单测 32 → 34 条（补 R07/R14 与 `tools/result` 契约）。
- 新增 `tests/push-api.test.mjs` + `tests/fixtures/fake-github.cjs`：用内存版 GitHub
  在临时 git 仓库里**真跑** `tools/push-via-api.cjs`，断言 `base_tree` 保留远端独有文件、
  `--prune` 才发 `sha:null`、ref 更新不带 `force`、head 被移动时中止且不覆盖、
  计划模式零写调用、以及**工作树 CRLF 不会导致每次重传**。R05 的写路径不再只靠肉眼 review。
- **真实推送实测并当场修掉一个 bug**：推到一次性分支 `audit/push-smoke`（随后删除，
  main 未动）时发现，比较用的是 `hash-object` 归一化后的 sha、上传用的却是工作树原始
  字节——工作树里 CRLF 的四个文件（`.github/workflows/*.yml`、`CHANGELOG.md`、
  `package.json`）因此被判定「每次都变了」且永远推不干净。改为 `hash-object -w` 写入
  归一化 blob、上传时用 `git cat-file blob <sha>` 取同一份内容；第二次真推
  `changed=0 / unchanged=155 / remoteOnly=1`，与远端的逐文件 sha 比对 0 处不一致。

### 神经语音（TTS）

- **R23 面板报「神经音色不可用」**：`lib/tts.js` 的 `resolvePython()` 用了 `homedir()` 与
  `readdirSync()`，但文件顶部只导入了 `existsSync`——两个 `ReferenceError` 都被外层
  `try/catch` 吞掉，于是**永远落回 PATH 里的 `python`**，而 PATH 上的 python 没装
  edge-tts；本机 DSH 内置 runtime 的 python 3.12 明明装了。补上两个导入即可（实测
  `resolvePython()` 现已指向 `~/.dsh/dsh-runtimes/.../python.exe`，`probeNeural()` 返回 `ok:true`）。
- 同时修掉同一个函数里的两个缺陷：**并发探测永久挂住**（第二个调用在 `exit` 里看到
  `neuralProbe` 已填就直接 return、不 resolve，导致 `/dsh-pet/tts/status` 不返回）——
  改为共享同一个在飞 Promise；**用 `close` 代替 `exit`** 判定结束，避免 stdout 晚到
  把成功的 import 判成失败。探测失败时服务端日志会打出实际使用的 python 路径
  （只在服务端，不回给页面）。
- 新增 `tests/voice.test.mjs`（并发必 settle / 缓存命中 / 内置 python 优先 / 音色表），
  已接入 `npm test` 与两条 CI。
- 真机验证（重启后）：`/dsh-pet/tts/status` 返回 `available:true` 且 3ms 响应
  （修复前会挂 25s 以上）；真合成一句中文得到 7,344 字节的 `audio/mpeg`。

### 素材清晰度（1.19.4）

- **dance 4 条重编到 640 高**：母版仍是 768×1344，编码 640/crf38/**cpu-used 0**/aq-mode 2/
  sharpness 3 + unsharp。薇的 dance 按长宽比核对后确认来自 `violet-dance-wide`（不是
  `-video`），四条都用各自同名 `-dance-wide` 母版重抠重编；长宽比与旧素材逐位一致，
  构图不变。单条约 +54%~1.8×，跳舞的头发/裙褶/脸部明显更实。
- **walk / hair 8 条保持 400 高，只升级参数**（crf38/cpu0/aq2/sharp3）：体积基本不变
  （合计 2.83→2.84MB），块状与糊边减轻。
- **显示侧 3×3 反锐化掩膜**（SVG `feConvolveMatrix`，`preserveAlpha`，系数和 1）：
  **0 字节**，只作用于播放中的 `<video>`，实测极淡地提锐、不产生白边；随 overlay 挂载，
  不依赖额外资源。
- 体积：整包 7.1MB → **8.6MB**（片段 4.8 → 6.3MB），素材 sha256 基线已同步。
- 另外：2K 那条 `violet-dance-2k` 经长宽比核对是**另一个 take**（0.695 vs 0.675），
  未用于替换。

### 文档更正

- ROADMAP 的 F1 段与完成度表：写清事件名是 `tools/result`、1.11.0 的「已完成」标记
  当时并不成立、真机验收仍未执行；现状表的轮询周期/行号同步更新。

## 1.19.2 — 2026-10-22

1.19.1 在 npm 上被一次 staged 发布占住了版本号（E409 "Cannot publish over
previously staged version"， 也看不到那条暂存），按老办法换号重发。
内容与 1.19.1 完全一致。

## 1.19.1 — 2026-10-22

审计 O6 完成：四只形象 × 三个动作，全部 12 条动作片段上线。

- 新增 9 条（补完绯的 hair 与靛/雪的 walk、hair），全部 400 高 / crf38：
  · `pet-crimson-dance.webm` 570 KB
  · `pet-crimson-hair.webm` 452 KB
  · `pet-crimson-walk.webm` 457 KB
  · `pet-indigo-dance.webm` 548 KB
  · `pet-indigo-hair.webm` 295 KB
  · `pet-indigo-walk.webm` 428 KB
  · `pet-silver-dance.webm` 408 KB
  · `pet-silver-hair.webm` 276 KB
  · `pet-silver-walk.webm` 368 KB
  · `pet-violet-dance.webm` 430 KB
  · `pet-violet-hair.webm` 245 KB
  · `pet-violet-walk.webm` 377 KB
- 12 条合计 4853 KB；整包从 9.9 MB 降到 **7.0 MB**（400 高在 200px 显示尺寸下
  仍是 2 倍过采样，与 520 高并排看无肉眼差异，但体积少一半）。
- `tools/rebuild-all-clips.sh` 记录 job → 角色/动作 的映射，一条命令重编全部片段。
- **修一个真 bug**：`build-clip.sh` 里的 ffmpeg 默认读 stdin，被放在 `while read`
  循环里调用时会吃掉循环输入，导致后续参数错位、生成 `pet-let-walk.webm` 这类
  截断文件名。已加 `-nostdin` 与 `</dev/null`。

实测：12 条全部 readyState=4、实时播放（0.45s 内推进 0.45s），尺寸 150×400 ~ 273×400。

## 1.19.0 — 2026-10-22

审计 O6 第一批：走路 / 撩发也开始用视频片段。

- **新增 3 条片段**（同一条管线：宽构图绿幕首帧 → MiniMax H3 5s/768P →
  `batch-key.py` v5 抠像 → libvpx-vp9 `yuva420p` crf34）：
  · `pet-violet-walk.webm` 196×520 · 620 KB
  · `pet-violet-hair.webm` 232×520 · 398 KB
  · `pet-crimson-walk.webm` 276×520 · 751 KB
- `clips` 现在按动作分键（`dance` / `walk` / `hair`）：有片段的动作播视频，
  没片段的照旧回退到 3 帧翻页——所以这一批可以逐条增量上线。
- `tools/build-clip.sh <jobId> <persona> <action>`：一条命令完成抽帧 → 抠像 → 编码，
  下一批素材只用改两个参数。
- `tools/probe.mjs --scenario=clips` 扩展为逐动作验证（dance/walk/hair），
  无片段的动作明确标记 skipped 而不是报错。

实测：薇的 dance/walk/hair 与绯的 dance/walk 全部 readyState=4、实时播放（0.45s 内推进 0.45s）。
绯的 hair 与靛/雪的 walk、hair 仍走帧动画，等下一批素材。

## 1.18.1 — 2026-10-22

审计 O8 + O10：探测工具合并、资产回归基线。

- **`tools/probe.mjs` 单一入口**：`--scenario=video|panel|clips|dom`，
  共用同一套无头 Chrome + CDP 引导。原来三个脚本（probe-video / probe-panel /
  probe-clips）与 `tests/probe.mjs` 全部合并删除，重复代码从 4 份降为 1 份。
  三个场景实测通过：video（readyState=4、0.8s 内推进 0.802s）、
  panel（重叠 143×0）、clips（四只全部实时播放）。
- **资产回归基线**：`tools/assets-manifest.cjs` 生成 `tests/assets-manifest.json`
  （66 个文件的 sha256 + 字节数），`tests/assets.test.mjs` 断言资产未被动过。
  有意换素材时显式跑 `--update`——"资产变了"从此是一次决定，不是副作用。
  另一个用例校验每个 pack 引用的贴图/动作/片段都真实存在于 assets/。
- CI 增加两条：资产基线校验、`tests/assets.test.mjs`；语法检查覆盖 `lib/`。

为什么不用截图对比：截图受动画时序、字体渲染、窗口尺寸影响，在 CI 上几乎必然误报；
而"素材文件本身变了"是确定性的，正好是这类插件最容易悄悄回归的地方。

## 1.18.0 — 2026-10-22

审计 O7：`index.js` 拆分（935 → 608 行），行为不变。

- **`lib/tts.js`**（303 行）：神经语音子系统——worker 生命周期、合成、缓存裁剪、
  音色表与语言映射。它不碰 ctx / webServer，只依赖 Node 内置模块 + 一个 python 子进程，
  因此可以脱离宿主独立导入与测试。
- **`lib/prompt.js`**（56 行）：人设表与 system prompt 构造。纯函数，便于单独验证
  提示词形状；人设表仍放在宿主侧（客户端只能传 personaId），注入面不变。
- `index.js` 只留插件入口、路由、安全校验与 chat——职责单一，改动时更容易定位。
- 搬迁是纯搬运：代码原样移动，只加 `export` 与导入。唯一实质修改是 worker 路径
  `./tools/…` → `../tools/…`（文件从包根移到 lib/）。
- `package.json` 的 `files` 增加 `lib/*.js`；`install.ps1` 的 `-Update` 保留清单增加 `lib`。
- 验证：30 条宿主单测全过、冒烟全过、`check --strict` 13/13；`probeNeural()` 实测能
  找到并运行 worker（本机未装 edge-tts，因此返回"未安装"而非路径错误）。

## 1.17.1 — 2026-10-22

审计 O2–O5 / O9 / O12：工程配套补齐。

- **CI 测试工作流**（`.github/workflows/test.yml`）：push/PR 触发构建可复现校验、
  生成器同步检查、30 条宿主测试、冒烟、语法检查、npm pack 试跑。
- **`/ping` 轮询降频**：宠物可见时 8s，不可见时 30s（从 setInterval 改自调度 setTimeout）。
- **`release.cjs --confirm`**：发布前显示当前/上次版本并要求输入 y；`--yes` 跳过。
- **CONTRIBUTING.md**：项目结构、构建测试、加形象、素材管线、加语言、发版流程。
- **冒烟新增 i18n 断言**：五语 × 46 键全部非空（防漏翻或错语言）。
- **`pets/example/pack.json`** 模板：五语占位台词齐全，`gen-personas` 排除不进构建。

## 1.17.0 — 2026-10-22

四只形象全部用上 24fps 跳舞视频；设置面板不再挡人。

- **四支跳舞视频**：薇/绯/靛/雪各一条，520×(337~437) · 24fps · 124 帧 · VP9+alpha，
  合计 2.92 MB（520 高 + crf34 + 轻锐化，显示尺寸 200px 下与高码率版无肉眼差异）。
  素材管线：MiniMax 图生视频（宽构图首帧 + 四肢不出画提示词）→ `batch-key.py` v5 抠像
  → libvpx-vp9 `yuva420p` 编码。
- **batch-key.py v5 定稿**：不腐蚀（MinFilter 会啃 1px 手指）、smoothstep alpha、
  保留 despill（v3/v4 的"绿底反预乘"会让指尖泛黄绿，已回退，结论记入脚本头注释）。
- **设置面板不再挡人**：宽度 230→196px；`placePanel()` 按宠物实际位置计算——
  上方 ≥300px 放上方（右对齐、底贴头顶），否则放左侧（底对齐）；
  无头 Chrome 实测与宠物重叠从 143×154px 降到 143×0px。
- **moodDriven 标记**：只有"心情自动发起"的动作会被心情变化收回；
  用户点"跳一段"发起的跳舞不再被工具报错（mood=angry）打断。
- 宿主单测 30/30、冒烟（含 `<video muted autoplay loop>` 断言）全绿；
  无头 Chrome 逐只验证四支视频 readyState=4、实时播放、透明背景。

## 1.16.2 — 2026-10-22

跳舞视频提清晰度：改用原生分辨率编码。

- 之前先缩到 640 高再用 crf32 压制，两次丢细节；原视频 768P 的原生清晰度完全没用上。
- 现在按抠像后的**原生 768×1286** 编码，crf32 + 轻锐化（`unsharp=5:5:0.5`）：
  体积 1.59 MB（比 crf24 的 2.54 MB 省四成，观感几乎无差）。
- 四方案对比（按真实显示尺寸 220px 渲染后放大 3 倍看边缘）：
  `768/crf24 2.54MB` ≈ `768/crf32 1.59MB` > `512/crf26 1.62MB` > 旧的 `382/crf32 0.76MB`。
- 重新编码命令（换角色时照用）：
  `ffmpeg -framerate 24 -i keyed/frame-%03d.png -vf "unsharp=5:5:0.5:5:5:0" `
  `  -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 32 -row-mt 1 -deadline good -cpu-used 2 -an out.webm`

## 1.16.1 — 2026-10-22

修 1.16.0 的动作视频被横向压扁。

**现象**：跳舞时人物显得被挤扁 / 变狭长。
**根因**：`tools/batch-key.py` 第一版逐帧按内容 bbox 裁剪，124 帧宽度从 244 到 434 不等；
编码器（image2 + libvpx）会把不同尺寸的帧强行缩放到第一帧的 254 宽，手臂张开的那几帧被横向压缩最多 41%。
**修法**：改成两遍处理——第一遍抠像并求全片内容并集，第二遍用**同一个裁切框**、
**同一个缩放比例**输出每帧（768×1286 @ (0,24)，×0.498 → 每帧 382×640）。
这样既没有压缩，帧与帧之间的相对位移也保住了。

新视频：382×640、24fps、124 帧、762 KB、透明像素 187894/244480。

## 1.16.0 — 2026-10-22

真视频级动作：薇的跳舞改成 24fps 的 alpha 视频片段。

- **资产**：用立绘当首帧，经 MiniMax 图生视频（H3 / 5s / 768P）生成绿幕舞蹈，
  再逐帧抠像（`tools/batch-key.py`，124 帧一个进程跑完），最后编码成
  `assets/pet-violet-dance.webm`：254×640、24fps、124 帧、5.167s、0.74 MB、VP9 + alpha。
- **渲染**：pack 新增 `clips: { dance: "…" }`；该动作播放时渲染循环 `<video muted loop
  playsinline>` 而不是翻帧。真 Chromium 实测：readyState=4、currentTime 0.8s 内推进 0.801s
  （实时播放）、254×640、透明背景无绿边。
- **宿主**：`/dsh-pet/assets/` 放行 `.webm`（content-type `video/webm`），其余扩展名仍 404。
- 帧序列仍是兜底：没有 clips 的动作照旧用 webp 翻帧 + 1.15 的交叉淡入。

这一条把「视频级流畅」从路线图落成了实现：不是把帧数堆到 30，而是让浏览器直接播真视频。

工具：新增 `tools/batch-key.py`（批量绿幕抠像）与 `tools/probe-video.mjs`
（无头 Chrome 验证 `<video>` 是否真的在播、是否带 alpha）。

## 1.15.0 — 2026-10-22

观感优化三件套（不需要新素材）：把「看得出是翻页」压到「基本不跳」。

- **带方向的交叉淡入**：换帧不再是纯透明度渐变，而是沿 ±3px 位移 + 轻微缩放（.994 → 1.006）
  交叉，方向逐帧左右交替，连续换帧时读起来像真的在动。时长 240ms → 180ms。
- **过渡期 1px 模糊**：淡入/淡出两端各加 `blur(1px)`，模拟运动模糊，掩盖帧间硬切。
- **常驻微动**：立绘包装层叠 `dsh-pet-alive`（5.2s：scale 1.000→1.012、rotate ±0.5°），
  由合成器以 60fps 跑、CPU 几乎零负担 —— 她不再是静止图，这点对「活人感」的贡献比多几帧更大。
- 尊重 `prefers-reduced-motion`：系统开了减弱动效时，微动与交叉淡入都关掉。
- 冒烟新增断言：渲染树里必须有 `.dsh-pet-imgwrap` 且 `--pet-dx` 为 ±3px；
  CSS 里必须存在 `dsh-pet-alive` 与 `var(--pet-dx)`。

需要说清的边界：这三条让观感明显更顺，但**不是视频级**——帧数没变、仍是 6 帧/套，
帧率约 4.3fps。真到 24–30fps 需要带 alpha 的短视频（见 ROADMAP F2 的 A 路）。

## 1.14.0 — 2026-10-22

反哺计划 F2 第二批：绯的跳舞 3 帧 → 6 帧。

- 新增 `pet-crimson-dance4/5/6.webp`：甩发下扫 → 叉腰举臂 → 转身抬脚跟，与原有三帧连成可循环的六帧。
- **修抠图脚本的背景判定**：原来用「四条边框的平均色」判是不是绿幕，长发飘到画面边缘、底部又有投影时
  会被判成「渐变底」，于是走错分支、绿底残留一大片（绯第 6 帧实测如此）。现在改成看四个角落的小块——
  只要有一个角是绿占多数就当绿幕，长发和投影同时盖住四个角几乎不可能。
- 冒烟断言同步：薇与绯的跳舞都必须是 6 帧，靛与雪仍是 3 帧。

进度：4 只 × 3 套 = 12 套动作，已扩 2 套（薇跳舞、绯跳舞），剩 10 套 × 3 帧 = 30 张。

## 1.13.0 — 2026-10-22

反哺计划 F2 试点：薇的跳舞动作 3 帧 → 6 帧。

- 新增 `pet-violet-dance4/5/6.webp`（绿幕渲染 → `tools/make-pet-image.py` 抠图 → 640px）。
  六帧连起来是「抬手 → 双手上举 → 侧展 → 双臂下扫 → 叉腰举臂 → 转身抬腿」，可循环。
- 帧时长随帧数自适应：≥6 帧用 230ms，3 帧仍 340ms —— 整套循环长度基本不变，但过渡明显更顺。
- **修抠图脚本的误伤**：`make-pet-image.py` 原先先做「右下角水印擦除」再判背景类型，绿幕图的
  右下角常有投影（绿通道均值 < 0.6），会被当成浅底抹成一块白方块。现在先判背景类型，
  绿幕图完全跳过水印步骤。
- 冒烟新增断言：薇的跳舞必须 6 帧、其余三只仍 3 帧、6 帧步长 ≤240ms。

其余 3 只 × 3 套动作仍是 3 帧，等这批确认画质后再铺。

## 1.12.0 — 2026-10-22

反哺计划 F4：形象目录化（pack）。

- 形象数据从源码搬到 `pets/<id>/pack.json`（4 只各一份，内容与迁移前一致）。
- 新增 `tools/gen-personas.cjs`：从 `pets/` 生成 `src/30-personas.js`；`node build.mjs`
  会先跑它再拼接。加形象不再需要改代码，只需加目录 + 放图。
- **硬闸门**：迁移前后 `client.js` 的 sha1 完全相同（`1d705d77…`），说明只是搬迁、零行为变化。
  `npm run gen:check` 可在 CI 或本地核对 `pets/` 与生成物是否同步。
- 发布包带上 `pets/*/pack.json`，用户可以直接改 pack 再 `node build.mjs` 自建形象。

## 1.11.0 — 2026-10-22

反哺计划第一批（`ROADMAP.md` 的 F5 + F1 + F3）。

- **F5 死代码**：删掉轮询里残留的 `/api/dsh-pet/ping`（该前缀 1.9.0 已移除）。
- **F1 阶段机**：`idle / working / tool / error / speak / done` 六态，取代原来只有一个
  `running` 布尔量。数据来自宿主 `tool/result` 事件（`lastToolAt` / `lastToolName`，经
  `/ping` 回传）与本地状态；`tool` 时她会踱两步、`error` 时生气、`done` 时开心。
  轮询从 15s 收紧到 8s，且首次挂载立即拉一次。
- **F3 右键菜单**：右键宠物出 5 项（跳一段 / 撩头发 / 叫出来 / 藏 1h / 设置），
  设置面板保留；菜单跟随点击位置并自动收进视口。
- **F3 斜杠命令**：`/dsh-pet [show|hide]`。`commands` 是可选服务——宿主没有就静默跳过；
  命令通过 `/ping` 的 `commandSeq` 下发给客户端，序号递增保证不会重放。
- 新增 6 条宿主单测（22 → 28）：阶段字段、tool/result 事件、命令注册与参数校验、
  无效参数不执行、无 commands 服务时软失败。冒烟新增六态映射与右键菜单 5 项断言。

## 1.10.2 — 2026-10-22

- **宿主版本要求说清楚了**：
  - `package.json` 补 `dsh.manifestVersion: 1`；`engines.dsh: ">=0.2.1-alpha.2"` 保留。
    注意：`engines.dsh` **只是声明，安装器不校验**（指南 §7.0 明确写"当前安装器/加载器都不校验"）。
    真正会被 `dsh plugin add` 强制的是 `@deepseek-ai/dsh-*` 的 peerDependencies —— 本插件刻意
    **不声明**这类 peer，因为它一个 dsh 运行时包都不 import，加假的 peer 只会让老版本被误拒。
  - 唯一的 dsh peer 是 `@deepseek-ai/schemastery@^3.18.2`（本机宿主 3.18.5，匹配）。
  - 挂 slot 改成软失败：宿主太旧（没有 `shell.overlay` 插槽）时只打一行说明，
    不再把异常抛进 boot 把整个 bundle 打掉。
  - README 的 Known limits 里写明：在 0.2.1-alpha.2 上开发验证；0.1.x 会装上但挂不出来。

## 1.10.1 — 2026-10-21

**接口形态变更**：`/dsh-pet/tts` 从 `GET` 改成 `POST`，`GET` 端点取消（返回 405）。

- 起因：只要存在可以喂给 `<audio src>` 的 URL，任何页面（以及本机任意进程——它自己
  `GET /` 就能拿到 token）都能驱动宿主合成音频并写盘。token 校验挡不住这条路，
  唯一根治办法是不提供"可被当作 URL 使用的合成端点"。
- 客户端改为 `fetch(POST)` 拿 `blob` → `URL.createObjectURL` → `<audio>` 播放，
  播完/失败即 `revokeObjectURL`；连说两句时用自增序号丢弃过期的那个，避免两句抢播。
- 响应头 `cache-control: no-store`（POST 结果不进浏览器缓存）。
- 冒烟新增断言：请求必须是 POST、必须打到 `/dsh-pet/tts`、播放的必须是 blob URL。
- 宿主单测：`tts 只接受 POST` 与 `tts 缺 text 时 400` 拆成两条。

> 1.10.0 在 npm 上落成了 staged（未上架），故改发 1.10.1；内容与 1.10.0 相同。

升级提示：这是唯一不向后兼容的改动（外部脚本若直接 `GET /dsh-pet/tts?text=` 会拿到 405）。
面板与语音行为不变。

## 1.9.4 — 2026-10-21

安全修订（依据 `SECURITY-AUDIT-v1.9.3.md`）。所有判定都不绑定端口/域名/平台，
任意宿主部署形态（本机、局域网、反代、桌面壳）都成立。

- **准入**：Host 必须是回环地址 / 宿主自身 origin / `allowedHosts` 登记值；Origin 存在时
  必须与本次 Host 同源（默认端口归一）或为 `dsh-app://app|shell`；`Sec-Fetch-Site` 存在时
  只接受 same-origin/none。挡住 DNS rebinding 与跨站调用。
- **缓存上限真的生效**：`trimCache()` 原来只在启动时跑一次，现在每次合成后（60 秒节流）复检；
  实测缓存从"无限增长"变为受 60 MB 约束。
- **落盘安全**：随机临时名 + `rename`，预先埋好的符号链接无法改落点；缓存目录 0700。
- **参数白名单**：`pitch`/`rate` 只接受 `±NNNHz` / `±NN%`；缓存键改 JSON 序列化（消除 `|` 歧义）。
- **错误脱敏**：worker 的 OSError（含绝对路径）只进宿主日志，HTTP 只回 `tts-failed`；
  worker stderr 收进 4 KB 环形缓冲，不再 `ignore`。
- **限流**：改成"先验后计"（畸形/空请求不占额度），全局 12 次/分 + 单客户端 6 次/分；
  `/tts/warm` 独立 6 次/分 + 单飞（同一时刻只跑一条）+ 单次条数 60→30。
- **提示注入面**：`personaId` 走无原型表 + `hasOwnProperty`（`__proto__` 不再命中）；
  聊天历史逐行加固定前缀、剥控制字符、限长。
- **隐私**：面板明示「神经音色会把朗读文本发往微软」；「恢复默认」同时清聊天历史；
  卸载脚本清 TTS 缓存。
- **打包/发布**：`install.ps1 -Update` 只拷运行时文件（不再把 `.git`/旧 tgz/预览图塞进
  profile，9 MB+ → 2.1 MB）；`tools/release.cjs` 默认不在本机 publish，交给 CI 带
  `--provenance` 发，需本机发时显式 `--publish`。
- **杂项**：assets 畸形 `%` 不再抛穿（400 + nosniff）；`readBody` 按字节计数；客户端设置
  做类型/范围校验（NaN/字符串不再让她消失）；音色切换预热防抖 600ms；`xiaomo` 音色映射
  之前被误改成 Xiaoxiao，已改回 Xiaomo。

- 测试：宿主单测 10 → 21 条（Host/Origin/Sec-Fetch-Site/原型链/限流/参数/畸形 URL）。

## 1.9.3 — 2026-10-21

- **台词补齐西 / 葡 / 印三语**：四个形象各 27 句，按性格重写（不是直译）。
  查找顺序 `lines<Lang>` → `linesEn` → `lines`，五语覆盖完整。
- **修一个一直没生效的结构错误**：`linesEn` 当初被插进 `lines` 对象内部（变成
  `lines.linesEn`），后来的 es/pt/hi 也跟着嵌进去，导致英文台词从来没被用过。
  现在语言包是 `lines` 的兄弟属性，`p.linesEs` 这类查找才真正命中。
- 自检出口加 `lang()` / `lineFor(mood)` / `text(key)`，方便核对当前语言实际取了什么。

## 1.9.2 — 2026-10-21

- **她说的语言也跟上界面语言**：
  - 神经音色按语言选：中文 晓晓 / 英文 Ava、Emma / 西语 Elvira / 葡语 Francisca /
    印地语 Swara；`/tts` 接 `lang` 参数，面板音色下拉新增「自动（按语言）」。
  - 系统 SAPI 兜底的 `u.lang` 也跟着语言走（原来写死 `zh-CN`）。
  - 聊天 system prompt 明确要求用界面语言说话（原文只说「跟随用户语言」，
    英文界面下她可能仍回中文）。
  - 台词包查找顺序：`lines<Lang>` → `linesEn` → `lines`（西/葡/印暂回落英文）。

- 宿主新增断言：音色表必须覆盖五种语言。

## 1.9.1 — 2026-10-21

- **修：文案不跟随 DSH 界面语言。** 原来读 `navigator.language`（操作系统/浏览器语言），
  用户在 DSH 里切成英文时它仍是 `zh-CN`，面板一直中文。现在按宿主约定读 `<html lang>`
  （DSH 的 i18n 服务切语言时会写它），并用 `MutationObserver` 监听，切换即时生效。
- 检测顺序：`localStorage['dsh-pet.lang']` 手动覆盖 → `<html lang>` → `navigator.language` → 英文。
- 面板「形象」区新增语言下拉（跟随 DSH / 中文 / English / Español / Português / हिन्दी）。

## 1.9.0 — 2026-10-21

- **源码拆分**：2523 行的 `client.js` 拆成 `src/` 下 15 个文件（工具 / i18n / 形象 / 设置 /
  状态 / 语音 / 行为 / 样式 / 立绘 / 组件 / 特效 / 移动 / 本体 / 入口），由 `node build.mjs`
  按文件名顺序拼回单文件产物。拆分是纯行切片，**拼回的 client.js 与拆分前逐字节一致**。
- **构建链**：`npm run build`（拼接 + 语法检查）、`npm test`（重建 + 冒烟）、
  `prepublishOnly`（重建 + check + 冒烟，防止发出过期产物）。
- **文案真源回到 locale**：产物里的字典改由 `build.mjs` 从 `locale/*.json` 注入
  （标记 `@locales`），改文案不用再碰源码。
- 文档：中英 README 的 Customize 段重写（拆分后该改哪个文件、怎么构建）。

## 1.8.2 — 2026-10-21

- 文档：README 去掉「本地私有包」的过时说法，改为开源/npm 发布说明。
- 首次发布到 npm：`dsh-pet-plugin@1.8.1` 起公开（MIT）。

## 1.8.0 — 2026-10-21

- **多语言（DSH 标准）**：
  - `locale/{en,zh,es,pt,hi}.json` 带 `pet` 命名空间；slot 以 `locale: 'pet'` 注册。
  - 面板全部文案走 `t()`；语言取浏览器界面语言，缺失回落英文。
  - 四个形象各补一套英文台词（`linesEn`）与英文 tag。
  - 聊天的 system prompt 按客户端语言切换（中文/英文两套）。
- 修：客户端模块 id 随包名改为 `dsh-pet-plugin`（否则 client-modules 报 duplicate factory）。
- 冒烟新增 i18n 断言（英文回落 + key 不外泄）。

## 1.6.0 — 2026-10-21

插件契约审计后的收口：

- **安全**：CORS 改为白名单（宿主 origin / `dsh-app://`），越权请求 403；`/tts/status`
  不再返回 python 与本机 home 路径。
- **注入面**：`/chat` 只接受 `personaId`，人设文本留在宿主表里，页面无法往 system prompt 塞内容。
- **接口面**：去掉 `/api/dsh-pet/*` 双前缀（客户端改用注入的绝对地址），路由 12 → 6 条。
- **资源**：断连即中止 LLM 流；warm / trimCache 随 dispose 停止；`probeNeural` 加 5 分钟 TTL；
  `/tts` 加 30/分钟限流。
- **调试出口**：`globalThis.__dshPet` 默认不挂，需 `dsh-pet.debug=1` 或 `?petdebug=1`。
- **资源体积**：56 张立绘 PNG → WebP（7.2 MB → 1.6 MB）。
- **文案/无障碍**：入口按钮与滑杆补 `aria-label`；五语 README 补齐且标题一致；补 `engines.dsh`。

## 1.5.0 — 2026-10-21

- 图标换成「长发剪影」（`icon.svg` + 输入框按钮同一条 path）。
- 设置面板重做：分组、自定义下拉、自绘开关、固定视口、行不再被 flex 压扁。
- 全量审计报告 `AUDIT-contract.md`；补 8 条宿主单测。

## 1.2.x — 2026-10-21

- 四个形象全部改为超写实照片立绘，每人 5 张表情。
- 动作序列（跳舞 / 撩头发 / 走路），按性格分化；表情与动作都走 240ms 交叉淡入。
- 换成常驻 TTS worker；边缘音色可选化（不再内置 python 依赖）。

## 1.0.0 — 2026-10-21

- 四个形象统一换装照片立绘；面板/气泡跟随主题 token。
- 修复：设置面板缺 `persona` 变量导致点齿轮整只宠物消失。

## 0.9.x

- 神经语音（edge-tts）可选接入；TTS worker；缓存 LRU；chat 限流；定时器回收。

## 0.8.x

- 绿幕抠图重做立绘（解决皮肤与背景同色导致的抠图失败）。
- 尺寸滑块、说话/被戳表情、跑到中间跳舞。

## 0.7.x

- 事件联动（一轮结束庆祝）、被戳反应、气泡主题色跟随。

## 0.6.x

- 四表情差分、图片缩放不再遮挡输入框。

## 0.5.x

- 首版：浮动桌宠 + 小输入框（不进会话）+ 语音 + 特效。
