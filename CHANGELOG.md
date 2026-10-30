# Changelog

## 1.27.1 — 2026-10-30

> 1.27.0 的补丁：神经音色在「DSH runtime 晚于插件装载」的宿主上会**永久不可用**。
> 现场是 Win10 22H2 —— 面板里「神经」开着，出声却是系统 SAPI，且没有任何提示。

### P0：解释器发现不再做进程级快照

- `resolvePython()` 只在缓存指向一个**仍然存在**的具体路径时才采信；落回 `python`
  时下次探测必然重扫。旧写法把首次结果钉死在模块变量里：DSH 的 runtime 若晚几秒才
  物化，一次「扫不到」就等于永久「没有」——连 `/tts/status?refresh=1` 也救不回来，
  只能重启宿主。这条是唯一会让用户做出错误归因的缺陷。
- 新增 `scanPythons()`：每次探测重新扫盘（`readdir` 很便宜）。候选根除
  `~/.dsh/dsh-runtimes` 外，加入 `<install>/resources/runtime` —— 安装目录自带的那份
  runtime 此前完全不在视野里，同一台机器上明明有可用解释器却被判成「没装」。
- 跳过 0 字节的 Microsoft Store App Execution Alias：`where python` 能找到它，
  `import edge_tts` 必失败，旧逻辑会把「没装依赖」伪装成「解释器坏了」。
- 解释器文件名按平台选择（Windows `python.exe` / 其余 `bin/python3`），非 Windows
  宿主不再永远找不到解释器。

### P1：降级不再无声

- 面板提示带出宿主给的 `neuralReason`：「神经音色不可用，改用系统语音：没装 edge-tts
  （试过 python / python3 / py）」——此前只有一句固定文案，用户无法区分「缺依赖 /
  没网 / 被限流」。`reason` 早就取到了，只是一直没渲染。

### P3（工程债）

- 新增 2 条回归：`usablePython` 拒绝 0 字节存根与不存在的路径；`scanPythons()` 只返回
  真实存在、且不含 `windowsapps` 的解释器。

**验证**：`npm test` — 171 tests / 170 pass / 0 fail / 1 skip（Win10 22H2，Node 24.21.0）；
`node build.mjs` 通过，`client.js` 仅 +8 行（提示那处）；补丁以 `git am` 回放后与原提交树
逐字节一致。

## 1.27.0 — 2026-10-29

> 依据 `AUDIT-2026-10-29-v1.26.1.md`（总评 73/100）：逐条核实后全部真实成立，本版按
> P0 → P1 → P2 → P3 顺序修订。**P0-1 改变了跨设备状态的语义**，是本版最需要读的一条。

### P0：跨设备状态（最该先修的一条）

- **设置不再被宿主旧快照覆盖**：`mergeHostState` 的「宿主有就覆盖本地」改为
  `updatedAt` 新者胜。客户端每次保存都记时间戳并 500ms 防抖回传 `/state`；宿主里那份
  更新时在响应里回 `{ stale: true, state }`，客户端采纳。老用户升级时由
  `ensureLocalStateAt()` 给现有 localStorage 补一个「刚刚保存」时间戳，保证本地不被旧快照打回。
- **history 对象化**：宿主侧不再 `String(x)`（那会把每条消息变成 `"[object Object]"`），
  只接受 `{ role: 'user'|'assistant', content: string }`；读侧把旧格式字符串丢弃并迁移
  （首次回传即把坏文件冲干净）。本机真实受害文件（8 条 `[object Object]`）已可自愈。
- `/state` 的 settings 走白名单（与 `DEFAULT_SETTINGS` 对账，测试会红）、POST 先验后计 +
  60 次/分钟限流、state.json 0600 / 目录 0700（P2-13）。
- 「恢复默认」现在也回传宿主（此前只清 localStorage，下次加载又被宿主旧值覆盖）。

### P1

- **P1-1 隐藏态不再卸载样式表**：`hidePet` 后只渲染一个带 `<style>` 的轻壳。
  🐾 召唤按钮的样式全部来自这份 CSS，此前一藏起来它就变成裸 `<button>`。
- **P1-2 pack 准入对齐渲染契约**：无 `image` 的包必须给完整 `colors`；
  `voice.pitch/rate` 必须是 0.3–3 的有限数；`temper` 必须是「心情 → 正数」。
  客户端 `setPersonas` 逐条过滤坏条目；渲染层给 `colors` / `voice` / `weighted()`
  加数据兜底；`PetOverlay` 外套一层 error boundary（真 React 下生效）回落到安全占位。
- **P1-3 视觉门禁不再假绿**：`tests/preview.mjs` 的 `toHtml` 递归展开函数组件
  （此前把源码当标签名拼进 HTML，页面 0 张 `<img>`、断言天然通过）；
  `tests/browser.mjs` 增加「≥40 张立绘 + 无 `<function>` 伪标签」断言。
- **P1-4 /pets 与 /assets 统一为只读资产闸**：只要求 Host + Origin，不强制
  `Sec-Fetch-Site`。桌面壳里 `<img>/<video>` 的 cross-site 加载不再 403
  （此前内置形象正常、自定义 pack 全部不显示）。变更类端点仍走三道闸。

### P2（功能/体验缺陷）

- P2-1 `statusBubbles:'off'` 也压住出现问候；P2-2 预热烤当前语言台词、串行发送、检查 `res.ok`，
  服务端单飞竞态修掉（先读 body 再「检查+占位」）；P2-3 `available:false` 直接降级为系统语音；
  P2-4 限流/自动播放被拦不再计入「三次降级」，重新打开「神经」开关会重置；
  P2-5 系统语音按界面语言挑嗓子；P2-6 通知文案读 `PET_LANG`；P2-7 聊天失败只显示本地化文案
  （origin/api/原文只进 console）；P2-8 公告/命令序号持久化（刷新不再重播 `hide`）；
  P2-9 `hidePet` 清 stage/menu/panelOpen/hover；P2-10 安静态补完（打哈欠趴下 / 醒来伸懒腰，
  `quietSince`/`wokeAt` 有了消费者，安静时停自发动作与恶作剧）；P2-11 开关改成可聚焦
  （`clip-path` 视觉隐藏 + `:focus-visible` 轮廓），Tab 能到、空格能切；P2-12 🐾 打开面板也调
  `placePanel()`；P2-14 神经语音探测会逐个试 DSH runtime 里的所有 python；
  P2-15 `.fx-*` 与表情贴纸规则全部收进 `.dsh-pet-layer`；P2-16 CI 补 focus/notify/state 用例；
  P2-17 `install.ps1` 的 `$keep` 补 `pets/`（`-Update` 不再留下旧 pack.json）。

