/**
 * 神经语音探测（lib/tts.js）的回归。
 *
 * 1.19.3 实测到的三个问题（都在这一个函数里）：
 *  - 缺 `homedir` / `readdirSync` 导入，被外层 try/catch 吞掉 → 永远落回 PATH 的 python
 *    → 明明 DSH 内置 runtime 里装了 edge-tts，面板却报「神经音色不可用」；
 *  - 并发调用时，第二个调用在 'exit' 里看到 `neuralProbe` 已被填上就直接 return，
 *    **永不 resolve** → /dsh-pet/tts/status 挂住；
 *  - 用 'exit' 而不是 'close' 判断结束时，stdout 可能还没到，成功的 import 会被判成失败。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeNeural, pythonCandidates, resolvePython, TTS_VOICES } from '../lib/tts.js'

const HERE = dirname(fileURLToPath(import.meta.url))

test('probeNeural 并发调用都会 settle（旧实现第二个调用永远挂住）', async () => {
  const a = probeNeural()
  const b = probeNeural()
  const r = await Promise.race([
    Promise.all([a, b]),
    new Promise((res) => setTimeout(() => res('timeout'), 12000)),
  ])
  assert.notEqual(r, 'timeout', '并发探测必须都返回结果')
  assert.equal(typeof r[0].ok, 'boolean')
  assert.deepEqual(r[0], r[1], '两个并发调用应拿到同一份结果')
})

test('探测结果会被缓存（5 分钟内不重复起进程）', async () => {
  const first = await probeNeural()
  const t0 = Date.now()
  const second = await probeNeural()
  const ms = Date.now() - t0
  assert.deepEqual(second, first)
  assert.ok(ms < 50, '缓存命中应该立即返回，实际 ' + ms + 'ms')
})

test('有 DSH 内置 python 时 resolvePython 不能落回 PATH 的 "python"', () => {
  const root = join(homedir(), '.dsh', 'dsh-runtimes')
  if (!existsSync(root)) return // 没有内置 runtime 的机器（含 CI）跳过
  const py = resolvePython()
  assert.notEqual(
    py,
    'python',
    '自动发现失效：曾因缺 homedir/readdirSync 导入而永远落回 PATH 的 python',
  )
  assert.ok(existsSync(py), '返回的 python 路径必须存在：' + py)
})

test('音色表覆盖五语', () => {
  for (const v of ['xiaoxiao', 'xiaoyi', 'xiaomo', 'ava', 'emma', 'elvira', 'francisca', 'swara']) {
    assert.ok(TTS_VOICES[v], '缺少音色 ' + v)
  }
})

test('音色表引用的每个发音人都真的存在（防服务端悄悄下线）', () => {
  // 踩过：lucia / thalita / ananya / xiaomo 在某个 edge-tts 版本里已不存在，
  // 合成失败后回落系统 SAPI，表现成「说着说着变成机器人」。
  const snap = JSON.parse(readFileSync(join(HERE, 'voices.json'), 'utf8'))
  const alive = new Set(snap.voices)
  for (const [key, name] of Object.entries(TTS_VOICES)) {
    assert.ok(alive.has(name), `音色键 ${key} → ${name} 不在发音人快照里；先跑 node tools/voice-inventory.mjs 看真实清单`)
  }
})

test('每个形象的五语音色都在音色表里，且同语言内不重复到无法区分', () => {
  const packs = readdirSync(join(HERE, '..', 'pets'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(HERE, '..', 'pets', d.name, 'pack.json'))
    .filter((f) => existsSync(f))
    .map((f) => JSON.parse(readFileSync(f, 'utf8')))
    .filter((p) => p && p.voice && p.voice.voiced)
  assert.ok(packs.length >= 5, '至少五只形象都要有 voiced 表')
  for (const p of packs) {
    for (const lang of ['zh', 'en', 'es', 'pt', 'hi']) {
      const key = p.voice.voiced[lang]
      assert.ok(key, `${p.id} 缺少 ${lang} 音色`)
      assert.ok(TTS_VOICES[key], `${p.id} 的 ${lang} 音色键 ${key} 不在音色表里`)
    }
  }
  // 英/西至少三只不同嗓子（这两门语言发音人多，必须拉开）；葡/印地只有少数嗓子，只要求「键全部有效」。
  for (const lang of ['en', 'es']) {
    const uniq = new Set(packs.map((p) => p.voice.voiced[lang]))
    assert.ok(uniq.size >= 3, `${lang} 的音色太挤：只有 ${uniq.size} 种，五只听起来会一样`)
  }
})

test('候选解释器：先算出来的那个，再 env，再 PATH 三个名字，去重保序', () => {
  // 本机装了两台 python：只试 `python` 会把「装了 edge-tts 的另一台」误判成没装
  assert.deepEqual(pythonCandidates('C:\\Py\\python.exe', {}), ['C:\\Py\\python.exe', 'python', 'python3', 'py'])
  assert.deepEqual(pythonCandidates('python3', {}), ['python3', 'python', 'py'])
  assert.deepEqual(pythonCandidates('python', { DSH_PET_PYTHON: 'C:\\X\\py.exe' }), [
    'python',
    'C:\\X\\py.exe',
    'python3',
    'py',
  ])
})

test('probeNeural({force:true}) 能绕过缓存并重新给出结论（装完依赖不用重启）', async () => {
  const first = await probeNeural()
  const forced = await Promise.race([
    probeNeural({ force: true }),
    new Promise((res) => setTimeout(() => res('timeout'), 30000)),
  ])
  assert.notEqual(forced, 'timeout', '强制探测也必须返回')
  assert.equal(typeof forced.ok, 'boolean')
  // 缓存里那条不能被 force 结果弄丢类型
  assert.equal(typeof first.ok, 'boolean')
})
