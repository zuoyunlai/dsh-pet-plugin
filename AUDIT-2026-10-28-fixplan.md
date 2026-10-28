# dsh-pet 审计修订计划（2026-10-28）

> 依据：2026-10-28 对 v1.24.0 的全量审计（约 6900 行源码精读 + 五语 locale / 素材哈希 /
> 文档口径脚本核对 + 五份历史审计交叉验证）。总评 78/100。
> 本文档只收**核实过**的问题：每条修订项都先有实锤证据（文件:行 或脚本输出），再定改法。
> 编号沿用仓库 R-xx 惯例；R-01~R-03 为 P1（现行真 bug），R-04 起按投入产出排序。

## 0. 核实结论（全部复现过，非推测）

| # | 证据 | 结论 |
|---|---|---|
| V1 | `src/40-settings.js:35` 的 `CLOCK_RE = /^([01]\\d|2[0-3]):[0-5]\\d$/`；从构建产物 `client.js` 提取该正则实测 `test("09:00")`、`test("23:59")` 均为 `false` | 双反斜杠使时间校验永不通过，活跃时段每次重载被静默重置为默认 `09:00–23:00` |
| V2 | `lib/prompt.js:15-20` `PERSONA_INFO` 仅 4 只；`pets/azure/pack.json` 有完整 `name/tag/tagEn`；`registry.js:21` 与 `tools/gen-personas.cjs:34` 的 `PREFERRED_IDS` 同样没有 azure | 选鲸鱼娘（及一切用户 pack 形象）单聊时，system prompt 静默回落成「薇」 |
| V3 | `src/70-style.js:334-337` 减弱动效块用裸 `*` 通配；CSS 经 `96-overlay.js:193` 的 `<style>` 注入主文档（无 shadow DOM） | OS 开「减弱动效」时，插件会把**整个 DSH 宿主**的动画/过渡一并关掉 |
| V4 | `src/99-entry.js:169` `urls = [base+'/dsh-pet/ping', '/dsh-pet/ping']`，`base` 为空时两元素相同且无去重（`chatWithPet` 有去重） | 同一地址失败时白跑一轮（8s 预算 ×2） |
| V5 | `src/70-style.js:326` 使用 `var(--pet-bd)`，全文件只定义过 `--pet-border` | 右键菜单边框色静默回落 currentColor |
| V6 | `runtime.chatOpen` 全仓只有三处：初始化 false、`hidePet` 置 false、`96-overlay.js:102` 读取；无任何置 true | 1.22.0 之前的死状态 |
| V7 | `src/90-components.js:83` 仍检查 `patch.voicePitch/voiceRate`；这两个键在 `loadSettings` 里已被删除迁移 | 死条件残留 |
| V8 | `TTS_VOICES.xiaomo → zh-CN-YunxiNeural`（云希，男声），无任何形象引用、面板不列；五语 locale 各有 `voice.xiaomo` 键 | 死键 + 键名与实际音色不符（README 还把「晓墨」当卖点列出） |
| V9 | `index.js:554` 读 `cfg.chatTimeoutMs`，但 `Config` schema 无此键 | 死配置项，用户配了不生效 |
| V10 | `src/41-runtime.js:63` 注释「20s 兜底」，`CLIP_MAX_MS` 实为 12000 | 注释与代码不符 |
| V11 | `checkNeural` 的 `.catch(() => { runtime.neuralOk = false })`（`50-voice.js:107`） | `/tts/status` 一次网络抖动 → 本会话永久降级，与「连续 3 次才降级」的自述相悖 |
| V12 | `chatWithPet` 的 fetch 无超时（`60-behavior.js:475`） | 网络挂起时气泡「……」与 busy 状态最长挂到浏览器自身超时 |
| V13 | 客户端硬编码中文绕过 i18n：单聊错误气泡（`60-behavior.js:526,529`）、状态点 title（`96-overlay.js:227-233`）、actor 悬停提示（:301） | 非中文用户在这些路径看到中文 |
| V14 | locale 实测：`hint.privacy` 五语全是英文原句；`panel.lang` 五语全 "Language"、`panel.settings` 四语 "Settings"；hi 有 14 个 `pet.*` 键与 en 逐字相同（清单见 R-15） | 五语宣称与实际不符 |
| V15 | `tests/assets.test.mjs:85` 硬编码 `['violet','crimson','indigo','silver']` | azure 不在「pack 引用素材必须存在」的测试覆盖里（V2 的直接原因） |
| V16 | README 口径 10 处过期（体积「2MB」vs 实测 19.9MB packed；交叉淡入 240ms vs 实际 180ms；「每套 3 张/340ms」vs 薇绯 6 帧/230ms；走路 ±5px vs -5/+13px；es/pt/hi 鲸鱼娘仍写单立绘；「面板不随宠物移动」vs `placePanel()`；assets 扩展名漏 webm/jpeg；「license 必填」强于运行期行为；「7 种心情」列了 8 个；「3 形象×8 心情」实为 5） | 文档债，其中体积为量级错误 |
| V17 | `index.js:677` `assetHandler` 不调 `applyCors`，`:727` `petAssetHandler` 调了 | 口径不齐。**不改行为**：桌面壳对 http 资产的 `Sec-Fetch-Site` 可能是 cross-site，加闸有破坏风险——本轮只补注释说明理由 |
| V18 | `tests/assets-manifest.json`(15.8KB) 与 `tests/voices.json`(8.7KB) 不在 `files` 白名单，但依赖它们的两个 .mjs 在包里 | 装到 profile 后跑这两个测试 ENOENT |
| V19 | 「重置全部」按钮 `window.location.reload()`（`90-components.js:250`） | 重置插件设置却重载整个 DSH 应用，殃及宿主未保存状态 |