### P3（工程债）

- 死导入清理（index.js 10 个 + `useCallback`）；`PetToggle` 的条件 hook 改为
  `SessionWatcher` 子组件；包里补 `tools/gen-personas.cjs` / `tools/push-via-api.cjs`
  （`npm run build` 与 `push-api.test` 在安装包内也能跑）；打断语音时回收 blob URL；
  `/tts/status?refresh=1` 限流 6/分；Config 的 maxTokens/temperature 补范围；
  客户端 45s 超时、4xx 不再换地址重试；超时后 `for await` 立刻退出；
  资产 URL 加 `?v=<version>` 击穿缓存；文档漂移（README 状态段、ROADMAP 版本、
  THIRD_PARTY_NOTICES 素材位置、prelude 挂载点注释、轮询注释）修正；
  i18n 补 `panel.langAuto`（zh/es/pt）与 hi 的梵文 description；
  新增「清空聊天记忆」入口 + 换形象时提示记忆是共享的；`data-phase` 有了 CSS 消费者；
  标题 `●` 前缀在标题被宿主改动后也能撤掉。
- 新增 `tests/state.test.mjs`：/state 往返与迁移、白名单、限流、权限、
  /pets 准入、pack 形状校验、客户端 updatedAt 语义与坏数据兜底。

## 1.26.1 — 2026-10-29

> 1.26.0 的补丁：修两处 CI 门禁问题。**npm 上的 1.26.0 请勿使用**——
> 它缺少下面第 ① 条修复，减弱动效的样式作用域不合规（功能可用，但审计门禁不过）。

- ① **CSS 作用域泄漏（CI 门禁 red）**：静立规则原写作裸 `.dsh-pet-figure{animation:none!important}`，
  作用域超出 `.dsh-pet-layer`，会命中 DSH 应用内任何同名元素——`tests/browser.mjs` 的
  减弱动效探针判「宠物元素移出 layer 后动画仍被关掉」而红。改为后代形式
  `.dsh-pet-layer .dsh-pet-figure` / `.dsh-pet-layer .dsh-pet-imgwrap`（探针优先取
  imgwrap，两者都要覆盖）。
- ② **中文注释里的反引号破模板串**：①那条规则上方的新增注释含反引号，而 CSS 是模板
  字符串——反引号提前闭合模板串，client.js 直接语法错误。注释里改用普通写法。
  （`npm test` 不覆盖 client.js 模板串的语法，靠 `tests/browser.mjs` 抓到。）

## 1.26.0 — 2026-10-28

> 两个批次合一：「她懂我」批次（失焦通知 + 失焦安静态，用户排第一的需求）与
> 「别烦我」批次（立绘摇摆 / 气泡挤位 / 切动作跳变三连修），外加把全部动作素材
> 从死区抠像切换到线性透射率抠像（黑鞋透底的根治）。

### 新功能：失焦通知 + 失焦安静态

- **失焦通知（用户 2026-10-28 排第一的需求）**：「跑一个 20 分钟的重构，切去浏览器，
  回来发现它 8 分钟前就跑完了」。现在一轮跑完（≥10s）且窗口失焦时，弹一条系统通知
  （纯 Web Notifications，Windows / macOS / Linux / 浏览器全平台，零宿主依赖——已核实
  插件 UI 经 `ctx.slots.register` 与页面同源同 document，`dsh-app://` 协议注册了
  `secure:true`，两种部署形态下通知都可用）。三层降级：系统通知 → 标题前缀 `● 跑完了`
  （永不失败，任务栏可见）→ 鞋上红点（预留）。权限申请挂在设置开关的 onClick 上
  （浏览器硬约束：非用户手势的 requestPermission 会被拒绝），拒绝则开关自动回弹。
  自证统计 `notifyStats`（sent/failed/lastReason）挂在 `__dshPet` 调试口——Linux 无
  通知守护进程、macOS 系统静音、权限被撤这三种静默失败只有 show/error 事件能说实话。
  默认关（`turnNotify`），`off | long | all` 三档……实际实现为布尔开关 + 10s 阈值 +
  90s 冷却 + `tag` 去重。
- **失焦安静态**：失焦超 60s（`QUIET_AFTER_MS`，用户拍板，考虑共享屏幕开会场景）自动进
  安静态——气泡静默、语音静音、停止自发动作；重新聚焦「醒」过来。右键「勿扰 1 小时」
  手动开启（`quietUntil` 只存内存不落 localStorage，避免「昨天设的勿扰今天还生效」）。
  安静态下 `announce` / `chatAck` / `chatErr` 三类「有事」台词仍放行（外部脚本点名要她
  说话属于有事，不属于自嗨）。

### 修复：立绘摇摆 / 气泡挤位 / 切动作跳变（用户 2026-10-28 连续三轮反馈）

- **立绘完全静立**：`.dsh-pet-figure{animation:none!important}` 一次性压死基础层
  `dsh-pet-breathe`（上下浮 1.5px）、`.mood-walk` 的 `dsh-pet-stroll`（±18px 横移）等
  全部 CSS 自造动作——图片形象的动感自此只由动作视频提供。fig-* 系列 9 个 keyframes
  与 8 条规则作为死代码删除（README「走路 −5/+13px 步幅」等描述同步删除，测试改
  反向断言防回潮）。SVG 形象（仅示例包）不受影响。
- **气泡不再挤动人物**：root 在「拖动过 / 有保存位置」时是 top 锚定，气泡作为 flex
  流内元素一出现就把角色往下顶。现改为 `.dsh-pet-top` 绝对定位浮层（bottom:100%），
  人物位置与气泡有无完全解耦。
- **切动作不再忽大忽小 / 横向跳**：动作视频按全片并集裁切，人物只占画布 73%~97% 而
  立绘几乎顶满，两边都 `height:100%` 时人物视觉大小突跳。新增 `tools/measure-clipfit.mjs`
  用 alpha 通道实测每个片段的人像占比，生成 `clipFit`（s 缩放 / y 脚底基线 / x 横向
  居中三分量）写入 pack.json，渲染层经 CSS 变量应用。五形象全覆盖，换素材后必须重跑。
