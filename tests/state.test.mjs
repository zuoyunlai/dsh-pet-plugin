/**
 * 跨设备状态（P0-1）与 pack 准入（P1-2）的回归测试。
 *
 * 为什么单独一个文件：2026-10-29 审计里最贵的两条缺陷都落在这里——
 *   - `/state` 的 history 被 String() 成 "[object Object]"，且宿主旧快照覆盖本地新设置；
 *   - 合法但缺字段的自定义 pack 能过闸，在渲染期抛 TypeError 把整个 overlay 打白。
 * 这两条都不是「能渲染」能证明的，必须直接对数据往返与形状校验断言。
 *
 * 宿主半边用假 ctx/req/res（同 host.test.mjs 的做法，不启动 DSH）；
 * 客户端半边用 tests/harness.mjs 的可控浏览器（虚拟时钟 + 可编程 fetch）。
 */
import test from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply, STATE_SETTING_KEYS } from '../index.js'
import { validatePackShape } from '../lib/registry.js'
import { killWorker } from '../lib/tts.js'
import { makeEnv } from './harness.mjs'

test.after(() => killWorker())

/* ---------------- 宿主侧台架（复制 host.test.mjs 的最小实现） ---------------- */

function makeCtx() {
  const routes = new Map()
  const listeners = new Map()
  return {
    routes,
    webServer: {
      register({ path, handler }) {
        routes.set(path, handler)
        return () => routes.delete(path)
      },
      tapIndex() {
        return () => {}
      },
      getOrigin() {
        return 'http://127.0.0.1:5908'
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
    get() {
      return undefined
    },
  }
}

function call(handler, { method = 'GET', url = '/', body = '', headers = {} } = {}) {
  const req = {
    method,
    url,
    headers,
    readableAborted: false,
    destroyed: false,
    socket: { remoteAddress: '127.0.0.1' },
    on(ev) {
      void ev
      return req
    },
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
  return Promise.resolve(handler(req, res)).then(() => res)
}

/** 每个用例一个独立 DSH_HOME：state.json / pets/ 都落在里面 */
function freshHome() {
  const home = mkdtempSync(join(tmpdir(), 'dshpet-state-'))
  process.env.DSH_HOME = home
  return home
}

const wait = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms))

function boot() {
  const ctx = makeCtx()
  apply(ctx, {})
  return ctx
}

/* ---------------- P0-1：宿主 /state ---------------- */

test('P0-1：history 以 {role, content} 对象往返，不再变成 "[object Object]"', async () => {
  const home = freshHome()
  const ctx = boot()
  const history = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: '嗯？' },
  ]
  const post = await call(ctx.routes.get('/dsh-pet/state'), {
    method: 'POST',
    body: JSON.stringify({ settings: { volume: 0.6, mode: 'always' }, history, updatedAt: 1000 }),
  })
  assert.equal(post.statusCode, 200)
  const got = JSON.parse((await call(ctx.routes.get('/dsh-pet/state'))).body()).state
  assert.deepEqual(got.history, history)
  const disk = JSON.parse(readFileSync(join(home, 'dsh-pet', 'state.json'), 'utf8'))
  assert.deepEqual(disk.history, history, '落盘也必须还是对象，不能再被 String()')
  assert.equal(disk.updatedAt, 1000)
  assert.equal(disk.settings.volume, 0.6)
})

test('P0-1：旧格式（"[object Object]" 字符串）读取时被丢弃，不会回给客户端', async () => {
  freshHome()
  const dir = join(process.env.DSH_HOME, 'dsh-pet')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify({
      settings: { volume: 0.3 },
      history: ['[object Object]', '[object Object]'],
      updatedAt: 0,
    }),
    'utf8',
  )
  const ctx = boot()
  const got = JSON.parse((await call(ctx.routes.get('/dsh-pet/state'))).body()).state
  assert.deepEqual(got.history, [], '坏历史必须被当成空，而不是原样回传')
})

test('P0-1：新者胜——宿主比这次保存更新时回 stale，且不覆盖', async () => {
  freshHome()
  const ctx = boot()
  const handler = ctx.routes.get('/dsh-pet/state')
  await call(handler, { method: 'POST', body: JSON.stringify({ settings: { volume: 0.9 }, updatedAt: 2000 }) })
  const stale = await call(handler, {
    method: 'POST',
    body: JSON.stringify({ settings: { volume: 0.1 }, updatedAt: 1000 }),
  })
  const j = JSON.parse(stale.body())
  assert.equal(j.stale, true)
  assert.equal(j.state.settings.volume, 0.9)
  const got = JSON.parse((await call(handler)).body()).state
  assert.equal(got.settings.volume, 0.9, '旧时间戳的写入不能覆盖宿主里更新的那份')
})

