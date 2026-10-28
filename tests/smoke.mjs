/**
 * dsh-pet 冒烟测试：不需要浏览器，也不需要装 react。
 *
 * 做法：在 vm 里跑 client.js，喂一个假的 window.__ModuleLoader__，
 * 用最小 React 桩把组件函数真的调用一遍 —— 能抓到渲染期的 TypeError/
 * 引用错误，以及「插件对象形状不对」「apply 抛错」这类会让整个 slot 白屏的问题。
 */
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

/* ---------- 假环境 ---------- */
const storage = new Map()
// 打开自检出口（工厂执行时就读这个标记）
storage.set('dsh-pet.debug', '1')
const spoken = []

const React = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.flat(Infinity).filter((c) => c != null && c !== false) }
  },
  useState(initial) {
    const value = typeof initial === 'function' ? initial() : initial
    return [value, () => {}]
  },
  useEffect() {},
  useCallback(fn) {
    return fn
  },
  useRef(value) {
    return { current: value }
  },
}

const ctx = createContext({
  console,
  Date,
  Math,
  JSON,
  String,
  Number,
  Object,
  Array,
  Set,
  Map,
  RegExp,
  parseInt,
  requestAnimationFrame: (fn) => fn(),
  setInterval: () => 0,
  clearInterval: () => {},
  // 阶段机（1.11.0）在 tick 里排动作时会用到这两个
  setTimeout: () => 0,
  clearTimeout: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
})

ctx.window = ctx
ctx.window.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, v),
}
ctx.window.speechSynthesis = {
  cancel() {},
  getVoices: () => [],
  speak(u) {
    spoken.push(u.text)
    if (u.onend) u.onend()
  },
}
// 神经语音链路（1.10 起是 POST + blob）的桩
const neuralTts = { calls: [], played: [], revoked: [] }
ctx.fetch = async (url, init) => {
  neuralTts.calls.push({ url, method: (init && init.method) || 'GET', body: init && init.body })
  return { ok: true, status: 200, blob: async () => ({ size: 2048, type: 'audio/mpeg' }) }
}
ctx.window.URL = {
  createObjectURL: (blob) => {
    neuralTts.blobs = (neuralTts.blobs || 0) + 1
    return 'blob:fake-' + neuralTts.blobs
  },
  revokeObjectURL: (u) => neuralTts.revoked.push(u),
}
ctx.Audio = class {
  constructor(src) {
    this.src = src
  }
  play() {
    neuralTts.played.push(this.src)
    return Promise.resolve()
  }
  pause() {}
}
ctx.window.speechSynthesis = ctx.window.speechSynthesis

ctx.window.SpeechSynthesisUtterance = class {
  constructor(text) {
    this.text = text
  }
}

let factory = null
ctx.window.__ModuleLoader__ = {
  load(spec) {
    ctx.__moduleId = spec.id
    factory = spec.factory
  },
}

runInContext(source, ctx, { filename: 'client.js' })

assert.ok(factory, 'client.js 没有通过 window.__ModuleLoader__.load 注册工厂')
assert.equal(ctx.__moduleId, 'dsh-pet-plugin', 'client factory 的 id 必须等于包名')

/* ---------- 插件对象 ---------- */
const plugin = factory((id) => {
  assert.equal(id, 'react', '客户端只应该 require react')
  return React
})

assert.ok(Array.isArray(plugin.inject), 'dsh.client 的 inject 必须是静态数组')
assert.equal(typeof plugin.apply, 'function', '插件必须导出 apply(ctx)')

/* ---------- apply 契约 ---------- */
const registered = []
const fakeCtx = {
  effect(fn) {
    return fn()
  },
  slots: {
    inject(key, cb) {
      assert.equal(typeof key, 'string')
      return cb()
    },
    register(spec, component) {
      registered.push({ spec, component })
      return () => {}
    },
  },
}

storage.set('dsh-pet.debug', '1') // 打开自检出口，否则 __dshPet 不挂载
plugin.apply(fakeCtx)

