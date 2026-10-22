/**
 * 宿主路由的最小单测（node --test tests/host.test.mjs）。
 * 用假的 ctx/req/res，不启动 DSH。
 */
import test from 'node:test'
import assert from 'node:assert'
import { apply } from '../index.js'

function makeCtx(opts = {}) {
  const routes = new Map()
  const listeners = new Map()
  const commands = opts.commands
    ? {
        registered: [],
        register(def) {
          this.registered.push(def)
          return () => {}
        },
      }
    : null
  return {
    routes,
    commands,
    listeners,
    emit(name, payload) {
      const fn = listeners.get(name)
      if (fn) fn(payload)
    },
    webServer: {
      register({ path, handler }) {
        routes.set(path, handler)
        return () => routes.delete(path)
      },
      tapIndex(fn) {
        return () => {}
      },
      getOrigin() {
        return 'http://127.0.0.1:0'
      },
    },
    effect(fn) {
      const dispose = fn()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    on(name, fn) {
      listeners.set(name, fn)
      return () => listeners.delete(name)
    },
    // chat 会 ctx.get('llm')；默认返回 undefined（没有模型），走 503 分支
    get(name) {
      if (name === 'commands') return commands
      return undefined
    },
  }
}

function call(handler, { method = 'GET', url = '/', body = '', headers = {} } = {}) {
  const req = {
    method,
    url,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
    on(ev, fn) {
      if (ev === 'data' && body) fn(Buffer.from(body))
      if (ev === 'end') fn()
      return req
    },
    // readBody 用 for await (const chunk of req)，所以假 req 要能异步迭代
    async *[Symbol.asyncIterator]() {
      if (body) yield Buffer.from(body)
    },
  }
  const chunks = []
  const res = {
    statusCode: 0,
    headers: {},
    writeHead(code, hdrs) {
      this.statusCode = code
      this.headers = { ...this.headers, ...(hdrs || {}) }
      return this
    },
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v
    },
    end(buf) {
      if (buf) chunks.push(Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf)))
    },
    body() {
      return Buffer.concat(chunks).toString('utf8')
    },
  }
  // 同步 handler（ping）返回 undefined，统一包成 Promise
  return Promise.resolve(handler(req, res)).then(() => res)
}

test('路由都注册上了', () => {
  const ctx = makeCtx()
  apply(ctx, {})
  for (const p of ['/dsh-pet/ping', '/dsh-pet/chat', '/dsh-pet/tts', '/dsh-pet/tts/status']) {
    assert.ok(ctx.routes.has(p), '缺少路由 ' + p)
  }
})

test('tts/status 返回可用性布尔值', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const res = await call(ctx.routes.get('/dsh-pet/tts/status'), { url: '/dsh-pet/tts/status' })
  assert.equal(res.statusCode, 200)
  const j = JSON.parse(res.body())
  assert.equal(typeof j.available, 'boolean')
  assert.ok(Array.isArray(j.voices))
})

test('tts 音色表覆盖多语言（界面语言切换后仍能出声）', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const res = await call(ctx.routes.get('/dsh-pet/tts/status'), { url: '/dsh-pet/tts/status' })
  const j = JSON.parse(res.body())
  for (const v of ['xiaoxiao', 'ava', 'elvira', 'francisca', 'swara']) {
    assert.ok(j.voices.indexOf(v) >= 0, 'missing voice ' + v)
  }
})

test('tts 只接受 POST（GET 端点已取消）', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const res = await call(ctx.routes.get('/dsh-pet/tts'), { method: 'GET', url: '/dsh-pet/tts?text=hi' })
  assert.equal(res.statusCode, 405)
})

test('tts 缺 text 时 400', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const res = await call(ctx.routes.get('/dsh-pet/tts'), {
    method: 'POST',
    url: '/dsh-pet/tts',
    body: '{}',
  })
  assert.equal(res.statusCode, 400)
})

test('chat 只接受 POST', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const res = await call(ctx.routes.get('/dsh-pet/chat'), { method: 'GET', url: '/dsh-pet/chat' })
  assert.equal(res.statusCode, 405)
})

test('chat 连发会被限流（合法请求才计数）', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const handler = ctx.routes.get('/dsh-pet/chat')
  let last
  for (let i = 0; i < 14; i++) {
    last = await call(handler, { method: 'POST', url: '/dsh-pet/chat', body: '{"text":"hi"}' })
  }
  assert.equal(last.statusCode, 429)
})

