# dsh-pet-plugin 竞品反哺修订报告（对照 zhu1090093659/dsh-pet）

- 日期：2026-10-27
- 性质：只读核实 + 反哺修订清单。**本轮未改任何代码、未发版**。
- 对照对象：`zhu1090093659/dsh-pet`（npm `@linxin666/dsh-pet@0.4.11`，Apache-2.0，2026-10-27 实测）
- 本仓基线：`dsh-pet-plugin@1.20.1`，本地 `npm test` 86/86 通过（30.7s），`npm pack --dry-run` 实测 135 files / packed 19,677,287 B / unpacked 20,139,052 B。
- 证据方法：竞品侧全部来自 GitHub Contents API 原文（缓存于 `E:/tmp/zhu/`：README.zh.md 386 行全文、package.json、LICENSE、`src/state.ts`、`src/event-projection.ts`、`src/routes.ts`、`src/client/index.ts`、`src/client/settings-registration.ts`、`assets/deep-chan/pet.json`、递归 tree.json）与 registry.npmjs.org 元数据；本仓侧全部来自当前工作树源码与实测命令。**没有运行过竞品插件**——其行为结论均由源码/文档推断，已在文中标注。

---

## 0 结论摘要

上轮口头对比报告（2026-10-27 会话内交付）经逐条核实：**12 条断言中 9 条成立、2 条部分成立、1 条不成立**，另发现 1 个上轮没提的本仓真实缺口（react 未声明 peer）。修正后的可借鉴清单为 R-01～R-10（P1×3、P2×5、P1 前置×1、P2 附加×1），不采纳 4 项。总体判断不变：竞品是「注册表驱动的多宠物平台」，我们是「少数高保真形象的桌宠」；它赢在产品化与生态位，我们赢在视觉上限、依赖面窄（不 inject react-dom、只 inject 2 个 client 包、支持更老宿主下限）。

---

## 1 上轮断言核实表

判定口径：✅ 成立 / ⚠️ 部分成立（需修正表述） / ❌ 不成立。每条给证据。

### 1.1 本仓侧

