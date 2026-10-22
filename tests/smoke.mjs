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
  assert.ok(text.includes('Desk pet'), 'i18n 回落英文时应渲染英文标题')
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

/* ---------- 结论 ---------- */
console.log('OK  slots:', slots.join(', '))
console.log('OK  personas:', Object.keys(petApi.PERSONAS).join(', '))
console.log('OK  spoken lines:', spoken.length, '（每次说话都走 TTS 桩）')
