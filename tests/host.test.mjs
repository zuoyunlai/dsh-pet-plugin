/**
 * 宿主路由的最小单测（node --test tests/host.test.mjs）。
 * 用假的 ctx/req/res，不启动 DSH。
 */
import test from 'node:test'
import assert from 'node:assert'
import { apply } from '../index.js'

function makeCtx() {
  const routes = new Map()
  return {
    routes,
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
    on() {
      return () => {}
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
  }
  const chunks = []
  const res = {
    statusCode: 0,
    headers: {},
    writeHead(code, hdrs) {
      this.statusCode = code
      this.headers = hdrs || {}
      return this
    },
    end(buf) {
      if (buf) chunks.push(Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf)))
    },
    body() {
      return Buffer.concat(chunks).toString('utf8')
    },
  }
  return handler(req, res).then(() => res)
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

test('tts 缺 text 时 400', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const res = await call(ctx.routes.get('/dsh-pet/tts'), { url: '/dsh-pet/tts' })
  assert.equal(res.statusCode, 400)
})

test('chat 只接受 POST', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const res = await call(ctx.routes.get('/dsh-pet/chat'), { method: 'GET', url: '/dsh-pet/chat' })
  assert.equal(res.statusCode, 405)
})

test('chat 连发会被限流', async () => {
  const ctx = makeCtx()
  apply(ctx, {})
  const handler = ctx.routes.get('/dsh-pet/chat')
  let last
  for (let i = 0; i < 14; i++) {
    last = await call(handler, { method: 'POST', url: '/dsh-pet/chat', body: '{"text":""}' })
  }
  assert.equal(last.statusCode, 429)
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
