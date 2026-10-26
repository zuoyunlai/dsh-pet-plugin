# dsh-pet 客户端只读审计报告（独立复核，不采信上次评分）

- 审计对象：`dsh-pet` 客户端 `src/*.js`（15 件，3342 行）+ `tests/` + 构建产物 `client.js`
- 版本：package.json 1.19.2；构建产物与 `src/` **一致**（`node build.mjs` 后 `git diff --stat` 为空）
- 方法：逐文件走读 + **本地无网络复现台架**（把真实 `client.js` 跑在 `node:vm` 里，配可控假定时器/假 fetch/假 DOM）
- 复现台架：`tests/_audit-harness.mjs`（+ K1–K15 断言套件 `tests/_audit-k-consolidated.mjs`）
- 约束遵守：**未修改任何产品源码**（`git diff --stat` 空）、**未发布**、**未付费生成**、全程离线
- 既有测试未被破坏：`node tests/smoke.mjs` 全过、`node --test tests/assets.test.mjs` 2/2 过

## 结论摘要

上次审计给的是 **87/100**（不是 93），且它自己已经记下了「跳舞视频 5.167 秒固定时长，到时视频被移除，可考虑 loop until 模式」这一条。本次复核**不推翻**那条结论，但**证实了它低估了范围**：不只是「跳舞」，而是**所有动作**；同时在它没覆盖的六个面上找到了确凿缺陷。

**已证实 12 项（P0×1 / P1×4 / P2×5 / P3×2），待测 3 项。**
其中 15 条断言在本地台架上 100% 复现（PASS 15/15）。

---

## 一、已证实缺陷

### P0-1 · 动作竞态：旧 advance 链会**提前杀死**新动作

- **证据**：`src/41-runtime.js:93-105`
  ```js
  const advance = () => {
    const act = runtime.action          // ← 读的是"当前"动作，不是闭包捕获的那个
    if (!act || act.name !== name || act.persona !== persona().id) return
    if (nowMs() > act.until) { runtime.action = null; notify(); return }
    act.i = (act.i + 1) % act.frames.length
    notify(); later(advance, step)
  }
  later(advance, step)
  ```
  守卫只比 `name` 与 `persona`。**同名同 persona 的新动作不会让旧链退出**，旧链随即接管新对象，用新对象的 `until` 判断过期并把它置 `null`。
- **触发条件**：心情驱动的 `dance` 正在播（`ms=6000`，`moodDriven:true`，`src/96-overlay.js:17`）时，用户点面板「跳一段」→ `playAction('dance', {ms:2400})`（`src/90-components.js:183` 附近 / `src/96-overlay.js:348`）。**两个动作同名同角色**。
- **实测（K1）**：t=0 心情驱动 dance(ms=6000) → t=1000 用户手动 dance(ms=2400) → t=3400 新动作被清空（它本应活到 t=3400，实际正好在 `until` 被旧链抢先清掉）；t=3500 起 `runtime.action === null`，**用户手动发起的动作被"心情"链吞掉**。
- **影响**：用户主动点击的反馈被系统自动动作打断/覆盖；反向也会——旧的短动作到期会把新的长动作砍半。
- **建议**：给 `runtime.action` 加单调递增的 `token`（或比较对象引用 `act !== myAction`）作为守卫；`playAction` 覆盖时显式作废旧链。

### P1-1 · 定时器链无界堆积

- **证据**：同上 `src/41-runtime.js:93-105`，旧链只在 `nowMs() > act.until` 时自杀；同名覆盖时旧链**永远不满足退出条件**，一条链会一直排下一条。
- **实测（K2）**：连续 8 次 `playAction('hair', {ms:3000})`、每次间隔 200ms，pending 定时器数从 **3 → 11 单调增长**。
- **影响**：`later()` 把 id 塞进 `runtime.timers`（`src/41-runtime.js:52-63`），Set 无上限 → 长时间运行内存缓慢增长；且每个链每 230–340ms 触发一次 `notify()` → **无谓的 React 重渲染**，动作帧率被多条链叠加推进（观感是「跳帧/加速」）。
- **建议**：`playAction` 覆盖时先 `clearTimeout` 掉上一条链的 id。