test('P0-1：settings 走白名单（未知键 / 超长字符串被丢弃）', async () => {
  freshHome()
  const ctx = boot()
  await call(ctx.routes.get('/dsh-pet/state'), {
    method: 'POST',
    body: JSON.stringify({
      settings: { volume: 0.5, mode: 'always', pos: { x: 12, y: 34 }, evil: 'x'.repeat(500) },
      updatedAt: 1000,
    }),
  })
  const got = JSON.parse((await call(ctx.routes.get('/dsh-pet/state'))).body()).state
  assert.equal(got.settings.volume, 0.5)
  assert.equal(got.settings.mode, 'always')
  assert.deepEqual(got.settings.pos, { x: 12, y: 34 })
  assert.equal(got.settings.evil, undefined, '白名单外的键不能落盘')
})

test('P0-1：畸形输入不占 /state 的限流额度（先验后计）', async () => {
  freshHome()
  const ctx = boot()
  const handler = ctx.routes.get('/dsh-pet/state')
  for (let i = 0; i < 70; i++) {
    const r = await call(handler, { method: 'POST', body: '{}' })
    assert.equal(r.statusCode, 400)
  }
  const ok = await call(handler, { method: 'POST', body: JSON.stringify({ settings: { volume: 0.4 } }) })
  assert.equal(ok.statusCode, 200, '70 条空 body 之后，合法请求仍应被受理')
})

test('P0-1：state.json 是 0600、目录是 0700（POSIX）', async (t) => {
  if (process.platform === 'win32') return t.skip('Windows 没有 POSIX mode')
  const home = freshHome()
  const ctx = boot()
  await call(ctx.routes.get('/dsh-pet/state'), {
    method: 'POST',
    body: JSON.stringify({ settings: { volume: 0.5 }, updatedAt: 1 }),
  })
  const dirMode = statSync(join(home, 'dsh-pet')).mode & 0o777
  const fileMode = statSync(join(home, 'dsh-pet', 'state.json')).mode & 0o777
  assert.equal(dirMode, 0o700, '目录应只有本用户可进')
  assert.equal(fileMode, 0o600, '状态文件应只有本用户可读写')
})

test('P0-1：STATE_SETTING_KEYS 与客户端 DEFAULT_SETTINGS 对账', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/40-settings.js', import.meta.url)), 'utf8')
  const start = src.indexOf('const DEFAULT_SETTINGS = {')
  assert.ok(start > 0, '找不到 DEFAULT_SETTINGS')
  const block = src.slice(start, src.indexOf('\n    }', start))
  const clientKeys = Array.from(block.matchAll(/^\s+([A-Za-z_$][\w$]*)\s*:/gm)).map((m) => m[1])
  assert.deepEqual(
    [...STATE_SETTING_KEYS].sort(),
    [...clientKeys].sort(),
    '两端设置键必须一致：加设置项要同步 index.js 的 STATE_SETTING_KEYS',
  )
})

/* ---------------- P1-4：/pets 的只读资产闸 ---------------- */

const VALID_USER_PACK = {
  id: 'testpet',
  name: 'Test Pet',
  image: 'art.png',
  clips: { dance: 'clip.webm' },
  voice: { pitch: 1, rate: 1 },
  temper: { idle: 3, happy: 2 },
}

