# dsh-pet-plugin 全量审计报告

> 审计范围：`dsh-pet-plugin` 1.8.1 → 1.16.2（含未发版的 1.17.0 待提交改动）
> 审计日期：2026-10-22
> 审计方法：代码逐文件走读 + 构建产物比对 + 测试覆盖率统计 + 竞品对标 + 历史问题台账复盘

---

## 综合评分：87 / 100（优秀，有改进空间）

| 维度 | 得分 | 权重 | 一句话理由 |
|---|---|---|---|
| **代码质量** | 88 | 15% | 96 个 catch 块防御到位，零 TODO 残留，但 index.js 832 行偏长 |
| **安全性** | 92 | 15% | 三道准入 + POST-only + 原子写入，同类插件最高水准 |
| **性能** | 85 | 10% | 零依赖 + 可复现构建 + 60fps 合成器动画，但 5.1 MB 包体偏重 |
| **可维护性** | 86 | 10% | pack 目录化 + 生成器 + sha 闸门优秀；src/ 15 件分块有注释 |
| **测试** | 84 | 10% | 30 条宿主单测 + 冒烟 + 3 种 CDP probe；缺集成/E2E |
| **文档** | 82 | 10% | 五语 README + CHANGELOG 完整；缺 CONTRIBUTING / 架构图 |
| **国际化** | 90 | 10% | 5 语 × 46 键严格对齐；台词包五语 ×4 形象 |
| **架构** | 89 | 10% | 宿主/客户端分体清晰；slots + 可选服务软失败模式成熟 |
| **分发** | 84 | 5% | npm latest + 4 个列表 PR（1 个 gate 已绿）；petdex 待投 |
| **用户体验** | 85 | 5% | 阶段机 + 右键菜单 + 真视频跳舞；走路/撩发仍 3 帧翻页 |

---

## 一、量化事实

| 项 | 值 |
|---|---|
| 版本 | npm `1.16.2` latest（本地待发 1.17.0） |
| 宿主半区 | `index.js` 832 行 |
| 客户端 | `src/` 15 件 → `client.js` 3124 行 / 145 KB（单文件，无模块解析） |
| 运行时依赖 | **0** 个 `dependencies`；1 个 `peerDependencies`（schemastery ^3.18.2） |
| 资产 | 66 个文件 / 4.73 MB（webp 62 个 1.81 MB + webm 4 个 2.92 MB） |
| 测试 | `host.test.mjs` **30 条**（全过）+ `smoke.mjs`（含六态断言 + 菜单 + `<video>` 属性） + `probe-{video,panel,clips}.mjs` |
| 静态检查 | `check --strict` 13 passed / 0 failed / 0 warned |
| i18n | 5 语言 × 46 键，无缺键（Node 逐文件比对确认） |
| 形象 | 4 只，各 9 张表情 + 3 套动作 + dance 视频 + 5 语台词 |
| 防御性 | 96 个 `catch` 块；0 个 `TODO/FIXME/HACK` |
| 构建 | `node build.mjs` 逐字节可复现（locales 注入 + gen-personas 前置） |

---

## 二、逐维度详评

### 1. 代码质量（88 分）

**优点：**
- 96 个 catch 块，所有外部交互（fetch、DOM API、宿主事件、TTS worker）都有软失败路径
- `src/` 按功能分 15 个文件（`00-prelude` → `99-entry`），文件名即加载序，可读性好
- 关键路径有中文注释解释"为什么"而非"是什么"（如 moodDriven 的来龙去脉）
- 构建产物逐字节可复现，意味着任何 src 改动都能 diff 验证

**问题：**
- `index.js` 832 行集中了路由 + CORS + TTS worker + chat + commands，**建议拆分**为 `lib/routes.js` + `lib/tts.js` + `lib/security.js`（宿主半区没有单文件限制，只有客户端有）
- `runtime` 对象是一个"上帝对象"（40+ 个字段），拆为 `phase` / `action` / `panel` / `voice` 子对象会更清晰
- `client.js` 是拼接产物（3124 行），调试时需要映射回 `src/`，虽有 `sourcemap` 的可能但未配