- **azure 表情立绘横向偏移**：实测 happy/shy/angry/sleep 相对 idle 整体左移 16~24px，
  切表情横向跳。新增 `imageFit`（按文件名记录水平补偿），四张补 3.5%~5%。
- **换表情纯淡化**：交叉淡入原来带 ±3px 位移 + 0.6% 缩放（模仿运动模糊），在超写实
  静帧上被读成「一切表情人就往旁边跳一下」。改纯透明度过渡（静帧之间实测中心差
  ≤0.5px，不需要位移补偿）。

### 素材：线性透射率抠像（黑鞋透底的根治）

- **根因三连**（用户绿幕截图最终定位）：① 死区公式 `dom>0.12 → alpha=0` 把半透明漆皮
  鞋底整个抠掉（绿幕直接透过材质，亮度分位证明绿色领先像素全是 luma≈0.69 的绿幕本体，
  不是「暗一档的反光」）；② 首次修复只补 alpha 不重建颜色 → 鞋变成实心绿块；③ 封闭
  空洞检测被腿缝骗（两脚并拢把腿缝封成闭合区，和误扣区在尺寸上同档）。
- **线性透射率公式**（`batch-key.py` 新默认，`--dead-zone-alpha` 保留旧公式）：
  黑鞋叠绿幕，材质透射率 t ⇒ 观测色 ≈ 绿幕色 × t ⇒ `dom ≈ t × dom_bg` ⇒ `alpha = 1 - t`。
  纯绿幕 t=1→alpha=0；不透明 t=0→alpha=1；半透明鞋底→中间值（该有的半透明质感）。
- **深色空洞补回**（`tools/fill-dark-holes.py`，stage 管线默认开启）：封闭 + 深色（luma<
  0.35）+ despill 后含内容（`max(R,B)≥0.02`，防把纯绿腿缝填黑）三判据联合，补 alpha
  的同时用 `cv2.inpaint` 从周围黑鞋重建颜色。腿缝等亮色镂空不碰。
- **17 个片段重出**（`tools/regen-clips.py` 按形象并行；源映射经多帧剪影 IoU 匹配固化到
  `tools/clip-sources.json`，四个文档记载的 dance 源全部吻合）。体积 19.9 → 15.9 MB
  （线性 alpha 更干净，编码效率更高）。
- **azure 三个片段（dance/walk/hair）例外回滚**：其 2K 源绿幕布光不均（暗绿区 dom≈0.55），
  线性公式把背景判成 ~40% 不透明（bg-alpha 66~92 实测）——半透明材质和暗绿背景在
  dom 特征上不可分，公式层面无解，保留旧死区管线素材。`regen-clips.py` 已加**背景透明度
  验收门**（四角 alpha>10 拒绝覆盖），此类事故在工具层被拦。

### 工具与文档

- `tools/measure-clipfit.mjs`：clipFit/imageFit 生成器（alpha 通道逐帧测量，取中位数）
- `tools/map-clip-sources.py`：源视频识别（多帧剪影 IoU + 帧数过滤）
- `tools/regen-clips.py`：全量重出（含背景透明度验收门）
- `tools/fill-dark-holes.py`：深色空洞补回 + 颜色重建
- `stage-pipeline.py` / `batch-key.py`：线性 alpha 默认化，补洞并入 stage 管线
- `gen-personas.cjs`：修了对象键含 `.`/`-` 时不加引号的语法错误（imageFit 文件名做键
  必炸）；`clipFit`/`imageFit` 入字段序
- README：「约 15MB（受 20MB 门禁约束）」包体口径、立绘静立描述更新、
  「走路步幅」等 CSS 动作描述删除；五语新增勿扰 / 通知词条

## 1.25.0 — 2026-10-28

> 审计挂账四项落地批次（`AUDIT-2026-10-28-fixplan.md` §2 中被评为最有价值的 ①③④ 与 ②）。

- **分辨率分档重出（4K 屏适配，用户 175% 缩放 + 2.0× 宠物实测验收）**：显示链算账——平时需要
  ~700px 素材、stage 跳舞（1.8× zoom）需要 ~1260px，全线 640 意味着平时 1.09× 放大、跳舞 1.97×
  拉伸。母版配对恢复（颜色定人 + 双帧姿势 IoU 定 take，全部 IoU≥0.94）后分档重出：
  - **5 条 stage 片段 → 960**：2K 母版（2528px）单代重出（CRF 42 + sharpness3 + aq-mode2，
    `stage-pipeline.py` 新增 `--crf`），跳舞场景从 1.97× 拉伸降到 1.3×；对 CRF38 版抽检 VMAF 95.5；
  - **8 条 hair/walk → 768 原生**：四只原版的 768 母版此前白白下采样到 640，现按原生高度单代重出；
  - **鲸鱼娘主立绘 315×640 → 468×950**：从 1024×1536 母版重嵌（构图与现版对齐，落位自检 0.02）。
    **表情立绘考证与补全（2026-10-28）**：表情生成源在游戏素材大师的 `azure-expressions` job
    （`~/.dsh/game-material-master/image-jobs/imvqtx3dob93552`，prompt/参数完整保留），
    但该 job 被四轮表情复用、每轮同文件名覆盖，只幸存「生气」的两个 take——已重嵌 950。
    其余三张（开心/害羞/困）由用户以新 950 基座为参考图、按原 prompt 模板重新生成
    （三张 1024×1536 绿幕图），同管线抠像重嵌 950——**五张立绘满配 950**；
    人物尺寸/落位逐张对齐现版画布（偏差 ≤0.003），新生成的人物面孔与旧版有可接受差异；
  - 7 条 dance/azure 短片段配对到 2K 母版，本批不动（映射已记录，留作后续 960 选项）。
  资产 14.51 → **18.76MB**（20MB 门禁内），包体约 19MB；资产测试高度断言改为分档
  （stage 960 / hair·walk 768 / 其余 640）。