### P1-2 · clip 加载失败**无任何回退**，角色变成空白框

- **证据**：`src/80-art.js:141-160`
  ```js
  const clip = act && p.clips && p.clips[act.name] ? p.clips[act.name] : null
  ...
  clip ? h('video', { className:'dsh-pet-video', src: assetUrl(clip), autoPlay:true, muted:true, loop:true, ... })
       : h(CrossImage, { src: actFrame || variant || p.image, ... })
  ```
  `<video>` 上**没有 `onError`、没有 `onLoadedMetadata`**（K3 实测 props 只有 `className,src,autoPlay,muted,loop,playsInline,preload,aria-label`）。clip 一旦 404 / 解码失败，帧序列 `actFrame` 被**完全丢弃**，角色位置只剩一个空的 `<video>`。
- **实测（K4）**：把 `PERSONAS.violet.clips.dance` 改成 `MISSING.webm` 后渲染 —— `video` 数 = 1，`img` 数 = **0**（没有任何兜底）。
- **补充事实（G2）**：四个 persona 的**全部**动作都配了 clip，帧序列实际是死代码（只有运行时改 persona 数据才会用到）。所以「有 clip 就没兜底」是常态而非边缘情况。
- **影响**：一次资源 404（部署漏文件、CDN 抖动、缓存过期）就让桌宠变成空白，用户毫无提示（无 console 警告、无降级 UI）。
- **建议**：给 `<video>` 加 `onError`，落一个 `runtime.clipFailed[action]=true` 标志，渲染时回落到 `CrossImage(actFrame)`；同时补一次 `console.warn`。

### P1-3 · 所有动作的**视频时长与动作生命周期不匹配**

- **实测事实**：用 `ffprobe` 量了全部 12 个 webm，**duration 全部 = 5.167s**（VP9，24fps，260×400 等）。
- **实测（G1）**：动作生命周期 vs clip 时长

  | 触发路径 | 动作时长 | clip | 结果 |
  |---|---|---|---|
  | tick 随机撩头发 `playAction('hair',{ms:1300})`（`src/60-behavior.js:200`） | 1300ms | 有 | 视频播到 **25%** 被硬切回静帧 |
  | 面板「撩头发」`{ms:1300}`（`src/90-components.js:184`） | 1300ms | 有 | 同上 |
  | 右键菜单「撩头发」`{ms:2400}`（`src/96-overlay.js:348`） | 2400ms | 有 | 播到 46% 被切 |
  | mood 驱动 `walk`（`moodUntil=+1700`） | 1700ms | 有 | 播到 33% 被切 |
  | mood 驱动 `dance`（`moodUntil=+6000`） | 6000ms | 有 | 循环 1.16 次后被切（观众看到「跳到一半又从头」） |

- **触发条件**：任何动作。所有 `.webm` 都比动作活得久（除 dance 6000ms 那条）。
- **影响**：这是**最显眼的观感缺陷**——撸头发只播四分之一就突然变回静态立绘（K5/G4 实测：动作中 `video=1,img=0`；+1500ms 后 `video=0,img=1`，DOM 节点直接被换掉）。
- **建议**：让动作生命周期**对齐 clip 的真实时长**（把 `duration` 写进 `pack.json` / `clips` 元数据，`playAction` 用 `max(ms, clipDuration)`），或实现「loop until 动作结束」的显式控制（`onTimeUpdate` 里在 `until` 到达时 `pause()`，而不是靠卸载节点硬切）。上次审计已提过「loop until」方向，本次证实范围是**全部动作**而非仅跳舞。

### P1-4 · `prefers-reduced-motion` 只覆盖了 **15/47** 条动画规则