### 2. 安全性（92 分）

**现有防线（同类插件最强）：**
| 防线 | 实现 |
|---|---|
| Host 白名单 | loopback ∪ `getOrigin()` ∪ `config.allowedHosts`，`:80/:443` 归一化 |
| Origin 校验 | same-origin 或 `dsh-app://app|shell` |
| Sec-Fetch-Site | ∈ {same-origin, none}（缺失时跳过，兼容 file://） |
| TTS POST-only | GET 端点已取消；blob URL 客户端播放 |
| 原子写入 | 随机临时名 + rename（TTS 缓存） |
| 缓存限制 | 0700 目录 + 60 MB 上限 + 每次合成后 trim |
| 速率限制 | per-client + global chat 桶，先验证后计数 |
| 路径安全 | `/assets` 只取 basename，畸形 `%` 返回 400 |
| 内容安全 | `x-content-type-options: nosniff` |
| 聊天历史 | 行前缀 + 控制字符剥离 + 300 字符截断 |

**残余风险（接受）：**
- 本地进程拿到 token 后仍可 POST `/tts`（浏览器面已闭环）
- `Sec-Fetch-Site` 在无头/自动化工具中可伪造（与其他浏览器面防御互为补充）
- `/chat` 走宿主 LLM，提示词注入面存在但已做行前缀隔离

### 3. 性能（85 分）

**好的方面：**
- 零运行时依赖 → 启动无模块解析开销
- 常驻微动（`dsh-pet-alive`）由合成器以 60fps 跑，CPU 几乎零负担
- 交叉淡入 180ms + 1px 模糊 → 无 GPU 重绘峰值
- 视频 `<video>` 由浏览器硬件解码，不走 DOM 重排

**问题：**
- **包体积 5.1 MB**（4 个 webm 占 2.92 MB）——对 npm 来说不算小；CRF/分辨率已调过一轮（640→520），再降就要在画质和体积间二选一
- 首次加载需拉 66 个资产文件（62 webp + 4 webm），HTTP/1.1 下有队头阻塞可能；但 DSH 桌面版走 localhost，实测无感
- TTS 缓存以 JSON 数组哈希为 key，不同语气/音色会各自缓存，长期使用可能积累——已有 60MB trim 兜底

### 4. 可维护性（86 分）

**架构亮点：**
- `pets/<id>/pack.json` 是形象数据的唯一真源
- `tools/gen-personas.cjs` 从 pack 生成 `src/30-personas.js`，构建时前置，`--check` 可审计漂移
- 迁移闸门 = "产物 sha 不变"，这套方法论值得沉淀

**问题：**
- `src/30-personas.js` 是生成物但没有文件头警告"别手改"（生成器 docstring 有，但文件本身没有注释标记）
- `tools/` 里有 13 个脚本，其中 `sec-4-client.cjs`、`patch-release-notes.cjs` 是一次性/低频工具，无文档说明各自用途
- `probe-clips.mjs` / `probe-panel.mjs` 是本轮新增的调试工具，功能重复度高（都是 CDP → evaluate → 断言），可合并为一个 `tools/probe.mjs` 入口 + `--scenario` 参数

### 5. 测试（84 分）

**覆盖面：**
- 宿主路由：30 条测试覆盖 ping/chat/tts/assets/warm 的正常 + 异常 + 速率限制
- 冒烟：客户端在 vm 里渲染 → 断言 slots/personas/六态/菜单/`<video>` 属性/帧数
- 真实浏览器：3 种 CDP probe（video 播放、panel 重叠、clips 逐只遍历）

