import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/**
 * 资产回归基线：assets/ 下每个文件的哈希、字节数和媒体元数据必须与
 * tests/assets-manifest.json 一致。媒体字段由生成阶段的 ffprobe 固化，测试阶段不依赖 ffprobe。
 *
 * 为什么用哈希而不是截图对比：截图受动画时序、字体渲染、窗口尺寸影响，
 * 在 CI 上几乎必然误报；而"素材文件本身变了"是确定性的，也正好是这类插件
 * 最容易悄悄回归的地方（重编码视频、重抠图、误换贴图）。
 *
 * 有意换素材之后跑：node tools/assets-manifest.cjs --update
 *
 * 注意：这里自己算哈希，不调 tools/ 里的脚本——安装到 profile 的副本只带
 * 运行时文件（tools/ 只剩 tts_worker.py），测试必须能在那种副本里跑通。
 */
function hashAssets() {
  const dir = join(root, 'assets')
  const out = {}
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    const st = statSync(full)
    if (!st.isFile()) continue
    const buf = readFileSync(full)
    out[name] = {
      bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
    }
  }
  return out
}

test('assets match the committed sha256 baseline', () => {
  const manifest = JSON.parse(readFileSync(join(here, 'assets-manifest.json'), 'utf8'))
  assert.ok(manifest.count >= 60, 'baseline should cover all sprites and clips, got ' + manifest.count)

  const actual = hashAssets()
  const problems = []
  assert.equal(manifest.totalBytes, Object.values(manifest.files).reduce((sum, meta) => sum + meta.bytes, 0),
    'manifest totalBytes must equal the sum of file bytes')
  assert.ok(manifest.totalBytes <= 20_000_000, `asset budget exceeded: ${manifest.totalBytes} bytes`)
  for (const [name, meta] of Object.entries(actual)) {
    const base = manifest.files[name]
    if (!base) problems.push('added: ' + name)
    else if (base.sha256 !== meta.sha256 || base.bytes !== meta.bytes) problems.push('changed: ' + name)
    if (name.endsWith('.webm') && base) {
      for (const field of ['width', 'height', 'durationMs', 'fps', 'codec', 'pixelFormat', 'alphaMode']) {
        if (!(field in base)) problems.push(`${name}: missing ${field} metadata`)
      }
      assert.equal(base.codec, 'vp9', `${name}: expected VP9`)
      assert.ok(base.width > 0 && base.width <= 640, `${name}: invalid width`)
      assert.equal(base.height, 640, `${name}: expected 640px height`)
      const expectedDuration = name.includes('-stage.') ? 10125 : 5167
      assert.equal(base.durationMs, expectedDuration, `${name}: unexpected duration`)
      assert.equal(base.alphaMode, '1', `${name}: expected alpha_mode=1`)
    }
  }
  for (const name of Object.keys(manifest.files)) {
    if (!actual[name]) problems.push('removed: ' + name)
  }
  assert.deepEqual(
    problems,
    [],
    'assets differ from baseline:\n  ' +
      problems.slice(0, 15).join('\n  ') +
      '\nif this is intentional: node tools/assets-manifest.cjs --update',
  )
})

test('every persona referenced in a pack exists on disk', (t) => {
  const petsDir = join(root, 'pets')
  // 安装到 profile 的副本只有运行时文件（没有 pets/ 与 src/），这类用例在那里跳过
  if (!existsSync(petsDir)) {
    t.skip('no pets/ in this install (runtime-only copy)')
    return
  }
  const present = new Set(readdirSync(join(root, 'assets')))
  const ids = ['violet', 'crimson', 'indigo', 'silver']
  for (const id of ids) {
    const pack = JSON.parse(readFileSync(join(petsDir, id, 'pack.json'), 'utf8'))
    const refs = new Set()
    for (const f of Object.values(pack.images || {})) refs.add(f)
    for (const arr of Object.values(pack.actions || {})) {
      for (const f of arr) refs.add(f)
    }
    for (const f of Object.values(pack.clips || {})) refs.add(f)
    for (const f of refs) {
      assert.ok(present.has(f), `${id}: pack references ${f} but it is not in assets/`)
    }
  }
})

test('every pack declares a license (R-10 分发门禁)', (t) => {
  const petsDir = join(root, 'pets')
  if (!existsSync(petsDir)) {
    t.skip('no pets/ in this install (runtime-only copy)')
    return
  }
  const ids = readdirSync(petsDir).sort()
  assert.ok(ids.length > 0, 'pets/ 目录不应为空')
  for (const id of ids) {
    const pack = JSON.parse(readFileSync(join(petsDir, id, 'pack.json'), 'utf8'))
    assert.ok(
      typeof pack.license === 'string' && pack.license.length > 0,
      `${id}: pack.json 缺少 license 字段（分发合规门禁，见 THIRD_PARTY_NOTICES.md）`,
    )
  }
  assert.ok(existsSync(join(root, 'THIRD_PARTY_NOTICES.md')), '根目录应有 THIRD_PARTY_NOTICES.md')
})
