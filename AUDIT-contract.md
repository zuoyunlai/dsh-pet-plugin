# dsh-pet 插件全量审计（2026-10-21，v1.5.0）

> 依据：`dsh-plugin-guide` 契约清单 + 官方文档副本（`client-modules` / `slots` / `web-server`）
> + 机械检查（`dsh-plugin-dev check --strict`、`verify`、8 条单测、冒烟、真机实例）。
> 结论先说：**契约层面基本合规**（自动检查全绿），问题集中在**接口暴露面**与**工程可维护性**；
> 两个安全问题已当场修掉。

---

## 一、契约逐条核对

| 条款（来自官方红线） | 本插件现状 | 判定 |
|---|---|---|
| 模块导出 `name` + `apply(ctx, config)`，可选 `inject` | `name='@local/dsh-pet'`、`inject=['webServer']`、同步 `apply` | ✅ |
| 注册即 effect，禁止手动 teardown | 6 条路由、`tapIndex`、`tool/result`、worker 清理**全部**走 `ctx.effect` / `ctx.on` | ✅ |
| 配置用 Schemastery `Schema<Config>` | `Config = Schema.object({provider, model, maxTokens, temperature})` | ✅ |
| 可选服务用 `ctx.get()`，不碰未声明的 `ctx.x` | `ctx.get('llm')`；只用已声明的 `webServer` | ✅ |
| UI 只渲染 slot，不 iframe、不往 `document.body` 追加 | 仅在 `shell.overlay` / `conversation.input.right` 内渲染；`document.body` 只作量测兜底（`parentElement \|\| document.body`） | ✅ |
| 样式只用 `--dsw-alias-*` token | 集中在 `.dsh-pet-layer` 的 `--pet-*` 映射层，其余全引用映射变量 | ✅ |
| 不 `require` 任何 Harness Client 包 | 客户端只有 `require('react')`（1 处） | ✅ |
| `dsh.client.inject` 必须是静态数组 | `["@deepseek-ai/dsh-client-ui-layout", "...-conversation"]`，且是**包行边**语义（官方 `client-modules` 文档核实） | ✅ |
| 展示元数据：`locale/*.json` 的 meta + 导出的 `./icon` | `zh/en.json` 均有 title/description；`icon.svg` 2.5 KB（< 256 KiB），realpath 在包内 | ✅ |
| 共享 dsh 包只放 peer/dev，绝不放 dependencies | `peerDependencies: @deepseek-ai/schemastery`，无 `dependencies` | ✅ |
| bundle patch 存在、行 id 唯一 | `cordis.patch.yml` 单行 `insert dsh-pet` | ✅ |
| `engines.node` 覆盖 22/24 | `^22.19.0 \|\| >=24.0.0` | ✅ |
| **`engines.dsh`** | 未声明 | ⚠️ 纯声明项，建议补 `>=0.2.1-alpha.2` |
| 禁止会话期间改 profile 的 patch/package.json | 安装脚本要求 DSH 完全退出；`update.cmd` 只拷文件 | ✅ |
| 异步 `apply` 的注册顺序 | `apply` 同步，注册全部同步完成 | ✅ |

---

## 二、发现的问题

### P0（已修，附实证）

**1. CORS 回显任意 Origin + 允许凭证 → 任何网页都能替你花 token**

原实现把请求里的 `Origin` 原样回写，并带 `access-control-allow-credentials: true`：

```http
GET /dsh-pet/ping   Origin: https://evil.example
→ 200
  access-control-allow-origin: https://evil.example
  access-control-allow-credentials: true        ← 任意站点可带凭证读返回
```

后果：你打开的任何网页都能 `POST /dsh-pet/chat`，用你的账号额度跟宠物聊天并读走回复；
也能读 `/ping` 拿到 provider/model。

**修复**：白名单（宿主 `getOrigin()` / `dsh-app://` / 同源 IP），越权直接 403。
**实测**：外部 Origin → 403；同源 → 200；外部 Origin 的 POST → 403。

**2. `/tts/status` 泄露本机绝对路径**

