/**
 * 资产清单：assets/ 下每个文件的 sha256 + 尺寸 + 字节数。
 *
 * 用途：`tests/assets.test.mjs` 对着这份清单断言资产没被动过。
 * 重新生成素材（换视频、重抠图、加形象）之后，要显式更新清单：
 *
 *   node tools/assets-manifest.cjs --update
 *
 * 这样"资产变了"永远是一次显式决定，而不是某次构建的副作用。
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const ASSETS = path.join(ROOT, 'assets')
const MANIFEST = path.join(ROOT, 'tests', 'assets-manifest.json')

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function probeMedia(full) {
  if (path.extname(full).toLowerCase() !== '.webm') return {}
  const raw = execFileSync('ffprobe', [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', full,
  ], { encoding: 'utf8' })
  const info = JSON.parse(raw)
  const stream = (info.streams || []).find((s) => s.codec_type === 'video')
  if (!stream) throw new Error(`no video stream: ${full}`)
  return {
    width: stream.width,
    height: stream.height,
    durationMs: Math.round(Number(info.format?.duration || stream.duration || 0) * 1000),
    fps: stream.avg_frame_rate || stream.r_frame_rate,
    codec: stream.codec_name,
    pixelFormat: stream.pix_fmt,
    alphaMode: stream.tags?.alpha_mode || stream.tags?.ALPHA_MODE || null,
  }
}

function build() {
  const out = {}
  for (const name of fs.readdirSync(ASSETS).sort()) {
    const full = path.join(ASSETS, name)
    const st = fs.statSync(full)
    if (!st.isFile()) continue
    const buf = fs.readFileSync(full)
    out[name] = {
      bytes: buf.length,
      sha256: sha256(buf),
      ...probeMedia(full),
    }
  }
  return {
    generatedAt: 'baseline',
    count: Object.keys(out).length,
    totalBytes: Object.values(out).reduce((sum, meta) => sum + meta.bytes, 0),
    files: out,
  }
}

const update = process.argv.includes('--update')
const manifest = build()

if (update) {
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`assets-manifest updated: ${manifest.count} files`)
} else {
  if (!fs.existsSync(MANIFEST)) {
    console.error('no baseline yet — run: node tools/assets-manifest.cjs --update')
    process.exit(1)
  }
  const base = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  const problems = []
  for (const [name, meta] of Object.entries(manifest.files)) {
    const old = base.files[name]
    if (!old) problems.push(`added: ${name}`)
    else if (old.sha256 !== meta.sha256) problems.push(`changed: ${name}`)
  }
  for (const name of Object.keys(base.files)) {
    if (!manifest.files[name]) problems.push(`removed: ${name}`)
  }
  if (problems.length) {
    console.error('assets differ from the committed baseline:')
    for (const p of problems.slice(0, 20)) console.error('  ' + p)
    if (problems.length > 20) console.error(`  …and ${problems.length - 20} more`)
    console.error('if this is intentional: node tools/assets-manifest.cjs --update')
    process.exit(1)
  }
  console.log(`assets match baseline (${manifest.count} files)`)
}