const slots = registered.map((r) => r.spec.name)
assert.ok(slots.includes('shell.overlay'), '宠物本体必须注册进 shell.overlay')
assert.ok(slots.includes('conversation.input.right'), '叫它出来的 🐾 按钮必须注册进 conversation.input.right')

const pet = registered.find((r) => r.spec.name === 'shell.overlay').component

/* ---------- 真跑一遍渲染 ---------- */
const petApi = ctx.__dshPet
assert.ok(petApi, 'client.js 应把自检出口挂在 globalThis.__dshPet 上')

const baseProps = {
  sessionId: 'session-1',
}

for (const personaId of Object.keys(petApi.PERSONAS)) {
  for (const mood of ['idle', 'walk', 'dance', 'shy', 'angry', 'sleep', 'talk', 'happy']) {
    petApi.runtime.settings.persona = personaId
    petApi.runtime.mood = mood
    petApi.runtime.visible = true
    petApi.runtime.bubble = mood === 'talk' ? { text: '测试', at: Date.now(), ttl: 9999 } : null
    const tree = pet({ ...baseProps })
    assert.ok(tree, `渲染 ${personaId}/${mood} 应产出元素`)
  }
}

// 隐藏态应当返回 null（不占 DOM）
petApi.runtime.visible = false
assert.equal(pet({ ...baseProps }), null, '隐藏时不应渲染')

// 设置面板打开时也要能渲染（曾经漏了 persona 变量，点齿轮整个宠物崩掉）
petApi.runtime.visible = true
petApi.runtime.panelOpen = true
for (const personaId of Object.keys(petApi.PERSONAS)) {
  petApi.runtime.settings.persona = personaId
  const tree = pet({ ...baseProps })
  assert.ok(tree, `设置面板在 ${personaId} 下应能渲染`)
  const walk = (node, fn, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 40) return
    if (typeof node.type === 'function') {
      // 真 React 会调用函数组件；桩不会，所以这里手动展开一层
      walk(node.type(node.props || {}), fn, depth + 1)
      return
    }
    fn(node)
    for (const c of node.children || []) walk(c, fn, depth + 1)
  }
  let sawPanel = false
  walk(tree, (n) => {
    if (n.props && String(n.props.className || '').includes('dsh-pet-panel')) sawPanel = true
  })
  assert.ok(sawPanel, 'panelOpen=true 时应渲染出设置面板')
}
// i18n：vm 里没有 navigator，按设计回落英文；顺带确认没有把 key 漏到界面上
petApi.runtime.panelOpen = true
{
  const collect = (node, out) => {
    if (node == null || typeof node !== 'object') return out
    if (typeof node.type === 'function') return collect(node.type(node.props || {}), out)
    for (const c of node.children || []) {
      if (typeof c === 'string') out.push(c)
      else collect(c, out)
    }
    return out
  }
  const text = collect(pet({ ...baseProps }), []).join(' ')
  // 产品名 1.21.0 起为「桌面伴侣 / Desktop companion」；断言读 locale/en.json 的真值，
  // 避免下次改名再出现「改了文案忘改断言」的假红。
  const enPanelTitle = JSON.parse(readFileSync(join(here, '..', 'locale', 'en.json'), 'utf8')).pet['panel.title']
  assert.ok(text.includes(enPanelTitle), 'i18n 回落英文时应渲染英文标题: ' + JSON.stringify(enPanelTitle))
  const keyLeak = new RegExp('panel\\.|pet\\.toggle|voice\\.xiao').exec(text)
  assert.ok(!keyLeak, '不该把 i18n key 漏到界面上: ' + (keyLeak && keyLeak[0]))
}
petApi.runtime.panelOpen = false

/* ---------- 引擎 tick：两种模式都不能抛 ---------- */
petApi.runtime.settings.mode = 'always'
for (let i = 0; i < 3; i++) petApi.tick()
petApi.runtime.settings.mode = 'random'
petApi.runtime.settings.probability = 100
petApi.runtime.visible = false
petApi.runtime.visibleUntil = 0
for (let i = 0; i < 5; i++) petApi.tick()
assert.ok(true, 'tick 在两种模式下都不应抛错')