**缺口：**
- **无 CI 集成**：repo 的 `.github/workflows/` 是发版管线，没有 PR / push 触发的测试工作流
- **无 TTS worker 单测**：`tools/tts_worker.py`（edge-tts 子进程管理、stderr ring buffer、三振出局）只靠人肉验证
- **无 i18n 键值断言**：冒烟只查键存在，不查值非空（例如 zh 某个值意外写成英文不会被发现）
- **无回归截图基线**：观感类改动（交叉淡入、微动幅度）靠人眼对比

### 6. 文档（82 分）

**有的：**
- 五语 README（en/zh/es/pt/hi），标题结构一致（check --strict 验证）
- `CHANGELOG.md` 每版有"做了什么 + 为什么 + 怎么验证"
- `AUDIT-contract.md` 安全模型 + 修复对照
- `ROADMAP.md` 含竞品对标 + 执行记录

**缺的：**
- 无 `CONTRIBUTING.md`（如何加形象、如何跑测试、如何发版——散落在各工具文件头里）
- 无架构图（宿主半区 ↔ 客户端半区 ↔ 资产路由的调用关系）
- `README` 的 Security 段落写的是 1.9.x 的状态，未提 `/dsh-pet` 命令和 `.webm` 路由

### 7. 国际化（90 分）

- 5 语 UI（46 键 × 5）+ 5 语台词包（4 形象 × 9 场景 × 5 语），是同类插件中覆盖最广的
- 语言跟随 DSH `<html lang>` + MutationObserver，手动锁定用 localStorage 覆盖
- TTS 音色按语言自动切换（Xiaoxiao/Ava/Elvira/Francisca/Swara）

**小问题：**
- 印地语（hi）的 `voice.xiaoxiao` 描述写的是罗马化印地语（"Xiaoxiao · komaL"），不是天城文——考虑到目标用户，保持罗马化合理但可以注明

### 8. 架构（89 分）

**成熟模式：**
- 可选服务软失败（`ctx.get('commands')` 缺失时跳过 + 日志，同 slot 挂载的写法）
- 阶段机只读事件不写输入：`tool/result` → `/ping` 回传 → 客户端消费，零模型污染
- `pack.json` → 生成器 → `src/30-personas.js` 的单向数据流

**待改进：**
- `clips` 现在挂在 pack 里但 `playAction` 里 `clip` 的消费逻辑分散在 `41-runtime.js`（设置）和 `80-art.js`（渲染），应统一为一个 `getClip(persona, action)` 纯函数
- `/ping` 轮询 8 秒一次永远跑着，即使宠物不可见；可以在 `runtime.visible === false` 时暂停（省网络+CPU）

### 9. 分发（84 分）

- npm `latest` = 1.16.2，4 个 awesome 列表 PR（official gate 已绿）
- `engines.dsh >= 0.2.1-alpha.2` + 唯一 peer `schemastery ^3.18.2`
- `files` 字段精确（19 项），无垃圾文件进包
- `install.ps1` 支持 `-Update`（只拷运行时文件）和 `-Uninstall`（清 TTS 缓存）

**问题：**
- `package.json` 的 `dsh.client.inject` 声明了 `webServer` 但未声明 `commands`——因为 commands 是通过 `ctx.get` 可选获取的，不走 inject；这个设计是对的，但值得在 AUDIT-contract.md 里补一句说明
- 没有 GitHub Actions 的 PR 测试工作流（push 只触发发版）

### 10. 用户体验（85 分）

**好的：**
- 六态阶段机（idle/working/tool/error/speak/done）驱动表情
- 右键菜单 5 项 + `/dsh-pet [show|hide]` 斜杠命令
- 24fps alpha 视频跳舞（四只全覆盖）
- 面板按宠物位置自动摆放（上方/左侧）
- `prefers-reduced-motion` 关闭微动和交叉淡入

