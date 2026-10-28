/**
 * 1.26.0 失焦通知：降级链与自证统计。
 *
 * 通知是跨平台方案里最容易被「看起来能用、其实坏了」的部分——Linux 无通知守护
 * 进程、macOS 系统静音、浏览器权限被撤，这三种情况 API 都不报错。所以这里
 * 每条降级链都要有正向与反向断言，并验证 notifyStats 说实话。
 *
 * 环境与 focus.test.mjs 一致（jsdom 台架），但多了 window.Notification 的桩。
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

const dom = new JSDOM('<!doctype html><html lang="zh"><body></body></html>', {
  url: 'http://127.0.0.1:14235/?petdebug=1',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
})
const { window } = dom
globalThis.window = window
globalThis.document = window.document

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
assert.ok(factory, 'client.js 没有注册工厂')

const plugin = factory((id) => {
  if (id !== 'react') throw new Error('unexpected require: ' + id)
  return React
})

const disposers = []
const fakeCtx = {
  effect(fn) {
    const d = fn()
    if (d) disposers.push(d)
    return d
  },
  slots: {
    inject(_key, cb) {
      return cb()
    },
    register() {
      return () => {}
    },
  },
}
plugin.apply(fakeCtx)

const pet = window.__dshPet
assert.ok(pet, 'petdebug=1 时应挂载 __dshPet 自检出口')

after(() => {
  for (const d of disposers) {
    try {
      d && d()
    } catch (e) {
      /* ignore */
    }
  }
  window.close()
})

/* ---------- Notification 桩 ---------- */

// 可控的 Notification 实现：permission 可设，show/error 事件可手动触发
function makeNotifEnv(permission) {
  const insts = []
  class FakeNotification {
    constructor(title, opts) {
      this.title = title
      this.opts = opts || {}
      this._listeners = {}
      insts.push(this)
    }
    addEventListener(ev, fn) {
      ;(this._listeners[ev] = this._listeners[ev] || []).push(fn)
    }
    fire(ev) {
      for (const fn of this._listeners[ev] || []) fn()
    }
    show() {}
  }
  window.Notification = FakeNotification
  Object.defineProperty(FakeNotification, 'permission', { configurable: true, get: () => permission })
  FakeNotification.requestPermission = async () => permission
  return insts
}

function reset() {
  pet.runtime.blurredAt = 0
  pet.runtime.dndUntil = 0
  pet.runtime.quietReason = ''
  pet.runtime.quietSince = 0
  pet.runtime.wokeAt = 0
  pet.runtime.visible = true
  pet.runtime.petOffscreen = false
  pet.runtime.bubble = null
  pet.runtime.notifyTaggedTitle = ''
  document.title = 'DeepSeek Harness'
  // 重置统计
  const s = pet.notifyStats
  s.sent = 0
  s.failed = 0
  s.lastReason = ''
  s.lastAt = 0
}

test('探测：无 Notification 环境 → supported=none / permission=unavailable', () => {
  delete window.Notification
  pet.probeNotify()
  assert.equal(pet.notifyStats.supported, 'none')
  assert.equal(pet.notifyStats.permission, 'unavailable')
})

test('探测：有 Notification 且 granted → supported=web / permission=granted', () => {
  makeNotifEnv('granted')
  pet.probeNotify()
  assert.equal(pet.notifyStats.supported, 'web')
  assert.equal(pet.notifyStats.permission, 'granted')
})

test('requestNotifyPermission：返回权限状态，拒绝时记 denied', async () => {
  makeNotifEnv('denied')
  const perm = await pet.requestNotifyPermission()
  assert.equal(perm, 'denied')
  assert.equal(pet.notifyStats.permission, 'denied')
})

test('降级链：短活不弹（< 10s），lastReason=short', () => {
  makeNotifEnv('granted')
  reset()
  const r = pet.sendTurnNotify(4000)
  assert.equal(r, 'skip:short')
  assert.equal(pet.notifyStats.sent, 0)
  assert.equal(pet.notifyStats.lastReason, 'short')
})

test('降级链：人正看着（前台且不安静）不弹，lastReason=focused', () => {
  makeNotifEnv('granted')
  reset()
  // 前台
  const doc = window.document
  const realVis = Object.getOwnPropertyDescriptor(doc, 'visibilityState')
  try {
    Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => 'visible' })
    doc.hasFocus = () => true
    const r = pet.sendTurnNotify(30000)
    assert.equal(r, 'skip:focused')
    assert.equal(pet.notifyStats.lastReason, 'focused')
  } finally {
    if (realVis) Object.defineProperty(doc, 'visibilityState', realVis)
  }
})

test('降级链：手动勿扰但人在前台 → 仍不弹（通知只看「人在不在看」，不看安静态）', () => {
  makeNotifEnv('granted')
  reset()
  pet.runtime.dndUntil = Date.now() + 60 * 60 * 1000 // 勿扰 1 小时
  const doc = window.document
  const realVis = Object.getOwnPropertyDescriptor(doc, 'visibilityState')
  try {
    Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => 'visible' })
    doc.hasFocus = () => true // 但人正看着
    const r = pet.sendTurnNotify(30000)
    assert.equal(r, 'skip:focused', '勿扰 + 前台也不能误弹——通知只看人是否在看')
  } finally {
    if (realVis) Object.defineProperty(doc, 'visibilityState', realVis)
  }
})