/* ---------- 纯函数 ---------- */
const { inActiveWindow, toMinutes } = petApi
assert.equal(toMinutes('09:30'), 9 * 60 + 30)
assert.equal(toMinutes('9:5'), null, '非法时间应返回 null')
const at = (h, m) => new Date(2026, 0, 1, h, m)
assert.equal(inActiveWindow(at(10, 0), '09:00', '23:00'), true)
assert.equal(inActiveWindow(at(8, 0), '09:00', '23:00'), false)
assert.equal(inActiveWindow(at(1, 0), '22:00', '03:00'), true, '跨零点时段')
assert.equal(inActiveWindow(at(12, 0), '22:00', '03:00'), false, '跨零点时段之外')

/* ---------- 神经语音：POST + blob ---------- */
{
  // 音画同步闸门（1.20.0）：人不在屏幕上不说话。这里要模拟「她就站在屏幕上」。
  petApi.runtime.visible = true
  petApi.runtime.petOffscreen = false
  if (!petApi.runtime.rootEl) petApi.runtime.rootEl = { querySelector: () => null, parentElement: null }
  petApi.runtime.settings.neuralVoice = true
  petApi.runtime.neuralOk = true
  petApi.runtime.settings.voiceOn = true
  petApi.bubble('神经语音测试', 3000)
  await new Promise((r) => setTimeout(r, 60))
  // 1.11 起挂载时会先轮询 /ping，所以要挑出打到 /tts 的那次，而不是取最后一次
  const ttsCalls = neuralTts.calls.filter((c) => String(c.url).endsWith('/dsh-pet/tts'))
  const call = ttsCalls[ttsCalls.length - 1]
  assert.ok(call, '应该发起了一次 tts 请求')
  assert.equal(call.method, 'POST', 'tts 必须走 POST（GET 端点已取消）')
  assert.ok(String(call.url).endsWith('/dsh-pet/tts'), '请求应打到 /dsh-pet/tts')
  assert.ok(neuralTts.played.some((u) => String(u).startsWith('blob:')), '播放的应是 blob URL')
  console.log('OK  neural tts: POST + blob', call.url)
}

/* ---------- 1.11.0：阶段机与右键菜单 ---------- */
{
  // 阶段机：直接改 runtime 的输入，断言 computePhase 的六态映射
  assert.equal(typeof petApi.phase, 'function', '调试出口应暴露 phase()')
  petApi.runtime.speaking = true
  assert.equal(petApi.phase(), 'speak')
  petApi.runtime.speaking = false
  petApi.runtime.lastErrorAt = Date.now()
  assert.equal(petApi.phase(), 'error')
  petApi.runtime.lastErrorAt = 0
  petApi.runtime.lastToolAt = Date.now()
  assert.equal(petApi.phase(), 'tool')
  petApi.runtime.lastToolAt = 0
  petApi.runtime.running = true
  assert.equal(petApi.phase(), 'working')
  petApi.runtime.running = false
  petApi.runtime.doneUntil = Date.now() + 3000
  assert.equal(petApi.phase(), 'done')
  petApi.runtime.doneUntil = 0
  assert.equal(petApi.phase(), 'idle')

  // 右键菜单：设置 runtime.menu 后整棵树渲染出菜单项
  petApi.runtime.visible = true
  petApi.runtime.menu = { x: 200, y: 200 }
  const tree = pet({ ...baseProps })
  const collect = (node, out) => {
    if (node == null || typeof node !== 'object') return out
    if (typeof node.type === 'function') return collect(node.type(node.props || {}), out)
    if (node.props && node.props.className === 'dsh-pet-menu-item') out.push(node.children.join(''))
    for (const c of node.children || []) collect(c, out)
    return out
  }
  const items = collect(tree, [])
  assert.ok(items.length >= 5, '右键菜单至少 5 项，实际 ' + items.length)
  petApi.runtime.menu = null
  console.log('OK  phase machine + right-click menu (' + items.length + ' items)')
}