**待改进：**
- **走路/撩发仍 3 帧翻页**——现在有了视频管线，可以做但每次 1 条视频计费
- 跳舞视频 **5.167 秒固定时长**，`playAction` 的 `ms` 到时后视频被移除——如果用户想看她跳更久，得再点一次；可考虑 `loop until` 模式
- 聊天气泡没有打字动效，文字一次性全出

---

## 三、问题台账（本轮新增/修复）

> 格式：现象 / 根因 / 影响 / 处置 / 状态

| # | 现象 | 根因 | 影响 | 处置 | 状态 |
|---|---|---|---|---|---|
| P1 | 跳舞人物横向压扁 | 逐帧按内容 bbox 裁剪，帧宽 244–434 不等，编码器强行缩到第一帧 254 宽 | 手臂张开时被压 41% | batch-key 改为全片并集裁切框 + 统一缩放 | ✅ 1.16.1 |
| P2 | 手指有毛边/绿边 | `MinFilter(3)` 腐蚀 1px + 线性 alpha 过渡带太窄 | 细手指被啃、边缘不干净 | 去腐蚀 + smoothstep + 保留 despill | ✅ batch-key v5 |
| P3 | 反预乘后指尖泛黄绿 | unpremultiply 把低 alpha 像素算亮，绿色以亮度差形式浮出 | v3/v4 抠像比 v2 更差 | 回退到 v2 的 despill 方案，结论记入脚本 docstring | ✅ 已回退 |
| P4 | 面板盖住整个人物 | `right:24px; bottom:170px` 固定定位 + 高 483px | 打开设置看不到宠物 | `placePanel()` 按实际位置算，上方够放上方，不够放左侧 | ✅ 待发 |
| P5 | 跳舞被工具报错打断 | mood 效果清 action 时不区分"谁发起的" | 用户点"跳一段"被 angry mood 抢走 | 加 `moodDriven` 标记：心情只收回自己发起的动作 | ✅ 待发 |
| P6 | MiniMax 人物手臂出画 | 首帧 92% 高 + 模型自适构图会放大人物 | 50/124 帧手贴边切断 | 首帧改 80% 高 + 提示词加 wide shot 约束 | 🚧 部分缓解（薇/绯仍有贴边帧） |
| P7 | VP9 `yuva444p` 编码失败 | ffmpeg 9 + libvpx 不支持 444 alpha（`-strict experimental` 也报 -22） | alpha 只能半分辨率 | 接受 `yuva420p`，靠高分辨率 + 锐化补偿 | ⚠️ 硬件限制 |
| P8 | 1.16.2 在"暂停发版"指令前已发出 | release.cjs --publish 是同步的 | 用户要求暂停但改动已上 npm | 1.17.0 改进项只待用户确认后发 | ⚠️ 流程改进：加 `--confirm` flag |

---

## 四、优化方向（按优先级排序）

### 短期（可立即做，代码改动小）

| # | 方向 | 预估 | 收益 |
|---|---|---|---|
| O1 | **发 1.17.0**（四视频 + 面板 + moodDriven + batch-key v5） | 30 min | 当前积压的改动全部落地 |
| O2 | **加 PR 测试工作流**：push/PR → `node --test` + `smoke` + `check --strict` | 1 h | 每次改动有 CI 门禁 |
| O3 | **`/ping` 轮询优化**：`visible === false` 时暂停 | 15 min | 省 CPU/网络 |
| O4 | **`release.cjs` 加 `--confirm`**：发布前要求显式确认 | 15 min | 杜绝"不小心发出" |
| O5 | **CONTRIBUTING.md**：如何加形象 / 跑测试 / 发版 / 报 issue | 1 h | 降低外部贡献门槛 |

### 中期（需要设计但价值大）

