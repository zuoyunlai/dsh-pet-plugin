/**
 * 正式测试台架（1.19.3）：把 client.js 真实跑在一个可控的假浏览器里。
 *
 * 与 smoke.mjs 的分工：
 *  - smoke 只证明「能渲染、不抛错」（React 桩的 useEffect 是空实现）；
 *  - 这里提供**可控定时器队列 + 虚拟时钟 + 可编程 fetch**，可以断言时序、
 *    失败回退、布局夹取这些 smoke 证明不了的行为。
 *
 * 关键点：
 *  - 假 setTimeout 是可控队列：能推进到某个时刻、也能只触发一个到期回调；
 *  - 假 fetch 可编程返回，也能按 AbortSignal 拒绝（用来测轮询超时）；
 *  - 假 DOM 只需要 getBoundingClientRect 之类，让 placePanel 有可测几何。
 */

import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

/* ---------------- 可控假环境 ---------------- */

export function makeEnv(opts = {}) {
  const storage = new Map()
  storage.set('dsh-pet.debug', '1')

  const timers = [] // {id, fn, at, seq, kind}
  let seq = 0
  let clock = 0

  const listeners = { resize: [], mousemove: [] }
  const fetchLog = []
  const fetchHandler = opts.fetchHandler || (async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))

  const React = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat(Infinity).filter((c) => c != null && c !== false) }
    },
    useState(initial) {
      const value = typeof initial === 'function' ? initial() : initial
      return [value, () => {}]
    },
    useEffect() {},
    useCallback: (fn) => fn,
    useRef: (v) => ({ current: v }),
  }

  // 虚拟化 Date.now()：让 nowMs() 跟着假时钟走，否则时序断言全是假的。
  const RealDate = Date
  const VDate = class extends RealDate {
    constructor(...a) {
      if (a.length === 0) super(clock)
      else super(...a)
    }
    static now() {
      return clock
    }
  }
  VDate.parse = RealDate.parse
  VDate.UTC = RealDate.UTC

  const ctx = createContext({
    console,
    Date: VDate,
    Math,
    JSON,
    String,
    Number,
    Object,
    Array,
    Set,
    Map,
    RegExp,
    Promise,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    requestAnimationFrame: (fn) => fn(),
    // 可控定时器
    setTimeout(fn, ms) {
      const id = ++seq
      timers.push({ id, fn, at: clock + (ms || 0), seq: id, kind: 'timeout' })
      return id
    },
    clearTimeout(id) {
      const i = timers.findIndex((t) => t.id === id)
      if (i >= 0) timers.splice(i, 1)
    },
    setInterval(fn, ms) {
      const id = ++seq
      timers.push({ id, fn, at: clock + (ms || 0), seq: id, kind: 'interval', every: ms || 0 })
      return id
    },
    clearInterval(id) {
      const i = timers.findIndex((t) => t.id === id)
      if (i >= 0) timers.splice(i, 1)
    },
    addEventListener(type, fn) {
      ;(listeners[type] = listeners[type] || []).push(fn)
    },
    removeEventListener(type, fn) {
      const arr = listeners[type] || []
      const i = arr.indexOf(fn)
      if (i >= 0) arr.splice(i, 1)
    },
    fetch: async (url, init) => {
      fetchLog.push({ url: String(url), method: (init && init.method) || 'GET', at: clock })
      return fetchHandler(url, init, clock)
    },
    MutationObserver: class {
      constructor(cb) {
        this.cb = cb
      }
      observe() {}
      disconnect() {}
    },
  })

  ctx.window = ctx
  ctx.AbortController = class {
    constructor() {
      this.signal = { aborted: false, _l: [] }
      this.signal.addEventListener = (ev, fn) => {
        if (ev === 'abort') this.signal._l.push(fn)
      }
      this.signal.removeEventListener = () => {}
    }
    abort() {
      if (this.signal.aborted) return
      this.signal.aborted = true
      for (const fn of this.signal._l.slice()) {
        try {
          fn()
        } catch (e) {
          /* ignore */
        }
      }
    }
  }
  // 减弱动效（R10）与轮询中止（R08）需要的两个浏览器对象
  ctx.window.matchMedia = (q) => ({
    media: String(q),
    matches: !!opts.reduced && String(q).indexOf('prefers-reduced-motion') >= 0,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })
  ctx.window.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  }
  ctx.window.speechSynthesis = { cancel() {}, getVoices: () => [], speak(u) { if (u.onend) u.onend() } }
  ctx.window.SpeechSynthesisUtterance = class {
    constructor(t) {
      this.text = t
    }
  }
  ctx.window.URL = { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} }
  ctx.window.innerWidth = opts.innerWidth || 1280
  ctx.window.innerHeight = opts.innerHeight || 800
  ctx.window.location = { search: '', origin: 'http://127.0.0.1:14235', reload() {} }
  ctx.Audio = class {
    constructor(src) {
      this.src = src
    }
    play() {
      return Promise.resolve()
    }
    pause() {}
  }
  ctx.document = {
    documentElement: { getAttribute: () => 'en', setAttribute() {} },
    body: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800, right: 1280, bottom: 800 }) },
    createElementNS: () => ({ setAttribute() {}, appendChild() {} }),
    querySelector: (sel) => (opts.actorRect && sel === '.dsh-pet-actor-wrap' ? { getBoundingClientRect: () => opts.actorRect } : null),
    hasFocus: () => true,
  }

  let factory = null
  ctx.window.__ModuleLoader__ = { load(spec) { factory = spec.factory } }

  runInContext(source, ctx, { filename: 'client.js' })

  const registered = []
  const effects = []
  const fakeCtx = {
    effect(fn) {
      const dispose = fn()
      effects.push(dispose)
      return dispose
    },
    slots: {
      inject(key, cb) {
        return cb()
      },
      register(spec, component) {
        registered.push({ spec, component })
        return () => {}
      },
    },
  }

  const plugin = factory((id) => {
    if (id !== 'react') throw new Error('unexpected require: ' + id)
    return React
  })
  plugin.apply(fakeCtx)

  const api = {
    ctx,
    api: ctx.__dshPet,
    registered,
    effects,
    storage,
    fetchLog,
    timers,
    listeners,
    now: () => clock,
    setNow: (t) => {
      clock = t
    },
    /** 推进虚拟时钟到 t，期间按时间顺序触发到期定时器（含 interval 的重复触发） */
    advance(ms) {
      const target = clock + ms
      let guard = 0
      for (;;) {
        if (++guard > 100000) throw new Error('timer loop')
        const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.seq - b.seq)
        if (!due.length) break
        const t = due[0]
        // 先按「触发时刻」推进时钟，再重新排 interval ——
        // 旧顺序会先 t.at = clock + every 再 clock = t.at，把时钟一次跳到下一次触发，
        // 导致同一轮里后面的 timer 都在错误的时刻执行（退出淡出那 220ms 就被吞掉）。
        const firedAt = t.at
        clock = Math.max(clock, firedAt)
        if (t.kind === 'interval') {
          t.at = firedAt + t.every
          t.seq = ++seq
        } else {
          const i = timers.indexOf(t)
          if (i >= 0) timers.splice(i, 1)
        }
        try {
          t.fn()
        } catch (e) {
          if (opts.throwOnTimer) throw e
        }
      }
      clock = target
    },
    /** 只触发当前到期的一次定时器 */
    fireDue() {
      const due = timers.filter((t) => t.at <= clock).sort((a, b) => a.at - b.at || a.seq - b.seq)
      if (!due.length) return 0
      const t = due[0]
      if (t.kind === 'interval') {
        t.at = clock + t.every
        t.seq = ++seq
      } else {
        const i = timers.indexOf(t)
        if (i >= 0) timers.splice(i, 1)
      }
      try {
        t.fn()
      } catch (e) {
        if (opts.throwOnTimer) throw e
      }
      return 1
    },
    pending: () => timers.length,
    pendingKinds: () => timers.map((t) => ({ at: t.at, kind: t.kind, every: t.every })),
    disposeAll() {
      for (const d of effects) {
        try {
          d && d()
        } catch (e) {}
      }
    },
  }
  return api
}

/** 遍历渲染树，找 className 命中的节点 */
export function findByClass(tree, cls, out = []) {
  if (!tree || typeof tree !== 'object') return out
  if (typeof tree.type === 'function') {
    findByClass(tree.type(tree.props || {}), cls, out)
    return out
  }
  const c = tree.props && tree.props.className
  if (typeof c === 'string' && c.split(/\s+/).includes(cls)) out.push(tree.props)
  for (const ch of tree.children || []) findByClass(ch, cls, out)
  return out
}

export function collectText(tree, out = []) {
  if (tree == null || typeof tree !== 'object') return out
  if (typeof tree.type === 'function') return collectText(tree.type(tree.props || {}), out)
  for (const ch of tree.children || []) {
    if (typeof ch === 'string') out.push(ch)
    else collectText(ch, out)
  }
  return out
}