- **瘦身：20 条动作片段同分辨率重编码，包体 19.9MB → 15.5MB（−22%）**。分辨率/帧率/时长
  一个没动（640px / 24fps / VP9+alpha），只按片自适应 CRF 44→42→40 挤码率。每条过两道
  质量闸：原生分辨率 libvmaf ≥ 93 + alpha 平面 SSIM ≥ 0.95；alpha 边缘复杂的两条 walk
  用 CRF 40 补救，`pet-violet-walk` 连 40 都到不了 alpha 闸、保留原样——19/20 成功，资产
  19.64MB → 14.51MB（20MB 门禁恢复余量）。工具 `tools/slim-clips.sh`（一次性：重复跑产生
  代际损失）。曾试加「0.5× 缩放 VMAF」第三道闸后撤掉——VMAF 模型对小分辨率不稳定，
  同片全分辨率 93 分、缩半 75 分的矛盾值只会误杀。真 Chromium 播放验证见 browser 冒烟；
  新旧中帧对比图 `preview-slim-compare.png`（工作区本地生成，不入库）。
- **CI 补盲区（test.yml 三 job）**：新增 browser job——Playwright + 真 Chromium 里立绘
  真加载、三条代表片段（两条瘦身 + 一条原样对照）真能播、prefers-reduced-motion 下三方向
  断言（宿主探针动画必须在 / 宠物在 `.dsh-pet-layer` 外必须还在动 / 在 layer 内必须关掉
  ——R-03 泄漏的端到端回归），截图存 artifact；新增 windows job（npm test 全套首次跑在
  主平台，此前 CI 只有 ubuntu）。`tests/browser.mjs` 用库模式不起 test runner。
- **文档数字单一源（tests/readme.test.mjs，9 条口径）**：交叉淡入毫秒 / 默认缩放 / drag
  60% / 心声 7% / 撩发 0.8%/tick / 帧步长两档 / 走路步幅 / 形象数 / 包体声称——每条
  「从代码提取真值 → 断言 README 写的就是它」，改码不改文档（或反之）直接红。清单同步进
  package.json ×2 / release.cjs / test.yml / release.yml（这个五处同步坑本身就是审计踩过
  一次的，这次全部对齐）。
- **读屏：闲聊气泡不再打断屏幕阅读器**。`bubble` 记录类别；单聊回复/错误/外部播报
  （chatAck/chatErr/announce）保持 `role=status` + `aria-live=polite`，心情台词、出现问候、
  被戳被拖这类装饰性气泡改 `aria-hidden`。
- **视线跟随短路**：五只内置全是照片立绘、没有瞳孔层（`.dsh-pet-pupils` 是 SVG 形象
  专用），原先每次 mousemove 都 `getBoundingClientRect`（强制 reflow）写没人消费的 CSS
  变量——照片形象现在直接跳过。
- **修 preview 工作流（静默坏已久）**：`tests/preview.mjs` 的 localStorage 桩全返回 null，
  1.19.3 起 `__dshPet` 自检口要 `dsh-pet.debug=1` 才挂，生成必炸；第二张挂件预览还硬编码
  远古形象 `gremlin`。两处修复后 README 里的预览命令重新可用（顺带：标题的「三种形象」
  改为动态数）。
- 测试 106 → 115；`npm pack` 19.9 → 19.5MB / 146 files；构建两次 sha1 一致、`gen:check`
  逐字节一致。（分辨率分档后为约 19MB / 146 files。）

## 1.24.1 — 2026-10-28

> 本版为 2026-10-28 全量审计的修订批次，逐项依据与核实证据见 `AUDIT-2026-10-28-fixplan.md`。

- **修：活跃时段设置每次重载被静默重置**。`CLOCK_RE` 曾误写成 `\\d`（正则字面量里那是
  「字面反斜杠 + 字母 d」），任何合法时间都校验失败，重载后回落默认 09:00–23:00——用户设的
  「22:00→03:00」一直存不住且无任何报错。附两条回归测试（从构建产物提取正则实测 + 预置
  localStorage 的设置往返）。（审计 R-01）
- **修：鲸鱼娘与用户自定义形象单聊时被当成「薇」**。宿主侧 `PERSONA_INFO` 只登记了四只，
  1.23.0 加第五只时漏了同步，`personaById('azure')` 静默回落 violet，用户 pack 同理。
  现在单聊人设优先读运行期注册表（宿主侧扫描的 pack 数据，服务端可信输入），内置表兜底并
  补上 azure；`PREFERRED_IDS` 两处（registry / gen-personas）同步补齐。素材存在性测试从
  硬编码四只改为扫目录（排除模板），新形象自动进覆盖。附 personaById + chat e2e 两条测试。
  （审计 R-02）
- **修：减弱动效的通配选择器泄漏到宿主**。`@media (prefers-reduced-motion)` 里用了裸
  `*`，而这份 CSS 是 `<style>` 直接注入主文档的（无 shadow DOM）——OS 开「减弱动效」时，
  整个 DSH 应用的动画/过渡都会被插件关掉。已加 `.dsh-pet-layer` 作用域（菜单/面板/特效层
  都是它的 DOM 子孙，覆盖完整）。（审计 R-03）
- 小修一批：`/ping` 轮询 URL 去重（`base` 为空时同地址失败会白跑一轮 8s 预算）；右键菜单
  边框引用未定义的 `--pet-bd`（改 `--pet-border`）；`checkNeural` 一次网络抖动就永久降级
  （改「置未知 + 下次说话重试」，明确 `available:false` 才降级）；单聊加 90s 客户端超时
  （原先挂起的 fetch 能让「……」气泡挂到浏览器超时）；`chatTimeoutMs` 进 `Config` schema
  （原是读得到配不上的死配置）；「重置全部」软复位（不再 `location.reload()` 重载整个
  DSH）；片段兜底注释「20s」对齐实际 12s；内置 `/assets` 路由不走准入的理由写进注释。
- 死代码清扫：`runtime.chatOpen`（1.22.0 前残尸，从未置 true）、`runtime.input`、设置面板
  残留的 `voicePitch/voiceRate` 条件、死音色键 `xiaomo`（键名与实际音色 Yunxi 不符且零
  引用，五语 `voice.xiaomo` 键同步删）。
- i18n：客户端三处硬编码中文（单聊错误气泡 / 状态点 title / 形象悬停提示）进五语键
  （`chat.*` / `dot.*` / `actor.tip`）；`hint.privacy` 四语不再是英文原句；`panel.lang`
  /`panel.settings` 各语本地化；hi 补译 14 个与英文逐字相同的键 + `meta.title`（天城文）。