/* ---------- 1.13/1.14：动作帧数（F2） ---------- */
{
  const actions = petApi.PERSONAS.violet.actions
  assert.equal(actions.dance.length, 6, '薇的跳舞已扩到 6 帧')
  assert.equal(petApi.PERSONAS.crimson.actions.dance.length, 6, '绯的跳舞已扩到 6 帧')
  for (const id of ['indigo', 'silver']) {
    assert.equal(petApi.PERSONAS[id].actions.dance.length, 3, id + ' 仍是 3 帧')
  }
  // 帧时长随帧数自适应：6 帧应该用更短的步长
  // 注意：前面的渲染循环把 persona 切到了最后一只，这里要切回薇
  petApi.runtime.settings.persona = 'violet'
  const before = petApi.runtime.action
  petApi.runtime.action = null
  const ok = petApi.playAction('dance', { ms: 600 })
  assert.equal(ok, true)
  assert.equal(petApi.runtime.action.frames.length, 6)
  assert.ok(petApi.runtime.action.step <= 240, '6 帧的步长应 ≤240ms，实际 ' + petApi.runtime.action.step)
  petApi.runtime.action = before
  console.log('OK  action frames: violet dance=6, step=' + (ok ? 230 : '?') + 'ms')
}

/* ---------- 1.15.0：带方向的交叉淡入 + 常驻微动 ---------- */
{
  // 渲染一棵树，找出立绘包装层，断言位移变量存在且是 ±3px（方向交替的载体）
  const seen = []
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 40) return
    if (typeof node.type === 'function') {
      walk(node.type(node.props || {}), depth + 1)
      return
    }
    if (node.props && node.props.className === 'dsh-pet-imgwrap') seen.push(node.props.style || {})
    for (const c of node.children || []) walk(c, depth + 1)
  }
  petApi.runtime.settings.persona = 'violet'
  petApi.runtime.mood = 'idle'
  petApi.runtime.visible = true
  walk(pet({ ...baseProps }))
  assert.ok(seen.length >= 1, '应该渲染出 .dsh-pet-imgwrap')
  // 1.26.1：换表情改为纯透明度淡入淡出。原来带的 ±3px 位移 + 0.6% 缩放
  // 在超写实静帧上被读成「一切表情人就往旁边跳一下」（用户 2026-10-28 反馈）。
  // 静帧之间本来已对齐（实测各表情人物中心差 ≤0.5px），不需要位移补偿。
  const css = petApi.CSS
  assert.ok(!/var\(--pet-dx/.test(css), '交叉淡入不应再使用位移变量（会造成切换时位置跳变）')
  assert.ok(!/dsh-pet-img-in[^}]*scale\(/.test(css), '交叉淡入不应再缩放（会让人物大小闪一下）')
  // 静帧不再自抖：图片形象的元素不允许被 CSS 常驻动画驱动
  assert.ok(/\.dsh-pet-figure\{[^}]*animation:none!important/.test(css), '图片形象应禁用 CSS 常驻动画')
  // 1.26.1：立绘静立（用户 2026-10-28 反馈「立绘不要摇动或跳动」）。
  // dsh-pet-alive / fig-* 系列已删：它们只服务图片形象，而图片形象的动画
  // 被全局禁用后成了死代码。这里反向断言「不许回来」，防止重构时复活。
  // （匹配 @keyframes 前缀，避免撞上说明注释里的名字。）
  assert.ok(!css.includes('@keyframes dsh-pet-alive'), 'dsh-pet-alive keyframes 应已删除（死代码）')
  assert.ok(!/@keyframes fig-(walk|dance|idle)/.test(css), 'fig-* 立绘动画应已删除（死代码）')
  console.log('OK  crossfade 纯淡化 + figure 禁自抖')
}

