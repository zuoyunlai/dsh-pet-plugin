# Changelog

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