- 打包修复：`tests/assets-manifest.json`、`tests/voices.json` 进包——原先依赖它们的两个
  测试 .mjs 在包里、数据文件不在，装到 profile 后一跑就 ENOENT。
- 文档：五语 README 十处过期口径修正——体积「2MB」→ 约 20MB（受 20MB 门禁约束）、交叉
  淡入 240→180ms、帧况（3–6 帧 / 230ms）、走路幅度 −5/+13px、es/pt/hi 的鲸鱼娘表情立绘、
  面板跟随宠物位置、assets 扩展名含 webm、license 口径、「7 种心情」「3 形象」计数。
- 测试 101 → 106，全绿；构建产物两次生成逐字节一致；`gen:check` 逐字节一致。

## 1.24.0 — 2026-10-27

- **补齐：薇 / 绯 / 靛 / 雪 的「被拖动」与「心声」台词**（各 5 条 drag + 8 条 aside，五语）。
  1.21.0 给鲸鱼娘做了这两条机制并只给她写了台词，另外四只没有——
  结果是拖鲸鱼娘她会吭声、拖另外四只一声不吭，观感不一致。
  现在五只齐备，按人设差异化：
  - 薇：从容挑逗（「这么急？我可是很沉的。」）
  - 绯：明目张胆（「再往前一点，我就靠上去了。」）
  - 靛：慢火慢炖（「慢一点……不用这么赶。」）
  - 雪：冷淡短句（「手。收回去。」——她既有 `poked` 也有 4 字的，短是刻意的）
- **测试改法**：`runtime.test.mjs` 里两条用例原先靠「薇没写这类台词」来验证降级机制，
  数据补齐后前提消失。改为**人为挖掉五语的该类别**再断言（只删中文会被 `linesEn` 兜住），
  这样验的是机制本身而不是当前数据；同时新增「五只都必须有 drag/aside」的防回归断言，
  将来新增形象漏写会立刻变红。两种故障注入（代码回落 idle / 数据漏写）均已实测会红。
- 测试 101/101。

## 1.23.0 — 2026-10-27

- **新：鲸鱼娘有了与另外四只同等的独立表情立绘**（happy / shy / angry / sleep）。
  之前她 9 个心情全指向同一张 `pet-azure.webp`，表情只能靠贴纸（腮红 / 💢 / z / ✨）表示；
  另外四只是整张立绘换表情。现在补齐 4 张，`images` 映射与其它四只同构
  （`dance → happy`、`poked → shy`）。
  四张由原立绘做参考图图生图（同一人物/服装/绿幕），再走 `batch-key.py` v9 抠像。
- **一致性处理**：抠像后按原立绘的画布规范统一重嵌——315×640、人物高 630、
  底部留白 3px、水平居中对齐。四张共用同一裁剪框（`222,18,885,1527`），
  否则切表情时人物会整体放大或平移，看起来像「跳了一下」。
  资产基线 83 → 87，`gen:check` 与构建可复现均通过。
- **附带变化**：因为 `80-art.js:218` 的规则是「有独立立绘就不再叠贴纸」，
  她的 shy/angry/sleep/happy 现在不再显示那四个贴纸，与另外四只行为一致。
- 测试 101/101。

## 1.22.0 — 2026-10-27

本轮全部来自用户装 1.21.0 实机验证后提的三条。第 1 条**第一版做错了对象**（把头顶台词气泡
当成了输入框），用户指出后回退重做，下面记录的是最终实现。

- **改：输入框平时不可见，鼠标移到人物上才滑出**。之前「跟她说句话」那个输入框一直占着
  右下角。现在默认收起，鼠标移到人物上滑出、移开 200ms 后收回（预留穿过多大间隙的时间，
  避免从人物移到输入框时闪一下）。两处例外：**聊天框打开时**与**输入框获得焦点时**保持展开，
  否则鼠标还没点进去它就没了；键盘 Tab 进入同样有效。
  设置面板新增「悬停才显示」开关，关掉即恢复常显（`inputMode: hover|always`，默认 hover）。
  旧的 `showInput` 语义不变（false = 整行不渲染）。
  > 首版误把**头顶台词气泡**做成了悬停触发，用户指出对象错了，已完整回退，
  > 气泡行为与 1.21.0 一致。
  > **第二版修了「很难命中」**：首版只把 `onPointerEnter/Leave` 挂在人物本体上，
  > 而输入框是它的**兄弟节点**——鼠标一离开人物，pointerleave 立即触发，200ms 宽限
  > 只是把这一刻推迟，人还没走到输入框就收起了，所以表现为「偶尔能进去」。
  > 现在人物与输入框放进同一个 `.dsh-pet-hoverzone` 容器，两者之间移动不算离开。
  > smoke 里加了一条**结构断言**钉住这件事（输入框与人物必须共享同一个 hoverzone 祖先），
  > 因为只测 `setHover()` 的逻辑是抓不到这类「事件挂错节点」的。
- **修：设置面板钻进顶栏，右上角 × 点不到**。`placePanel()` 原来只夹到视口 `top>=8`，
  宠物拖到屏幕上方时面板顶部被 DSH 顶栏盖住，× 明明可见却点不着。新增 `headerSafeArea()`：
  优先量覆盖层父容器的 `top`，其次查常见顶栏选择器，最后回退 44px；面板让开这块安全区。
- **修：面板头部吸顶**。低分辨率下面板内容需要滚动时，× 始终固定在可视区顶部。
- **修：面板高度按可用区域自适应**。`maxHeight` 由「顶栏以下、视口以内」推算，
  低分辨率自动变矮并内部滚动。600 / 768 / 900 三档都有用例。
- 测试 101/101（新增 5 项）。其中「顶栏避让」与「移开有宽限期」两条用**故障注入**验证过：
  把修复退回去，对应测试立即变红（实测，非声明）。

## 1.21.0 — 2026-10-27

本轮是竞品（@linxin666/dsh-pet）反哺：逐条核实竞品实现后采纳 R-01～R-10 修订
（R-05 经回填判定不实施）。完整核实与处置记录在
`FANFEED-competitor-review-2026-10-27.md`。

