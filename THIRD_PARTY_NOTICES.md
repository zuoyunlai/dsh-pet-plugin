# 第三方素材与组件声明（THIRD_PARTY_NOTICES）

本插件（dsh-pet-plugin）发布包中的内容按来源分三类：

## 1. 插件自身代码（MIT）

- 宿主端 `index.js`、`lib/`、客户端 `src/`（构建产物 `client.js`）、`tools/`、`tests/`
  均为本项目原创代码，随包以 MIT 许可发布（见 `LICENSE`）。

## 2. 形象素材（本项目自有，AI 生成）

- `pets/<id>/`（violet / crimson / indigo / silver / azure / example）下的
  `.webp` 立绘与 `.webm` 动作视频，均由本项目通过生成式工具链制作并授权分发，
  未使用任何第三方美术素材。每个形象的 `pack.json` 均带 `license` 字段（当前全部 MIT）。
- 例：`pets/example/` 是文档示例目录，同样为本项目生成。

## 3. 运行期依赖（不随包再分发）

- **React**：客户端在宿主页面内运行时向宿主 `require('react')`（见 `package.json`
  `peerDependencies`），插件包内不含 React 的任何副本；其许可（MIT）以宿主安装为准。
- **DSH 宿主服务**（`webServer` / `llm` / `commands` 等）：由 DeepSeek Harness 宿主
  注入，插件只声明 `peerDependencies` 中的 Schema 定义库，不内嵌宿主代码。
- **语音**：TTS 由系统/浏览器语音（Web Speech）或本机神经音色提供，
  音色名称（如 xiaoxiao、aria 等）指向运行期服务提供方，插件不分发任何语音数据。

## 4. 工具链产物

- `client.js` 由 `build.mjs` 从 `src/*.js` 生成；`tools/tts_worker.py` 为本项目的
  辅助脚本（随包发布，便于用户复现语音探测）。两者不引入第三方版权内容。

如发现本声明与实际内容不符，请在仓库提 issue 指正。