| # | 上轮断言 | 判定 | 证据与修正 |
|---|---|---|---|
| A1 | 「纯 JS 零 React，手写 DOM 覆盖层」 | ❌ **不成立，必须修正** | `src/00-prelude.js:17-19`：`const React = require('react')`、`const h = React.createElement`、解构 `useState/useEffect/useCallback/useRef`；`src/80-art.js:111-150`、`src/90-components.js:4-16`、`src/92-fx.js:305` 均用 hooks。正确的表述是：**用 React 运行时（无 JSX/无 TS、不经 react-dom）**。`grep react-dom|createRoot|createPortal` 在 `src/*.js` 零命中；挂载走官方 slot（`src/99-entry.js:275-292`：`shell.overlay` order 200 + `conversation.input.right` order 50），遵守 prelude 第 9 行「不 iframe、不往 document.body 追加、不 require 任何 @deepseek-ai/dsh-client-* 包」。 |
| A2 | 「peer 只声明 schemastery」 | ✅ 成立，且引出新缺口 | `package.json` peerDependencies 仅 `@deepseek-ai/schemastery ^3.18.2`，dependencies 为 null。但 A1 证明运行时 `require('react')`——**react 是事实上的 peer 却未声明**（竞品声明了 `react ^18.2.0`、`react-dom ^18.2.0`、`@deepseek-ai/dsh >=0.2.1-rc.3`）。列为 R-09。 |
| A3 | 「5 只形象构建期写死：pack.json → gen-personas → 30-personas.js」 | ✅ 成立 | `tools/gen-personas.cjs:2`（"F4：从 pets/<id>/pack.json 生成 src/30-personas.js"）；本轮 `node build.mjs` 输出「gen-personas: 与现有 src/30-personas.js 逐字节一致（5 个 pack）」，`src/30-personas.js` 1006 行。pack.json 字段实测：id/name/tag/tagEn/image/voice/temper/images/actions/clips/lines/linesEn/Es/Pt/Hi。 |
| A4 | 「状态机 idle/working/tool/error/speak/done 六态，只监听 tools/result」 | ✅ 成立 | `src/41-runtime.js:31-32`（"阶段机（F1）：idle / working / tool / error / speak / done"）；`index.js:120` `ctx.on('tools/result')`、`index.js:128` 兼容旧 `tool/result`；`index.js:143-154` 20s 自检日志（收不到事件时告警"只有 idle/working/speak/done 四态"）。无 thinking/review 数据源。 |
| A5 | 「轮询 8s/30s + 指数退避」 | ✅ 成立 | `src/99-entry.js:221-222`：`baseGap = visible||panelOpen ? 8000 : 30000`，`gap = min(120000, baseGap*2^min(failures,4))`；单轮预算 `POLL_TIMEOUT=8000`（:169）+ AbortController。竞品为固定 `POLL_MS=2000`（其 `src/client/index.ts:102,480`）。 |
| A6 | 「点『跳舞』最长要等 8 秒才动」 | ❌ **不成立，必须修正** | 右键菜单/面板动作在客户端本地立即执行（`src/96-overlay.js` 菜单 → `src/41-runtime.js` 动作队列），不经 /ping 往返。8s/30s 轮询只影响**相位对模型活动的感知延迟**（thinking→tool→done 的切换最多滞后一个轮询周期），不影响用户交互响应。上轮把两者混为一谈。 |
| A7 | 「idle 也是 webp 静帧」隐含前提（上轮 P1-5 说『补一张图集播微表情』） | ⚠️ 部分成立 | 我们 idle **已经是** webp 静帧 + CSS 微动（smoke 实测："crossfade dx=3px + alive micro-motion"；63 张 webp 共 1,949,240 B）。视频只用于 dance/walk/hair/stage 四类 hero 动作。因此「加图集省包体」的收益被上轮高估——不存在「视频在播待机」的浪费。修订后的 R-05 收窄为：为 thinking/review 等低强度相位提供 2-4 帧 webp 序列（可选，省 0-4MB，属优化非必需）。 |
| A8 | 「资产 20 条 webm、全 640 高、5167/10125ms、VP9 alpha」 | ✅ 成立 | `tests/assets-manifest.json` 实测：count 83 / totalBytes 19,432,671；webm 20 条 17,483,431 B；webp 63 张 1,949,240 B；heights=[640]、durations=[5167,10125]、codecs=[vp9]、alphaMode=['1']。npm pack 内 webm 同为 20 条 17,483,431 B。 |
| A9 | 「持久化全在 localStorage」 | ✅ 成立 | `src/20-i18n.js:17,56`（PET_LANG_KEY）、`src/40-settings.js:74,90`（STORAGE_KEY）、`src/60-behavior.js:298,309`（HISTORY_KEY）、`src/99-entry.js:10`（dsh-pet.debug）。宿主侧无状态文件（`grep DSH_HOME|homedir()` 仅 `lib/tts.js:91` 命中——那是找 DSH 内置 python，不是状态）。 |
| A10 | 「资产路由安全：basename + 扩展名白名单」 | ✅ 成立 | `index.js:545` `name = basename(decodeURIComponent(...))`、`:552-553` `ASSET_TYPES` 扩展名白名单、`:565` webm no-store / webp 1h。服务的是包内固定目录，结构上无用户可控路径段；竞品的 realpath 包含检查 + 64KB/20MB 上限（其 routes.ts:45,47,310,425,539）是**因为它服务用户投放的宠物目录**——我们采纳 R-01 后才需要同等防线（见 R-06 前置关系）。 |
| A11 | 「测试 86 项 node:test + ffprobe 资产门禁」 | ✅ 成立 | 本轮实测 86/86 通过；`tests/assets.test.mjs` 校验 manifest sha256/bytes 与 ffprobe 元数据（width/height/durationMs/fps/codec/pixelFormat/alphaMode）+ 20MB 预算门。 |

### 1.2 竞品侧