- **证据**：`src/70-style.js:83-86`、`:224-226`、`:300-302` 共 3 个 reduced-motion 块（构建产物 `client.js:1643/1784/1860` 一致）。
- **实测（J 组，特异性精确判定）**：CSS 共 47 条带 `animation` 的规则，其中 **22 条在 `prefers-reduced-motion: reduce` 下照常播放**。逐条判定（`!important` 优先于特异性）：

  **仍然会动的**：
  - `.mood-{idle,walk,dance,shy,angry,talk,happy,sleep,poked} .dsh-pet-figure` —— **9 条**（`src/70-style.js:196-204`）。这是**四只宠物的主动画**（四个 persona 全是 `p.image` 贴图形象，走 `.dsh-pet-figure` 分支，`src/80-art.js:137`），**没有任何基类可覆盖**（`.dsh-pet-figure` 本身没有 `animation` 声明，只有 `.mood-*` 变体有）。
  - `.mood-poked .dsh-pet-body`（`src/70-style.js:205`）
  - `.fx-mark.{blush,sweat,vein,zzz,spark}` 5 条表情贴纸（`src/70-style.js:210-219`）
  - `.fx-bolt` / `.fx-rain` / `.fx-spark` / `.fx-shake` / `.fx-impact` / `.dsh-pet-fx-fog` 6 条特效（`src/70-style.js:260-289`）
  - `.dsh-pet-dot.busy` 呼吸点（`src/70-style.js:39`）

  **确实关掉了的（15 条）**：`.dsh-pet-imgwrap`、`.dsh-pet-img-cur/.dsh-pet-img-prev`（块1）、`.dsh-pet-body/.dsh-pet-eye/.dsh-pet-mouth/.dsh-pet-tail`（块2，`!important`）、`.dsh-pet-fx-ink i/.dsh-pet-fx-confetti i/.dsh-pet-fx-cloud/.fx-bomb/.fx-crack/.fx-flash`（块3，`!important`）。
- **另有一条 CSS 管不到的**：`<video autoPlay loop>` 是**媒体播放**，不是 CSS 动画，`prefers-reduced-motion` 对它无效。**动作 clip 5170ms 无缝循环，在 reduced-motion 用户那里照常无限循环**。
- **影响**：开了「减弱动态效果」的系统级偏好的用户，桌宠仍然全速摇/跳/抖/放特效，且视频无限循环。**这是可访问性缺陷，不是口味问题**。
- **对比**：上次审计写「`prefers-reduced-motion` 关闭微动和交叉淡入」——这句只对 SVG 形象成立，对**贴图形象（4/4 只都是）不成立**。
- **建议**：加一条 `.dsh-pet-figure, .mood-* .dsh-pet-figure, .fx-mark*, .fx-bolt, .fx-rain, .fx-spark, .fx-shake, .fx-impact, .dsh-pet-dot.busy { animation: none !important }`；并对 `<video>` 用 `matchMedia('(prefers-reduced-motion: reduce)')` 监听，命中时**不播 clip**（退回帧序列或静止图）。

### P2-1 · 设置面板会**跑出视口**（宠物靠左时左边缘为负）

- **证据**：`src/60-behavior.js:81-112` `placePanel()`。左侧分支用 `right: Math.max(8, vw - r.left + PANEL_GAP) + 'px'`，**只夹了 `right` 的下界，没有夹面板左边缘**。
- **实测（K8）**：宠物 `left=0`（视口最左）→ `panelPos = {right:"1156px", ...}` → 面板左边缘 x = 1280 − 1156 − 196 = **−72px**（面板有 72px 在视口外，标题栏和关闭按钮「×」够不着）。
- **影响**：用户把桌宠拖到屏幕左边缘后打开设置，面板被切掉一截。
- **建议**：`right` 计算后夹到 `vw - PANEL_W - 8`；或者用 `left` 而非 `right` 定位并夹 `left ∈ [8, vw-PANEL_W-8]`。

### P2-2 · 换 persona 后 `action.frames` 仍是**旧角色**的帧文件名

- **证据**：`src/41-runtime.js:72-91` 把 `frames`（旧 persona 的帧名）与 `persona: p.id` 一起冻结进 `runtime.action`；换 persona 时（`src/90-components.js:113` `update({persona:v})`）**没有清空 `runtime.action`**。
- **实测（K6）**：violet 播 dance → `runtime.settings.persona = 'crimson'` → `runtime.action.persona === 'violet'` 且 `runtime.action.frames[0] === 'pet-violet-dance1.webp'`（crimson 应该有 `pet-crimson-*` 前缀）。
- **影响**：换角色后若动作还在播，会显示**旧角色的帧**；配合 `src/80-art.js:141` 的 `p.clips[act.name]`（读**新** persona 的 clip）——**clip 是新角色的、帧是旧角色的**，混搭。
- **建议**：`update({persona})` 时 `runtime.action = null`。