- **新：形象注册表从构建期搬到运行期**（R-01）。`src/30-personas.js` 仍是内置兜底，
  宿主启动时扫描 `$DSH_HOME/dsh-pet/pets/<id>/pack.json`（`license` 必填，R-10 门禁），
  与内置五只合并后经 `GET /dsh-pet/personas` 下发；客户端 `setPersonas()` 空表拒收、
  当前形象失效自动回落，`assetUrl()` 支持每形象独立资产基址（内置 `/dsh-pet/assets`、
  用户 `/dsh-pet/pets/<id>`）。换形象不再需要重新构建 client.js。
- **新：事件投影补全**（R-02）。宿主侧 `turn/start`/`step/start`/`tool/call`/
  `assistant/message`/`turn/end`（含新版 `tools/result` 与旧版 `tool/result`）投影为
  `working/tool/review/done` 相位，`/ping` 直出 `phase`（15s 新鲜窗口）；客户端
  `computePhase()` 融合宿主相位——thinking/working→走位、review→撩发（回答正在流）、
  done 前 4s 保持庆祝。
- **新：外部播报 + 自动台词开关**（R-03）。`POST /dsh-pet/announce`（限流 30/分，
  文本 ≤300 字，seq 防重放）让脚本/其他插件让桌面伴侣开口；机会主义探测宿主进程内
  `ctx.pet?.announce`。设置新增 `statusBubbles: auto|off`——off 时心情/问候/闲聊自动
  台词静默，点按/拖拽/announce 播报不受影响。
- **新：状态落宿主盘 + 一次性迁移**（R-04）。`GET/POST /dsh-pet/state`（settings ≤64 键、
  history ≤200 条 ×8000 字符，白名单校验）；客户端启动时宿主优先合并，无宿主状态则把
  localStorage 上云，换浏览器/清缓存不再丢形象和历史。
- **新：台词运行期覆盖**（R-07）。`$DSH_HOME/dsh-pet/voice.json`
  （`{"<personaId>|*": {"lines": {"<mood>": [...]}}}`，五语键 lines/linesEn/linesEs/
  linesPt/linesHi）按 mood warn-and-drop 合并，坏包整体忽略不拒载；经 /personas 下发，
  客户端零改动。
- **新：jsdom 组件级测试**（R-08）。`tests/overlay.dom.test.mjs` 在真 DOM 里跑 client.js：
  菜单项全部为 `button[role=menuitem]`（键盘可达）、Escape 关闭菜单、视频 error 事件
  撤 `<video>` 回静帧且 `clipFailed` 记忆。菜单遮罩补 onKeyDown Escape。devDeps 加
  react/react-dom/jsdom（不进包）。
- **新：用户目录资产防线**（R-06，R-01 前置）。`/dsh-pet/pets/*` 走 realpath 双侧包含
  检查 + 扩展名白名单 + 注册表准入 + 413；`/dsh-pet/assets` 静态文件超 20MB 返回 413。
- **新：peer 声明补正**（R-09）。peerDependencies 补 `"react": ">=18.2.0"`——运行时
  `require('react')` 早是事实 peer。
- **新：分发合规**（R-10）。每个 `pets/*/pack.json` 声明 `license`；根目录
  `THIRD_PARTY_NOTICES.md` 随包分发；assets.test 增 license 存在性门禁。
- **改名：「桌宠」→「桌面伴侣」**。产品名在界面与文案层统一改为「桌面伴侣 /
  Desktop Companion」（面板标题、右下角切换按钮、斜杠命令说明与回执、聊天 system prompt
  里的自称、`icon.svg` 的 aria-label、五语 locale 的 meta.title/description）；包名、
  目录名、路由前缀 `/dsh-pet` 不变。历史台账（AUDIT/FANFEED/CHANGELOG 既往版本）与
  ROADMAP 里引用的注册表检索关键词保持原样，不做追溯改写。
- **修：文档里「四只形象 / four personas」等过期计数**。README 五语、CONTRIBUTING 与
  官方列表条目脚本统一到「五只」，并如实标注**只有薇/绯/靛/雪四只各带五张表情立绘
  （基础 + happy/shy/angry/sleep），鲸鱼娘目前只有一张基础立绘**，表情靠 SVG 面部叠加。
- 测试 96/96（新增 jsdom 3 项、voice 覆盖 6 项、assets license 门禁 1 项）。
- **修：改名只改一半，`npm test` 是红的**。`locale/en.json` 的 `panel.title` 已改成
  `Desktop companion`，但 `tests/smoke.mjs` 仍断言 `Desk pet`。现在断言直接读
  `locale/en.json` 的真值，下次改名不会再出现「改了文案忘改断言」。
- **修：zh/es/pt/hi 语言包被生成器静默回落成英文**。`tools/gen-locales.cjs` 的四张覆盖表
  都漏了 1.20.0 新增的 8 个键（`panel.stay`/`panel.cheer`/`voice.auto`/`voice.hsiaochen`/
  `voice.xiaobei`/`panel.pitchTrim`/`panel.rateTrim`/`panel.voiceEff`），重新生成后 zh 面板
  里出现「Stay a while」「Cheer up」这类英文。已逐语补回覆盖表，并**新增门禁**：非 en 语言
  的值若与 en 完全相同即判漏译（白名单里只有外来词与 DSH 等术语，逐条注明理由）。
  该门禁已用故障注入验证——删掉覆盖表任意一项会立刻报出对应键。
- **修：`npm test` 偶发卡死不退出**。TTS 用例会真的走合成路径并拉起常驻 Python worker，
  测试收尾没回收，`node --test` 跑完仍挂在 event loop 上；单独跑某个文件时 worker 未拉起
  故不复现。`tests/host.test.mjs` 加 `test.after(() => killWorker())`。连续三轮 96/96、
  每轮约 31 秒。
- **修：jsdom 组件测试从未进过 CI**，且 `package.json` **没有声明** `jsdom`/`react`/
  `react-dom`（CHANGELOG 当时写了「devDeps 加」，实际只在 workspace 根目录装了，别人
  clone 后跑 `npm test` 会直接失败）。现补 `devDependencies` 并让 `test.yml` 与
  `release.yml` 都装上依赖、都跑 `overlay.dom.test.mjs`；两份清单此前已漂移。
  顺带修掉 `test.yml` 新步骤标题里的裸冒号——那会让**整个 workflow 文件无法解析**。
- **台账回填**：`FANFEED-senior-review-2026-10-23.md` §7 的 20 行此前全标「待修」而 §9
  已记录全部落地；现逐行回填到实际状态。`AUDIT-full-2026-10-22.md` 的 P4/P5 由
  「✅ 待发」更正为「✅ 1.17.0 已发」。