## 1. 修订项

### R-01〔P1〕修 CLOCK_RE，活跃时段可持久

- **改法**：`src/40-settings.js:35` 双反斜杠改单反斜杠：`/^([01]\d|2[0-3]):[0-5]\d$/`。
- **验收**：新增回归测试两条——①从 `client.js` 源文本提取 `CLOCK_RE` 断言匹配 `09:00`/`23:59`、拒绝 `24:00`/`9:00`；②harness 预置 `localStorage['dsh-pet.settings.v1']`（`activeStart:'22:30'`）加载后断言 `runtime.settings.activeStart === '22:30'`（真用户路径 round-trip）。
- **风险**：无。旧行为是「永远重置」，新行为只是恢复 1.14 前的本意。

### R-02〔P1〕鲸鱼娘与用户形象的单聊人设

- **改法**：两层。①`lib/prompt.js` 的 `PERSONA_INFO` 补 `azure`（内容取自 `pets/azure/pack.json` 的 `name/tag/tagEn`，作纯函数兜底，测试可直测）；②`index.js` `chatHandler` 改为**优先查运行期注册表** `petRegistry.personas`（宿主侧扫描的 pack 数据是服务端可信输入，不构成注入面），查不到再回落 `personaById`——一并覆盖用户自定义 pack。
- **验收**：新增单测：`personaById('azure').name === '鲸鱼娘'`；未知 id 仍回落 violet；注册表命中时用 pack 的 name/tag（host 侧已有 makeCtx 假 ctx 模式可复用）。
- **风险**：注册表异步加载未完成时的首个请求回落内置表——与现状等价，不劣化。

### R-03〔P1〕减弱动效规则加作用域

- **改法**：`src/70-style.js` 该 media 块的 `*,*::before,*::after` 改为 `.dsh-pet-layer *,.dsh-pet-layer *::before,.dsh-pet-layer *::after`。菜单/面板/特效层都是 `.dsh-pet-layer` 的 DOM 子孙（`96-overlay.js:180-342`），覆盖完整；输入框右侧 🐾 按钮在另一个 slot，但它没有任何 animation 声明，不受影响。
- **验收**：构建后 grep 产物确认无裸 `*{animation:none`；现有 R10 相关测试（harness reduced 路径）保持绿。
- **风险**：低。唯一语义变化是「宿主动画不再被插件关掉」——这正是目的。

### R-04 内置顺序表补 azure（两处同步）

- **改法**：`tools/gen-personas.cjs:34` 与 `lib/registry.js:21` 的 PREFERRED 列表补 `'azure'`，并加注释「两处必须同步」。
- **验收**：`npm run gen:check` 仍报逐字节一致（azure 字母序本就落第五，顺序不变）；`npm test` 全绿。
- **风险**：无（纯显式化既有巧合）。

### R-05 /ping 轮询 URL 去重

- **改法**：`src/99-entry.js` 构造 urls 时去重（与 `chatWithPet` 同款写法）。
- **验收**：现有轮询测试全绿；harness 断言 `base` 为空时 fetchLog 中同 URL 不再连续出现两次失败重试（如已有覆盖则免）。

### R-06 `--pet-bd` 改 `--pet-border`

- **改法**：`src/70-style.js:326` 一行。**验收**：构建产物 grep 无 `--pet-bd`。

### R-07 注释对齐：兜底 12s

- **改法**：`src/41-runtime.js:63` 注释「20s」改「12s（CLIP_MAX_MS）」。

### R-08 checkNeural 网络失败可重试

- **改法**：`src/50-voice.js` `.catch` 分支改置 `undefined`（未知）并复位 `neuralChecked`，下次说话重试；`available:false` 的明确否定结论仍直接降级。
- **验收**：voice/runtime 测试全绿；不在测试里模拟网络抖动（收益低），靠 code review。