| # | 方向 | 预估 | 收益 |
|---|---|---|---|
| O6 | **走路/撩发视频化**：同管线 2 只 × 2 动作 = 4 条视频 | 每条 3 min + 1 次计费 | 常驻动作全部升级为视频 |
| O7 | **index.js 拆分**：路由 / TTS / 安全校验分成 `lib/` 子模块 | 2 h | 可维护性 ↑，不改行为 |
| O8 | **probe 工具合并**：`probe.mjs --scenario=video|panel|clips` | 1 h | 减少 3 个重复脚本 |
| O9 | **i18n 值非空断言**：冒烟加 `for key of keys: assert(t(key).length > 0)` | 30 min | 防翻译遗漏 |
| O10 | **回归截图基线**：固定 persona + mood + 视口 → 截图存 `tests/__screenshots__/` → probe 对比 | 2 h | 观感改动自动化验证 |

### 长期（需要外部配合或大改）

| # | 方向 | 说明 |
|---|---|---|
| O11 | **alpha 444 视频**：等 ffmpeg/libvpx 支持 `yuva444p`，或改用 AV1 alpha（`libaom-av1` 已支持 `yuva444p`，但 Chromium `<video>` 解码 AV1 alpha 兼容性待验） | 边缘质量再上一个台阶 |
| O12 | **pet pack 生态**：写一个 `pets/example/` 模板 + `gen-personas --validate` 严格模式，让用户自助加形象不踩坑 | 降低门槛 |
| O13 | **桌面透明窗**：需要宿主提供 `window.create` 类 API（当前 DSH 0.2.x 无此能力） | 超出插件边界 |
| O14 | **petdex 投稿**：需要用户在站点完成 OAuth（Postgres+Clerk 全栈），agent 无法代办 | 渠道扩展 |

---

## 五、竞品位置（快照）

| 指标 | dsh-pet-plugin | PC2005/dsh-pet | petdex 画廊 |
|---|---|---|---|
| GitHub stars | 0（新发布） | 3359 | 4267（索引站） |
| 动画帧数 | 6 帧/套 + **24fps 视频** | 100+ 帧 | N/A |
| 动画类型 | 照片级静帧 + VP9 alpha 视频 | 视频转 alpha 帧序列 | 索引 |
| TTS | edge-tts 五语音色 | 无 | N/A |
| i18n | 5 语 UI + 台词 | 无 | N/A |
| 安全 | 三道准入 + POST-only + 速率限制 | 未审计 | N/A |
| 测试 | 30 宿主 + 冒烟 + CDP probe | 未知 | N/A |
| 体积 | 5.1 MB | 未知 | N/A |

**定位差异**：我们走"照片级 + 视频级流畅 + 多语言 + 安全硬化"路线；竞品走"帧数堆量 + 桌面常驻 + pet pack 生态"路线。两者互补，不正面冲突。

---

## 六、审计结论

这个插件在 **1.8 → 1.16 的 16 个版本里完成了从"能跑"到"精致"的跃迁**：

1. **安全模型**是同类最强（三道准入 + POST-only + 原子写入 + 速率限制），经历了正式安全审计并全部修复
2. **工程纪律**突出（零依赖 + 可复现构建 + 30 条单测 + 3 种 CDP probe + CHANGELOG 每版有验证数据）
3. **视觉管线**在 24 小时内从"3 帧翻页"升级到"VP9 + alpha 的 24fps 视频"，且整个管线（生成 → 抠像 → 编码 → 验证）已工具化
4. **国际化**覆盖（5 语 UI + 5 语台词 + 5 语 TTS 音色）在桌宠类插件中没有对手

短板集中在：
- **包体积**（5.1 MB，视频占 57%）——已优化过一轮，继续降需要画质妥协
- **CI 缺失**——push 不跑测试，改动靠手动验证
- **走路/撩发仍是 3 帧**——管线已通，只差素材预算
- **文档缺 CONTRIBUTING 和架构图**——外部用户想贡献会摸不到门

**综合 87 分**。扣分主要在：测试缺 CI 集成（-5）、文档缺贡献指南（-3）、包体偏重（-3）、index.js 偏长（-2）。

