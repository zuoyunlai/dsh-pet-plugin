/**
 * 神经语音（edge-tts）子系统：worker 管理、合成、缓存裁剪。
 *
 * 从 index.js 拆出来（1.18.0）。这一块不碰 ctx/webServer，只依赖 Node 内置
 * 模块和一个 python 子进程，所以可以独立测试与替换。
 */
import { readFile, mkdir, stat, readdir, unlink, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
// —— 神经语音（edge-tts）——
// 本文件在 lib/ 下，worker 在包根的 tools/，所以要上一级
export const TTS_WORKER = fileURLToPath(new URL('../tools/tts_worker.py', import.meta.url))
export const TTS_CACHE = join(tmpdir(), 'dsh-pet-tts')
const TTS_CACHE_MAX = 60 * 1024 * 1024 // 60MB 上限，超了按最旧删
export const TTS_VOICES = {
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
export const LANG_NAMES = {
  en: 'English',
  es: 'Spanish',
  pt: 'Portuguese',
  hi: 'Hindi',
}

export function voiceFor(requested, lang) {
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
export function probeNeural() {
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

export function killWorker() {
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
export async function synthAtomic(text, voice, file, pitch, rate) {
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
export async function trimCache() {
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
