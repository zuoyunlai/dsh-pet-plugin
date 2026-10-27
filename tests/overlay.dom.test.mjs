/**
 * R-08：真实浏览器语义的组件测试（jsdom + 真 React）。
 *
 * 与 harness.mjs（VM 假浏览器 + React 桩）的分工：
 *  - 那边证明「时序/回退逻辑」；这边证明「真实 DOM 上的可交互性」：
 *    1) 右键菜单的每一项都是真 <button role=menuitem>（Tab/Enter 原生可达）；
 *    2) Escape 直接关闭菜单（R-08 新增的 onKeyDown）；
 *    3) 动作视频 error 事件 → ClipLayer 撤掉 <video>、退回静帧立绘。
 *
 * 这些断言只有挂到真 DOM 上才作数：React 桩的树里没有「元素类型/焦点/事件」的概念。
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')
const require = createRequire(import.meta.url)
const React = require('react')
const { createRoot } = require('react-dom/client')

/* ---------- 真浏览器环境 ---------- */

const dom = new JSDOM('<!doctype html><html lang="zh"><body></body></html>', {
  url: 'http://127.0.0.1:14235/?petdebug=1',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
})
const { window } = dom
// react-dom 在 Node 里渲染前会探测全局 window/document（getCurrentEventPriority 等）
globalThis.window = window
globalThis.document = window.document

// jsdom 缺的浏览器 API 桩（client 只在具体链路上用到它们）
window.matchMedia = (q) => ({
  media: String(q),
  matches: false,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
})
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })
window.speechSynthesis = { cancel() {}, getVoices: () => [], speak(u) { if (u.onend) u.onend() } }
window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t } }
window.URL.createObjectURL = () => 'blob:fake'
window.URL.revokeObjectURL = () => {}
window.Audio = class { constructor(src) { this.src = src } play() { return Promise.resolve() } pause() {} }
window.AbortController = window.AbortController || AbortController

let factory = null
window.__ModuleLoader__ = { load(spec) { factory = spec.factory } }

runInContext(source, dom.getInternalVMContext(), { filename: 'client.js' })
assert.ok(factory, 'client.js 没有通过 window.__ModuleLoader__.load 注册工厂')

// 真 React 喂给工厂（客户端只 require react）
const plugin = factory((id) => {
  if (id !== 'react') throw new Error('unexpected require: ' + id)
  return React
})

const registered = []
const disposers = []
const fakeCtx = {
  effect(fn) {
    const d = fn()
    if (d) disposers.push(d)
    return d
  },
  slots: {
    inject(_key, cb) { return cb() },
    register(spec, component) { registered.push({ spec, component }); return () => {} },
  },
}
plugin.apply(fakeCtx)

const petApi = window.__dshPet
assert.ok(petApi, 'petdebug=1 时应挂载 __dshPet 自检出口')

const PetOverlay = registered.find((r) => r.spec.name === 'shell.overlay').component
const host = window.document.createElement('div')
window.document.body.appendChild(host)
const root = createRoot(host)

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms))

/**
 * 等条件成立再断言，最多等 timeout 毫秒（默认 3000）。
 *
 * 为什么不能只用固定 tick：React 18 的 createRoot 是并发渲染，render() 返回后
 * DOM 未必已经提交；固定等 40ms 在本机够用，但在更慢的 CI runner 上不够——
 * v1.24.0 的 release workflow 就是因此红了（"菜单项应是原生 button，实际 0 个"，
 * 而本地连跑 5 次全绿）。这类"本地绿、CI 红"的假绿比测试缺失更危险，必须改成轮询。
 */
async function waitFor(fn, msg, timeout = 3000) {
  const start = Date.now()
  for (;;) {
    let v
    try {
      v = fn()
    } catch (e) {
      v = undefined
    }
    if (v) return v
    if (Date.now() - start > timeout) {
      throw new Error('等待超时（' + timeout + 'ms）：' + msg)
    }
    await tick(16)
  }
}

before(async () => {
  root.render(React.createElement(PetOverlay, { sessionId: 'session-1' }))
  // 等到组件真的挂进 DOM 再进用例，避免下游用例拿到空树
  await waitFor(
    () => window.document.querySelector('.dsh-pet-root'),
    'PetOverlay 未在超时内挂载到 .dsh-pet-root'
  )
})

after(() => {
  try { root.unmount() } catch (e) {}
  for (const d of disposers) { try { d && d() } catch (e) {} }
  window.close()
})

/* ---------- R-08 用例 ---------- */

test('右键菜单每一项都是原生 button[role=menuitem]（键盘可达）', async () => {
  petApi.runtime.visible = true
  petApi.runtime.menu = { x: 120, y: 120 }
  petApi.notify()

  // 等菜单真的提交到 DOM（CI runner 慢，固定 40ms 不够）
  const items = await waitFor(() => {
    const list = host.querySelectorAll('button[role="menuitem"]')
    return list.length >= 5 ? list : null
  }, '菜单项应是原生 button，实际 ' + host.querySelectorAll('button[role="menuitem"]').length + ' 个')
  assert.ok(items.length >= 5)
  const menu = host.querySelector('[role="menu"]')
  assert.ok(menu, '菜单容器应带 role=menu')
  assert.equal(host.querySelector('.dsh-pet-menu-mask') != null, true, '遮罩应存在')

  // 清场：直接关掉
  petApi.runtime.menu = null
  petApi.notify()
  await waitFor(() => host.querySelector('.dsh-pet-menu-mask') === null, '关掉后遮罩应移除')
})

test('Escape 键关闭菜单', async () => {
  petApi.runtime.visible = true
  petApi.runtime.menu = { x: 120, y: 120 }
  petApi.notify()
  const mask = await waitFor(
    () => host.querySelector('.dsh-pet-menu-mask'),
    '菜单应已打开'
  )

  mask.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await waitFor(() => host.querySelector('.dsh-pet-menu-mask') === null, 'Escape 后遮罩应移除')

  assert.equal(petApi.runtime.menu, null, 'runtime.menu 应清空')
})

test('动作视频 error → 撤掉 <video> 退回静帧', async () => {
  petApi.runtime.visible = true
  petApi.playAction('dance')
  petApi.notify()
  await tick(80)

  const video = host.querySelector('video.dsh-pet-video')
  assert.ok(video, '动作期间应渲染 <video>')
  const clip = video.getAttribute('src')

  video.dispatchEvent(new window.Event('error'))
  await tick()

  assert.equal(host.querySelector('video.dsh-pet-video'), null, 'error 后应撤掉 <video>（退回静帧）')
  assert.equal(petApi.runtime.clipFailed[clip.split('/').pop()], true, '失败按片段记忆')

  // 收尾：让动作结束，避免影响后续用例
  petApi.runtime.action = null
  petApi.runtime.clipFailed = {}
  petApi.notify()
  await tick()
})
