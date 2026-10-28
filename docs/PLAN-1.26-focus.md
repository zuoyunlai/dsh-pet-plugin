# 1.26.0 方案（修订版）：跨平台失焦通知 + 失焦安静态

> **本版推翻了初版的核心技术路线。** 你提出"要普适、要覆盖 Linux/macOS/浏览器"之后，我重核了宿主与浏览器规范，
> 初版方案 A 里"让宿主开一个 Electron IPC 通知通道"这条路**在跨平台语境下是错的**——它是桌面壳专属的，
> 一旦这么做，Linux 浏览器用户、`dsh-web` HTTP 部署用户全都拿不到通知。
>
> 修订原则：**先按 Web 标准做，桌面壳只作为可选增强。** 桌面壳能做的，浏览器也能做；浏览器做不到的，才考虑加壳通道。

## 0. 修订后的一句话结论

通知可以做到跨平台，但**不是一个实现，是一条能力降级链**：

```
HTTPS/localhost 浏览器      → Web Notifications（标准，Win/mac/Linux 全通）
localhost HTTP 浏览器       → 同上（localhost 属安全上下文）
file:// 或非安全上下文      → 降级：标题前缀 + 文档内提示
桌面壳（可选增强，非必需）  → 额外拿到任务栏闪烁/程序坞跳动
```

初版"必须改宿主"的结论作废。**安静态方案 B 不受影响，跨平台零成本。**

---

## 1. 为什么初版的路线错了（负责任的复盘）

初版我核到宿主 `lib/main.js:9716` 有 `Notification` + `flashFrame`，就推"宿主开个通道给插件用"。这个结论本身没错，但**前提被我隐式限定了**：

- `flashFrame` 在宿主里是 `platform === "win32"` 分支（`main.js:9710`），macOS 走 `app.dock.bounce`，Linux 走 `Notification` 自身；
- `dshDesktop` 是 `contextBridge` 暴露的**桌面壳 preload**，浏览器界面形态里**根本不存在**这个对象。

所以那条通道一落地就是"只有 Windows 桌面版能用"，和你"普适"的要求直接冲突。**幸好是在写代码前发现。**

### 1.1 更正一处核实错误（记录在此，避免误导读代码的人）

修订过程中我一度把 `@deepseek-ai/dsh-web` 当成"可独立运行的 HTTP 服务器"，并据此写了"支持 `--public-url` 的独立部署"。
**这是错的**：`dsh-web` 是 `ctx.web`（搜索/抓取）的**能力接口**，`bin` 字段根本不存在。

真正的浏览器界面形态由 **`@deepseek-ai/dsh-web-app`** 提供——它是"浏览器界面 bundle 的运行时胶水插件"：
解析前端 dist、挂 `frontend-static` 兜底、注册 `webApp` 服务、处理 `publicUrl` 与**非回环 HTTP 暴露告警**。

**结论不变**（浏览器形态真实存在，通知必须走 Web 标准），但依据换成了正确的那个模块。

---

## 2. 平台事实矩阵（核过的，不是猜的）

### 2.1 Web Notifications 的硬约束（MDN 权威）

| 约束 | 内容 | 对方案的影响 |
|---|---|---|
| **安全上下文** | Chrome/Firefox 要求 secure context。`localhost`/`127.0.0.1` **算**安全上下文 | DSH 默认 `http://127.0.0.1:3080`（`dsh-host-webserver`）→ **可用** |
| **用户手势** | 浏览器**不允许**非用户手势触发 `requestPermission()`（Firefox 72+ 已强制，Safari 更早） | **不能装完就弹权限框**，必须挂在一次真实点击上 |
| **跨源 iframe** | 不能从 cross-origin iframe 请求权限 | **本插件不受此限**：UI 经 `ctx.slots.register` 直接挂在 `shell.overlay` 插槽，在**父页面同一个 document / 同一个源**里，不是 iframe。`window.Notification` 可直接用（见 §2.4） |
| **移动端** | `new Notification()` 在绝大多数移动浏览器抛 `TypeError` | 只做桌面优先；移动端降级到标题/文档内提示 |
| **权限状态** | `granted`/`denied`/`default`，`default` 视同拒绝 | 必须有"权限被拒后的静默降级"，不能报错扰民 |
| **沙箱/隐私模式** | 权限可能**根本无法授予**（如隐私浏览） | 降级链要能吃掉这个失败 |

**推断（需实测确认）**：DSH 插件 UI 若渲染在 iframe 内，父页 `dsh-app://app` 或 `http://127.0.0.1:3080` 与 iframe 同源时可行；跨源则不可行。**这一条必须实测，见 §5 步 0。**

### 2.4 已核实：插件 UI 与页面同源（这条消掉了最大的不确定性）

`src/99-entry.js:342-369` 用 `ctx.slots.inject(slot, () => ctx.slots.register(spec, Component))` 把 `PetOverlay` 挂到 `shell.overlay`、把 `PetToggle` 挂到 `conversation.input.right`。
这是 **cordis slot 系统在同一个 React 树里渲染组件**，不是 iframe 嵌入。