### R-09 单聊加客户端超时

- **改法**：`chatWithPet` 每个 fetch 配 `AbortController` + 90s 超时（> 服务端默认 30s、≤ 可配置上限 120s），超时走既有错误气泡路径。
- **验收**：harness 可编程 fetch 挂起 + advance 90s 断言 ai=fail（若易构造则加，构造困难则以 review 为准）。

### R-10 死代码清扫

- `runtime.chatOpen`（41-runtime 初始化、60-behavior hidePet、96-overlay inputShown 三处连根）
- `runtime.input`（41-runtime 兼容字段）
- `90-components.js:83` 的 `voicePitch/voiceRate` 残留条件
- `TTS_VOICES.xiaomo` + 五语 `voice.xiaomo` locale 键（五语同步删，保持键平价；README「晓墨」表述随 R-16 修）
- **验收**：`npm test` 全绿（voice.test 的音色存在性断言不受影响——删的是无引用键）；grep 全仓无残留。

### R-11 `chatTimeoutMs` 进 Config schema

- **改法**：`index.js` Config 加 `chatTimeoutMs: Schema.number().min(1000).max(120000).default(30000)`，既有夹取逻辑保留。
- **验收**：host 测试全绿。

### R-12 内置 assets 路由不设闸：写明理由

- **改法**：`index.js` `assetHandler` 上方加注释：为何不走 `applyCors`（`<img>/<video>` 的 no-cors 加载会带 `Sec-Fetch-Site: cross-site`，桌面壳形态下加闸可能直接断图；且该路由只服务包内公开素材、basename 防穿越、无副作用）。
- **验收**：纯注释。

### R-13 「重置全部」软复位

- **改法**：`90-components.js` 按钮 onClick 改为：清 `STORAGE_KEY` → `runtime.settings = loadSettings()` → 清 `dragPos/autoPos` → `clearAction()` → `placePanel()` → `notify()`；不再 `location.reload()`。聊天历史不清（原 reload 行为也不清它，语义保持）。
- **验收**：harness/组件层测试不回归；行为可在 debug 口 review。

### R-14 测试补强 + 打包修复

- `tests/assets.test.mjs:85` ids 补 `'azure'`。
- 新增 host 侧 prompt 测试（R-02 验收）。
- 新增 settings round-trip + CLOCK_RE 回归（R-01 验收；`harness.mjs` 增加可选 `opts.storage` 预置，向后兼容）。
- `package.json` `files` 补 `tests/assets-manifest.json`、`tests/voices.json`（合计 <25KB，修 V18）。
- **验收**：`npm test` 全绿；`npm pack --dry-run` 出现这两个文件。

### R-15 i18n 批量修订

- 新增键（五语同步）：`chat.needSignIn`、`chat.stuck`（替 `60-behavior.js` 两处硬编码）、`dot.thinking/ok/fail/idle`（替 `96-overlay.js` 四处 title）、`actor.tip`（替 :301 硬编码）。
- 翻译既有英文占位：`hint.privacy`（zh/es/pt/hi 四语）、`panel.lang`（zh/es/pt/hi）、`panel.settings`（zh/es/pt/hi）。
- hi 补译 14 个与 en 逐字相同的 `pet.*` 键（用天城文，与既有 3 键一致）+ `meta.title`。
- **验收**：键集合五语平价（沿用既有 gen-locales 门禁思路，脚本复核）；`npm test` 全绿。

### R-16 文档口径批量修正（五语 README + CHANGELOG）

- zh/en：240ms→180ms；帧况改为「3–6 帧（6 帧时 230ms/帧）」；走路改「−5/+13px 非对称」；「面板不随宠物移动」改为按位置摆放；assets 扩展名补 webm/jpeg；「license 必填」改为「内置包门禁要求，用户包运行期不校验」；「7 种心情」→8；「3 形象×8 心情」→5；「晓墨」从卖点列表移除；体积「2MB」→「约 20MB（87 个素材，20MB 门禁约束）」。
- es/pt/hi：鲸鱼娘「单张立绘」改为五张表情（对齐 1.23.0）。
- CHANGELOG 增补 1.24.1 段记录本轮。
- **验收**：五语相关表述互查一致；不承诺本轮做「数字单一源生成」（挂账）。

### R-17 全量验证（发版前绿闸）

`node build.mjs` 两次产物逐字节一致 → `npm run gen:check` → `npm test` 全绿 → `npm pack --dry-run` 体积复核（当前 19.9MB，已贴近 20MB 门禁）→ CHANGELOG/README 与行为对齐复查。

## 2. 本轮不做（挂账，附理由）

