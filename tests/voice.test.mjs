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
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { probeNeural, resolvePython, TTS_VOICES } from '../lib/tts.js'

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