推论（都很硬）：

- `window.Notification` **可直接访问**，不需要 postMessage 桥；
- `Notification.permission` 属于**页面源**（`dsh-app://app` 或 `http://127.0.0.1:3080`）；
- 权限申请的用户手势可以来自插件自己的 UI（设置面板开关），完全合法。

### 2.5 已核实：`dsh-app://` 是 secure context

`lib/main.js:11880-11890` 的 `protocol.registerSchemesAsPrivileged` 给 `dsh-app` 注册的 privileges 是：

```js
{ standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true }
```

`secure: true` 意味着 Electron 会把它当作安全上下文。而 `127.0.0.1` 本身按规范也算安全上下文。

**结论：桌面壳与浏览器形态两种部署下，Web 通知都是可用的，全程不需要 Electron IPC。**
初版"必须改宿主"的路线正式作废，跨平台目标不需要任何宿主侧让步。

### 2.2 各平台实际行为

| 平台 | 通道 | 备注 |
|---|---|---|
| Windows | 浏览器通知走系统通知中心；桌面壳另有 `flashFrame` | 通知栏需开"允许通知"（用户侧设置，插件无法控制） |
| macOS | 浏览器通知走通知中心；**首次会弹系统授权**，且 Safari/Chrome 各有独立授权 | 用户关掉某浏览器通知 → 静默失效，需能探测 |
| Linux | 走 `libnotify`/DBus；**无通知守护进程的环境（纯 WM、服务器、容器）会静默失败** | 必须能探测"发得出去没有"，不能假定成功 |
| 桌面壳（三平台） | Electron `Notification` | 作为**增强**而非必需；`isSupported()` 已有降级范式 |

### 2.3 关键结论：**必须能自证"通知到底发出去没有"**

初版我写了 misfire 计数，现在它从"锦上添花"升级为**跨平台方案的必备件**：

Linux 无守护进程、macOS 系统级静音、浏览器权限被撤——**这三种情况 API 都不报错**，只是通知不出现。
所以 `new Notification()` 之后必须监听 `show` / `error` 事件（MDN 明确提供），把结果记进客户端 `runtime.notifyStats`
（经 `__dshPet` 调试口可读；**不引入 POST 回传**——通知是客户端能力，统计放客户端是唯一自洽的位置）：

```
notify.supported   // 'web' | 'none'
notify.permission  // granted | denied | default | unavailable
notify.sent        // 实际弹出（Notification.show 或标题前缀生效）
notify.failed      // 探测到 error / 未触发 show（超时 2s）
notify.lastReason  // 失败原因分类：no-daemon / denied / unsupported / timeout / short / focused / cooldown
```

**没有这一层，跨平台 = 在 4 个平台上静默坏掉而没人知道。**

---

## 3. 方案 A（修订）：通知适配层

### 3.1 分层结构

新增 `src/56-notify.js`（`55-focus.js` 之后，编号落在 voice 与 behavior 之间，属既有序号约定）：

```
probeNotifyCapability()   // 一次性特性探测，结果缓存
requestPermission()       // 只能在用户手势回调里调用（严格）
sendTurnNotify(payload)   // 带降级链与结果回执
```

`sendTurnNotify` 的降级顺序：

```
1. Web Notification（permission === 'granted'）   ← 唯一主通道，全平台同码
2. 文档标题前缀 ● 跑完了              ← 永不失败的兜底
3. 文档内角标（她头上一个红点）        ← 兜底中的兜底
```

**每一层失败都静默下移，绝不抛错、绝不刷控制台噪音。**

初版这里排在第一位的"shell 通道"已删除——经 §2.5 核实，Web 通知在两种部署形态下都可用，
桌面壳 IPC 不再带来任何能力增益，徒增宿主耦合与发版阻塞。**少一条通道，多一份普适。**

### 3.2 权限申请必须挂手势（这是硬约束，不是设计偏好）

规范明确：非用户手势触发的 `requestPermission()` 会被浏览器**直接拒绝**。所以：

- **禁止**在插件初始化时请求权限；
- 在**设置面板的开关**上挂 `onClick`：用户拨开"跑完了提醒我"→ 那一刻才是合法申请时机；
- 用户拒绝后，设置项**自动回弹为 off** 并显示一行说明（"浏览器拒绝了通知权限，可以在地址栏左侧改回来"），而不是假装开着。

### 3.3 通知内容与交互

- `tag: 'dsh-pet-turn-end'` —— 同一 tag 自动替换，**天然解决连发刷屏**（MDN 明确机制），不需要自己写去重；
- `silent: true` —— 与她"别烦我"的调性一致，也不和语音抢注意力；
- `requireInteraction: false` —— 让它自己消失，别赖在通知中心；
- `icon` 用已有资产，`lang` 跟随 `runtime.settings.lang`（5 语已就绪）。

