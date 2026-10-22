/**
 * F4：从 pets/<id>/pack.json 生成 src/30-personas.js。
 *
 * 硬要求：生成结果必须与迁移前逐字节一致（client.js 的 sha1 不变），
 * 所以格式化规则是从现有文件反推的，不是随手写的。
 *
 * 用法：node tools/gen-personas.cjs [--check]
 *   --check  只比较，不写盘；不一致时退出码 1
 */
const fs = require('fs')
const path = require('path')

const OUT = 'src/30-personas.js'
const HEADER = '    /* ================= 人格 / 形象 ================= */\n\n'
const ORDER = [
  'id',
  'name',
  'tag',
  'tagEn',
  'image',
  'images',
  'actions',
  'voice',
  'temper',
  'lines',
  'linesEn',
  'linesEs',
  'linesPt',
  'linesHi',
]
/** 固定形象顺序：内置四只按这个顺序排，其它 pack 按字母序追加在后 */
const PREFERRED = ['violet', 'crimson', 'indigo', 'silver']

const q = (v) => JSON.stringify(String(v))

function fmt(value, indent) {
  const pad = ' '.repeat(indent)
  const pad2 = ' '.repeat(indent + 2)
  if (typeof value === 'string') return q(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value)
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    // 阈值是从迁移前的文件反推的：按 "a', 'b" 拼接后的长度 < 88 就单行
    const joined = value.every((x) => typeof x === 'string') ? value.join("', '") : ''
    if (joined && joined.length < 88) return '[' + value.map(q).join(', ') + ']'
    return '[\n' + value.map((x) => pad2 + fmt(x, indent + 2)).join(',\n') + ',\n' + pad + ']'
  }
  const keys = Object.keys(value)
  if (!keys.length) return '{}'
  const inline = '{ ' + keys.map((k) => k + ': ' + fmt(value[k], 0)).join(', ') + ' }'
  if (inline.length < 96 && !inline.includes('\n')) return inline
  return '{\n' + keys.map((k) => pad2 + k + ': ' + fmt(value[k], indent + 2)).join(',\n') + ',\n' + pad + '}'
}

function packIds() {
  const all = fs
    .readdirSync('pets', { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join('pets', d.name, 'pack.json')))
    .map((d) => d.name)
  const preferred = PREFERRED.filter((id) => all.includes(id))
  const rest = all.filter((id) => !PREFERRED.includes(id)).sort()
  return preferred.concat(rest)
}

function generate() {
  const ids = packIds()
  if (!ids.length) throw new Error('no pets/*/pack.json found')
  let out = HEADER + '    const PERSONAS = {\n'
  for (const id of ids) {
    const pack = JSON.parse(fs.readFileSync(path.join('pets', id, 'pack.json'), 'utf8'))
    if (pack.id && pack.id !== id) {
      throw new Error('pets/' + id + '/pack.json 的 id 与目录名不一致：' + pack.id)
    }
    out += '      ' + id + ': {\n'
    const keys = ORDER.filter((k) => pack[k] !== undefined)
    const extra = Object.keys(pack).filter((k) => !ORDER.includes(k))
    for (const k of keys.concat(extra)) {
      out += '        ' + k + ': ' + fmt(pack[k], 8) + ',\n'
    }
    out += '      },\n'
  }
  out += '    }\n\n'
  return out
}

const generated = generate()
const check = process.argv.includes('--check')
const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''

if (generated === current) {
  console.log('gen-personas: 与现有 src/30-personas.js 逐字节一致（' + packIds().length + ' 个 pack）')
  process.exit(0)
}

if (check) {
  // 找出第一处差异，方便修格式化规则
  const a = current.split('\n')
  const b = generated.split('\n')
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      console.log('gen-personas: 不一致，第一处差异在第 ' + (i + 1) + ' 行')
      console.log('  现有: ' + JSON.stringify((a[i] || '').slice(0, 120)))
      console.log('  生成: ' + JSON.stringify((b[i] || '').slice(0, 120)))
      break
    }
  }
  process.exit(1)
}

fs.writeFileSync(OUT, generated)
console.log('gen-personas: 已写入 ' + OUT + '（' + packIds().length + ' 个 pack）')