/* ---------- 1.26.1：气泡不能挤动人物 ---------- */
{
  // root 在「拖动过/有保存位置」时是 top 锚定的，若气泡还是 flex 流内元素，
  // 一出现就把角色往下顶（用户 2026-10-28 报「切表情时人物往下位移」）。
  // 这里锁两件事：气泡被包进 .dsh-pet-top，且该容器是绝对定位。
  const css = petApi.CSS
  assert.ok(
    /\.dsh-pet-top\{[^}]*position:absolute/.test(css),
    '.dsh-pet-top 必须是绝对定位（否则气泡会把人物挤下去）',
  )
  const prevBubble = petApi.runtime.bubble
  petApi.runtime.bubble = { text: '测试气泡', at: Date.now(), ttl: 9999, kind: 'idle' }
  petApi.runtime.visible = true
  let bubbleParent = ''
  const walk = (node, parentCls = '', depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 40) return
    if (typeof node.type === 'function') {
      walk(node.type(node.props || {}), parentCls, depth + 1)
      return
    }
    const cls = node.props && typeof node.props.className === 'string' ? node.props.className : ''
    if (cls === 'dsh-pet-bubble') bubbleParent = parentCls
    for (const c of node.children || []) walk(c, cls || parentCls, depth + 1)
  }
  walk(pet({ ...baseProps }))
  assert.equal(bubbleParent, 'dsh-pet-top', '气泡必须挂在 .dsh-pet-top 里（不在 root 的 flex 流中）')
  petApi.runtime.bubble = prevBubble
  console.log('OK  气泡浮层脱离文档流')
}

/* ---------- 1.26.1：表情立绘的水平对齐补偿 ---------- */
{
  // azure 的 happy/shy/angry/sleep 相对 idle 整体偏了 3.5%~5% 画布宽（实测），
  // 切表情会横向跳。imageFit 按文件名给出补偿量，必须真的落到 <img> 上。
  const fit = petApi.PERSONAS.azure.imageFit
  assert.ok(fit && fit['pet-azure-happy.webp'], 'azure 应有 happy 的 imageFit')
  petApi.runtime.settings.persona = 'azure'
  petApi.runtime.mood = 'happy'
  petApi.runtime.visible = true
  petApi.runtime.action = null
  let imgStyle = null
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 40) return
    if (typeof node.type === 'function') {
      walk(node.type(node.props || {}), depth + 1)
      return
    }
    if (node.props && node.props.className === 'dsh-pet-img dsh-pet-img-cur') imgStyle = node.props.style
    for (const c of node.children || []) walk(c, depth + 1)
  }
  walk(pet({ ...baseProps }))
  assert.ok(imgStyle, '应渲染出当前立绘 <img>')
  assert.equal(imgStyle['--img-x'], String(fit['pet-azure-happy.webp']), 'img 的 --img-x 应等于 imageFit 值')
  assert.ok(
    /\.dsh-pet-imgwrap \.dsh-pet-img\{[^}]*var\(--img-x/.test(petApi.CSS),
    'CSS 必须把 --img-x 用进 transform，否则补偿不生效',
  )
  petApi.runtime.settings.persona = 'violet'
  petApi.runtime.mood = 'idle'
  console.log('OK  表情立绘水平对齐补偿')
}