| # | 上轮断言 | 判定 | 证据与修正 |
|---|---|---|---|
| B1 | 「54★/15 fork/390MB 仓库、TS、Apache-2.0、v0.4.11」 | ✅ 成立 | GitHub API + `package.json`；LICENSE 文件原文为 Apache 2.0。**附带发现**：其 `README.zh.md:386` 写「[BSD-3-Clause](LICENSE)」与 LICENSE 实文不符——竞品自己的文档漂移，恰是我们 README 对账门要防的事。 |
| B2 | 「npm 包 16.7MB/338 文件」 | ✅ 成立（上轮未给此数，本轮补齐使对比公平） | registry 元数据：0.4.11 unpackedSize 16,718,198 B / fileCount 338 / published 2026-10-27T00:11Z。对比本仓 unpacked 20,139,052 B / 135 files——**双方包体同量级（16.7 vs 20.1 MB）**，上轮「305MB vs 19.4MB」的悬殊对比是仓库体积对包体积的错位比较（其 305MB 资产大部分只进 git、按 files 白名单只随包发 whale/whale-refined/ouo-neko/bee-eater/decorations，其余走创意工坊）。 |
| B3 | 「运行期注册表：内置 + ~/.codex/pets + $DSH_HOME/pets + 组合注入」 | ✅ 成立 | 其 README.zh.md:88-93；manifest v2 fail-closed（未知字段/渲染器拒载，:86、:378），schema 在 `contracts/pet-manifest-v2.schema.json`（14,898 B）。 |
| B4 | 「7 相位状态机 + 庆祝窗口 2400ms + 全事件投影」 | ✅ 成立 | 其 `src/state.ts:14`（ActivityPhase 7 值）、`:60`（celebrateMs/failureMs 默认 2400）；`src/event-projection.ts:103-162` 处理 turn/start、step/start、assistant/message、tool/call、tool/result、turn/end。**注意**：这些事件名在其 `dsh >=0.2.1-rc.3` 语境下成立；我们 engines 下限是 `>=0.2.1-alpha.2`，照抄前必须先在真宿主探测事件面（当年 `tool/result`→`tools/result` 的教训，`index.js:100-103` 有注释存档）。 |
| B5 | 「2s 轮询」 | ✅ 成立 | 其 `src/client/index.ts:102` `const POLL_MS = 2000`、`:480` setInterval。 |
| B6 | 「设置席位：Web 扩展父级 + 回退一级分区」 | ✅ 成立 | 其 `src/client/settings-registration.ts`：`installWebExtensionPage({key:'pet', order:130, ...})`，父级缺席回退一级 settings.section；v0.4.11 release note 详述座位迁移与"控制器挂 apply() 不随座位重建"。 |
| B7 | 「安全：loopback 围栏 + realpath 包含 + 64KB/20MB 上限 + Live2D 闭包白名单」 | ✅ 成立 | 其 routes.ts:45（manifest 64*1024）、:47（image 20*1024*1024）、:85（containedRealpath）、:310/:425/:539（413）；README.zh.md:372-378。 |
| B8 | 「玩法经济与亲密度、多会话气泡（12 个）、voice.json 三级覆盖、panel action 上限 8、statusBubbles 开关、pet.announce」 | ✅ 成立 | README.zh.md:32-44（玩法表）、:41/:332（多会话+子代理折叠，最近 12 个）、:42/:105-107（voice.json 宠物>全局>内置，坏包 warn 不拒载）、:241（MAX_PANEL_ACTIONS=8）、:245-247（statusBubbles auto/off）、:220-243（announce/registerPanelAction 为**宿主侧进程内**契约，浏览器半区插件走 /api/pet/*）。**修正一点**：上轮说「借它的 ctx.pet.announce」——那是它家进程内服务，我们不能直接调；借鉴形态要么是机会主义集成（探测到 ctx.pet 就注册），要么是自建 `/dsh-pet/announce` HTTP 契约（见 R-03）。 |
| B9 | 「每日匿名遥测心跳」 | ✅ 成立 | README.zh.md:380-382：浏览器半区每个 UTC 日向 dsh-market.com 发 localStorage 随机 ID + 包名。不采纳（R 区外）。 |
| B10 | 「它没有 ffprobe 类资产门禁」 | ⚠️ 未核实，降级 | 其 package.json scripts 仅 build/test/typecheck/pet:cli/prepare，无资产校验入口；但 CI workflow 内容本轮未读，不能断言其没有。从"证据只到读过的文件"的纪律，此条改为未核实。 |
| B11 | 「deep-chan 图集 1.3MB/57 帧」 | ✅ 成立 | tree.json：spritesheet.webp 1,311,728 B；pet.json frames=[6,8,8,4,5,8,6,6,6]=51 + 8 帧镜像=57（README:254）。 |
| B12 | 「工程化：.agents/notes 实现日志 + release-notes + pr-evidence」 | ✅ 成立 | tree.json：`.agents/notes/implemented/` 下 20+ 篇按日期归档的 bug-fix/feature/process 笔记、`.agents/skills/dsh-pet-developer/SKILL.md`（8KB）、`docs/release-notes/v0.3.25–v0.4.11` 每版一篇、`docs/pr-evidence/<pet>-pr-<n>/` 截图佐证。这是我们 CHANGELOG+本 FANFEED 台账的同类物，其"每只社区宠物入库配 PR 证据截图"的纪律值得抄。 |

### 1.3 修正汇总（上轮报告的三处硬伤）

1. **A1**：「零 React」错——我们用 React（createElement + hooks），真实差异是**不用 react-dom / 不 createRoot / 不挂 document.body / 只 inject 2 个 client 包**。
2. **A6**：「点跳舞等 8 秒」错——用户动作本地即时；轮询延迟只影响相位感知。
3. **A7/B2**：「图集省包体」高估——idle 已是 webp 静帧；且竞品 npm 包 16.7MB 与我们同量级，305MB 是仓库不是包。

---

## 2 差异台账（实测数字）

| 维度 | 本仓 dsh-pet-plugin 1.20.1 | 竞品 @linxin666/dsh-pet 0.4.11 |
|---|---|---|
| 语言/框架 | JS（ESM）+ React createElement/hooks，无 JSX/TS/react-dom | TypeScript + React 18 + react-dom(createRoot/portal) + pixi.js + Live2D 引擎 |
| 宿主耦合 | inject 2 个 client 包（ui-layout、ui-conversation）；peer 仅 schemastery（**react 漏声明，R-09**）；engines dsh >=0.2.1-alpha.2 | inject 5 个 client 包；peer 含 @deepseek-ai/dsh >=0.2.1-rc.3 + react + react-dom |
| 形象来源 | 5 只，构建期 codegen（pack.json → 30-personas.js，1006 行） | 运行期注册表 4 源；社区宠物 8+ 只（内置 5 + 工坊） |
| 渲染 | 20 条 VP9 alpha webm（17,483,431 B）+ 63 张 webp 静帧（1,949,240 B），CSS 背景/视频层 | sprite2d 图集（~1.3MB/只）/ frames2d 目录帧 / Live2D 三渲染器 |
| 相位机 | 6 态（idle/working/tool/error/speak/done），数据源仅 tools/result 时间戳 | 7 态 + 2400ms 庆祝/失败窗口，全事件投影 + 多会话各自气泡 |
| 轮询 | 8s 可见/30s 隐藏 + 指数退避（cap 120s），单轮 8s 预算 | 固定 2s |
| 挂载 | 官方 slot：shell.overlay(order 200) + conversation.input.right(order 50) | document.body 全局 React 根 + portal，单挂载槽接管（issue #785） |
| 持久化 | 全 localStorage（清缓存即失） | 宿主 $DSH_HOME/pet.json + 每宠名字 |
| 设置入口 | 自绘面板（无设置席位） | Web 扩展席位（key 'pet', order 130）+ 一级分区回退 |
| 安全 | Origin/Host + 限流 + MAX_TEXT 2000 + basename/扩展名白名单（服务包内固定目录） | loopback 围栏 + realpath 包含 + 64KB/20MB→413 + Live2D 闭包（因服务用户目录） |
| 语音 | edge-tts 神经音色，五语×每形象映射，mp3 磁盘缓存，python worker | 无发声（voice.json 是文案包） |
| 测试 | node:test 86 项 + ffprobe 资产门禁 + pack 前完整跑 | vitest + jsdom + @testing-library（192KB 测试，含 67.9KB PetSprite 组件测试）；资产门禁未核实 |
| 包体 | packed 19,677,287 B / unpacked 20,139,052 B / 135 files | unpacked 16,718,198 B / 338 files（同量级） |
| 生态 | 自发 npm + 4 目录收录 PR | 自建 dsh-market.com 工坊 + 全家桶聚合包 + 每日遥测心跳 |

---

## 3 反哺修订清单（R-01～R-10）

状态全部为「待办」——本轮只出报告。每条给：来源证据 → 落点 → 成本/风险 → 验收门。

### P1（产品形态升级，均为零新依赖）

**R-01 pack.json 从构建期搬到运行期（注册表化）**
- 来源：竞品 README.zh.md:88-103（4 源注册表 + CLI validate/install + "非法条目永不覆盖可用宠物"）。
- 落点：`index.js`（启动扫描包内 `pets/*/pack.json` + `$DSH_HOME/dsh-pet/pets/*/pack.json`，经 `/dsh-pet/ping` 或新端点下发 persona 定义）；`src/30-personas.js` 退化为内置兜底；`tools/gen-personas.cjs` 保留为发布期一致性检查。
- 成本：中。风险：资产路由要开始服务用户目录 → **R-06 是前置**；两源冲突策略照抄"后注册覆盖 + 非法跳过"。
- 验收门：新增 `tests/registry.test.mjs`（扫描/校验/冲突/拒载用例）；assets.test 保留；真宿主装一只临时宠物目录跑通选择-切换-持久化。

**R-02 补全事件投影（thinking/review/done 数据源）**
- 来源：竞品 `src/event-projection.ts:103-162`、`src/state.ts:14,60`。
- 落点：`index.js` ctx.on 增补 turn/start、step/start、assistant/message、tool/call、turn/end（逐个 try/catch + 存在性探测，沿用 `index.js:100-103` 的双事件名兼容纪律）；`/ping` 载荷加 phase 直出（宿主算好，客户端只消费）；`src/41-runtime.js` 相位映射扩 thinking→walk、review→hair、done→庆祝窗口（竞品 2400ms 起步）。
- 成本：低-中。风险：**事件名必须先在真宿主逐一探测**（我们 engines 下限 alpha.2，竞品在 rc.3 语境；当年 `tool/result` 不可达的教训在案）；收不到的事件静默降级，不破坏现有六态。
- 验收门：host.test 增事件投影用例（含"事件面缺失时降级"）；20s 自检日志扩到逐事件名。轮询是否随之收紧到 2-3s：若 phase 直出则保持 8s 也可接受（延迟感主要来自相位初切），先测再定。

**R-03 气泡契约：statusBubbles 开关 + /dsh-pet/announce**
- 来源：竞品 README.zh.md:220-247（announce/registerPanelAction/statusBubbles 三件套；注意其 pet.* 是**进程内**服务，我们不能直接用）。
- 落点：`index.js` 增 `POST /dsh-pet/announce`（同源 + 限流 + MAX_TEXT，宿主侧进程内再暴露 `ctx.pet?.announce` 机会主义注册——探测到竞品在跑就挂进它的面板）；`src/40-settings.js` 增 `statusBubbles: auto|off`（off 只关状态气泡，互动反馈与 announce 照常）。
- 成本：低。风险：多插件气泡争位是生态问题，单方面开关只是自我约束；写进 README 声明契约。
- 验收门：host.test 增 announce 路由（含超长/限流/脱敏）；runtime.test 增 statusBubbles 行为。

### P1 前置（采纳 R-01 则必做）

**R-06 用户目录资产防线：realpath 包含 + 分类大小上限**
- 来源：竞品 routes.ts:45,47,85,310,425,539。
- 落点：`index.js` assetHandler 扩用户目录时，双侧 realpath 包含检查 + 清单 64KB / 图 20MB（webm 沿用现有总量预算线）超限 413。
- 成本：低。风险：无（纯加固）。
- 验收门：host.test 增穿越/超限/软链逃逸用例。

### P2（体验与工程补强）

**R-04 状态落宿主盘 + localStorage 一次性迁移**
- 来源：竞品 README.zh.md:330（$DSH_HOME/pet.json；名字/布局/计数）。
- 落点：`index.js` 增 GET/POST `/dsh-pet/state`（JSON 落 `$DSH_HOME/dsh-pet/state.json`）；`src/40-settings.js` 首次拉取合并 localStorage 后以宿主为准。`src/60-behavior.js` 的 HISTORY_KEY 同步迁移。
- 成本：中。风险：双写期一致性——迁移只做一次、宿主优先、失败回落 localStorage。
- 验收门：host.test 落盘/读取/损坏文件拒载用例；runtime.test 迁移合并用例。

**R-05 低强度相位轻量序列（可选优化，上轮 P1-5 降级修订）**
- 事实前提（A7 核正）：idle 已是 webp 静帧 + CSS 微动；视频只播 hero 动作。剩余优化点：thinking/review 相位若长期占屏，2-4 帧 webp 序列（<300KB/形象）比循环调用 5s 视频更省解码与电量。
- 验收门：新增序列进 assets-manifest 门禁；A/B 实测 CPU 占用再决定是否默认启用。
- **处置（2026-10-27 回填）：本轮不实施。** 理由：① R-02 落地后 thinking/review 相位的实际表现已由现有映射承担（thinking→working→walk 走位、review→hair 撩发），长期静止"占屏"场景不存在——working 相位本身有走位动画；② 视频只在动作触发时挂载、结束即卸载（`<video>` 元素移除后不占解码），idle 恒为 webp 静帧，A/B 的对照组缺少真实负载差异；③ 5 只 ×4 帧 ×多语场景收益上限 0-4MB/包体不省反增（当前 20 条视频总预算 19.4MB 已在门禁内）。待将来出现"用户反馈 working 相位耗电"的真实证据再重启。

**R-07 文案/台词运行期覆盖（voice 三级）**
- 来源：竞品 README.zh.md:42,105-107（宠物 > 全局 $DSH_HOME/pets/.voice.json > 内置，坏包 warn 不拒载）。
- 落点：`pack.json` 已含 lines 五语——加 `$DSH_HOME/dsh-pet/voice.json` 全局覆盖层，读取端 warn-and-drop。
- 成本：低。验收门：voice.test 增覆盖/坏包用例。

**R-08 组件级测试（jsdom）**
- 来源：竞品 67.9KB PetSprite.test.tsx + jsdom + @testing-library（挂载/拖拽/气泡/键盘有真 DOM 断言；我们 86 项全在假 ctx/纯逻辑层，DOM 覆盖层零覆盖——这是 1.20.0 审查已登记的缺口，竞品证明可行）。
- 落点：devDependencies 加 jsdom（仅 dev，不进包）；先覆盖 96-overlay 菜单键盘可达性与 80-art 视频失败回退两处。
- 成本：低-中。验收门：CI 跑通，覆盖上述两场景。

**R-09 peer 声明补正（本轮新发现）**
- 事实：`src/00-prelude.js:17` 运行时 `require('react')`，但 `package.json` peerDependencies 只有 schemastery。竞品声明 react/react-dom/@deepseek-ai/dsh 三个 peer。
- 落点：peerDependencies 增 `"react": "^18.2.0"`（react-dom 我们不用，不加；@deepseek-ai/dsh 是否该声明沿 1.20.0 审查结论"服务由宿主注入、不虚构 npm peer"，除非官方指南改口）。
- 成本：极低。风险：profile 安装时 peer 解析告警需实测一遍。
- 验收门：`dsh-plugin-dev check --strict` 通过 + 本机 profile 安装实测无新增告警。

**R-10 资产出处声明（license per pack + THIRD_PARTY_NOTICES）**
- 来源：竞品 v2 manifest license 必填 + 10KB THIRD_PARTY_NOTICES.md + README:253-265 逐只出处记录。
- 落点：`pets/*/pack.json` 增 `license` 字段（AI 辅助生成 + 自有权声明）；根目录 THIRD_PARTY_NOTICES.md 一页。
- 成本：极低。验收门：assets.test 增 license 字段存在性检查。

### 不采纳（与上轮一致，理由核实后不变）

1. **Live2D/pixi 渲染器**：vendor 构建与 Cubism 授权成本高，与超写实视频定位重叠小。
2. **遥测心跳**：我们无服务端，也不应静默联网（其 README:380-382 明示每日上报）。
3. **390MB 资产进 git**：其反例；我们「npm 包 + 生成脚本」路线正确。
4. **react-dom/createRoot/body 挂载 + 5 client 包硬绑**：上轮表述修正后更精确——React 本身我们也在用，不采纳的是 react-dom 全局根、body 追加（违反我们 prelude 红线）与更窄的宿主下限（rc.3 vs alpha.2）。

---

## 4 执行顺序建议（依赖关系）

```
R-09（peer 补正，独立，随手做）
R-06 → R-01（防线先行，再开用户目录）
R-02（独立；先真宿主探测事件面）
R-03（独立；announce 路由 + statusBubbles）
R-04 → R-07（状态落盘后，覆盖层读写同一文件树）
R-08、R-10（独立，可穿插）
R-05（最后，实测数据决定做不做）
```

## 5 遗留缺口（本报告未闭合的）

- 竞品 CI 内容未读（B10），其资产门禁有无不能下结论。
- 竞品插件未实际运行：多会话气泡、亲密度 UI、工坊下载的实际体验结论均来自源码/文档。
- R-02 的事件名在 dsh 0.2.1-alpha.2 宿主上的可用性未探测（行动时第一步）。
- `dsh-plugin-dev check --strict` 本轮未重跑（上轮 13 passed/3 skipped；本轮无代码变更，不影响）。

---

*本报告为台账原件：断言、判定、修正均按核实当场记录，未做事后美化。修订实施时逐条回填状态。*

---

## 6 修订执行记录（2026-10-27 回填，v1.21.0）

全部 R 项已按第 4 节顺序执行完毕，测试 96/96（build+smoke+host/assets/runtime/push-api/voice+jsdom overlay）。
不发 npm、不打 tag（用户指令）；版本号本地 bump 1.21.0。

| 项 | 状态 | 落点 |
| --- | --- | --- |
| R-09 | ✅ 已实施 | package.json peerDependencies + `"react": ">=18.2.0"` |
| R-06 | ✅ 已实施 | `/dsh-pet/pets/*` realpath 双侧包含 + ASSET_TYPES 白名单 + 注册表准入 + 413；`/dsh-pet/assets` 单文件 >20MB → 413 |
| R-01 | ✅ 已实施 | 宿主 `lib/registry.js` 扫描 `$DSH_HOME/dsh-pet/pets/<id>/pack.json` 与内置合并（后注册覆盖、非法跳过），`GET /dsh-pet/personas` 下发；客户端 `setPersonas()` 空表拒收/失效回落，`assetUrl()` 每形象基址 |
| R-02 | ✅ 已实施 | 宿主 lifecycle 事件投影 working/tool/review/done（`tools/result` 与旧 `tool/result` 双注册），`/ping` 直出 `phase`/`phaseAt`（15s 新鲜窗）；客户端 `computePhase()` 融合（thinking/working→walk、review→hair、done 前 4s） |
| R-03 | ✅ 已实施 | `POST /dsh-pet/announce`（30/分限流、≤300 字、seq 防重放、机会主义 `ctx.pet?.announce`）；设置 `statusBubbles auto|off` 只闸自动台词 |
| R-04 | ✅ 已实施 | `GET/POST /dsh-pet/state`（settings ≤64 键 / history ≤200×8000 字符白名单）；客户端启动宿主优先合并、否则一次性上云 |
| R-05 | ⏸ 不实施（理由见 R-05 节回填） | — |
| R-07 | ✅ 已实施 | `$DSH_HOME/dsh-pet/voice.json` 按 mood warn-and-drop 合并（实施中纠正了计划稿的 shape bug：覆盖对象是 `{mood: [lines]}` 而非扁平数组）；voice.test 6 用例 |
| R-08 | ✅ 已实施 | `tests/overlay.dom.test.mjs`（JSDOM 真跑 client.js）：菜单键盘可达（全 button[role=menuitem]）、Escape 关闭（源码补 onKeyDown）、视频 error→静帧回退+clipFailed；devDeps react/react-dom/jsdom 不进包 |
| R-10 | ✅ 已实施 | 6 个 `pets/*/pack.json` 全部 `"license": "MIT"`；根 `THIRD_PARTY_NOTICES.md` 随包（files 已加）；assets.test 门禁（pack license + notices 存在，runtime-only 副本 skip） |

验证：`npm test` 96/96；`npm run gen:check` 逐字节一致（5 pack）；`npm pack --dry-run` 1.21.0 / 138 files / packed 19,698,095 B（NOTICES 已入包）。`dsh-plugin-dev check --strict` 在当前宿主已不存在（1.20.0 报告已核实），沿用「宿主加载期校验 + 实跑」替代证据链。