### P2-3 · 面板打开时**整屏被遮罩吞掉指针事件**

- **证据**：`src/70-style.js:303` `.dsh-pet-menu-mask{position:fixed;inset:0;z-index:80;pointer-events:auto}`。
- **影响**：右键菜单打开期间，桌宠本体、输入框、**以及宿主页面上的其它所有元素**都点不到，只能点菜单项或空白处关闭。对桌面挂件来说这是阻塞性的。
- **建议**：遮罩改 `pointer-events:none`，只让菜单本身 `pointer-events:auto`；或监听 `pointerdown` 到 `document` 时才关闭。

### P2-4 · 卸载后**裸 `setTimeout` 仍会修改 runtime 并 `notify()`**

- **证据**：`src/94-move.js:24` 和 `:30` 用的是**裸 `setTimeout`**，没走 `later()`，因此**不在 `runtime.timers` 里**；而 `src/99-entry.js:97` 的卸载清理只调 `clearLater()`。
- **实测（K9 + 精查）**：跳舞后 `disposeAll()`（卸载）→ 残留定时器 = `[2500(暖音), 7900(裸), 9600(裸)]` → t=+8000 时 `stage` 被改成 `{tx:0,ty:0,zoom:1}`，t=+10000 时 `stage=null, mood='idle'`，**每次都带 `notify()`**。
- **影响**：插件卸载/热重载后 10 秒内仍会 `notify()` 已卸载的组件（React 警告「在已卸载组件上更新状态」）；若插件被重新加载，这些定时器会把**新实例**的 `runtime.stage` 冲掉。
- **对照**：`src/41-runtime.js:51` 的注释明确说「所有长延时都记在 `runtime.timers` 里，卸载时统一清」——`94-move.js` 违反了自己项目的约定。
- **建议**：`94-move.js` 的两个 `setTimeout` 改用 `later()`；或在 `dispose` 里显式清它们。

### P2-5 · 多会话**无隔离**：`runtime` 是模块级单例

- **证据**：`src/41-runtime.js:3` `const runtime = { ... }` —— 整个插件一份。与会话相关的字段全在上面：`running`(32)、`lastRunning`、`turnStartedAt`、`lastDanceAt`、`doneUntil`、`phase`。
- **宿主端同样不隔离**：`index.js:93-94` `let lastErrorAt = 0 / let lastToolAt = 0` 在 `apply()` 闭包内，**整个插件实例一份**。
- **实测（K11 / F2）**：两个会话各挂一个 `PetToggle`（`conversation.input.right` 是 session 作用域，`src/00-prelude.js:6`）：
  - 会话 A `running: true` → `runtime.lastRunning = true`
  - 会话 B 渲染（idle）→ **把 `runtime.lastRunning` 写回 `false`，`turnStartedAt` 清 0**
  - ⇒ 会话 A 的「一轮开始」边沿被 B 吃掉，A 结束时**不会触发 done 庆祝**；反过来 A 结束时可能被误判为「刚结束」而放一次撒花。
- **阶段机跨会话串味**：`src/60-behavior.js:17` `computePhase()` 读全局 `lastErrorAt`，窗口 `ERROR_WINDOW = 8000`（`:11`）——**任何会话的一次工具失败，会让所有会话的桌宠在 8 秒内变成生气脸 + 乌云特效**（`src/99-entry.js:136-139` + `src/60-behavior.js:140-142`）。`lastToolAt` 同理（`TOOL_WINDOW=5000`）。
- **建议**：`/ping` 响应里带上 sessionId（或让客户端按会话订阅），`runtime` 里改为 `Map<sessionId, SessionState>`；阶段机与 `running` 按会话取值。

### P3-1 · 齿轮/发送按钮缺 `aria-label`

