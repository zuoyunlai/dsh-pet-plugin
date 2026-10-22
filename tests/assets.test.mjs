import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/**
 * 资产回归基线：assets/ 下每个文件的 sha256 必须与 tests/assets-manifest.json 一致。
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
  for (const [name, meta] of Object.entries(actual)) {
    const base = manifest.files[name]
    if (!base) problems.push('added: ' + name)
    else if (base.sha256 !== meta.sha256) problems.push('changed: ' + name)
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
