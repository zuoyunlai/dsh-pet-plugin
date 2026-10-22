#!/usr/bin/env node
/**
 * 把 src/*.js 按文件名排序拼成 client.js。
 *
 * 为什么要拼：DSH 的 client-modules 只加载 package.json 里 `exports["./client"]`
 * 指向的单个文件，浏览器侧没有模块解析，所以源码分块、产物单文件。
 *
 * 拼接是纯文本连接（不加分隔符、不改缩进），会被替换的只有两处：
 *   - i18n 块的 `/* @locales *\/ {}` 标记（注入 locale/*.json）
 *   - src/30-personas.js：在拼接前由 tools/gen-personas.cjs 从 pets/<id>/pack.json 生成
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const MARKER = '/* @locales */ {}'

/** 形象数据源是 pets/，先重新生成 src/30-personas.js 再拼接 */
function generatePersonas() {
  const out = execFileSync(process.execPath, ['tools/gen-personas.cjs'], { encoding: 'utf8' })
  process.stdout.write(out)
}

function localeDict() {
  const dict = {}
  // 固定语言顺序（en 打头，其余按发布顺序），保证产物可逐字节复现
  const ORDER = ['en', 'zh', 'es', 'pt', 'hi']
  const found = readdirSync('locale').filter((f) => f.endsWith('.json'))
  const rank = (f) => {
    const i = ORDER.indexOf(f.replace(/.json$/, ''))
    return i < 0 ? ORDER.length : i
  }
  const files = found.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  for (const f of files) {
    const lang = f.replace(/\.json$/, '')
    const json = JSON.parse(readFileSync('locale/' + f, 'utf8'))
    if (!json.pet) throw new Error('locale/' + f + ' has no "pet" namespace')
    dict[lang] = json.pet
  }
  return dict
}

generatePersonas()

const parts = readdirSync('src')
  .filter((f) => f.endsWith('.js'))
  .sort()

if (!parts.length) {
  console.error('src/ is empty — nothing to build')
  process.exit(1)
}

const dict = localeDict()
let out = ''
let injected = 0
for (const p of parts) {
  let code = readFileSync('src/' + p, 'utf8')
  if (code.includes(MARKER)) {
    code = code.replace(MARKER, JSON.stringify(dict))
    injected++
  }
  out += (out ? '\n' : '') + code
}

if (!injected) console.warn('warning: no @locales marker found — dictionaries are not injected')

writeFileSync('client.js', out)
execFileSync(process.execPath, ['--check', 'client.js'])

const kb = (Buffer.byteLength(out) / 1024).toFixed(1)
console.log(`client.js  ${parts.length} parts  ${out.split('\n').length} lines  ${kb} KB`)
console.log(`locales    ${Object.keys(dict).length} (${Object.keys(dict).join(', ')})`)
for (const p of parts) {
  const lines = readFileSync('src/' + p, 'utf8').split('\n').length
  console.log('  ' + p.padEnd(20) + String(lines).padStart(5))
}