test('畸形/空请求不占限流额度', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const handler = ctx.routes.get('/dsh-pet/chat')
  for (let i = 0; i < 20; i++) {
    const r = await call(handler, { method: 'POST', url: '/dsh-pet/chat', body: '{"text":""}' })
    assert.equal(r.statusCode, 400)
  }
  // 20 条空 body 之后，第一条真正的请求仍然应该被受理（不是 429）
  const ok = await call(handler, { method: 'POST', url: '/dsh-pet/chat', body: '{"text":"hi"}' })
  assert.notEqual(ok.statusCode, 429)
})

test('assets 不吃路径穿越', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const res = await call(ctx.routes.get('/dsh-pet/assets'), {
    url: '/dsh-pet/assets/..%2F..%2Findex.js',
  })
  assert.equal(res.statusCode, 404)
})

test('外部 Origin 被拒绝（防止任意网页调用）', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const res = await call(ctx.routes.get('/dsh-pet/chat'), {
    method: 'POST',
    url: '/dsh-pet/chat',
    body: '{"text":"hi"}',
    headers: { origin: 'https://evil.example' },
  })
  assert.equal(res.statusCode, 403)
  assert.equal(res.headers['access-control-allow-origin'], undefined)
})

test('tts/status 不泄露本机绝对路径', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const res = await call(ctx.routes.get('/dsh-pet/tts/status'), { url: '/dsh-pet/tts/status' })
  const body = res.body()
  assert.ok(!/Users|home"|python/i.test(body), '不应包含路径字段: ' + body)
})

test('只挂 /dsh-pet 一个前缀（不再占用宿主 /api）', () => {
  const ctx = makeCtx()
  apply(ctx, {})
  for (const p of ['/api/dsh-pet/ping', '/api/dsh-pet/chat']) {
    assert.ok(!ctx.routes.has(p), '不应注册 ' + p)
  }
})

test('Host 与 origin 不同源时拒绝（挡 DNS rebinding）', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const res = await call(ctx.routes.get('/dsh-pet/ping'), {
    url: '/dsh-pet/ping',
    headers: { host: 'evil.example:5908', origin: 'http://evil.example:5908' },
  })
  assert.equal(res.statusCode, 403)
})

test('Host 是陌生域名时拒绝（即便没有 Origin）', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const res = await call(ctx.routes.get('/dsh-pet/ping'), {
    url: '/dsh-pet/ping',
    headers: { host: 'evil.example' },
  })
  assert.equal(res.statusCode, 403)
})

test('回环 Host 正常放行（本机部署）', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  for (const host of ['127.0.0.1:5908', 'localhost:5908', '[::1]:5908']) {
    const res = await call(ctx.routes.get('/dsh-pet/ping'), { url: '/dsh-pet/ping', headers: { host } })
    assert.equal(res.statusCode, 200, host)
  }
})

test('config.allowedHosts 可以放行反代域名', async () => {
  const ctx = makeCtx()
  apply(ctx, { allowedHosts: ['pet.example.com'] })
  const res = await call(ctx.routes.get('/dsh-pet/ping'), {
    url: '/dsh-pet/ping',
    headers: { host: 'pet.example.com:443', origin: 'https://pet.example.com' },
  })
  assert.equal(res.statusCode, 200)
})

test('Sec-Fetch-Site 跨站时拒绝', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const res = await call(ctx.routes.get('/dsh-pet/ping'), {
    url: '/dsh-pet/ping',
    headers: { host: '127.0.0.1:5908', 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(res.statusCode, 403)
})

test('dsh-app 桌面壳的两个 origin 都放行', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  for (const origin of ['dsh-app://app', 'dsh-app://shell']) {
    const res = await call(ctx.routes.get('/dsh-pet/ping'), {
      url: '/dsh-pet/ping',
      headers: { host: '127.0.0.1:5908', origin },
    })
    assert.equal(res.statusCode, 200, origin)
  }
})

test('personaId 走原型链时回落默认人设', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  // 没有 llm 时返回 503，但绝不能因为 __proto__ 抛错或命中 Object.prototype
  const res = await call(ctx.routes.get('/dsh-pet/chat'), {
    method: 'POST',
    url: '/dsh-pet/chat',
    body: '{"text":"hi","personaId":"__proto__"}',
  })
  assert.equal(res.statusCode, 503)
})