| 项 | 理由 |
|---|---|
| 包体瘦身（webm 重压缩/可选资源包） | 素材管线问题，牵动资产基线与质量门，需独立评估；本轮只把口径改实 |
| CI 加 Windows runner / 浏览器截图矩阵 | 基建改动，独立提交 |
| README 数字单一源生成 | 需设计（生成器 or lint），超出本轮 |
| 多标签页会话隔离（历史 R09） | 历史已明确暂缓，设计改动 |
| 气泡 aria-live 打断读屏、打字机动效、sourcemap、runtime 拆分 | 历史 P3 打磨项，维持挂账 |
| host 侧 429/探测失败中文文案 i18n | 宿主日志/低频路径，价值低 |
| `pets/example` 悬空引用 | 模板性质、运行期已排除；等模板改造时一并处理 |
| `assetHandler` 加准入闸 | 见 V17：有破坏桌面壳加载的风险，只注释不改 |
| 视线跟随按形象短路 | 真优化但需真机验证观感（移除后鼠标交互变化），下一轮 |

> **执行补记（2026-10-28 晚）**：§2 挂账中被评为最有价值的四项已按序落地为 1.25.0——
> ①包体瘦身走了「同分辨率重编码 + VMAF/alpha-SSIM 质量闸」路径（19/20 片段过闸，
> 包体 19.9→15.5MB；「可选资源包拆分」仍留作结构性选项，涉及默认形象数与安装方式的产品决策）；
> ②CI 增 browser（Playwright，含 R-03 三方向端到端）与 windows 两个 job；③README 数字
> 单一源测试 9 条口径进绿闸；④aria-live 分流 + 视线跟随短路。细节见 CHANGELOG 1.25.0。

## 3. 执行顺序

R-01 → R-02 → R-03 →（R-04~R-13 小项一批）→ build + gen:check 中检 → R-14 测试 → R-15 locale → R-16 文档 → R-17 全量验证。每步落盘前跑相关子集，收尾跑全量。

## 4. 执行记录

| 项 | 状态 | 备注 |
|---|---|---|
| R-01 CLOCK_RE | ✅ 完成 | 单反斜杠修复；新增 3 条回归（产物正则实测 / 往返保留 / 坏值仍回落） |
| R-02 azure 人设 | ✅ 完成 | `PERSONA_INFO` 补 azure + chatHandler 优先读注册表；`PREFERRED_IDS` ×2 同步；新增 personaById + chat e2e 2 条测试；assets 测试改扫目录 |
| R-03 reduced-motion 作用域 | ✅ 完成 | `.dsh-pet-layer` 前缀；产物 grep 无裸 `*{animation:none` |
| R-04 顺序表 | ✅ 完成 | `gen:check` 仍逐字节一致（azure 字母序本就落第五） |
| R-05 ping 去重 | ✅ 完成 | 与 chatWithPet 同款写法 |
| R-06 --pet-bd | ✅ 完成 | 产物 grep 0 残留 |
| R-07 注释 12s | ✅ 完成 | |
| R-08 checkNeural 重试 | ✅ 完成 | 网络错误置未知 + 复位 neuralChecked |
| R-09 单聊客户端超时 | ✅ 完成 | 90s AbortController，超时走既有错误气泡（五语） |
| R-10 死代码清扫 | ✅ 完成 | chatOpen / runtime.input / voicePitch 残留条件（迁移 delete 保留）/ xiaomo（音色表 + 五语键）；voice.test 音色清单同步（xiaomo→hsiaochen） |
| R-11 chatTimeoutMs schema | ✅ 完成 | default 30000，min 1000 max 120000 |
| R-12 assets 无闸注释 | ✅ 完成 | 说明桌面壳 Sec-Fetch-Site 风险，行为不变 |
| R-13 软复位 | ✅ 完成 | 清 storage → loadSettings → 清位置/动作 → placePanel，不再 reload |
| R-14 测试 + 打包 | ✅ 完成 | harness 支持 `opts.storage` 预置；files 补 2 个 json（pack 142→144 文件）；测试 101→106 |
| R-15 i18n 批量 | ✅ 完成 | 新增 7 键 ×5 语；privacy/lang/settings 本地化；hi 补译 14 键 + meta.title；键平价 64/64 ×5 |
| R-16 文档 | ✅ 完成 | 五语 README 修正（zh 9 处、en 7 处、es/pt/hi 各 1 处）；CHANGELOG 增 1.24.1 段；package.json 版本 1.24.0→1.24.1 |
| R-17 全量验证 | ✅ 完成 | 构建两次 sha1 相同（9294c4d399cf）；`gen:check` 逐字节一致；`npm test` 106/106；`npm pack` 19.9MB / 144 files |

未做（挂账）：见 §2，全部维持原判。执行后整体复核：五份 README、CHANGELOG、fixplan 三者口径互查一致。
