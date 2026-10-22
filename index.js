/**
 * dsh-pet 的宿主半边。
 *
 * 只做一件事：在 Web 服务上开一个小接口 POST /dsh-pet/chat，
 * 把用户对宠物说的话，用一次性 LLM 调用（ctx.llm.stream，不建会话、
 * 不进任何 session 日志）换成一两句人话回给浏览器。
 *
 * 为什么不在客户端直接调模型：浏览器没有 LLM 通道；而走会话会把宠物的
 * 闲聊写进主上下文，那是我们明确不想要的。
 */
import Schema from '@deepseek-ai/schemastery'
import { readFile, mkdir, stat, readdir, unlink, rename } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir, homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join, basename, dirname } from 'node:path'

export const name = 'dsh-pet-plugin'
export const inject = ['webServer']

const ASSET_DIR = fileURLToPath(new URL('./assets/', import.meta.url))
const ASSET_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

// —— 神经语音（edge-tts）——
const TTS_WORKER = fileURLToPath(new URL('./tools/tts_worker.py', import.meta.url))
const TTS_CACHE = join(tmpdir(), 'dsh-pet-tts')
const TTS_CACHE_MAX = 60 * 1024 * 1024 // 60MB 上限，超了按最旧删
const TTS_VOICES = {
  xiaoxiao: 'zh-CN-XiaoxiaoNeural',
  xiaoyi: 'zh-CN-XiaoyiNeural',
  xiaomo: 'zh-CN-XiaomoNeural',
  ava: 'en-US-AvaNeural',
  emma: 'en-US-EmmaNeural',
  elvira: 'es-ES-ElviraNeural',
  francisca: 'pt-BR-FranciscaNeural',
  swara: 'hi-IN-SwaraNeural',
}
const TTS_DEFAULT = 'zh-CN-XiaoxiaoNeural'
/** 界面语言 → 默认音色（'auto' 时用这张表） */
const TTS_BY_LANG = {
  zh: 'zh-CN-XiaoxiaoNeural',
  en: 'en-US-AvaNeural',
  es: 'es-ES-ElviraNeural',
  pt: 'pt-BR-FranciscaNeural',
  hi: 'hi-IN-SwaraNeural',
}
/** 语言码 → 提示词里用的语言名 */
const LANG_NAMES = {
  en: 'English',
  es: 'Spanish',
  pt: 'Portuguese',
  hi: 'Hindi',
}

function voiceFor(requested, lang) {
  if (requested && TTS_VOICES[requested]) return TTS_VOICES[requested]
  return TTS_BY_LANG[String(lang || '').slice(0, 2).toLowerCase()] || TTS_DEFAULT
}

/** python 依赖目录：可选增强。有就找，没有就当神经语音不可用（自动退回系统语音）。 */
function resolvePyDir() {
  const cands = []
  if (process.env.DSH_PET_PY_DIR) cands.push(process.env.DSH_PET_PY_DIR)
  for (const c of cands) {
    try {
      if (existsSync(join(c, 'edge_tts'))) return c
    } catch (e) {
      /* ignore */
    }
  }
  return null
}

let pythonPath = null
function resolvePython() {
  if (pythonPath !== null) return pythonPath
  // 1) 显式指定  2) DSH 自带 runtime 的 python（按目录约定找，不写死某台机器）  3) PATH 里的 python
  if (process.env.DSH_PET_PYTHON) {
    pythonPath = process.env.DSH_PET_PYTHON
    return pythonPath
  }
  const found = []
  try {
    const root = join(homedir(), '.dsh', 'dsh-runtimes')
    for (const name of readdirSync(root)) {
      for (const exe of ['python.exe', 'python3', 'python']) {
        const p = join(root, name, 'dependencies', 'python', exe)
        if (existsSync(p)) found.push(p)
      }
    }
  } catch (e) {
    /* 没这个目录就跳过 */
  }
  pythonPath = found[0] || 'python'
  return pythonPath
}