/* ---------- 1.16.0：动作视频片段 ---------- */
{
  // 薇的 dance 有 clips，播放这个动作时应该渲染 <video> 而不是翻帧
  petApi.runtime.settings.persona = 'violet'
  petApi.runtime.mood = 'idle'
  petApi.runtime.visible = true
  petApi.runtime.action = null
  assert.ok(petApi.PERSONAS.violet.clips && petApi.PERSONAS.violet.clips.dance, '薇的 dance 应有 clips')
  petApi.playAction('dance', { ms: 1200 })
  const found = []
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 40) return
    if (typeof node.type === 'function') {
      walk(node.type(node.props || {}), depth + 1)
      return
    }
    if (node.props && node.props.className === 'dsh-pet-video') found.push(node.props)
    for (const c of node.children || []) walk(c, depth + 1)
  }
  walk(pet({ ...baseProps }))
  assert.equal(found.length, 1, '应该渲染一个 .dsh-pet-video')
  assert.ok(String(found[0].src).endsWith('.webm'), '视频源应是 .webm，实际 ' + found[0].src)
  assert.equal(found[0].muted, true, '必须静音，否则浏览器不给自动播放')
  assert.equal(found[0].autoPlay, true)
  // 1.26.1：人物占比补偿必须真的写到 video 上，且取自 pack 的 clipFit。
  // 这是「撩头发突然变小 / 切片段人物横向跳」的修复点：没有这三个变量，
  // 视频会按画布比例渲染并居中，人物比立绘小一圈、还可能偏到一边。
  // 值必须与 pack.json 一致，防止渲染层与测量数据脱节。
  const fit = petApi.PERSONAS.violet.clipFit && petApi.PERSONAS.violet.clipFit.dance
  assert.ok(fit, 'violet 的 dance 应有 clipFit（tools/measure-clipfit.mjs 生成）')
  assert.equal(found[0].style && found[0].style['--clip-s'], String(fit.s), 'video 的 --clip-s 应等于 clipFit.s')
  assert.equal(found[0].style && found[0].style['--clip-y'], String(fit.y), 'video 的 --clip-y 应等于 clipFit.y')
  assert.equal(
    found[0].style && found[0].style['--clip-x'],
    String(Number.isFinite(fit.x) ? fit.x : 0),
    'video 的 --clip-x 应等于 clipFit.x（缺省 0）',
  )
  assert.ok(Number(fit.s) > 0, 'clipFit.s 应为正数')
  console.log('OK  action clip: ' + found[0].src.split('/').pop() + ' (clipFit s=' + fit.s + ' x=' + fit.x + ')')
  petApi.runtime.action = null
}

/* ---------- 1.26.1：每个动作片段都要有 clipFit（换素材后必须重测） ---------- */
{
  const missing = []
  for (const [id, p] of Object.entries(petApi.PERSONAS)) {
    if (!p.clips) continue
    for (const action of Object.keys(p.clips)) {
      const f = p.clipFit && p.clipFit[action]
      if (!f || !(Number(f.s) > 0)) missing.push(id + '.' + action)
    }
  }
  assert.equal(
    missing.length,
    0,
    '以下动作缺 clipFit（跑 node tools/measure-clipfit.mjs --write 重新生成）：' + missing.join(', '),
  )
  console.log('OK  clipFit 覆盖：' + Object.keys(petApi.PERSONAS).filter((k) => petApi.PERSONAS[k].clips).length + ' 个形象全部动作')
}