test('tts 的 pitch/rate 只接受固定形状', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  // 这两条不该 500：要么 503（合成不可用），要么 200，但绝不能是因为参数怪而崩
  for (const q of ['{"text":"hi","pitch":"<x>"}', '{"text":"hi","rate":"\\u0000"}', '{"text":"hi","pitch":"+999999Hz"}']) {
    const res = await call(ctx.routes.get('/dsh-pet/tts'), { method: 'POST', url: '/dsh-pet/tts', body: q })
    assert.ok([200, 503].indexOf(res.statusCode) >= 0, q + ' -> ' + res.statusCode)
  }
})

test('tts/warm 也有独立限流', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const handler = ctx.routes.get('/dsh-pet/tts/warm')
  let last
  for (let i = 0; i < 8; i++) {
    last = await call(handler, { method: 'POST', url: '/dsh-pet/tts/warm', body: '{"lines":[]}' })
  }
  assert.equal(last.statusCode, 429)
})

test('assets 畸形百分号不抛穿（400 而不是 500 崩溃）', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const res = await call(ctx.routes.get('/dsh-pet/assets'), { url: '/dsh-pet/assets/%zz' })
  assert.equal(res.statusCode, 400)
})

/* ---------- 1.11.0：阶段机（F1）与斜杠命令（F3） ---------- */

test('ping 暴露阶段机字段（初始为 0）', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const res = await call(ctx.routes.get('/dsh-pet/ping'), { url: '/dsh-pet/ping' })
  const j = JSON.parse(res.body())
  assert.equal(j.lastToolAt, 0)
  assert.equal(j.lastToolName, '')
  assert.equal(j.commandSeq, 0)
})

test('tool/result 之后 ping 能拿到工具时间戳与名字', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  ctx.emit('tool/result', { toolName: 'pwsh', ok: true })
  const j = JSON.parse((await call(ctx.routes.get('/dsh-pet/ping'), { url: '/dsh-pet/ping' })).body())
  assert.ok(j.lastToolAt > 0, 'lastToolAt 应该被写')
  assert.equal(j.lastToolName, 'pwsh')
})

test('工具失败同时更新 lastErrorAt', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  ctx.emit('tool/result', { tool: 'bash', ok: false })
  const j = JSON.parse((await call(ctx.routes.get('/dsh-pet/ping'), { url: '/dsh-pet/ping' })).body())
  assert.ok(j.lastErrorAt > 0)
  assert.equal(j.lastToolName, 'bash')
})

test('有 commands 服务时注册 /dsh-pet，并且 commandSeq 递增', async () => {
  const ctx = makeCtx({ commands: true })
  apply(ctx, {})
  assert.equal(ctx.commands.registered.length, 1)
  const def = ctx.commands.registered[0]
  assert.equal(def.name, 'dsh-pet')
  assert.equal(def.handler({ rawInput: ' hide ' }).kind, 'success')
  let j = JSON.parse((await call(ctx.routes.get('/dsh-pet/ping'), { url: '/dsh-pet/ping' })).body())
  assert.equal(j.command, 'hide')
  assert.equal(j.commandSeq, 1)
  def.handler({ rawInput: '' })
  j = JSON.parse((await call(ctx.routes.get('/dsh-pet/ping'), { url: '/dsh-pet/ping' })).body())
  assert.equal(j.command, 'show')
  assert.equal(j.commandSeq, 2)
})

test('未知参数返回 error 而不是执行', async () => {
  const ctx = makeCtx({ commands: true })
  apply(ctx, {})
  const res = ctx.commands.registered[0].handler({ rawInput: 'dance' })
  assert.equal(res.kind, 'error')
  const j = JSON.parse((await call(ctx.routes.get('/dsh-pet/ping'), { url: '/dsh-pet/ping' })).body())
  assert.equal(j.commandSeq, 0)
})

test('没有 commands 服务时不崩（软失败）', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const res = await call(ctx.routes.get('/dsh-pet/ping'), { url: '/dsh-pet/ping' })
  assert.equal(res.statusCode, 200)
})