test('降级链：失焦 + granted → 走 notification，show 事件驱动 sent', () => {
  const insts = makeNotifEnv('granted')
  reset()
  const doc = window.document
  const realVis = Object.getOwnPropertyDescriptor(doc, 'visibilityState')
  try {
    Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => 'visible' })
    doc.hasFocus = () => false // 失焦
    const r = pet.sendTurnNotify(30000)
    assert.equal(r, 'notification')
    assert.equal(insts.length, 1)
    assert.equal(insts[0].opts.tag, 'dsh-pet-turn-end')
    assert.equal(insts[0].opts.silent, true)
    assert.equal(insts[0].opts.requireInteraction, false)
    // show 之前 sent 不应 +1（自证语义：只有真的显示才算发出去了）
    assert.equal(pet.notifyStats.sent, 0)
    insts[0].fire('show')
    assert.equal(pet.notifyStats.sent, 1)
    assert.equal(pet.notifyStats.lastReason, '')
    assert.ok(document.title.startsWith('● '), '标题应打上前缀（双保险）')
    assert.ok(pet.runtime.notifyTaggedTitle, '应记录原标题以便恢复')
  } finally {
    if (realVis) Object.defineProperty(doc, 'visibilityState', realVis)
  }
})

test('自证：2s 内未 show 也未 error → 记 failed/no-daemon，标题兜底', async () => {
  const insts = makeNotifEnv('granted')
  reset()
  const doc = window.document
  const realVis = Object.getOwnPropertyDescriptor(doc, 'visibilityState')
  try {
    Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => 'visible' })
    doc.hasFocus = () => false
    const r = pet.sendTurnNotify(30000)
    assert.equal(r, 'notification')
    assert.equal(pet.notifyStats.failed, 0)
    // 等 2.2s，静默失败窗口到期（Linux 无守护进程的典型表现）
    await new Promise((res) => setTimeout(res, 2200))
    assert.equal(pet.notifyStats.failed, 1, '静默失败应被记下来')
    assert.equal(pet.notifyStats.lastReason, 'no-daemon')
    assert.ok(document.title.startsWith('● '), '标题兜底应已生效')
  } finally {
    if (realVis) Object.defineProperty(doc, 'visibilityState', realVis)
  }
})

test('自证：error 事件 → 记 failed/error，标题兜底', () => {
  const insts = makeNotifEnv('granted')
  reset()
  const doc = window.document
  const realVis = Object.getOwnPropertyDescriptor(doc, 'visibilityState')
  try {
    Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => 'visible' })
    doc.hasFocus = () => false
    pet.sendTurnNotify(30000)
    insts[0].fire('error')
    assert.equal(pet.notifyStats.failed, 1)
    assert.equal(pet.notifyStats.lastReason, 'error')
    assert.ok(document.title.startsWith('● '))
  } finally {
    if (realVis) Object.defineProperty(doc, 'visibilityState', realVis)
  }
})

test('降级链：失焦 + denied → 落到标题前缀，lastReason=title-fallback', () => {
  makeNotifEnv('denied')
  reset()
  const doc = window.document
  const realVis = Object.getOwnPropertyDescriptor(doc, 'visibilityState')
  try {
    Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => 'visible' })
    doc.hasFocus = () => false
    const r = pet.sendTurnNotify(30000)
    assert.equal(r, 'title')
    assert.equal(pet.notifyStats.lastReason, 'title-fallback')
    assert.ok(document.title.startsWith('● '))
    assert.equal(pet.notifyStats.sent, 1)
  } finally {
    if (realVis) Object.defineProperty(doc, 'visibilityState', realVis)
  }
})

test('降级链：无 Notification 环境 → 标题前缀仍生效（永不失败）', () => {
  delete window.Notification
  reset()
  const doc = window.document
  const realVis = Object.getOwnPropertyDescriptor(doc, 'visibilityState')
  try {
    Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => 'visible' })
    doc.hasFocus = () => false
    const r = pet.sendTurnNotify(30000)
    assert.equal(r, 'title')
    assert.ok(document.title.startsWith('● '))
  } finally {
    if (realVis) Object.defineProperty(doc, 'visibilityState', realVis)
  }
})

test('冷却：90s 内连发只发一次，第二次 skip:cooldown', () => {
  const insts = makeNotifEnv('granted')
  reset()
  const doc = window.document
  const realVis = Object.getOwnPropertyDescriptor(doc, 'visibilityState')
  try {
    Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => 'visible' })
    doc.hasFocus = () => false
    const r1 = pet.sendTurnNotify(30000)
    assert.equal(r1, 'notification')
    assert.ok(pet.notifyStats.lastAt > 0, '第一次应记录冷却时间戳')
    const r2 = pet.sendTurnNotify(30000)
    assert.equal(r2, 'skip:cooldown')
    assert.equal(insts.length, 1, '冷却期内不应再建 Notification')
  } finally {
    if (realVis) Object.defineProperty(doc, 'visibilityState', realVis)
  }
})

test('标题前缀恢复：titlePrefix(false) 还原原标题', () => {
  reset()
  pet.titlePrefix(true)
  assert.ok(document.title.startsWith('● '))
  pet.titlePrefix(false)
  assert.equal(document.title, 'DeepSeek Harness')
  assert.equal(pet.runtime.notifyTaggedTitle, '')
})

test('通知文案：title 用形象名，body 含分钟数', () => {
  reset()
  const doc = window.document
  const realVis = Object.getOwnPropertyDescriptor(doc, 'visibilityState')
  try {
    Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => 'visible' })
    doc.hasFocus = () => false
    const insts = makeNotifEnv('granted')
    pet.sendTurnNotify(125000) // 约 2 分钟
    assert.equal(insts.length, 1)
    assert.equal(insts[0].title, '薇') // 默认 persona violet 名为「薇」
    assert.ok(/2/.test(insts[0].opts.body), 'body 应含分钟数 2')
  } finally {
    if (realVis) Object.defineProperty(doc, 'visibilityState', realVis)
  }
})
