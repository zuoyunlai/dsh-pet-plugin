# dsh-pet · DSH 桌宠

在 **DSH Web 界面**右下角养一只小家伙：常驻或随机冒出来，会主动说话（带语音）、
会走路跳舞害羞发怒，旁边挂着一个可以直接聊天的小输入框，形象和脾气可以换。

> 边界：插件只能活在 DSH 窗口里（挂到框架的浮动层槽位），**不能浮在别的软件之上**。
> 想要"整块桌面到处跑"的桌宠，那不是插件能力范围，得另做 Electron 壳。

## At a glance

- **多语言**：面板文案、形象简介与聊天 system prompt 都跟随浏览器界面语言，内置
  `en / zh / es / pt / hi` 五套（`locale/*.json` 的 `pet` 命名空间；slot 按 DSH 约定
  以 `locale: 'pet'` 注册）。每个形象另带一套英文台词，非中文界面下她说英文。

- **挂载点**：`shell.overlay`（宠物本体，全窗浮动层，默认点击穿透）+
  `conversation.input.right`（输入框右侧的 🐾 按钮，宠物找不到时可以靠它叫回来）。
- **单聊**：小输入框里说的话**不进主会话**。宿主半边开了个 `POST /dsh-pet/chat`
  小接口，用一次性 `ctx.llm.stream()` 调用换一两句回复（不建会话、不写会话日志），
  宠物把回复念在气泡里。默认模型 `deepseek-account` / `deepseek-flash`，
  可在插件配置里改 provider / model / maxTokens / temperature。
- **图标**：`icon.svg` 是插件 logo（玫红 `#e95573` 的「长发剪影」）；输入框右侧的入口按钮用**同一条 path**（内联 SVG，18px），两处永远一致。
- **设置面板**：分组（形象 / 声音 / 显示 / 动作 / 特效）+ 自定义下拉（不用原生 select：Windows 弹出层是系统白底，深色主题下看不清）+ 自绘开关；面板固定在视口右侧、不随宠物位置移动。
- **四个内置形象/性格**（全部是**超写实照片风格**立绘，同一套打光与构图，
  每人 5 张：默认 / 开心 / 害羞 / 生气 / 困）：
  - 薇 · 紫发，从容地挑逗（`assets/pet-violet*.png`）
  - 绯 · 红发，明目张胆地勾引（`pet-crimson*.png`）
  - 靛 · 蓝发，慢火慢炖地撩（`pet-indigo*.png`）
  - 雪 · 银发，冷淡底下的闷骚（`pet-silver*.png`）

  换表情时是**交叉淡入淡出**（240ms），不是硬切；动作幅度按照片重调过
  （走路 ±5px、跳舞 ±4°、呼吸 5–6s 一轮），默认大小 1.15×。
- **动作序列**：形象可以带 `actions: { dance: [...], hair: [...], walk: [...] }`，
  每套 3 张同姿势变化的帧，按 340ms 逐帧交叉淡入播放（像翻页动画）。
  四只各配齐三套（跳舞 / 撩头发 / 走路），姿势按性格分化：绯是大幅甩发猫步，靛是慢摆缓步，雪是克制直线。跳舞/走路时循环播，发呆时按 0.8%/tick 随机撩一下头发。
  面板里也有「撩头发」按钮可以直接试。
- **立绘怎么加**：把透明底 WebP 丢进 `assets/`，在 `PERSONAS` 里加一项
  `image: '文件名.png'`（多表情时用 `images: { mood: '文件.png' }`）。贴图由宿主路由
  `/dsh-pet/assets/` 提供（只放行 png/jpg/webp，路径只取 basename，防越界）。
  抠图脚本 `tools/make-pet-image.py`：**绿幕图优先**（按绿通道领先算 alpha + despill），
  浅色渐变背景只作兜底——那路上皮肤和白底几乎同色（实测色差 0.041），分不开。

## Behavior

| 能力 | 实现方式 |
|---|---|
| 常驻 / 随机出现 | 齿轮面板切换；随机模式下按「每小时概率」掷骰，并受活跃时段约束 |
| 活跃时段 | 起止时间，支持跨零点（22:00 → 03:00） |
| 主动说话 | 台词包按心情分组随机抽取，气泡 + 语音朗读 |
| 语音 | **可选增强**：宿主装过 `edge-tts`（任意 python，`pip install edge-tts`）就用神经音色（晓晓/晓伊/晓墨），宿主路由 `/dsh-pet/tts` 合成并缓存，`/dsh-pet/tts/status` 负责探测；没有 python/edge-tts 时**自动退回系统 `speechSynthesis`**，插件本身零依赖、2MB |
| 小输入框 | 宠物下方常驻，回车后**只跟它单聊**：一次性模型调用，回复进气泡，不写进任何 DSH 会话 |
| 动作与表情 | CSS 动画 7 种心情：idle / walk / dance / shy / angry / sleep / talk / happy |
| 视线跟随 | 瞳孔跟着鼠标走（写 CSS 变量，不触发重渲染） |
| 特效 | 泼墨 / 撒花 / 乌云 / 起雾（可擦）/ 炸弹+碎屏；齿轮面板里有逐个试的按钮 |
| 事件联动 | 一轮真跑过（>4s）再结束时撒花；宿主有工具失败时飘乌云（轮询 `/dsh-pet/ping` 的 `lastErrorAt`） |
| 脾气 | 每个形象带 `temper` 权重表，决定它更爱跳舞还是更爱睡觉 |
| 一键消失 | 齿轮面板「藏 1 小时」，一小时后自动回来 |