**点击回窗**：浏览器下 `notification.onclick` 能做的只有 `window.focus()`，且**多数浏览器不保证真的把标签页切到前台**。
所以 `document.title` 前缀（兜底层 3）不是冗余——**它是浏览器形态下唯一可靠的"回来吧"信号**。这点必须对用户诚实，不能承诺"点一下就回来"。

### 3.4 i18n

通知文案进 5 语（`locale/` 与 `20-i18n.js` 现成）。**文案里不要出现平台差异词**，统一"跑完了，回来看看吧"。

---

## 4. 方案 B（不变）：失焦安静态

初版方案 B 就是纯客户端 DOM 状态机，天然跨平台，**无需修订**。要点复述：

- 失焦 ≥ `QUIET_AFTER_MS`（建议 60s，考虑到共享屏幕场景，比初版的 120s 更短）→ 气泡静默/语音静音/停止自发动作，进之前打个哈欠趴下；
- 重新聚焦 → 抻懒腰 + 一句轻心声；
- 右键「勿扰 1 小时」，`quietUntil` **只存内存**（不落 localStorage，避免"昨天设的今天还生效"）；
- quiet 下 `/announce` **仍说话**（脚本通道属于"有事"，不属于"自嗨"）。

---

## 5. 实施顺序

**步 0 已经在写方案期间做完**（结论见 §2.4 / §2.5，两项风险都已消除）。剩下一项真机探测并入步 3。

| 步 | 内容 | 平台影响 | 验收 |
|---|---|---|---|
| 1 | B 稳定态 + 闸门复用 | 全平台一致 | 失焦静默、回来唤醒 |
| 2 | B 右键勿扰 + 5 语 | 全平台一致 | 倒计时正确、重启不残留 |
| 3 | A 的 `55-notify.js` 探测与降级链 + 标题兜底 | 全平台 | 三层降级逐层断链测试；真机记录 `Notification.permission` 初始值 |
| 4 | A 的权限手势申请 + 设置项 | 全平台 | 拒绝权限 → 开关回弹为 off |
| 5 | `/ping` 自证字段 | 全平台 | 三平台各跑一次，`lastReason` 与肉眼一致 |

原步 6（桌面壳增强通道）**删除**：§2.5 证实它不带来任何能力增益。

### 5.2 测试

- `tests/` 现有 `overlay.dom.test.mjs` / `runtime.test.mjs` 可 mock `window.Notification` 与 `document.hasFocus`；
- 降级链测试：逐个把 `Notification` 设成 `undefined` / `permission='denied'` / 构造抛错 / `show` 不触发，断言每层都落到下一层且**不抛异常**；
- 需要真机验证的只有一项：Linux 无通知守护进程下的 `lastReason` 是否为 `no-daemon`（可用容器复现）。

---

## 6. 与初版的差异对照（便于你审）

| 项 | 初版 | 修订版 | 原因 |
|---|---|---|---|
| 通知通道 | 宿主开 Electron IPC | **纯 Web 标准**，壳通道整条删除 | §2.5 证实无增益 |
| 可否改宿主 | 必须 | **不需要** | 跨平台 |
| `document.hasFocus()` | 组合判定但仍依赖 | **仍需**，但增加 `visibilityState` 与 grace | 浏览器下这是唯一信号 |
| 默认值 | off | off（不变） | 理由不变 |
| misfire 计数 | 建议 | **升级为必备**（含 `lastReason`） | 三种静默失败无法靠肉眼发现 |
| 点击回窗 | 承诺回窗 | **诚实说明**：浏览器不保证，标题兜底才可靠 | 避免过度承诺 |
| 渲染上下文 | 未核 | **已核**：slot 同源，非 iframe | 消除最大不确定性 |
| 步 0 | 无 | **已执行完毕** | — |

---

## 7. 仍需你拍板

1. **`QUIET_AFTER_MS` 取 60s 还是 120s**？（修订版倾向 60s）
2. **通知默认关**——确认保持？（我仍建议默认关，由用户在设置里拨开时才申请权限，正好符合浏览器手势约束）
3. **是否接受"浏览器形态下点击通知不保证切回标签页"**，以标题兜底为准？

## 附：本次核实来源

- MDN `Notification.requestPermission()`：安全上下文、用户手势强制、跨源 iframe 限制
- MDN `Notification()` 构造器：移动端 TypeError、`tag`/`silent`/`requireInteraction` 语义、`show`/`error` 事件
- MDN Using the Notifications API：权限状态三值、隐私模式不可授予、`tag` 替换机制
- 宿主 `main.js:11880-11890`：`dsh-app` 协议注册 `secure: true` → 桌面壳是安全上下文
- 宿主 `main.js:9710` 附近：`flashFrame` 仅 win32，macOS 走 `dock.bounce`
- `src/99-entry.js:342-369`：`ctx.slots.register` 挂 `shell.overlay` → 与页面同源，非 iframe
- `@deepseek-ai/dsh-web-app`：浏览器界面 bundle 的胶水插件，注册 `webApp` 服务、处理 `publicUrl`
- `@deepseek-ai/dsh-host-webserver`：默认监听 `127.0.0.1:3080`