/** 探测「神经语音是否可用」：能 import edge_tts 才算可用。结果缓存。 */
const NEURAL_TTL = 5 * 60 * 1000 // 负结果也要过期：用户之后装了 edge-tts 不该等重启
let neuralProbe = null // null=未探测 / {ok, reason, at}
function probeNeural() {
  if (neuralProbe && Date.now() - neuralProbe.at < NEURAL_TTL) return Promise.resolve(neuralProbe)
  return new Promise((resolve) => {
    const py = resolvePython()
    const code = 'import edge_tts, sys; sys.stdout.write("ok")'
    const child = spawn(py, ['-c', code], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        ...(resolvePyDir() ? { DSH_PET_PY_DIR: resolvePyDir() } : {}),
      },
    })
    let out = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch (e) {
        /* ignore */
      }
      neuralProbe = { ok: false, reason: 'python 未响应', at: Date.now() }
      resolve(neuralProbe)
    }, 8000)
    child.stdout.on('data', (d) => {
      out += d
    })
    child.on('error', () => {
      clearTimeout(timer)
      neuralProbe = { ok: false, reason: '找不到 python', at: Date.now() }
      resolve(neuralProbe)
    })
    child.on('exit', (code2) => {
      clearTimeout(timer)
      if (neuralProbe) return
      neuralProbe =
        code2 === 0 && out.includes('ok')
          ? { ok: true, reason: '', at: Date.now() }
          : { ok: false, reason: '没装 edge-tts（pip install edge-tts）', at: Date.now() }
      resolve(neuralProbe)
    })
  })
}

// —— 常驻 worker：一个 python 进程串行处理所有合成请求 ——
let worker = null
let workerBuf = ''
let workerStderr = '' // 只留最近一段 stderr，排障用，不回给 HTTP 调用方
let workerSeq = 0
let workerQueue = Promise.resolve()
const workerWaiters = new Map()

function killWorker() {
  try {
    if (worker) worker.kill()
  } catch (e) {
    /* ignore */
  }
  worker = null
  workerBuf = ''
  workerStderr = ''
  for (const [, w] of workerWaiters) w.reject(new Error('worker gone'))
  workerWaiters.clear()
}

function ensureWorker() {
  if (worker) return worker
  const py = resolvePython()
  const pyDir = resolvePyDir()
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  if (pyDir) env.DSH_PET_PY_DIR = pyDir
  const child = spawn(py, [TTS_WORKER], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env })
  worker = child
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    workerBuf += chunk
    let idx
    while ((idx = workerBuf.indexOf('\n')) >= 0) {
      const line = workerBuf.slice(0, idx).trim()
      workerBuf = workerBuf.slice(idx + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch (e) {
        continue
      }
      const waiter = workerWaiters.get(msg.id)
      if (!waiter) continue
      workerWaiters.delete(msg.id)
      if (msg.ok) waiter.resolve()
      else waiter.reject(new Error(msg.err || 'tts failed'))
    }
  })
  // stderr 只留最近 20 行给 /tts/status 排查用，不回给 HTTP 调用方
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    workerStderr += chunk
    if (workerStderr.length > 4000) workerStderr = workerStderr.slice(-4000)
  })
  child.on('exit', () => {
    if (worker === child) killWorker()
  })
  child.on('error', () => {
    if (worker === child) killWorker()
  })
  return child
}

function synthViaWorker(text, voice, outFile, pitchHz, ratePct) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = ensureWorker()
    } catch (e) {
      reject(e)
      return
    }
    const id = ++workerSeq
    const timer = setTimeout(() => {
      workerWaiters.delete(id)
      reject(new Error('tts timeout'))
    }, 30000)
    workerWaiters.set(id, {
      resolve: () => {
        clearTimeout(timer)
        resolve()
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      },
    })
    try {
      child.stdin.write(
        JSON.stringify({ id, text, voice, pitch: pitchHz, rate: ratePct, out: outFile }) + '\n',
      )
    } catch (e) {
      clearTimeout(timer)
      workerWaiters.delete(id)
      reject(e)
    }
  })
}

/** 串行队列：worker 是单线程的，前端并发请求也不会互相踩。 */
function synthQueued(text, voice, outFile, pitchHz, ratePct) {
  const run = () => synthViaWorker(text, voice, outFile, pitchHz, ratePct)
  const p = workerQueue.then(run, run)
  workerQueue = p.then(
    () => undefined,
    () => undefined,
  )
  return p
}