## Install (local, no registry)

**通用插件**：不绑定任何一台机器的路径，也不带本地依赖。发布名 `dsh-pet-plugin`。

```bash
dsh plugin --profile desktop add dsh-pet-plugin   # 从 npm 装（发布后）
```

从本地目录装（先完全退出 DSH）：
语音的「甜」是可选增强——宿主上任意一个 python 装了 `edge-tts` 就能启用：

```bash
pip install edge-tts          # 或者用任意虚拟环境
export DSH_PET_PYTHON=/path/to/python   # 不会自动找时显式指定
```

没装也没关系：自动用系统语音（Windows 上是 Huihui，靠面板里的音高/语速调甜）。

1. **完全退出 DSH**（profile 的 `package.json` 是 HMR 监听的，运行中写会把在途 turn 杀掉；
   而且 bundle 本来也只在启动时加载）。
2. **双击本目录里的 `install.cmd`**。不用开终端、不用管当前目录、不用碰执行策略。
   非要用终端的话：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "E:\Documents\deepseek-harness\default-workspace\dsh-pet\install.ps1"
   ```

   必须在 **cmd 或新开的 PowerShell** 里执行。不要把 `ExecutionPolicy Bypass -File ...`
   这一截粘进已经打开的 PowerShell 里——在那里 `ExecutionPolicy` 会被解析成
   `Get-ExecutionPolicy`，报一个看不懂的「无法绑定参数 Scope」。
3. 重新打开 DSH。

脚本会：
1. 在 profile `package.json` 的 `dependencies` 里加
   `"@local/dsh-pet": "file:E:/Documents/deepseek-harness/default-workspace/dsh-pet"`
2. 在 `dsh.profile.bundles` 里加一行 `@local/dsh-pet`
3. 在 profile 里跑 `pnpm install`，让 node_modules 真的拥有这个包
4. 回读核对四件事（文件、bundles 行、依赖行、JSON 合法），任何一步不对就回滚

> **为什么必须是依赖而不是复制**：DSH 启动时会用 pnpm 校正 profile，
> 只手工复制进 `node_modules` 的包**会在下一次启动时被清掉**（这也是你昨晚装好、
> 今天早上它消失的原因）。声明成 `file:` 依赖后它才会被 pnpm 当作正经包保留。

- 改了代码要刷进已装副本：双击 `update.cmd`（只复制文件，不碰 profile，**DSH 开着也能跑**），
  然后 `Ctrl+R` 刷新窗口；没变化再重启 DSH
- 查状态：双击 `verify.cmd`
- 卸载：双击 `uninstall.cmd`

## Verify

```powershell
node --check client.js
node tests\smoke.mjs        # 假 window + React 桩，真跑一遍渲染，覆盖 3 形象 × 8 心情
node --test tests\host.test.mjs   # 宿主路由：注册/状态/限流/路径穿越（要在已装目录里跑）
node "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-plugin-guide\bin\dsh-plugin-dev.js" check --cwd .
```

> `host.test.mjs` 需要 `@deepseek-ai/schemastery`，所以请在**已安装目录**里跑：
> `cd ~/.dsh/profiles/desktop/node_modules/@local/dsh-pet && node --test tests/host.test.mjs`

预览（不用装进 DSH 也能先看长什么样）：

```powershell
node tests\preview.mjs
chrome --headless=new --screenshot=preview.png --window-size=1200,760 "file:///.../preview.html"
```

## Customize

- 加形象：在 `client.js` 的 `PERSONAS` 里加一项 —— `colors`（配色）、`ears`
  （`antenna` / `cat` / `round`）、`voice`（pitch/rate）、`temper`（心情权重）、
  `lines`（台词包）。不需要改任何渲染代码。
- 加台词：往对应心情的数组里塞句子即可。
- 加动作：在 `CSS` 的 keyframes 段落加动画，再在 `Face`/`PetArt` 里按 `mood` 挂 class。

## Known limits

- 神经语音是**可选增强**：宿主得有 python + `edge_tts`，否则退回系统 `speechSynthesis`
  （Windows 上就是那几个 SAPI 音色，靠面板的音高/语速调）。`speak()` 是唯一出口，替换容易。
- 浏览器自动播放策略：页面没有用户手势前可能不出声，点一下宠物即可解锁。
- 设置存在浏览器 localStorage，换浏览器配置就没了。
- 本插件是本地私有包（`private: true`），没有发布 npm 的打算。