- **证据**：`src/96-overlay.js:270-281`（齿轮，只有 `title:'桌宠设置'`）、`src/96-overlay.js:221`（发送，只有 `title:'发送'`）。
- **实测（K12）**：两个按钮的 `aria-label` 都是 `undefined`。
- **说明**：`title` 在多数屏幕阅读器里**不被当作可访问名称**（只在部分浏览器作为 tooltip 暴露），按钮实际无名。
- **建议**：补 `aria-label`。

### P3-2 · 面板里的「活跃时段」两个 `time` 输入缺 `aria-label`

- **证据**：`src/90-components.js:147` 与 `:149`。
- **实测（K13）**：两个 `type=time` 的 `aria-label` 均为 `undefined`（同面板其它 11 个 input 都有）。
- **建议**：补 `aria-label`（如「活跃开始时间」/「活跃结束时间」）。

---

## 二、待测（静态判定成立，但本地无 React/浏览器，无法端到端确认）

### T-1 · `CrossImage` 在 **render 期**调用 `setState` 两次

- **证据**：`src/80-art.js:114-117`
  ```js
  if (src !== cur) { setPrev(cur); setCur(src) }
  ```
  这是渲染函数体内直接调 `setState`。React 官方允许的「派生 state」模式是**在渲染期用 `setState` 更新同一个组件的 state**，但 React 官方文档明确指出：这是**仅限「同一组件、且更新会立刻重渲染」**的特殊模式，且**一次渲染中最多只能更新一次自己的 state**；这里连续调了两次（`setPrev` + `setCur`），且 `prev` 是**另一个 state 变量**。
- **风险**：React 18/19 在这种模式下会打警告，某些版本/严格模式下会抛 `Cannot update a component while rendering a different component`。
- **为什么没端到端复现**：本机 `node_modules` 里**没有 react**（只有 `@deepseek-ai` / `@standard-schema`），且审计禁止联网安装。
- **建议**：改成 `useEffect` 里做 state 推进，或用单个 state 对象 `{cur, prev}` 一次 `setState` 原子更新；`--pet-dx` 的方向切换也从 render 期自增挪到 effect 里。

### T-2 · `<video>` **没有 `key`**，React 会复用同一 DOM 节点

- **证据**：`src/80-art.js:150-159` 的 `h('video', {className, src, autoPlay, ...})` 没有 `key`。
- **实测（K14）**：`video` props 里 `key === undefined`。
- **风险**：从 `dance` 切到 `walk` 时，React **复用同一个 `<video>` 元素**只改 `src`。行为上：浏览器会重新加载并从 0 开始播，但 `autoPlay` 在已存在的元素上**不一定重新触发**（尤其 `muted` 属性已变过的情况下），可能出现「切换动作后视频停住」。
- **建议**：给 `<video>` 加 `key={clip}`（或 `key={act.name}`），强制换节点重建。

### T-3 · `--pet-dx` 方向交替在**render 期**自增

- **证据**：`src/80-art.js:124` `swap.current = (swap.current + 1) % 2` —— 在渲染函数体内直接改 `useRef`。
- **影响（静态 + 部分实测 F4）**：`--pet-dx` 在**每次渲染**时翻转，而不是每次换帧时翻转。桌宠每 5s 一次 tick + 气泡过期 + phase 变化都会触发重渲染 ⇒ 交叉淡入的方向序列被这些无关渲染打乱，视觉上不再是「左右交替像在动」。
- **建议**：把方向切换绑到 `src` 变化上（在 effect 里做）。

---

## 三、复核过、**确认没问题的**部分（避免重复劳动）