/**
 * 把合成结果写到随机临时文件再 rename 到最终名：
 * - 不会跟随缓存目录里预先放好的符号链接（rename 替换的是链接本身）
 * - 半成品也不会被别的请求当成缓存命中
 */
async function synthAtomic(text, voice, file, pitch, rate) {
  const tmp = file + '.' + Math.random().toString(36).slice(2, 10) + '.tmp'
  try {
    await synthOnce(text, voice, tmp, pitch, rate)
    await rename(tmp, file)
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  }
}

let lastTrimAt = 0

/** 合成一句：走常驻 worker（起不来就抛错，由调用方兜底成系统语音）。 */
async function synthOnce(text, voice, outFile, pitchHz, ratePct) {
  await synthQueued(text, voice, outFile, pitchHz, ratePct)
  // 缓存上限必须真的生效：原来只在 apply() 里 trim 一次，之后无限增长。
  // 每 60 秒最多扫一次目录，别把合成路径拖慢。
  const now = Date.now()
  if (now - lastTrimAt > 60000) {
    lastTrimAt = now
    trimCache().catch(() => {})
  }
}

/** 缓存超过上限就按最旧的删。 */
async function trimCache() {
  try {
    const names = await readdir(TTS_CACHE)
    const files = []
    let total = 0
    for (const n of names) {
      if (!n.endsWith('.mp3')) continue
      const p = join(TTS_CACHE, n)
      const st = await stat(p).catch(() => null)
      if (!st) continue
      files.push({ p, size: st.size, at: st.mtimeMs })
      total += st.size
    }
    if (total <= TTS_CACHE_MAX) return
    files.sort((a, b) => a.at - b.at)
    for (const f of files) {
      if (total <= TTS_CACHE_MAX * 0.8) break
      await unlink(f.p).catch(() => {})
      total -= f.size
    }
  } catch (e) {
    /* 目录不存在之类的，忽略 */
  }
}

export const Config = Schema.object({
  provider: Schema.string().default('deepseek-account').description('模型 provider 路由'),
  model: Schema.string().default('deepseek-flash').description('模型名'),
  maxTokens: Schema.number().default(800).description('单次回复上限（越大越啰嗦）'),
  temperature: Schema.number().default(1).description('0-2，越高越活蹦乱跳'),
  allowedHosts: Schema.array(Schema.string()).default([]).description(
    '额外允许的 Host（主机名或 主机名:端口）。把 DSH 放在反向代理/局域网域名下时填这里；' +
      '本机回环地址与宿主自身 origin 永远允许。',
  ),
})

const MAX_BODY = 64 * 1024
const MAX_TEXT = 2000

/**
 * 只挂一个前缀。桌面壳（dsh-app://）走宿主注入的绝对地址 + 白名单 CORS，
 * 不再需要 /api 兜底——那条前缀属于宿主命名空间，容易被别的路由吃掉。
 */
const BASES = ['/dsh-pet']

/**
 * 人设表放在宿主：客户端只允许传 personaId，名字/简介不会由页面拼进 system prompt，
 * 从根上关掉「客户端可控文本 → 模型指令」的注入面。
 */
// 无原型表：__proto__ / constructor / toString 之类不会顺着原型链命中
const PERSONA_INFO = Object.assign(Object.create(null), {
  violet: { name: '薇', tag: '紫发 · 从容的挑逗', tagEn: 'violet-haired, unhurried teasing' },
  crimson: { name: '绯', tag: '红发 · 明目张胆的勾引', tagEn: 'red-haired, shameless flirting' },
  indigo: { name: '靛', tag: '蓝发 · 慢火慢炖地撩', tagEn: 'blue-haired, slow-burn teasing' },
  silver: { name: '雪', tag: '银发 · 冷淡底下的闷骚', tagEn: 'silver-haired, cold outside and warm inside' },
})
const PERSONA_DEFAULT = 'violet'

function personaById(id) {
  const key = String(id || '')
  return Object.prototype.hasOwnProperty.call(PERSONA_INFO, key)
    ? PERSONA_INFO[key]
    : PERSONA_INFO[PERSONA_DEFAULT]
}

