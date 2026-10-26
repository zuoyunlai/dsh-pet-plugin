# dsh-pet-plugin 1.20.0 反哺审查报告

日期：2026-10-26（Asia/Shanghai）
范围：当前工作树源码、配置、测试、打包产物与发布元数据；只读核实后进入修订。

## 结论与评分

综合评分：89/100。插件契约与安全边界成熟，资产与发布链条稳定，本机真实宿主与真实浏览器已跑通；主要扣分来自 CI 内仍缺自动化浏览器/跨平台矩阵，以及约 19.7 MB 包体的长期运维成本。媒体元数据和总预算门禁已在本轮补齐。

| 面向 | 分数 | 判断 |
|---|---:|---|
| DSH 契约与宿主集成 | 19/20 | `name/apply/inject`、effect/disposer、可选服务探测、slots 挂载均有实现；本机 1.20.0 实跑 `/dsh-pet/ping` 与 `/dsh-pet/tts/status` 均正常，`toolEvents:"ok"` 证明 `tools/result` 在真实宿主可达 |
| 客户端/UI/可访问性 | 17/20 | slot React、主题 token、aria 与 reduced-motion 已覆盖；用户已确认本机真实浏览器与桌面版表现正常，剩余是键盘/读屏的自动化回归 |
| 安全与隐私 | 19/20 | CORS/Host/Fetch-Site、限流、路径隔离、提示注入隔离、错误引用号均较完整 |
| 资源/发布/安装 | 18/20 | manifest、hash、媒体元数据与 20 MB 预算门禁、发布脚本和安装后检查成熟；包体仍偏大 |
| 测试/可验证性/维护 | 18/20 | `npm test` 86/86、pack dry-run、`install.ps1 -Verify` 本轮均通过，真实宿主已实跑；CI 内仍无浏览器/跨平台矩阵 |

## 逐项核实

### 已修复或已降级

- 历史 R01：webm 缓存半截文件风险已通过 `.webm` `no-store` 处理。
- 历史 R08：客户端 ping 已有 AbortController 和 8秒预算，并在 effect disposer 中 abort。
- 历史 R14：history 已作为 user 数据块进入模型，系统提示明确禁止把 history 当指令。
- 历史 R22：宿主工具事件已改监听 `tools/result(exec,result)`，并提供20秒未观察告警。
- 路径穿越、CORS/DNS rebinding、TTS GET 滥用、错误详情泄露等历史高风险项已有对应防护。

### P1：应先修订

1. **持久化设置类型污染（已修复）**：基线中的 `src/40-settings.js:27-41` 只校验 persona/mode，其余字段直接接受 localStorage JSON。当前已改为逐字段归一化，非法值回默认，限制 `scale`、音量、概率、时间、位置、布尔开关和 voice trim 的范围与形状，并由回归测试覆盖。
2. **LLM 请求无主动服务端超时（已修复）**：基线中的 `index.js:415-439` 只检测 req close，未给 `ctx.llm.stream` 设置 AbortSignal，也没有服务端最大等待预算。当前已增加可配置且有上下限的超时、请求断连时终止本地消费，并避免向已关闭响应写入；回归测试覆盖正常 close 与超时 AbortSignal。
3. **宿主兼容性需安装级验证（保留为验证缺口）**：插件直接注入 `webServer`，并通过宿主运行时获取 `llm` 与可选 `commands`，未 import 独立 DSH 服务包，因此不应新增虚假的 `@deepseek-ai/dsh-*` peer。安装 smoke 与 `engines.dsh` 说明仍需在真实宿主环境持续维护。

### P2：随后修订

4. **媒体生命周期与失败诊断**：`src/80-art.js` 已有 metadata、3秒放弃和 onError，但浏览器矩阵尚未覆盖 VP9 alpha、自动播放策略、快速切换和卸载竞态。补台架断言和诊断字段，必要时给 video 事件增加受控日志。当前代码已覆盖 metadata、失败回退和卸载清理；真实浏览器矩阵仍是待补验证。
5. **轮询成本与可观测性**：`src/99-entry.js:159-241` 在可见时每8秒轮询 `/ping`，虽有超时和不可见降频，但仍是固定轮询；当前已加入连续失败指数退避（上限120秒），避免网络异常时固定唤醒。宿主提供事件桥后仍可进一步改为推送。
6. **包体和资产运维**：`npm pack --dry-run` 为 19,675,824 bytes、135 files，20 条 WebM 是主要体积。已增加每资产尺寸/时长/codec/pixel format/alpha/sha 清单和 20 MB 总预算检查，防止新资产无意膨胀。

### P3：验证与文档

