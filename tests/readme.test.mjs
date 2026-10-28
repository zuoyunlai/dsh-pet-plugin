import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * README 数字单一源（挂账③，2026-10-28 审计）：文档口径漂移不是偶发是流程性腐坏——
 * 240ms 漂了 9 个版本、「2MB」漂了 8 个版本、「五语对齐」提交漏改三语。
 * 这里把易漂移的数字逐条「从代码提取真值 → 断言 README 写的就是它」，
 * 改代码不改文档（或反之）会在测试里直接红。
 *
 * 覆盖范围刻意收窄到「曾经真的漂过」的数字；样式/行为数字加新条目时
 * 请同时给 zh / en 两份 README 补口径（es/pt/hi 是精简版，不带数字）。
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const grab = (p, re) => {
  const m = read(p).match(re)
  return m ? m[1] : null
}
const MINUS = '\u2212' // README 用的 Unicode 负号

function fact(name, getValue, checks) {
  test('README 口径：' + name, (t) => {
    if (!existsSync(join(root, 'README-zh.md')) || !existsSync(join(root, 'src'))) {
      t.skip('runtime-only copy（无 README/src）')
      return
    }
    const v = getValue()
    assert.notEqual(v, null, '从代码里取不到该值——正则过期了？')
    for (const [file, re, label] of checks) {
      const got = grab(file, re)
      assert.equal(got, v, `${file} 的「${label}」与代码不一致：文档=${got}，代码=${v}`)
    }
  })
}

/* ---------- 每条 = 代码真值 + 文档断言 ---------- */

fact(
  '表情交叉淡入毫秒数（曾漂移 9 个版本：240→180）',
  () => {
    const m = read('src/70-style.js').match(/dsh-pet-img-in \.(\d+)s/)
    return m ? String(Number('0.' + m[1]) * 1000) : null
  },
  [
    ['README-zh.md', /交叉淡入淡出\*\*（(\d+)ms）/, '交叉淡入'],
    ['README.md', /cross-fade \((\d+) ms\)/, 'cross-fade'],
  ],
)

fact(
  '默认缩放（settings 默认值）',
  () => grab('src/40-settings.js', /scale: ([\d.]+),/),
  [['README-zh.md', /默认大小 ([\d.]+)×/, '默认大小']],
)

fact(
  '被拖动台词概率（%）',
  () => String(Math.round(Number(grab('src/96-overlay.js', /Math\.random\(\) < ([\d.]+)\) bubble\(line, null, 'drag'\)/)) * 100)),
  [
    ['README-zh.md', /(\d+)% 概率说一句 `drag`/, 'drag 概率'],
    ['README.md', /(\d+)% chance of a `drag` line/, 'drag chance'],
  ],
)

fact(
  '心声概率（%）',
  () => String(Math.round(Number(grab('src/60-behavior.js', /ASIDE_RATE = ([\d.]+)/)) * 100)),
  [
    ['README-zh.md', /低频（(\d+)%）/, '心声概率'],
    ['README.md', /low-frequency \((\d+)%\)/, 'inner voice'],
  ],
)

fact(
  '撩头发随机概率（%/tick）',
  () => {
    const raw = grab('src/60-behavior.js', /Math\.random\(\) < ([\d.]+)\) playAction\('hair'\)/)
    return raw ? String(Number(raw) * 100).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : null
  },
  [['README-zh.md', /(\d+(?:\.\d+)?)%\/tick 随机撩/, '撩发概率']],
)

test('README 口径：立绘静立（1.26.1 起无 CSS 摇摆）', (t) => {
  if (!existsSync(join(root, 'README-zh.md')) || !existsSync(join(root, 'src'))) {
    t.skip('runtime-only copy')
    return
  }
  // fig-* 立绘动画已删（被 animation:none!important 压死后是死代码），
  // README 不得再声称「走路步幅 / 跳舞 ±4° / 呼吸」这类 CSS 自造动作。
  const zh = read('README-zh.md')
  assert.ok(!zh.includes('步幅'), 'README-zh 不应再提「步幅」（CSS 步幅动画已删）')
  assert.ok(!/呼吸\s*5/.test(zh), 'README-zh 不应再提「呼吸 5–6s」（立绘已静立）')
  const css = read('src/70-style.js')
  assert.ok(!/fig-walk|fig-dance/.test(css), 'CSS 里不应再有 fig-* 立绘动画')
  assert.ok(/\.dsh-pet-figure\{[^}]*animation:none!important/.test(css), '.dsh-pet-figure 应禁用动画')
})

test('README 口径：动作帧步长（3 帧 / 6 帧两档）', (t) => {
  if (!existsSync(join(root, 'README-zh.md')) || !existsSync(join(root, 'src'))) {
    t.skip('runtime-only copy')
    return
  }
  const m = read('src/41-runtime.js').match(/frames\.length >= 6 \? (\d+) : (\d+)/)
  assert.ok(m, '帧步长提取失败')
  const [, six, three] = m
  const zh = read('README-zh.md')
  assert.ok(zh.includes(`3 帧按 ${three}ms、6 帧按 ${six}ms`), `README-zh 帧步长应为 3帧=${three}ms / 6帧=${six}ms`)
  const en = read('README.md')
  assert.ok(
    en.includes(`3-frame sets step at ${three} ms, 6-frame at ${six} ms`),
    `README.md 帧步长应为 3-frame=${three} ms / 6-frame=${six} ms`,
  )
})

test('README 口径：形象数量与 smoke 覆盖', (t) => {
  const petsDir = join(root, 'pets')
  if (!existsSync(petsDir) || !existsSync(join(root, 'README-zh.md'))) {
    t.skip('runtime-only copy')
    return
  }
  const ids = readdirSync(petsDir).filter((d) => d !== 'example')
  assert.ok(ids.length >= 5, '内置形象至少五只')
  const zh = read('README-zh.md')
  assert.ok(zh.includes(`覆盖全部 ${ids.length} 形象`), `README-zh 的 smoke 覆盖数应等于 pets/ 实际数量（${ids.length}）`)
})

test('README 口径：包体声称与资产实测一致（曾把 2MB 写了 8 个版本）', (t) => {
  if (!existsSync(join(root, 'README-zh.md')) || !existsSync(join(root, 'tests/assets-manifest.json'))) {
    t.skip('runtime-only copy')
    return
  }
  const manifest = JSON.parse(read('tests/assets-manifest.json'))
  const mb = Math.round(manifest.totalBytes / 1048576)
  assert.ok(manifest.totalBytes <= 20_000_000, '资产超出 20MB 预算')
  const m = read('README-zh.md').match(/约 (\d+)MB（受 20MB 门禁约束）/)
  assert.ok(m, 'README-zh 应有「约 NMB（受 20MB 门禁约束）」的包体口径')
  assert.ok(
    Math.abs(Number(m[1]) - mb) <= 1,
    `README-zh 包体声称 ${m[1]}MB，与资产实测 ${mb}MB 相差超过 1MB——改了素材记得同步文档（或用 tools/assets-manifest.cjs --update 后看这里）`,
  )
})