原先返回 `python: "C:\\Users\\...\\python.exe"`、`home: "C:\\Users\\Zuoyunlai"`。
即使接口只监听本机，页面里任何脚本（含第三方插件）都能读到。
**修复**：只返回 `available / reason / voices`。**实测**：响应中已无路径。

### P1（未修，建议处理）

**3. 双前缀 `/api/dsh-pet/*` 的占用面**
6 条路由 × 2 个前缀 = 12 条注册，其中 `/api/*` 属于宿主命名空间。桌面壳确实需要
`/api` 兜底（`dsh-app://` 页面相对路径到不了宿主），但**现在客户端已经全部用注入的绝对
地址**（`__DSH_PET_BASE__`），`/api` 可能已是历史遗留。建议实测桌面壳后删掉这半边，
把路由占用面减半。

**4. 客户端可控文本进入 system prompt（提示注入面）**
`POST /chat` 的 `payload.persona` 被直接拼进 system：

```js
systemPrompt(payload.persona)   // persona.name / persona.tag 全是客户端给的
```

CORS 收紧后风险已降低，但同源页面/被改过的前端仍可塞任意指令。
建议：客户端只传 `personaId`，宿主侧查内置表取名字与人设。

**5. ~~`globalThis.__dshPet` 无条件导出~~ 已修：默认关闭，需 `dsh-pet.debug=1` 或 `?petdebug=1`**
生产环境把 `runtime`、`PERSONAS`、`tick`、`playFx` 全部挂到全局，任何页面脚本都能直接
操纵宠物状态。建议用 `localStorage['dsh-pet.debug'] === '1'` 或 URL 参数门控。

**6. ~~`probeNeural` 负结果永久缓存~~ 已修：5 分钟 TTL**
用户之后 `pip install edge-tts`，必须重启 DSH 才生效。建议加 5 分钟 TTL。

**7. ~~`GET /tts` 有副作用且无限流~~ 已修：30 次/分钟限流（仍保留 GET，因为 `<audio src>` 只能发 GET）**
GET 会合成音频并写盘。同源页面可刷缓存（有 60 MB 上限兜底，但仍是放大的工作）。
建议改 POST，或复用 chat 的限流器。

**8. ~~两个后台任务不随 dispose 中止~~ 已修：`disposed` 标记 + req 的 close 事件中断 LLM 流**
`warm` 的预热循环（最多 60 句）与 `trimCache()` 在插件卸载后仍会跑完；
`chat` 也没有 `AbortSignal`，客户端断开后 LLM 流会继续读到 maxTokens。
建议：`ctx.effect(() => () => abortAll())`，并把请求的 `req.on('close')` 接到 AbortController。

**9. `readBody` 的 64 KB 是字符数不是字节数**
`raw.length` 对多字节字符会放宽实际上限。建议按 `Buffer.byteLength`。

### P2（打磨）

| # | 问题 | 建议 |
|---|---|---|
| 10 | `check --strict` 报「五语 README 不全」「zh 与 en 标题漂移」 | 补 `README-es/pt/hi.md`，或明确接受只做中英（私有插件可接受，但要知道这是警告项） |
| 11 | 未声明 `engines.dsh` | 补一行 `"dsh": ">=0.2.1-alpha.2"` |
| 12 | `assets/` 7.3 MB 全量进包 | 本地安装无妨；若将来发 npm，建议转 webp（体积可降 60%）或按形象分包 |
| 13 | `client.js` 单文件 2291 行 | 拆成 `personas.js / fx.js / panel.js / engine.js`，构建期拼成单 bundle（运行期契约不变） |
| 14 | 纯图标按钮无 `aria-label` | 🐾 按钮补 `aria-label="桌宠"`；面板开关补可读标签 |
| 15 | 无 CHANGELOG | 按版本记一行，便于回溯（这次 1.0→1.5 的视觉迭代已足够多） |
| 16 | 设置面板里的开发提示（"藏起来后刷新页面可恢复"） | 收进「关于」折叠区，主面板只留常用项 |