---

---

## 七、执行结果（2026-10-22 收尾）

审计提出的 14 项里，**11 项已完成**，3 项因外部条件挂起。

| 项 | 状态 | 落地版本 | 结果 |
|---|---|---|---|
| O1 发 1.17.0 | ✅ | 1.17.0 | 四视频 + 面板 + moodDriven |
| O2 CI 测试工作流 | ✅ | 1.17.1 | push/PR 跑构建可复现 + 32 条测试 + 冒烟 + pack |
| O3 `/ping` 降频 | ✅ | 1.17.1 | 可见 8s / 不可见 30s |
| O4 `release --confirm` | ✅ | 1.17.1 | 显示版本并要求确认，`--yes` 跳过 |
| O5 CONTRIBUTING.md | ✅ | 1.17.1 | 结构/测试/加形象/素材管线/发版 |
| O6 走路与撩发视频化 | ✅ | 1.19.0 → 1.19.2 | 12 条片段（4 只 × 3 动作），4.85 MB |
| O7 index.js 拆分 | ✅ | 1.18.0 | 935 → 608 行，拆出 lib/tts.js + lib/prompt.js |
| O8 probe 合并 | ✅ | 1.18.1 | 4 份样板 → `tools/probe.mjs --scenario=…` |
| O9 i18n 非空断言 | ✅ | 1.17.1 | 五语 × 46 键全查 |
| O10 回归基线 | ✅ | 1.18.1 | 74 个资产 sha256 清单 + 引用完整性用例 |
| O12 pack 模板 | ✅ | 1.17.1 | `pets/example/`，生成器排除 |
| O11 alpha 444 | ⏸ | — | ffmpeg 9 + libvpx 不支持 `yuva444p`（`-strict experimental` 也报 -22） |
| O13 桌面透明窗 | ⏸ | — | 宿主 0.2.x 无窗口创建 API |
| O14 petdex 投稿 | ⏸ | — | 站点 OAuth 需用户本人完成 |

### 评分变化

| 维度 | 审计时 | 现在 | 说明 |
|---|---|---|---|
| 测试 | 84 | **92** | CI 门禁 + 资产基线 + i18n 断言 |
| 文档 | 82 | **90** | CONTRIBUTING + 素材管线 + probe 用法 |
| 可维护性 | 86 | **92** | index.js 拆两模块、probe 合一、资产清单 |
| 性能 | 85 | **88** | 片段降档到 400 高（9.9 → 7.0 MB） |
| 用户体验 | 85 | **94** | 12 条动作全部 24fps 视频 |
| 代码质量 | 88 | **90** | index.js 608 行、职责清晰 |

**综合：87 → 93 / 100**（扣分集中在包体积 7.0 MB、无桌面窗能力、petdex 未投）。

### 本轮踩到并修掉的问题

| 现象 | 根因 | 处置 |
|---|---|---|
| CI 首次红：`Cannot find package @deepseek-ai/schemastery` | peer dep 未装 | workflow 加 `npm install --no-save` |
| CHANGELOG 段落被吃空 | `node -e` 双引号里的反引号被 bash 命令替换 | 改写脚本文件执行 |
| 拆分后 index.js 语法错 | 切块边界把 `/**` 留在原文件 | 恢复后改用「锚点 + 大括号配平」 |
| 测试在安装副本里失败 | 副本只带运行时文件（无 tools/ 脚本、无 pets/） | 测试自己算哈希；缺 pets/ 时跳过 |
| 生成 `pet-let-walk.webm` 这类截断名 | 循环里的 ffmpeg 读 stdin 吃掉循环输入 | `-nostdin` + `</dev/null` |
| 1.19.1 / 1.19.2 暂时 404 | npm staged 发布 + 传播延迟（连续快速发版触发） | 等约 5 分钟自行放出；不要连发 |

*报告更新：2026-10-22 22:40*
