/**
 * 1.26.0 失焦安静态：判定与闸门。
 *
 * 这个文件只测一件事：**她该闭嘴的时候是不是真的闭上了**。
 * 因为安静态一旦判错，表现是「没有任何异常」——不会报错、不会有日志，
 * 只会在开会共享屏幕的时候突然开口。所以每条规则都要有正向与反向断言。
 *
 * 环境直接复刻 overlay.dom.test.mjs 的 jsdom 台架（真 React、真 DOM）。
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

const MIN = 60 * 1000

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

/** 每个用例前把安静相关的运行期状态归零 */
function reset() {
  pet.runtime.blurredAt = 0
  pet.runtime.dndUntil = 0
  pet.runtime.quietReason = ''
  pet.runtime.quietSince = 0
  pet.runtime.wokeAt = 0
  pet.runtime.visible = true
  pet.runtime.petOffscreen = false
  pet.runtime.bubble = null
  pet.runtime.settings.voiceOn = false
}

test('安静态：前台且不勿扰时不安静', () => {
  reset()
  assert.equal(pet.quietReason(), '')
  assert.equal(pet.isQuiet(), false)
})

test('安静态：失焦未满阈值时不安静（阈值内还会她正常活动）', () => {
  reset()
  pet.runtime.blurredAt = Date.now() - (pet.QUIET_AFTER_MS - 1000)
  assert.equal(pet.quietReason(), '')
})

test('安静态：失焦超过阈值 → 原因 blur', () => {
  reset()
  pet.runtime.blurredAt = Date.now() - (pet.QUIET_AFTER_MS + 1000)
  assert.equal(pet.quietReason(), 'blur')
  assert.equal(pet.isQuiet(), true)
})

test('安静态：阈值是 60s（用户 2026-10-28 拍板，回归保护）', () => {
  assert.equal(pet.QUIET_AFTER_MS, 60 * 1000)
  assert.equal(pet.DONT_DISTURB_MS, 60 * 60 * 1000)
})

test('安静态：手动勿扰优先报 dnd，且到期后自动解除', () => {
  reset()
  pet.toggleDontDisturb()
  assert.equal(pet.quietReason(), 'dnd')
  assert.ok(pet.dndRemainingMs() > 0)
  pet.toggleDontDisturb() // 再点一次 = 结束
  assert.equal(pet.quietReason(), '')
  assert.equal(pet.dndRemainingMs(), 0)

  // 过期的勿扰不应继续生效
  pet.runtime.dndUntil = Date.now() - 1000
  assert.equal(pet.quietReason(), '')
})

test('安静态：dnd 与 blur 同时成立时，dnd 优先（用户显式操作优先于推断）', () => {
  reset()
  pet.runtime.blurredAt = Date.now() - (pet.QUIET_AFTER_MS + 5000)
  pet.runtime.dndUntil = Date.now() + MIN
  assert.equal(pet.quietReason(), 'dnd')
})

test('闸门：安静时自发台词被吞掉（bubble 不落库）', () => {
  reset()
  pet.runtime.blurredAt = Date.now() - (pet.QUIET_AFTER_MS + 1000)
  pet.bubble('随便说点什么', 3000, 'idle')
  assert.equal(pet.runtime.bubble, null, '安静态下自发气泡不应出现')
})

test('闸门：安静时 announce 仍然说话（脚本通道属于「有事」）', () => {
  reset()
  pet.runtime.blurredAt = Date.now() - (pet.QUIET_AFTER_MS + 1000)
  pet.bubble('CI 又挂了', 3000, 'announce')
  assert.ok(pet.runtime.bubble, 'announce 在安静态下必须放行')
  assert.equal(pet.runtime.bubble.text, 'CI 又挂了')
})

test('闸门：安静时用户刚发的消息回复仍然出声（chatAck / chatErr）', () => {
  reset()
  pet.runtime.blurredAt = Date.now() - (pet.QUIET_AFTER_MS + 1000)
  pet.bubble('嗯，我在听', 3000, 'chatAck')
  assert.ok(pet.runtime.bubble, 'chatAck 在安静态下必须放行')
  pet.runtime.bubble = null
  pet.bubble('出错了', 3000, 'chatErr')
  assert.ok(pet.runtime.bubble, 'chatErr 在安静态下必须放行')
})

test('闸门：不安静时自发台词照常出现（不能因为加闸门把她变哑巴）', () => {
  reset()
  pet.bubble('今天空气不错', 3000, 'idle')
  assert.ok(pet.runtime.bubble, '前台时自发气泡必须正常')
})

test('闸门：藏起来时仍然不说话（既有规则不能被安静态覆盖掉）', () => {
  reset()
  pet.runtime.visible = false
  pet.bubble('冒泡', 3000, 'announce')
  assert.equal(pet.runtime.bubble, null, '藏起来时连 announce 也不冒泡——她不在屏幕上')
})

test('闸门：拖出视口时仍然不说话（既有规则）', () => {
  reset()
  pet.runtime.petOffscreen = true
  pet.bubble('冒泡', 3000, 'idle')
  assert.equal(pet.runtime.bubble, null)
})

test('isAddressedKind：只有三个「有事」类别放行', () => {
  assert.equal(pet.isAddressedKind('announce'), true)
  assert.equal(pet.isAddressedKind('chatAck'), true)
  assert.equal(pet.isAddressedKind('chatErr'), true)
  for (const k of ['idle', 'dance', 'poked', 'drag', 'appear', '', undefined, null]) {
    assert.equal(pet.isAddressedKind(k), false, '不该放行: ' + String(k))
  }
})

test('isFocused：visibilityState 隐藏或 hasFocus 为假，任一不满足都算不在', () => {
  const doc = window.document
  const realHasFocus = doc.hasFocus
  const realVis = Object.getOwnPropertyDescriptor(doc, 'visibilityState')
  try {
    Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => 'visible' })
    doc.hasFocus = () => true
    assert.equal(pet.isFocused(), true, '两者都满足才算在前台')

    doc.hasFocus = () => false
    assert.equal(pet.isFocused(), false, 'hasFocus=false → 不在')

    doc.hasFocus = () => true
    Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => 'hidden' })
    assert.equal(pet.isFocused(), false, 'hidden → 不在（窗口被遮住时 hasFocus 仍可能为真）')
  } finally {
    doc.hasFocus = realHasFocus
    if (realVis) Object.defineProperty(doc, 'visibilityState', realVis)
    else delete doc.visibilityState
  }
})

test('syncQuiet：跨越边界时记录进入/退出时间戳（供过渡动作使用）', () => {
  reset()
  // 进入安静
  pet.runtime.blurredAt = Date.now() - (pet.QUIET_AFTER_MS + 1000)
  pet.syncQuiet()
  assert.equal(pet.runtime.quietReason, 'blur')
  assert.ok(pet.runtime.quietSince > 0, '进入安静应记录时间戳')
  assert.equal(pet.runtime.wokeAt, 0)

  // 重新聚焦 → 退出
  pet.runtime.blurredAt = 0
  pet.syncQuiet()
  assert.equal(pet.runtime.quietReason, '')
  assert.equal(pet.runtime.quietSince, 0)
  assert.ok(pet.runtime.wokeAt > 0, '醒来应记录时间戳')
})