7. `engines.dsh >=0.2.1-alpha.2` 与实际宿主服务能力应在安装 smoke 中做版本/服务探测；peer 不应只依赖 engines 表达兼容性。
8. 增加真实浏览器/Chromium、Windows/macOS/Linux、隐私模式 localStorage、网络挂起、TTS 缺失和 VP9 alpha 解码矩阵；当前 Node 测试不能证明这些行为。
9. README/CHANGELOG 应明确“一次性聊天不进会话日志”、TTS 缓存位置与清理方式、19.7 MB 包体及浏览器 VP9 alpha 前提。

## 修订顺序与状态

- [x] P1-1 设置归一化
- [x] P1-2 LLM 超时与断连处理
- [x] P1-3 peer/宿主兼容性核对（确认无需新增虚假 DSH peer；文档已说明注入服务）
- [x] P2-1 资产媒体尺寸/时长/codec/alpha/总预算门禁（ffprobe 元数据与 20 MB 总预算已纳入 manifest 测试）
- [x] P2-2 轮询失败退避
- [x] P3-1 Node 回归补充（设置、聊天生命周期/超时、轮询退避）
- [x] P3-2 README/CHANGELOG 资产说明同步；真实浏览器/桌面版与 Windows `install.ps1` 由用户当场确认可用，本机只差 CI 内的自动化矩阵
- [x] P3-3 `dsh-plugin-dev check --strict` 不再是可用门禁：新宿主已不随包提供该工具（见验证记录第 2 条），改为「宿主加载期校验 + `install.ps1 -Verify` + 本机实跑」三条替代证据

最终验证结果追加在本文末尾。未执行版本发布。

## 最终验证记录

- `npm test`：通过（构建、smoke 与 86 个 Node 回归测试）。新增覆盖设置归一化、聊天正常 close、LLM 超时 AbortSignal 和轮询退避。
- `dsh-plugin-dev check --strict`：**该工具已不在当前宿主中，不能作为门禁**。核实依据（2026-10-26）：① 仓库内无 `tools/dsh-plugin-dev.js`（`node tools/dsh-plugin-dev.js` 报 `MODULE_NOT_FOUND`）；② `%USERPROFILE%\.dsh\profiles\desktop\node_modules\@deepseek-ai\` 只有 `cosmokit`、`schemastery`，没有 `dsh-tools` / `dsh-plugin-dev`；③ `D:\Programs\DeepSeek Harness\resources\app.asar`（182,434,783 B）内全文检索 `dsh-plugin-dev` 无命中，仅有 `cordis-plugin-development` 技能文档目录（4 处命中均在 skill 路径下）。此前会话记录里的 13/13 属旧宿主产物，不代表当前环境。
- `install.ps1 -Verify`（Windows，PowerShell 5.1，本机实跑）：通过。输出 `[ok] rebuilt client.js from src`、`copied into node_modules: True`、`listed in dsh.profile.bundles: True`、`package.json parses: True`、`declared as dependency: yes (file:...)`，并以 `OK.` 收尾。安装副本 `node_modules/dsh-pet-plugin/package.json` 版本 = 1.20.0。
- 真实宿主实跑（本机 GUI 127.0.0.1:8085）：`GET /dsh-pet/ping` 返回 `ok:true`、`provider:deepseek-account`、`model:deepseek-flash`、`toolEvents:"ok"`、`lastToolName:"ops_bash"`——证明真实宿主上路由注册、`tools/result` 事件与阶段机均可达；`GET /dsh-pet/tts/status` 返回 `available:true` 与 23 个神经音色，证明本机 `edge-tts` 链路可用。
- 用户当场确认（2026-10-26）：本机安装已生效，真实浏览器与桌面版表现正常，Windows 上的 `install.ps1` 安装流程正常。
- `npm pack --dry-run --json`：通过；本轮最终测得 packed 19,675,824 bytes、unpacked 20,135,290 bytes、135 files，20 条 WebM、WebP 资源与运行时所需 TTS worker 均纳入。（同一棵树上连跑两次可能相差数字节，属 npm tar 头时间戳差异，不是内容变化；判定以文件数与资产 sha 为准。）
- 资产 manifest：当前门禁校验 83 个文件的 SHA-256 与字节数，并通过 ffprobe 锁定 WebM 尺寸、时长、VP9、像素格式和 alpha mode；20 条 WebM 总字节数 19,432,671，低于 20 MB 预算。普通片段 5167ms，五条 stage 片段 10125ms。
- 本轮修订未执行 npm/GitHub 发布；工作树变更需在发布前单独审阅。
- 仍未做的只有「CI 内自动化矩阵」：GitHub Actions 里没有 Playwright/Chromium 截图比对、没有 Windows runner 跑 `install.ps1`、没有网络挂起与 TTS 缺失的故障注入。本机的真实浏览器与桌面版可用是人工确认结论，不是可回归的门禁。
