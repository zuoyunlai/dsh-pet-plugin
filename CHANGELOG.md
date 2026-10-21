# Changelog

## 1.10.0 — 2026-10-21

**接口形态变更**：`/dsh-pet/tts` 从 `GET` 改成 `POST`，`GET` 端点取消（返回 405）。

- 起因：只要存在可以喂给 `<audio src>` 的 URL，任何页面（以及本机任意进程——它自己
  `GET /` 就能拿到 token）都能驱动宿主合成音频并写盘。token 校验挡不住这条路，
  唯一根治办法是不提供"可被当作 URL 使用的合成端点"。
- 客户端改为 `fetch(POST)` 拿 `blob` → `URL.createObjectURL` → `<audio>` 播放，
  播完/失败即 `revokeObjectURL`；连说两句时用自增序号丢弃过期的那个，避免两句抢播。
- 响应头 `cache-control: no-store`（POST 结果不进浏览器缓存）。
- 冒烟新增断言：请求必须是 POST、必须打到 `/dsh-pet/tts`、播放的必须是 blob URL。
- 宿主单测：`tts 只接受 POST` 与 `tts 缺 text 时 400` 拆成两条。

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