| 项 | 结论 | 证据 |
|---|---|---|
| `inActiveWindow` 跨零点判定 | ✅ 正确 | `src/10-util.js:29-36`；`tests/smoke.mjs` 已断言 `22:00→03:00` |
| `probability` → 每 tick 概率换算 | ✅ 正确（35%/h ↔ 每 tick 4.8611e-4 × 720 tick/h = 0.35） | `src/60-behavior.js:170` |
| IME 输入法处理 | ✅ 正确（查 `isComposing` / `keyCode===229`） | `src/96-overlay.js:210` |
| 语音「说一句掐一句」（`speakSeq`） | ✅ 正确（`seq !== speakSeq` 时 revoke 丢弃） | `src/50-voice.js:188-199` |
| `runToCenterAndDance` 重入保护 | ✅ 正确（`if (runtime.stage) return`） | `src/94-move.js:5` |
| 跳舞期间 `scheduleMood` 被挡住 | ✅ 正确（`!runtime.stage` 条件） | `src/60-behavior.js:190` |
| 轮询**间隔**按可见性降频 | ✅ 正确（8s / 30s），且 `await doPoll()` 后才 `schedule()` ⇒ **慢响应不会重叠** | `src/99-entry.js:155-166`（实测 E 组） |
| 气泡 `role="status" aria-live="polite"` | ⚠️ 形式正确，但闲聊台词会周期性打断屏幕阅读器；建议改 `aria-live="off"` 或仅对状态变化播报 | `src/96-overlay.js:180` |
| 右键菜单 `role="menu"` | ⚠️ 缺 `role="menuitem"`、无焦点管理、无 Esc 关闭 | `src/96-overlay.js:338` |
| `placePanel` 上方分支 | ✅ 正确（`spaceAbove >= 300` 时右对齐、底边贴头顶，`maxHeight` 夹 560） | `src/60-behavior.js:92-99` |
| 现有测试 | ✅ 全过，未被本次审计破坏 | `tests/smoke.mjs` / `tests/assets.test.mjs` |

---

## 四、上次审计（87 分）**没有覆盖**的面 —— 本次新增

1. 动作调度竞态（旧链杀新动作）
2. clip 加载失败回退
3. 定时器链堆积与卸载后残留定时器
4. 面板越界（left 边缘为负）
5. 多会话隔离（runtime 单例 + 宿主 `lastToolAt` 全局）
6. 无障碍（按钮/输入的可访问名称、菜单语义、键盘不可达）
7. reduced-motion 的**实际覆盖矩阵**（22/47 条仍会动 + video 完全管不到）

上次审计自己记下的两条，本次的进展：
- 「跳舞视频 5.167 秒固定时长，到时视频被移除，可考虑 loop until」→ **证实，且范围是全部动作**（P1-3）
- 「`prefers-reduced-motion` 关闭微动和交叉淡入」→ **不准确**：只对 SVG 形象成立，贴图形象（4/4 只）主动画关不掉（P1-4）

---

## 五、修复优先级建议

| 优先级 | 项 | 一句话修法 |
|---|---|---|
| P0 | P0-1 动作竞态 | `runtime.action` 加 `token`，守卫比 `token` 而非 `name` |
| P1 | P1-2 clip 回退 | `<video onError>` → 回落 `CrossImage(actFrame)` + `console.warn` |
| P1 | P1-3 视频时长 | clip 元数据带 `duration`；`playAction` 用 `max(ms, duration)`；或 `loop until` |
| P1 | P1-4 reduced-motion | 补 `.dsh-pet-figure` 等 22 条；`matchMedia` 命中时不播 video |
| P1 | P1-1 定时器堆积 | `playAction` 覆盖时清掉旧链 id |
| P2 | P2-5 多会话隔离 | `/ping` 带 sessionId；`runtime` 的会话态改 `Map` |
| P2 | P2-1 面板越界 | `right` 夹到 `vw - PANEL_W - 8` |
| P2 | P2-4 卸载残留 | `94-move.js` 改用 `later()` |
| P2 | P2-2 换角色残留 | `update({persona})` 时 `runtime.action = null` |
| P2 | P2-3 遮罩吞事件 | 遮罩 `pointer-events:none` |
| P3 | P3-1 / P3-2 a11y | 补 `aria-label`（按钮 2 个 + time 2 个） |

---

## 六、复现方式

```bash
cd dsh-pet
node tests/_audit-k-consolidated.mjs   # 15 条断言，PASS 15/15
node tests/_audit-j-spec.mjs           # reduced-motion 特异性覆盖矩阵
```
台架在 `tests/_audit-harness.mjs`：把真实 `client.js` 跑进 `node:vm`，用**可控假 setTimeout**（可推进虚拟时钟、可手动触发）复现竞态，**不依赖 sleep 撞运气**；`Date.now()` 已虚拟化，因此所有时间断言都是真实值。

**审计过程未修改任何产品源码**（`git diff --stat` 空）、未发布、未付费生成、全程离线。