function systemPrompt(persona, lang) {
  const name = (persona && persona.name) || 'pet'
  if (lang !== 'zh') {
    const tagEn = (persona && persona.tagEn) || 'a desk pet living inside the DSH window'
    const speak = LANG_NAMES[String(lang || '').slice(0, 2).toLowerCase()] || 'English'
    return [
      `You are "${name}", ${tagEn}. You live in the bottom-right corner of the user's DeepSeek Harness window as a desk pet.`,
      'How you talk:',
      '1. One or two short spoken lines. Casual, like a friend. No markdown, no lists, no essays.',
      '2. You have moods and opinions; you can be playful, sulky or sweet, but never greasy and never repetitive.',
      '3. Never call yourself an AI, a model, an assistant or a program; never explain how you work.',
      '4. If the user asks something real, answer usefully in a sentence or two, without lecturing.',
      '5. If you do not know, say you do not know.',
      `6. Speak ${speak} — that is the interface language the user picked. Only switch if the user writes in another language.`,
    ].join('\n')
  }
  const tag = (persona && persona.tag) || '一只住在 DSH 界面里的桌宠'
  return [
    `你是「${name}」，${tag}。你住在用户的 DeepSeek Harness 界面右下角，是一只桌宠。`,
    '说话规矩：',
    '1. 每次只回一到两句，口语化，像朋友随口说的，不要用 markdown、不要列表、不要长篇。',
    '2. 有自己的脾气和小情绪，可以搞怪、拌嘴、撒娇，但别油腻、别复读。',
    '3. 永远不要自称 AI、模型、助手、程序；也不要解释自己在怎么工作。',
    '4. 用户问正经问题，就用一两句给个有用的话，别端着。',
    '5. 不知道就说不知道，别编。',
  ].join('\n')
}

async function readBody(req) {
  const parts = []
  let bytes = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buf.length
    if (bytes > MAX_BODY) throw new Error('body too large')
    parts.push(buf)
  }
  return Buffer.concat(parts).toString('utf8')
}

