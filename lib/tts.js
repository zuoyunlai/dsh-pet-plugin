/**
 * 神经语音（edge-tts）子系统：worker 管理、合成、缓存裁剪。
 *
 * 从 index.js 拆出来（1.18.0）。这一块不碰 ctx/webServer，只依赖 Node 内置
 * 模块和一个 python 子进程，所以可以独立测试与替换。
 */
import { readFile, mkdir, stat, readdir, unlink, rename } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir, homedir } from 'node:os'
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
  xiaomo: 'zh-CN-YunxiNeural',
  hsiaochen: 'zh-TW-HsiaoChenNeural',
  xiaobei: 'zh-CN-liaoning-XiaobeiNeural',
  xiaoni: 'zh-CN-shaanxi-XiaoniNeural',
  ava: 'en-US-AvaNeural',
  emma: 'en-US-EmmaNeural',
  jenny: 'en-US-JennyNeural',
  aria: 'en-US-AriaNeural',
  michelle: 'en-US-MichelleNeural',
  sonia: 'en-GB-SoniaNeural',
  natasha: 'en-AU-NatashaNeural',
  neerja: 'en-IN-NeerjaNeural',
  elvira: 'es-ES-ElviraNeural',
  dalia: 'es-MX-DaliaNeural',
  elena: 'es-AR-ElenaNeural',
  salome: 'es-CO-SalomeNeural',
  camila: 'es-PE-CamilaNeural',
  francisca: 'pt-BR-FranciscaNeural',
  thalita: 'pt-BR-ThalitaMultilingualNeural',
  raquel: 'pt-PT-RaquelNeural',
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
/** 选 python：显式 env > DSH 内置 runtime > PATH（导出给测试断言「别落回 PATH」）。 */
export function resolvePython() {
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
let neuralProbe = null // null=未探测 / {ok, reason, py, at}
let neuralPending = null // 正在飞的探测：并发调用共享，避免第二个调用永远等不到结果

/**
 * 候选解释器顺序：先机器上算出来的那个，再 env，再 PATH 上的三个名字。
 * 去重且保序。本机实测过两台 python（3.14 装了 edge-tts、3.15-32 没装），
 * 只试一个名字会误判「没装」——所以这里枚举出来（也方便单测）。
 */
export function pythonCandidates(first, env) {
  const out = []
  const e = env || process.env
  for (const c of [first, e.DSH_PET_PYTHON, 'python', 'python3', 'py']) {
    if (c && out.indexOf(c) < 0) out.push(c)
  }
  return out
}

/** 探测一个解释器能不能 import edge_tts。成功返回 true，并把 resolvePython 钉到它。 */
function probePython(py) {
  return new Promise((resolve) => {
    const code = 'import edge_tts, sys; sys.stdout.write("ok")'
    let child = null
    try {
      child = spawn(py, ['-c', code], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          ...(resolvePyDir() ? { DSH_PET_PY_DIR: resolvePyDir() } : {}),
        },
      })
    } catch (e) {
      resolve(false)
      return
    }
    let out = ''
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      resolve(ok)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch (e) {
        /* ignore */
      }
      finish(false)
    }, 8000)
    child.stdout.on('data', (d) => {
      out += d
    })
    child.on('error', () => {
      clearTimeout(timer)
      finish(false)
    })
    // 用 'close' 而不是 'exit'：'exit' 可能在 stdout 的数据到达父进程之前触发，
    // 那样明明 import 成功也会被判成「没装 edge-tts」（1.19.3 实测到过这种假阴性）。
    child.on('close', (code2) => {
      clearTimeout(timer)
      finish(code2 === 0 && out.includes('ok'))
    })
  })
}

/**
 * 依次试候选解释器，第一个能 import edge_tts 的就作为御用解释器。
 * 本机实测过两台 python（3.14 装得上、3.15-32 没有），只试 `python` 会误判「没装」。
 * force=true 时跳过 5 分钟缓存（用户当场装完依赖就能刷出来）。
 */
export function probeNeural(opts) {
  const force = !!(opts && opts.force)
  if (!force && neuralProbe && Date.now() - neuralProbe.at < NEURAL_TTL) return Promise.resolve(neuralProbe)
  // 并发调用共用同一个探测（旧写法会让第二个调用永不 resolve，表现为 /tts/status 挂住）
  if (neuralPending && !force) return neuralPending
  neuralPending = (async () => {
    let first = 'python'
    try {
      first = resolvePython()
    } catch (e) {
      /* 落回 PATH 上的 python */
    }
    const cands = pythonCandidates(first)
    let okPy = null
    for (const py of cands) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await probePython(py)
      if (ok) {
        okPy = py
        break
      }
    }
    const probe = okPy
      ? { ok: true, reason: '', py: okPy, at: Date.now() }
      : {
          ok: false,
          reason: '没装 edge-tts（试过 ' + cands.join(' / ') + '；用 python -m pip install edge-tts 装）',
          py: cands[0] || '',
          at: Date.now(),
        }
    if (okPy) {
      // worker 与合成都用这个解释器，否则会出现「探测说能用、合成时说没装」
      neuralPython = okPy
    }
    neuralProbe = probe
    neuralPending = null
    // 路径只进服务端日志，不回给页面（status 的 reason 会显示在面板上）
    try {
      if (!okPy) console.warn('[dsh-pet] neural probe failed: tried=' + cands.join(','))
    } catch (e) {
      /* ignore */
    }
    return probe
  })()
  return neuralPending
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

// 探测确认过「真的能 import edge_tts」的那个解释器。
// 与 resolvePython() 分开：后者是「按约定猜」的结果，不能因为探测成功就被改写
// （测试与日志都靠它反映发现规则；本机两台 python 只有一台装了依赖）。
let neuralPython = ''

function ensureWorker() {
  if (worker) return worker
  const py = neuralPython || resolvePython()
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

function synthViaWorker(text, voice, outFile, pitchHz, ratePct, volPct) {
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
        JSON.stringify({
          id,
          text,
          voice,
          pitch: pitchHz,
          rate: ratePct,
          volume: volPct,
          out: outFile,
        }) + '\n',
      )
    } catch (e) {
      clearTimeout(timer)
      workerWaiters.delete(id)
      reject(e)
    }
  })
}

/** 串行队列：worker 是单线程的，前端并发请求也不会互相踩。 */
function synthQueued(text, voice, outFile, pitchHz, ratePct, volPct) {
  const run = () => synthViaWorker(text, voice, outFile, pitchHz, ratePct, volPct)
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
export async function synthAtomic(text, voice, file, pitch, rate, volume) {
  const tmp = file + '.' + Math.random().toString(36).slice(2, 10) + '.tmp'
  try {
    await synthOnce(text, voice, tmp, pitch, rate, volume)
    await rename(tmp, file)
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  }
}

let lastTrimAt = 0

/** 合成一句：走常驻 worker（起不来就抛错，由调用方兜底成系统语音）。 */
async function synthOnce(text, voice, outFile, pitchHz, ratePct, volPct) {
  await synthQueued(text, voice, outFile, pitchHz, ratePct, volPct)
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
