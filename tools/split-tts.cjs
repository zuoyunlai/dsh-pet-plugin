/**
 * 把 index.js 拆成 index.js + lib/tts.js。
 *
 * 只搬「神经语音」这一整块（第 33 行到 trimCache 结束），因为它们自成体系：
 * 不碰 ctx、不碰 webServer，只依赖 Node 内置模块 + 一个 python worker 子进程。
 * 搬完 index.js 只留插件入口、路由、安全校验和 chat。
 *
 * 这是纯搬迁：搬过去的代码原样不动，只是加上 export。
 */
const fs = require('fs')

const src = fs.readFileSync('index.js', 'utf8')
const lines = src.split('\n')

// 1) 定位 TTS 块：从「神经语音」注释行到 trimCache 的结束大括号
const startIdx = lines.findIndex((l) => l.includes('// —— 神经语音（edge-tts）——'))
if (startIdx < 0) throw new Error('TTS start marker not found')

const trimStart = lines.findIndex((l) => l.startsWith('async function trimCache()'))
if (trimStart < 0) throw new Error('trimCache not found')

// trimCache 结束后第一个顶层 `}` 之后就是 Config
let endIdx = trimStart
let depth = 0
for (let i = trimStart; i < lines.length; i++) {
  for (const ch of lines[i]) {
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        endIdx = i
        break
      }
    }
  }
  if (depth === 0 && i >= trimStart && lines[i].trim() === '}') break
}
console.log('TTS block: lines', startIdx + 1, '..', endIdx + 1)

const ttsBody = lines.slice(startIdx, endIdx + 1).join('\n')

// 2) 加 export 前缀
const exported = ttsBody
  .replace(/^function voiceFor\(/m, 'export function voiceFor(')
  .replace(/^function probeNeural\(/m, 'export function probeNeural(')
  .replace(/^function killWorker\(/m, 'export function killWorker(')
  .replace(/^async function synthAtomic\(/m, 'export async function synthAtomic(')
  .replace(/^async function trimCache\(/m, 'export async function trimCache(')

// 3) 写 lib/tts.js（自带 import）
const header = [
  '/**',
  ' * 神经语音（edge-tts）子系统：worker 管理、合成、缓存裁剪。',
  ' *',
  ' * 从 index.js 拆出来（1.18.0）。这一块不碰 ctx/webServer，只依赖 Node 内置',
  ' * 模块和一个 python 子进程，所以可以独立测试与替换。',
  ' */',
  "import { readFile, mkdir, stat, readdir, unlink, rename } from 'node:fs/promises'",
  "import { existsSync } from 'node:fs'",
  "import { spawn } from 'node:child_process'",
  "import { createHash } from 'node:crypto'",
  "import { tmpdir } from 'node:os'",
  "import { fileURLToPath } from 'node:url'",
  "import { join } from 'node:path'",
  '',
].join('\n')

fs.mkdirSync('lib', { recursive: true })
fs.writeFileSync('lib/tts.js', header + exported + '\n')
console.log('lib/tts.js written:', exported.split('\n').length, 'lines')

// 4) index.js：删掉 TTS 块，改成 import
const kept = lines.slice(0, startIdx).concat(lines.slice(endIdx + 1))
let out = kept.join('\n')

// 在 import 区末尾加上 lib/tts 的导入
const importAnchor = "import { join, basename, dirname } from 'node:path'\n"
if (!out.includes(importAnchor)) throw new Error('import anchor missing')
out = out.replace(
  importAnchor,
  importAnchor +
    "import { voiceFor, probeNeural, killWorker, synthAtomic, trimCache } from './lib/tts.js'\n",
)

fs.writeFileSync('index.js', out)
console.log('index.js now:', out.split('\n').length, 'lines')