async function withUserPack() {
  const home = freshHome()
  const dir = join(home, 'dsh-pet', 'pets', 'testpet')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'pack.json'), JSON.stringify(VALID_USER_PACK), 'utf8')
  writeFileSync(join(dir, 'art.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
  writeFileSync(join(dir, 'clip.webm'), Buffer.alloc(64, 1))
  const ctx = boot()
  // 注册表扫描是异步的：等到 /personas 能看见它
  for (let i = 0; i < 20; i++) {
    await wait(20)
    const j = JSON.parse((await call(ctx.routes.get('/dsh-pet/personas'))).body())
    if (j.personas.some((p) => p.id === 'testpet')) return { ctx, home }
  }
  throw new Error('用户 pack 没有被扫描到：' + JSON.stringify(VALID_USER_PACK))
}

test('P1-4：/pets 只读资产不强制 Sec-Fetch-Site（桌面壳 <img> 的 cross-site 不再 403）', async () => {
  const { ctx } = await withUserPack()
  const res = await call(ctx.routes.get('/dsh-pet/pets'), {
    url: '/dsh-pet/pets/testpet/art.png',
    headers: { host: '127.0.0.1:5908', origin: 'dsh-app://app', 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(res.statusCode, 200, '用户 pack 的图片必须和内置 /assets 同一准入策略')
  assert.match(String(res.headers['content-type']), /image\/png/)
})

test('P1-4：/assets 也只读闸——跨站 + 桌面壳 origin 放行（与 /pets 统一）', async () => {
  freshHome()
  const ctx = boot()
  const res = await call(ctx.routes.get('/dsh-pet/assets'), {
    url: '/dsh-pet/assets/pet-violet-dance.webm',
    headers: { host: '127.0.0.1:5908', origin: 'dsh-app://app', 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(res.statusCode, 200)
})

test('P1-4：/pets 仍然挡住目录穿越、未注册 id 与非白名单扩展名', async () => {
  const { ctx } = await withUserPack()
  const handler = ctx.routes.get('/dsh-pet/pets')
  for (const url of [
    '/dsh-pet/pets/testpet/..%2F..%2Fstate.json',
    '/dsh-pet/pets/nope/art.png',
    '/dsh-pet/pets/testpet/evil.js',
  ]) {
    const res = await call(handler, { url })
    assert.equal(res.statusCode, 404, url)
  }
})

test('P1-4：变更类端点仍然要求 Sec-Fetch-Site（闸没有被一起放松）', async () => {
  freshHome()
  const ctx = boot()
  const res = await call(ctx.routes.get('/dsh-pet/announce'), {
    method: 'POST',
    url: '/dsh-pet/announce',
    body: '{"text":"hi"}',
    headers: { host: '127.0.0.1:5908', 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(res.statusCode, 403)
})

test('P3-6：/announce 的畸形请求不占限流额度', async () => {
  freshHome()
  const ctx = boot()
  const handler = ctx.routes.get('/dsh-pet/announce')
  for (let i = 0; i < 40; i++) {
    const r = await call(handler, { method: 'POST', body: '{}' })
    assert.equal(r.statusCode, 400)
  }
  const ok = await call(handler, { method: 'POST', body: '{"text":"hello"}' })
  assert.equal(ok.statusCode, 200)
})

/* ---------------- P1-2：pack 形状校验对齐渲染契约 ---------------- */

test('P1-2：只有 images.idle、没有 colors 的包被拒载（否则 SVG 分支 TypeError）', () => {
  const r = validatePackShape(
    { id: 'x', name: 'X', clips: { dance: 'a.webm' }, images: { idle: 'a.png' } },
    'x',
  )
  assert.equal(r.ok, false)
  assert.match(r.reason, /colors/)
})

test('P1-2：voice 缺 pitch / rate（或不是有限数）被拒载', () => {
  const base = { id: 'x', name: 'X', clips: { dance: 'a.webm' }, image: 'a.png' }
  assert.equal(validatePackShape({ ...base, voice: {} }, 'x').ok, false)
  assert.equal(validatePackShape({ ...base, voice: { pitch: 'high', rate: 1 } }, 'x').ok, false)
  assert.equal(validatePackShape({ ...base, voice: { pitch: 1, rate: 1 } }, 'x').ok, true)
})

test('P1-2：temper 必须是「心情 → 正数」', () => {
  const base = { id: 'x', name: 'X', clips: { dance: 'a.webm' }, image: 'a.png' }
  assert.equal(validatePackShape({ ...base, temper: { idle: 0 } }, 'x').ok, false)
  assert.equal(validatePackShape({ ...base, temper: { idle: '3' } }, 'x').ok, false)
  assert.equal(validatePackShape({ ...base, temper: { idle: 3 } }, 'x').ok, true)
})

test('P1-2：合法贴图包通过，并补默认 tag', () => {
  const r = validatePackShape(VALID_USER_PACK, 'testpet')
  assert.equal(r.ok, true)
  assert.equal(r.pack.tag, '')
  assert.equal(r.pack.tagEn, '')
})

test('P1-2：内置五只的 pack.json 全部仍通过校验（收口不能误伤自家素材）', async () => {
  const root = fileURLToPath(new URL('../pets/', import.meta.url))
  for (const id of ['violet', 'crimson', 'indigo', 'silver', 'azure']) {
    const pack = JSON.parse(readFileSync(join(root, id, 'pack.json'), 'utf8'))
    const r = validatePackShape(pack, id)
    assert.equal(r.ok, true, `${id}: ${r.reason}`)
  }
})

test('P1-2（客户端）：setPersonas 跳过坏条目，而不是整表替换', () => {
  const env = makeEnv()
  const ok = env.api.setPersonas([
    { id: 'good', name: 'G', clips: { dance: 'a.webm' }, image: 'a.png' },
    { id: 'bad', name: 'B', clips: { dance: 'b.webm' } },
  ])
  assert.equal(ok, true)
  assert.ok(env.api.PERSONAS.good, '合法条目应进表')
  assert.equal(env.api.PERSONAS.bad, undefined, '缺 colors/image 的条目应被跳过')
})

test('P1-2（客户端）：坏 pack 直接进渲染层也不抛（colors/voice 兜底）', () => {
  const env = makeEnv()
  const bad = { id: 'bad', name: 'B', clips: { dance: 'b.webm' } }
  const tree = env.api.PetArt({ persona: bad, mood: 'idle' })
  assert.ok(tree, '没有 colors 也要能画（回落安全色），不能抛 TypeError')
  // voice 缺失时 voiceParams 也要给可用的基座值（设置面板会读它）
  env.api.PERSONAS.bad = bad
  env.api.runtime.settings.persona = 'bad'
  const v = env.api.voiceParams('idle')
  assert.equal(v.pitch, 1)
  assert.equal(v.rate, 1)
})

/* ---------------- §11.1（审计标注未证实）：useSession 缺失时的兜底 ---------------- */

test('§11.1：宿主没传 useSession 时，用 hostPhase 边沿推导「一轮在跑」', () => {
  const env = makeEnv()
  assert.equal(env.api.runtime.sessionHookSeen, false, '未挂 PetToggle 时应处于兜底路径')
  env.api.runtime.settings.turnNotify = false

  env.api.runtime.hostPhase = 'working'
  env.api.tick()
  assert.equal(env.api.runtime.running, true, 'working 边沿应把 running 推上去')

  env.api.runtime.hostPhase = 'idle'
  env.api.tick()
  assert.equal(env.api.runtime.running, false, '回到 idle 应把这一轮收尾')
  assert.ok(env.api.runtime.doneUntil > 0, '收尾应点亮 done 窗口（庆祝/表情）')
})

/* ---------------- 客户端 P0-1：updatedAt 新者胜 ---------------- */

const flush = async (env, n = 40) => {
  for (let i = 0; i < n; i++) {
    await Promise.resolve()
    env.advance(1)
  }
}

function stateFetch(hostState, extra) {
  return async (url, init) => {
    const u = String(url)
    if (u.indexOf('/dsh-pet/personas') >= 0) {
      return { ok: true, status: 200, json: async () => ({ ok: true, personas: [] }) }
    }
    if (u.indexOf('/dsh-pet/state') >= 0) {
      if (init && init.method === 'POST') {
        return { ok: true, status: 200, json: async () => (extra && extra.postReply) || { ok: true } }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, state: hostState }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }
}

test('P0-1（客户端）：宿主旧快照不能覆盖本地更新的设置', async () => {
  const env = makeEnv({
    storage: {
      'dsh-pet.settings.v1': JSON.stringify({ volume: 0.9, scale: 1.4 }),
      'dsh-pet.stateAt.v1': '9999',
    },
    fetchHandler: stateFetch({ settings: { volume: 0.2, scale: 1 }, history: [], updatedAt: 0 }),
  })
  await flush(env)
  assert.equal(env.api.runtime.settings.volume, 0.9, '本地更新的音量不能被宿主旧快照打回去')
  assert.equal(env.api.runtime.settings.scale, 1.4)
  assert.ok(
    env.fetchLog.some((x) => x.url.indexOf('/dsh-pet/state') >= 0 && x.method === 'POST'),
    '本地更新时必须把状态回传宿主',
  )
})

test('P0-1（客户端）：宿主更新时采纳（换设备恢复）', async () => {
  const env = makeEnv({
    storage: {
      'dsh-pet.settings.v1': JSON.stringify({ volume: 0.1 }),
      'dsh-pet.stateAt.v1': '1000',
      'dsh-pet.history.v1': JSON.stringify([{ role: 'user', content: 'LOCAL' }]),
    },
    fetchHandler: stateFetch({
      settings: { volume: 0.8 },
      history: [{ role: 'user', content: 'REMOTE' }],
      updatedAt: 5000,
    }),
  })
  await flush(env)
  assert.equal(env.api.runtime.settings.volume, 0.8)
  assert.equal(env.api.runtime.history[0].content, 'REMOTE')
})

test('P0-1（客户端）：宿主坏 history（[object Object]）不污染本地历史', async () => {
  const env = makeEnv({
    storage: {
      'dsh-pet.settings.v1': JSON.stringify({ volume: 0.5 }),
      'dsh-pet.stateAt.v1': '9999',
      'dsh-pet.history.v1': JSON.stringify([{ role: 'user', content: 'LOCAL' }]),
    },
    fetchHandler: stateFetch({
      settings: { volume: 0.5 },
      history: ['[object Object]', '[object Object]'],
      updatedAt: 0,
    }),
  })
  await flush(env)
  assert.equal(env.api.runtime.history.length, 1)
  assert.equal(env.api.runtime.history[0].content, 'LOCAL')
  const stored = env.storage.get('dsh-pet.history.v1')
  assert.ok(stored && stored.indexOf('[object Object]') < 0, '不得把损坏数据写回 localStorage')
})