---

## 二·五、发布就绪度（2026-10-21 追加）

对外发布前的元数据与产物核对：

| 项 | 状态 | 说明 |
|---|---|---|
| 包名 | ✅ | `@local/dsh-pet` → **`dsh-pet-plugin`**（npm 上该名未被占用；`dsh-pet`/`dsh-plugin-pet` 已被占） |
| `private: true` | ✅ 已移除 | 发布必需 |
| `publishConfig.access` | ✅ `public` | 避免 scoped 包默认私有 |
| LICENSE | ✅ | MIT，文件 + `license` 字段（年份/作者留了 TODO） |
| repository / homepage / bugs | ⚠️ 占位 | 已写 `github.com/TODO/...`，发布前替换成真地址 |
| `files` 白名单 | ✅ | 14 项：入口、客户端、patch、locale、icon、`assets/*.webp`、TTS worker、CHANGELOG、LICENSE、五语 README |
| `engines.dsh` | ✅ | `>=0.2.1-alpha.2` |
| peerDependencies | ✅ | 只有 `@deepseek-ai/schemastery`，无 dependencies |
| 五语 README | ✅ | 标题完全一致（en/zh/es/pt/hi） |
| 包体积 | ✅ | `npm pack` = **1.7 MB** / 71 文件（WebP 化前 7.2 MB） |
| 安装脚本改名兼容 | ✅ | `install.ps1` 从 `package.json` 读包名、自动迁移旧条目与旧目录、`-Update` 迁移前回落旧路径 |

**发布步骤**（供你执行）：

```bash
# 1) 换成你的仓库地址与作者
npm pkg set repository.url="git+https://github.com/<you>/dsh-pet-plugin.git" \
            homepage="https://github.com/<you>/dsh-pet-plugin#readme" \
            bugs.url="https://github.com/<you>/dsh-pet-plugin/issues" \
            author.name="<you>"
# 2) 登录并发布
npm login                # 注意当前 registry 是 npmmirror，发布要走官方源：
npm publish --registry https://registry.npmjs.org/
# 3) 验证
dsh plugin --profile desktop add dsh-pet-plugin
```

> 想把名字换成自己的 scope（例如 `@you/dsh-pet`）：改 `package.json` 的 `name`
> 即可 —— `index.js`、`cordis.patch.yml`、`install.ps1` 都从 `package.json` 读名字，
> 但 `index.js` 的 `export const name` 与 patch 行是**字面量**，要一起改（两处）。

## 三、优化建议（按收益排序）

1. **把接口面收成一个**：删掉 `/api` 那半边（先实测桌面壳），路由从 12 条降到 6 条，
   攻击面/维护面同步减半。
2. **persona 只传 id**：宿主查表 → 客户端无法向 system prompt 注入文本。
3. **调试出口开关化**：`__dshPet` 只在显式开关下挂载。
4. **拆文件 + JSDoc 类型**：2300 行单文件已经是这次视觉迭代的主要摩擦点
   （改面板要在一万字符里定位）。
5. **给 TTS 链路加统一限流与中止**：warm/tts/chat 共用一个令牌桶 + AbortController。
6. **补 `engines.dsh` 与五语 README**：纯合规项，成本低。

---

## 四、验证记录（本轮实测）

```
dsh-plugin-dev check --strict   OK  11 passed / 0 failed / 2 warned / 3 skipped
dsh-plugin-dev verify           OK  pack → install → dump-config → headless-smoke → uninstall
tests/host.test.mjs             8/8  （新增：外部 Origin 403、status 不泄露路径）
tests/smoke.mjs                 OK   4 形象 × 8 心情 + 设置面板渲染
真机实例                        外部 Origin 403 / 同源 200 / status 无路径字段
```

> `verify` 会真的 `pnpm pack` 装进干净 profile 再跑 headless 冒烟，属于官方推荐的自包含验证；
> 它绿了只能说明「装得上、起得来」，**不代表功能正确** —— 功能侧仍靠上面 8 条单测与真机。