## 1.20.1 — 2026-10-26

本轮是 1.20.0 的审查反哺：先把全部结论对着当前源码核实，再按报告顺序修，
没有把「代码里已有修复」当成「已经验证过」。完整核实记录在
`FANFEED-1.20.0-review-2026-10-26.md`。

- **修：设置面板的脏数据可以一路流进渲染和请求**（审计 P1-1）。`loadSettings()` 原来只校验
  `persona` 和 `mode`，其余字段把 `localStorage` 里的 JSON 直接吃下去——手改过存储、旧版本遗留、
  或别的插件写坏同名键，都能让 `scale` 变成 `"big"`、音量变成 `99`、概率变成 `-5`、
  定时器间隔变成 `0`。现在 `normalizeSettings()` 逐字段过：枚举按白名单、数值按 `Number.isFinite`
  + 区间夹取（`probability` 0–100、`volume` 0–1、`pitchTrim` 0.85–1.15、`rateTrim` 0.8–1.25、
  `scale` 0.5–2、`pos` 各轴 ±100000）、时间走 `HH:MM` 正则、布尔只认真正的布尔。
  非法值一律回默认，不再尝试「修一修继续用」。
- **修：聊天请求没有服务端超时，上游挂住就一直挂着**（审计 P1-2）。`/dsh-pet/chat` 原来只监听
  `req` 的 `close`，`ctx.llm.stream()` 没有 `AbortSignal`，也没有等待上限。现在加了
  `chatTimeoutMs` 配置（默认 30000，夹取 1000–120000），超时立刻 abort 模型流并返回
  `504 llm-timeout`；顺带修掉一个反向的坑——`close` 在**正常读完请求体之后**也会触发，
  旧写法会把它当断连，把已经拿到的回复丢掉。现在只有 `req.readableAborted || req.destroyed`
  算断连。
- **修：`/ping` 轮询在网络异常时按固定节奏空转**（审计 P2-2）。可见时 8s 一次、不可见 30s 一次，
  这个节奏不变；但连续失败会指数退避（`baseGap × 2^min(failures,4)`，上限 120s），
  成功一次立刻回到基础节奏。宿主侧断网或重启时不再每 8 秒白撞一次。
- **新：资产门禁从「只要没动过」升级到「尺寸/时长/编码也要对」**（审计 P2-1）。
  `tools/assets-manifest.cjs` 现在对每条 WebM 跑 `ffprobe`，把宽高、时长、`vp9`、像素格式、
  alpha 模式一起写进 `tests/assets-manifest.json`；`tests/assets.test.mjs` 逐条断言，
  并加总预算 20 MB。普通片段期望 5167ms、`-stage` 片段期望 10125ms——两者本就是不同批次，
  门禁按文件名区分，不再拿一个常数硬套（第一次跑就是被这条抓住的）。
- **修：`package.json` 的描述把五只角色写成四只**（审计 M3）。npm 包页和面板元数据都读它，
  1.20.0 加了鲸鱼娘之后这里一直是旧文案，改成「五只」。
- **文档**：README / README-zh 的资产段补上「640 高、普通 5.167s / stage 10.125s、
  门禁记什么、总预算 20 MB」，不再只写一句「VP9 + alpha」。
- **弃用**：`dsh-plugin-dev check --strict` 不再作为本仓库门禁——新宿主已不随包提供该工具
  （`app.asar` 内只剩 `cordis-plugin-development` 技能文档，`@deepseek-ai/` 下也没有 `dsh-tools`）。
  替代证据是三条：宿主加载期校验、`install.ps1 -Verify`、本机真实宿主实跑。

**验证**：`npm test` 86/86（新增 4 条：设置归一化、正常 close 仍返回模型结果、超时
AbortSignal 返回 `504`、轮询失败退避）；`git diff --check` 干净；`npm pack --dry-run` 135 files、
packed 19,675,824 B；`install.ps1 -Verify` 在 Windows PowerShell 5.1 上通过；本机真实宿主
`/dsh-pet/ping` 返回 `toolEvents:"ok"`、`/dsh-pet/tts/status` 返回 `available:true` + 23 个音色。
仍未做的是 CI 内的浏览器/跨平台自动化矩阵（本机可用是人工确认，不是可回归的门禁）。

## 1.20.0 — 2026-10-25

- **新形象：鲸鱼娘**（`azure`）。深海蓝渐变长发、鲸鳍状耳朵、腰后鲸尾的女仆装，
  照片写实棚拍质感（1024×1536 绿幕种子图，抠像走 `batch-key.py` v9）。
  台词五语齐备（中 / 英 / 西 / 葡 / 印地），人设标签「深海蓝 · 乖巧可爱的诱惑」。
- **「走到屏幕中间跳舞再走回角落」改成一条连贯视频**（五只角色全覆盖）。
  做法：每个角色新增一条 **10s 单镜头**片段 `pet-<p>-stage.webm`——走进来 → 中间跳 → 走回，
  `runToCenterAndDance()` 在播放期间按片长百分比平移位置，全程**不切片段**。
  旧的「走路片段 + 跳舞片段」接法在切换点会闪一帧静帧（新 `<video>` 未 `playing` 时露出底层立绘）
  再加尺寸跳变（各自自动求并集裁切，人物像素尺度差 1.7%），这条路上抖动无法根治。
  编舞按人设差异化：薇（半速慵懒 + 侧身回头）、绯（大振幅 + 整圈转身 + 甩发）、
  蓝（先抑制后升温 + 双手框头）、雪（极慢 + 背对回头）、鲸鱼娘（手贴脸颊顺颈下滑）。
- **修：片段时长不再写死 5.167s**。原来 `CLIP_DURATION_MS` 是全局常量，
  凡是长过 5.167s 的片段都会在半途被卸掉（画面硬切回静帧）。现在以媒体自己的
  `loadedmetadata` 为准写进 `runtime.clipMs`，收尾时间按真实片长重排，自然播完仍由 `onEnded`
  收口；metadata 还没到手时用 12s 宽上限兜底。