export function apply(ctx, config) {
  const cfg = config || {}

  // 卸载标记：warm / trimCache 之类的后台任务都看它，别在插件走了之后继续干活
  let disposed = false
  trimCache().catch(() => {})
  try {
    ctx.effect(() => () => {
      disposed = true
      killWorker()
    })
  } catch (e) {
    /* ignore */
  }

  // 阶段机数据源：工具活动时间与最近一次失败时间；没有事件面时都保持 0，
  // 客户端就会退化成「只有 running / idle」两态。
  let lastErrorAt = 0
  let lastToolAt = 0
  let lastToolName = ''
  // 斜杠命令 → /ping 下发 → 客户端消费（序号递增，避免重复执行）
  let petCommand = ''
  let petCommandSeq = 0
  try {
    if (typeof ctx.on === 'function') {
      ctx.on('tool/result', (payload) => {
        try {
          const at = Date.now()
          lastToolAt = at
          const name =
            (payload && (payload.toolName || payload.tool || payload.name)) || ''
          if (name) lastToolName = String(name).slice(0, 40)
          if (payload && (payload.error || payload.ok === false)) lastErrorAt = at
        } catch (e) {
          /* ignore */
        }
      })
    }
  } catch (e) {
    /* 事件面不可用就跳过 */
  }

  /**
   * 斜杠命令：/dsh-pet 叫出来、/dsh-pet hide 藏起来。
   * commands 是可选服务：老宿主没有就静默跳过（同 slot 的软失败写法）。
   */
  try {
    const commands = typeof ctx.get === 'function' ? ctx.get('commands') : null
    if (commands && typeof commands.register === 'function') {
      ctx.effect(() =>
        commands.register({
          definitionId: 'dsh-pet.toggle',
          name: 'dsh-pet',
          description: '桌宠：叫出来 / hide 藏 1 小时',
          handler: (invocation) => {
            const arg = String((invocation && invocation.rawInput) || '').trim().toLowerCase()
            if (arg === 'hide') {
              petCommand = 'hide'
              petCommandSeq++
              return { kind: 'success', text: '桌宠藏起来了，1 小时后回来。' }
            }
            if (arg && arg !== 'show') {
              return { kind: 'error', text: '用法：/dsh-pet [show|hide]' }
            }
            petCommand = 'show'
            petCommandSeq++
            return { kind: 'success', text: '桌宠叫出来了。' }
          },
        }),
      )
    }
  } catch (e) {
    /* 宿主没有 commands 服务 */
  }

  const reply = (res, code, payload) => {
    const body = JSON.stringify(payload)
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(body)
  }

  /* ---------------- 请求准入（与宿主部署形态无关） ----------------
   * 三道判定，缺省放行非浏览器客户端（curl / 本机脚本）：
   *   1. Host 必须是回环地址、宿主自身 origin，或 config.allowedHosts 里显式登记过
   *      —— 挡住 DNS rebinding（攻击者域名解析到 127.0.0.1，Origin 与 Host 同源也混不过去）
   *   2. Origin 存在时，必须与本次请求的 Host 同源，或是 DSH 桌面壳 dsh-app://app|shell
   *   3. Sec-Fetch-Site 存在时只接受 same-origin / none
   * 不写死端口与域名，所以 127.0.0.1、局域网 IP、反代域名都能用（后者登记 allowedHosts）。
   */
  const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

  const hostOf = (value) => {
    const v = String(value || '')
      .trim()
      .toLowerCase()
    if (!v) return ''
    try {
      return new URL(v.includes('://') ? v : 'http://' + v).host.toLowerCase()
    } catch (e) {
      return v
    }
  }

  const hostAllowed = (req) => {
    const host = hostOf(req.headers && req.headers.host)
    if (!host) return true // HTTP/1.0 之类没有 Host 的客户端，交给 Origin 判定
    let own = ''
    try {
      own = hostOf(ctx.webServer.getOrigin())
    } catch (e) {
      own = ''
    }
    if (own && host === own) return true
    const bare = host.replace(/:\d+$/, '')
    if (LOOPBACK.has(host) || LOOPBACK.has(bare)) return true
    const extra = Array.isArray(cfg.allowedHosts) ? cfg.allowedHosts : []
    for (const raw of extra) {
      const h = hostOf(raw)
      if (h && (h === host || h.replace(/:\d+$/, '') === bare)) return true
    }
    return false
  }

  /** 去掉默认端口，避免 'https://a.com' 与 'a.com:443' 被判成不同源 */
  const normalizeHost = (raw) => {
    let h = hostOf(raw)
    if (!h) return ''
    if (/^[^:]+:443$/.test(h)) h = h.replace(/:443$/, '')
    if (/^[^:]+:80$/.test(h)) h = h.replace(/:80$/, '')
    return h
  }

  const originAllowed = (req, origin) => {
    if (/^dsh-app:\/\/(app|shell)$/i.test(origin)) return true // 桌面壳的两个 origin
    const host = normalizeHost(req.headers && req.headers.host)
    return !!host && normalizeHost(origin) === host
  }

  const fetchSiteAllowed = (req) => {
    const site = String((req.headers && req.headers['sec-fetch-site']) || '').toLowerCase()
    if (!site) return true
    return site === 'same-origin' || site === 'none'
  }

  const applyCors = (req, res) => {
    const reqOrigin = req.headers && req.headers.origin
    const ok = hostAllowed(req) && fetchSiteAllowed(req) && (!reqOrigin || originAllowed(req, reqOrigin))
    if (ok && reqOrigin) {
      res.setHeader('access-control-allow-origin', reqOrigin)
      res.setHeader('access-control-allow-credentials', 'true')
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
      res.setHeader('access-control-allow-headers', 'content-type')
      res.setHeader('vary', 'origin')
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(ok ? 204 : 403)
      res.end()
      return true
    }
    if (!ok) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'forbidden' }))
      return true
    }
    return false
  }

  const pingHandler = (req, res) => {
    if (applyCors(req, res)) return
    let origin = ''
    try {
      origin = ctx.webServer.getOrigin()
    } catch (e) {
      origin = ''
    }
    reply(res, 200, {
      ok: true,
      serverOrigin: origin,
      pageOrigin: (req.headers && req.headers.origin) || null,
      provider: cfg.provider,
      model: cfg.model,
      lastErrorAt,
      // 阶段机（F1）：客户端据此区分「在调工具」与「只是会话在跑」
      lastToolAt,
      lastToolName,
      // 斜杠命令（F3）：序号递增，客户端按序号消费，重复轮询不会重放
      command: petCommand,
      commandSeq: petCommandSeq,
    })
  }

  // 限流：全局 12 次/分钟（防止重试循环烧 token）+ 单客户端 6 次/分钟。
  // 只有「通过了参数校验」的请求才计数，见 chatHandler 的调用顺序。
  const chatHits = []
  const perClient = new Map()
  const clientKey = (req) => {
    try {
      return String((req.socket && req.socket.remoteAddress) || 'unknown')
    } catch (e) {
      return 'unknown'
    }
  }
  const prune = (list, now) => {
    while (list.length && now - list[0] > 60000) list.shift()
  }
  const rateLimited = (key) => {
    const now = Date.now()
    prune(chatHits, now)
    const mine = perClient.get(key) || []
    prune(mine, now)
    perClient.set(key, mine)
    if (chatHits.length >= 12 || mine.length >= 6) return true
    chatHits.push(now)
    mine.push(now)
    if (perClient.size > 200) perClient.clear()
    return false
  }

  const chatHandler = async (req, res) => {
    if (applyCors(req, res)) return

    if (req.method !== 'POST') {
      reply(res, 405, { error: 'method-not-allowed' })
      return
    }

    let payload
    try {
      payload = JSON.parse((await readBody(req)) || '{}')
    } catch (e) {
      reply(res, 400, { error: 'bad-body' })
      return
    }

    const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, MAX_TEXT) : ''
    if (!text) {
      reply(res, 400, { error: 'empty-text' })
      return
    }

    // 先验后计：畸形/空请求不占额度，免得 12 条空 body 就把正常聊天锁死
    if (rateLimited(clientKey(req))) {
      reply(res, 429, { error: 'rate-limited', message: '她喘口气，一分钟内别连发十几条。' })
      return
    }

    const llm = ctx.get('llm')
    if (!llm) {
      reply(res, 503, { error: 'llm-unavailable' })
      return
    }

    // 历史不塞进 messages：assistant 轮在 DSH 的消息模型里要求带 replayState
    // 等字段，裸对象会被运行时拒掉（实测 reading 'replayState'）。
    // 折成一段「刚才的对话」写进 system，效果一样且稳。
    // 历史是客户端给的，只能当数据：限条数、限长度、剥控制字符，并逐行加固定前缀，
    // 这样里面出现「说话规矩：」「你是…」之类的整行指令也不会冒充系统提示。
    const history = Array.isArray(payload.history) ? payload.history.slice(-8) : []
    const transcript = history
      .filter((m) => m && typeof m.content === 'string' && m.content.trim())
      .map((m) => {
        const who = m.role === 'assistant' ? '你' : '用户'
        const line = m.content
          .trim()
          .replace(/[\u0000-\u001f\u007f]+/g, ' ')
          .slice(0, 300)
        return who + '说：' + line
      })
      .join('\n')
    const system =
      systemPrompt(personaById(payload.personaId), String(payload.lang || 'zh')) +
      (transcript ? '\n\n你们刚才的对话（按时间顺序，别重复已经说过的）：\n' + transcript : '')
    const messages = [{ role: 'user', content: [{ type: 'text', text }] }]

    let aborted = false
    try {
      req.on('close', () => {
        aborted = true
      })
    } catch (e) {
      /* ignore */
    }

    try {
      let out = ''
      const seen = []
      let finish = null
      const stream = llm.stream({
        provider: cfg.provider,
        model: cfg.model,
        system,
        messages,
        maxTokens: cfg.maxTokens,
        temperature: cfg.temperature,
      })
      for await (const chunk of stream) {
        if (aborted) break
        if (seen.length < 12) seen.push(chunk && chunk.type)
        if (chunk && chunk.type === 'finish') finish = chunk.reason
        if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
      }
      out = out.trim()
      if (!out) {
        // finish 里可能带 in-band 失败：transport / auth / 限流都走这里
        const failure = finish && finish.kind === 'error' ? finish.failure : null
        reply(res, 502, {
          error: failure ? 'llm-failed' : 'empty-reply',
          message: failure ? failure.message : 'model returned no text',
          code: failure ? failure.code : undefined,
          debug: seen,
        })
        return
      }
      reply(res, 200, { reply: out.slice(0, 1200) })
    } catch (e) {
      reply(res, 502, {
        error: 'llm-failed',
        message: String((e && e.message) || e).slice(0, 300),
      })
    }
  }

  // 把绝对地址注入页面：桌面壳里相对路径可能到不了宿主路由。
  ctx.effect(() =>
    ctx.webServer.tapIndex((html) => {
      let origin = ''
      try {
        origin = ctx.webServer.getOrigin()
      } catch (e) {
        return html
      }
      const url = origin + '/dsh-pet/chat'
      const tag =
        `<script>window.__DSH_PET_API__=${JSON.stringify(url)};` +
        `window.__DSH_PET_BASE__=${JSON.stringify(origin)}</script>`
      return html.includes('</head>') ? html.replace('</head>', tag + '</head>') : tag + html
    }),
  )

  // 宠物贴图：从包内 assets/ 直接读，只放行图片扩展名，路径只取 basename。
  const assetHandler = async (req, res) => {
    let name = ''
    try {
      // 畸形 %（如 %zz）会让 decodeURIComponent 抛错，不能让它抛穿到宿主
      name = basename(decodeURIComponent((req.url || '').split('?')[0] || ''))
    } catch (e) {
      res.writeHead(400, { 'x-content-type-options': 'nosniff' })
      res.end()
      return
    }
    const dot = name.lastIndexOf('.')
    const ext = dot >= 0 ? name.slice(dot).toLowerCase() : ''
    if (!ext || !ASSET_TYPES[ext]) {
      res.writeHead(404, { 'x-content-type-options': 'nosniff' })
      res.end()
      return
    }
    try {
      const buf = await readFile(join(ASSET_DIR, name))
      res.writeHead(200, {
        'content-type': ASSET_TYPES[ext],
        'x-content-type-options': 'nosniff',
        'cache-control': 'public, max-age=3600',
      })
      res.end(buf)
    } catch (e) {
      res.writeHead(404, { 'x-content-type-options': 'nosniff' })
      res.end()
    }
  }

  // —— 神经语音：GET /tts?text=&voice=&pitch=&rate= 返回 mp3（带磁盘缓存）——
  // —— 神经语音可用性探测：客户端据此决定用神经音色还是系统语音 ——
  const ttsStatusHandler = async (req, res) => {
    if (applyCors(req, res)) return
    const st = await probeNeural()
    reply(res, 200, {
      available: st.ok,
      reason: st.reason,
      voices: Object.keys(TTS_VOICES),
      // 不返回 python / home 之类的绝对路径：接口即便是本机，也会被页面读到
    })
  }

  // 合成是有副作用的 GET（会写盘）：也限一下，别让同源页面刷缓存
  const ttsHits = []
  const ttsLimited = () => {
    const now = Date.now()
    while (ttsHits.length && now - ttsHits[0] > 60000) ttsHits.shift()
    if (ttsHits.length >= 30) return true
    ttsHits.push(now)
    return false
  }

  // pitch / rate 会进 SSML 和缓存键：只接受固定形状，别的值一律回默认
  const PITCH_RE = /^[+-]\d{1,3}Hz$/
  const RATE_RE = /^[+-]\d{1,3}%$/
  const pitchOf = (v) => (PITCH_RE.test(String(v || '')) ? String(v) : '+0Hz')
  const rateOf = (v) => (RATE_RE.test(String(v || '')) ? String(v) : '+0%')

  /** 缓存键用 JSON 序列化，避免 '|' 拼接造成的键歧义 */
  const ttsKey = (voice, pitch, rate, text) =>
    createHash('sha1').update(JSON.stringify([voice, pitch, rate, text])).digest('hex').slice(0, 20)

  // 只接受 POST：GET 版本会让任意网页（甚至本机任意进程）用一句 <audio src> 就驱动合成。
  // 客户端改为 fetch 拿 blob 再 createObjectURL，所以不再需要可被直接当作 URL 的端点。
  const ttsHandler = async (req, res) => {
    if (applyCors(req, res)) return
    if (req.method !== 'POST') {
      reply(res, 405, { error: 'method-not-allowed' })
      return
    }
    let payload = {}
    try {
      payload = JSON.parse((await readBody(req)) || '{}')
    } catch (e) {
      payload = {}
    }
    if (ttsLimited()) {
      reply(res, 429, { error: 'rate-limited' })
      return
    }
    const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, 300) : ''
    const voice = voiceFor(payload.voice, payload.lang)
    const pitch = pitchOf(payload.pitch)
    const rate = rateOf(payload.rate)
    if (!text) {
      reply(res, 400, { error: 'empty-text' })
      return
    }
    const file = join(TTS_CACHE, ttsKey(voice, pitch, rate, text) + '.mp3')
    try {
      await stat(file)
    } catch (e) {
      try {
        // mode 0o700：缓存目录只有本用户能进（POSIX；Windows 忽略）
        await mkdir(TTS_CACHE, { recursive: true, mode: 0o700 })
        await synthAtomic(text, voice, file, pitch, rate)
      } catch (err) {
        // 错误详情只写宿主日志：worker 的 OSError 里带绝对路径，不能回给页面
        try {
          console.error('[dsh-pet] tts failed:', (err && err.message) || err)
        } catch (e2) {
          /* ignore */
        }
        reply(res, 503, { error: 'tts-failed' })
        return
      }
    }
    try {
      const buf = await readFile(file)
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' })
      res.end(buf)
    } catch (e) {
      res.writeHead(500)
      res.end()
    }
  }

  // —— 预热：POST /tts/warm {voice, pitch, rate, lines:[...]}，后台串行补缓存 ——
  // 单飞：同一时刻只允许一条预热在跑；限流比 /tts 更严（6 次/分钟）。
  let warming = false
  const warmHits = []
  const warmLimited = () => {
    const now = Date.now()
    while (warmHits.length && now - warmHits[0] > 60000) warmHits.shift()
    if (warmHits.length >= 6) return true
    warmHits.push(now)
    return false
  }

  const warmHandler = async (req, res) => {
    if (applyCors(req, res)) return
    if (warmLimited() || warming) {
      reply(res, 429, { error: 'rate-limited' })
      return
    }
    let payload = {}
    try {
      payload = JSON.parse((await readBody(req)) || '{}')
    } catch (e) {
      payload = {}
    }
    const voice = voiceFor(payload.voice, payload.lang)
    const pitch = pitchOf(payload.pitch)
    const rate = rateOf(payload.rate)
    const lines = Array.isArray(payload.lines) ? payload.lines.slice(0, 30) : []
    warming = true
    res.writeHead(202, { 'content-type': 'application/json; charset=utf-8' })
    res.end('{"ok":true}')
    ;(async () => {
      try {
        await mkdir(TTS_CACHE, { recursive: true, mode: 0o700 })
      } catch (e) {
        warming = false
        return
      }
      try {
        for (const raw of lines) {
          if (disposed) return
          const text = String(raw || '').trim().slice(0, 300)
          if (!text) continue
          const file = join(TTS_CACHE, ttsKey(voice, pitch, rate, text) + '.mp3')
          try {
            await stat(file)
            continue
          } catch (e) {
            /* 需要合成 */
          }
          try {
            await synthAtomic(text, voice, file, pitch, rate)
          } catch (e) {
            /* 单条失败不影响其它 */
          }
        }
      } finally {
        warming = false
      }
    })()
  }

  for (const base of BASES) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: base + '/ping', handler: pingHandler }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: base + '/chat', handler: chatHandler }))
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: base + '/assets', handler: assetHandler }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: base + '/tts', handler: ttsHandler }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: base + '/tts/status', handler: ttsStatusHandler }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: base + '/tts/warm', handler: warmHandler }))
  }
}