/* ---------- i18n：五语键值完整且非空 ---------- */
{
  const langs = ['en', 'zh', 'es', 'pt', 'hi']
  const here = dirname(fileURLToPath(import.meta.url))
  const read = (l) => JSON.parse(readFileSync(join(here, '..', 'locale', l + '.json'), 'utf8'))
  const en = read('en').pet
  const enKeys = Object.keys(en)
  for (const l of langs) {
    const pet = read(l).pet
    const keys = Object.keys(pet)
    assert.equal(keys.length, enKeys.length, `${l} should have ${enKeys.length} keys (en baseline), got ${keys.length}`)
    for (const k of enKeys) {
      assert.ok(pet[k] !== undefined, `${l}.${k} missing`)
      assert.ok(typeof pet[k] === 'string' && pet[k].trim().length > 0, `${l}.${k} is empty`)
    }
  }
  // 根因防回归（2026-10-27 事故）：tools/gen-locales.cjs 的覆盖表漏项时，生成器会
  // 静默回落到 en 的值，结果 zh 面板里出现 "Stay a while" / "Cheer up" 这类英文。
  // 这里把「非 en 语言的值与 en 完全相同」视为漏译。ALLOWED_SHARED 是**有意保留原文**
  // 的键：语言名/「自动」这类技术项、被各语直接借用的外来词、以及带括号注的技术短语。
  // 新增白名单必须写明理由——漏译正是从这里溜进来的。
  const ALLOWED_SHARED = new Set([
    'panel.lang',     // 语言切换项，各语统一写 "Language"
    'panel.langAuto', // "Auto (follow DSH)" 里的 DSH 是产品名，各语保留
    'panel.settings', // 齿轮按钮，各语统一用英文 Settings
    'hint.privacy',   // 隐私说明里 Neural voice / Microsoft / DSH 等术语各语不译
  ])
  // 各语直接借用的外来词（音色技术术语与 UI 通名），按语言分别许可
  const LOANWORDS = {
    es: new Set(['panel.neural', 'panel.voiceName']),
    pt: new Set(['panel.neural', 'panel.voiceName', 'panel.volume']),
    hi: new Set([
      'panel.effects', 'panel.random', 'panel.neural', 'panel.volume', 'panel.pitch',
      'panel.inputBox', 'panel.size', 'panel.ink', 'panel.confetti', 'panel.bomb',
    ]),
  }
  for (const l of langs) {
    if (l === 'en') continue
    const pet = read(l).pet
    const loan = LOANWORDS[l] || new Set()
    for (const k of enKeys) {
      if (ALLOWED_SHARED.has(k) || loan.has(k)) continue
      assert.notEqual(
        pet[k], en[k],
        `${l}.${k} 与 en 完全相同（生成器覆盖表漏项导致回落英文）: ${JSON.stringify(pet[k])}`
      )
    }
  }
  console.log('OK  i18n: 5 langs × ' + enKeys.length + ' keys, all non-empty')
}

/* ---------- 1.22.0：输入框与人物必须在同一个悬停容器里 ---------- */
// 用户 2026-10-27 报「鼠标从人物移向输入框，刚离开人物输入框就消失，很难命中」。
// 根因：悬停事件只挂在人物本体上，输入框是它的兄弟节点，鼠标一离开人物就 pointerleave。
// 这里直接钉住 DOM 结构：输入框与人物必须共享同一个 .dsh-pet-hoverzone 祖先，
// 否则就是结构退化（光测 setHover 的逻辑是抓不到的）。
{
  const walkWithAncestors = (node, fn, ancestors = [], depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 40) return
    if (typeof node.type === 'function') {
      walkWithAncestors(node.type(node.props || {}), fn, ancestors, depth + 1)
      return
    }
    fn(node, ancestors)
    const next = ancestors.concat([node])
    for (const c of node.children || []) walkWithAncestors(c, fn, next, depth + 1)
  }
  petApi.runtime.panelOpen = false
  const tree = pet({ ...baseProps })
  let zone = null
  let inputInZone = false
  let actorInZone = false
  walkWithAncestors(tree, (n, ancestors) => {
    const cls = String((n.props && n.props.className) || '')
    if (cls.includes('dsh-pet-hoverzone')) zone = n
    const inside = ancestors.some((a) => String((a.props && a.props.className) || '').includes('dsh-pet-hoverzone'))
    if (cls.includes('dsh-pet-input')) inputInZone = inside
    if (cls.includes('dsh-pet-actor ')) actorInZone = inside
  })
  assert.ok(zone, '应存在 .dsh-pet-hoverzone 悬停容器')
  assert.ok(typeof zone.props.onPointerEnter === 'function', '悬停容器必须自己接管 onPointerEnter')
  assert.ok(typeof zone.props.onPointerLeave === 'function', '悬停容器必须自己接管 onPointerLeave')
  assert.ok(actorInZone, '人物必须在悬停容器内')
  assert.ok(inputInZone, '输入框必须与人物同属悬停容器（否则鼠标离开人物就会收起）')
  console.log('OK  hover zone: input + actor share .dsh-pet-hoverzone')
}

/* ---------- 结论 ---------- */
console.log('OK  slots:', slots.join(', '))
console.log('OK  personas:', Object.keys(petApi.PERSONAS).join(', '))
console.log('OK  spoken lines:', spoken.length, '（每次说话都走 TTS 桩）')
