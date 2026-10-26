#!/usr/bin/env node
/**
 * 把本机 edge-tts 的真实发音人清单存成快照（tests/voices.json）。
 *
 * 为什么要快照：语音服务会**悄悄下线发音人**。我们踩过一次——pack.json 里
 * 的 lucia / thalita / ananya 在某个 edge-tts 版本里已经不存在，合成直接失败、
 * 回落系统 SAPI，用户听到的是「上一句还是合成音、下一句突然变机器音」。
 * 有快照之后，测试就能在离线状态下断言「代码里引用的每个音色都真的存在」。
 *
 * 用法：node tools/voice-inventory.mjs        # 重新抓取并写入快照
 *       node tools/voice-inventory.mjs --list # 只打印，不写文件
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'tests', 'voices.json')

const py = `import asyncio, json, edge_tts
vs = asyncio.run(edge_tts.list_voices())
print(json.dumps([{'n': v['ShortName'], 'g': v['Gender'], 'l': v['Locale']} for v in vs]))`

let voices
try {
  const raw = execFileSync('python', ['-c', py], { encoding: 'utf8', timeout: 120000 })
  voices = JSON.parse(raw)
} catch (err) {
  console.error('抓取失败（需要本机装了 edge-tts）：', err.message)
  process.exit(1)
}

const names = voices.map((v) => v.n).sort()
if (process.argv.includes('--list')) {
  console.log(names.join('\n'))
  process.exit(0)
}

const payload = {
  note: 'edge-tts 发音人快照，由 tools/voice-inventory.mjs 生成；测试用它离线校验音色键是否还有效。更新前先确认新版真的能合成。',
  generated: new Date().toISOString().slice(0, 10),
  count: names.length,
  voices: names,
}
writeFileSync(out, JSON.stringify(payload, null, 2) + '\n', 'utf8')
console.log(`[ok] ${names.length} 个发音人 → ${out}`)