- **修：人不在屏幕上还在说话**（用户报「有时候人物不在桌面了，可她还在说话」）。
  音画同步只认一个判据 `onScreen()`（可见 + 未被拖出视口 + 已挂载）：
  `bubble()` 先过闸（不可见连台词都不挂），`speak()` 再过一次闸，合成回来时**再判一次**
  （TTS 是异步的，几百毫秒后人可能已经被藏起来）；被拖出视口时立刻 `stopVoice()`。
- **修：神经语音又变成不可用**。真因是 `edge_tts` 只装在 `python`（3.14）一个解释器上，
  而探测只试一个名字；这台机器上还有 `python3` / `py`（3.15-32，没装）。现在按
  「算出来的 → `DSH_PET_PYTHON` → `python` → `python3` → `py`」逐个试，第一个能 import 的就作为
  御用解释器（探测结果与 worker 共用同一个）；`/dsh-pet/tts/status?refresh=1` 可跳过 5 分钟缓存，
  装完依赖当场就能刷出来，不必重启。`reason` 也会列出试过哪些解释器。
- **修：`install.ps1 -Update` 会装进「源码新、产物旧」的包**。它原来只复制文件、不重建
  `client.js`，导致 `src/30-personas.js` 已有新角色而页面里看不到（用户报「除了鲸鱼娘，
  其他四个人物好像没有变化」）。现在安装前强制 `node build.mjs`，失败即中止安装。
- **新机制：心声（内心 OS）**。正式台词之外，形象可以自带 `lines.aside`，低概率（7%）在旁边
  多冒一句灰色斜体小字，例如「( 其实尾巴刚才撞到椅子了，不能承认。)」。心声**不出声**
  （内心独白配上语音会变成自问自答），存活时间比主台词短，跟着主台词一起消失；没写 `aside`
  的形象完全不受影响，也不会拿 idle 台词顶替。
- **新机制：被拖动台词**。拖着她换个位置、松手时按 60% 概率说一句 `lines.drag`
  （「哇——轻、轻一点！尾巴会打结的……」）。这两类新台词都按「精确分类」取值
  （`linesOf(mood)`）：缺哪类就安静，不回落到 idle，免得答非所问。
- **鲸鱼娘台词重写**（借 `dafeiyu-persona` 的结构，不借它的毒舌）：11 类 × 五语，
  加入专属自称（「小鱼我」）、海洋与吃货词（小鱼干、冒泡泡、游走、晕鱼了）、
  傲娇触发点（被戳 / 被拖时嘴硬）；`error` 类保持得体，不卖萌。1.20.0 起鲸鱼娘是唯一
  同时有心声与拖动台词的形象，辨识度高于其余四只。
- **措辞修正**：右键菜单与面板里的「叫出来 / 打个招呼」这两处逻辑其实是「在她已经可见时
  再待一会儿 / 让她开心一下」；她藏起来后整层不渲染，菜单根本点不到。菜单项改为「再待一会儿」、
  面板按钮改为「开心一下」；输入框旁的 🐾 按钮在她不可见时才显示「叫出来」。
- **修：五个音色键指向已经下线的发音人**。`pack.json` 里的 `lucia`（西语）、`thalita`（葡语）、
  `ananya`（印地语）与 `TTS_VOICES` 里的 `xiaomo` 在现行 edge-tts 里**都不存在**；
  合成会失败并静默回落系统 SAPI，听起来就是「说着说着突然变成机器人」。
  现在改为真实存在的发音人（`xiaomo` → `zh-CN-YunxiNeural`、葡语 `thalita` → `pt-BR-ThalitaMultilingualNeural`），
  并新增 `sonia` / `natasha` / `neerja` / `elena` / `salome` / `camila` / `raquel`。
- **英 / 西做到「一人一声」**（本机 edge-tts 女声：英文 24 个、西语 23 个、中文 8 个、葡语 3 个、印地语 1 个）。
  英文：薇 Sonia（英）、绯 Aria（美）、蓝 Neerja（印）、雪 Natasha（澳）、鲸鱼娘 Michelle（美）；
  西语：薇 Elvira（西班牙）、绯 Dalia（墨西哥）、蓝 Elena（阿根廷）、雪 Salomé（哥伦比亚）、鲸鱼娘 Camila（秘鲁）。
  **葡语只有 3 个女声、印地语只有 1 个**，这两门语言做不到五只全不同，只能靠音高/语速区分（如实说明，不假装解决）。
- **新增 `tools/voice-inventory.mjs` + `tests/voices.json` 快照 + 两条离线断言**：
  「音色表引用的发音人必须真实存在」「每只形象的五语键都有效，且 en/es 至少三种不同嗓子」。
  服务端悄悄下线发音人这类事故，以后在测试阶段就会红，而不是等用户听见机器人音。
- 素材：`assets/` 12MB → 19MB（新增五条 stage，5.4MB）。五条尺寸：
  薇 318×640 / 747KB、绯 454×640 / 1,052KB、蓝 358×640 / 860KB、雪 428×640 / 874KB、
  鲸鱼娘 426×640 / 1,834KB；抠像半透明 1.0–1.5%，四角 alpha 全 0，脚部锚点逐帧钉到中位数。
  当前 20 条 WebM 的 manifest 还锁定实际尺寸、时长、VP9、像素格式、alpha mode、字节数和 SHA-256；
  普通片段为 5167ms，五条 stage 为 10125ms，全部资产总量 19,432,671 bytes，测试预算上限 20 MB。
- 台账：`FANFEED-senior-review-2026-10-23.md` §9 记录本轮全部现象 / 根因 / 处置
  （含「让视频自己走过去」被判死的原因与数字：横向空间需要人物缩到画幅 55%）。

## 1.19.9 — 2026-10-24

- **四个 dance 片段全部换成 2K 竖屏母版重生成**（1440×2528 首尾帧，人物占高 ~1900px，旧的只有 984px）。
  输出仍是 **640 高**，但每输出像素对应的源像素从 1.5 涨到 **~3.0**，头发丝、睫毛、缎面高光都实了。
  同时动作改成腰胯驱动的慢节奏（figure-eight / pelvis tilt / torso roll），不再只是抬手。
- 体积：dance 四条 **3.34MB → 3.10MB（−7%）**，整包略降。silver 因白发高频细节 +33%，其余三条都变小。
- 抠像沿用 v9（死区 + 暗部保护，**不做洞填充**），未出现「镂空填充」与「高光透底」回归。
- walk / hair 八条不变。

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
