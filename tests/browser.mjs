/**
 * 浏览器冒烟（挂账②，2026-10-28 审计）：真 Chromium 里验证 jsdom/node --test 证明不了的事。
 *
 *   1) preview.html 里五只形象真的渲染、立绘真的加载（naturalWidth > 0）
 *   2) VP9+alpha 片段 Chromium 真的能解码播放（瘦身重编码后最要紧的回归；含未重编码的对照）
 *   3) prefers-reduced-motion：插件自己的动画被关掉、宿主探针元素动画不受影响
 *      （R-03「裸 * 泄漏到宿主」的端到端回归——jsdom 不算 computed style）
 *   4) 页面无 JS 错误
 *
 * 素材走 /dsh-pet/assets/ 路由（生产同款：basename 防穿越），由本脚本起的临时 HTTP 服务
 * 映射到仓库 assets/——preview.html 里的绝对路径在 file:// 下本来就打不开。
 *
 * 依赖（库模式，不用 test runner）：npm install --no-save playwright && npx playwright install chromium
 * CI：test.yml 的 browser job。截图存 tests/.browser-preview.png（CI artifact）。
 */
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { basename, dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const fail = (msg) => {
  console.error('BROWSER FAIL: ' + msg)
  process.exit(1)
}

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch (e) {
  fail('缺 playwright：npm install --no-save playwright && npx playwright install chromium')
}

/* ---------------- 临时静态服务：/ → preview.html，/dsh-pet/assets/* → assets/（basename） ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
}
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname)
    if (path.startsWith('/dsh-pet/assets/')) path = '/assets/' + basename(path)
    if (path === '/') path = '/preview.html'
    const file = join(root, normalize(path).replace(/^([/\\])+/, ''))
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch (e) {
    res.writeHead(404)
    res.end('not found')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/`

try {
  // preview.html 是生成物（tests/preview.mjs 用 React 桩静态渲染五只 × 8 心情）
  execFileSync(process.execPath, ['tests/preview.mjs'], { cwd: root, stdio: 'inherit' })

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1240, height: 780 } })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console.error: ' + m.text())
  })

  await page.goto(base + 'preview.html')

  // 1) 形象渲染 + 立绘加载
  await page.locator('.dsh-pet-root, .dsh-pet-actor').first().waitFor({ timeout: 5000 })
  // 2026-10-29 审计 P1-3：这条门禁曾经是假绿——preview 把函数组件源码当标签名拼进
  // HTML，页面里一张 <img> 都没有，而旧断言只遍历 document.images（空列表天然通过）。
  // 现在先断言「真的有 40 张立绘」和「没有 <function …> 伪标签」，再查加载失败。
  const render = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'))
    return {
      imgs: document.images.length,
      functionTags: all.filter((el) => String(el.tagName).toUpperCase().indexOf('FUNCTION') === 0).length,
      textLen: (document.body.innerText || '').length,
    }
  })
  if (render.functionTags) fail(`preview.html 里有 ${render.functionTags} 个 <function …> 伪标签（toHtml 没展开函数组件）`)
  if (render.imgs < 40) fail(`立绘数量不足：document.images=${render.imgs}（五只 × 八种心情至少要 40 张）`)
  const badImgs = await page.evaluate(() =>
    Array.from(document.images)
      .filter((im) => !im.complete || im.naturalWidth === 0)
      .map((im) => im.src),
  )
  if (badImgs.length) fail(`有 ${badImgs.length} 张立绘没加载出来：` + badImgs.slice(0, 3).join(', '))

  // 2) 片段可解码可播：一条 CRF44 过闸的、一条 CRF40 过闸的、一条保留原样的对照
  for (const clip of ['pet-azure-stage.webm', 'pet-indigo-hair.webm', 'pet-violet-walk.webm']) {
    const ok = await page.evaluate(async (name) => {
      const v = document.createElement('video')
      v.src = '/dsh-pet/assets/' + name
      v.muted = true
      return await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 5000)
        v.onplaying = () => {
          clearTimeout(timer)
          resolve(v.videoWidth > 0 && v.videoHeight > 0)
        }
        v.onerror = () => {
          clearTimeout(timer)
          resolve(false)
        }
        v.play().catch(() => {
          clearTimeout(timer)
          resolve(false)
        })
      })
    }, clip)
    if (!ok) fail(`片段在 Chromium 里播不起来：${clip}（瘦身重编码回归？）`)
  }

  // 3) R-03 端到端：减弱动效下，宿主探针动画必须还在；插件 CSS 必须只在
  //    .dsh-pet-layer 之内关动画。
  //    2026-10-29（P1-3 修复后）：preview 的每一格现在自带 .dsh-pet-layer 作用域
  //    （P2-15 收口后贴纸/特效规则都在 layer 内），所以「不在 layer 里」不能再靠
  //    原父节点——把整个 .dsh-pet-actor 临时提到 body 上量（保留 mood 类，
  //    否则 .mood-* 的动画规则本身就不生效），量完放回。
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const probe = await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent = '@keyframes host-probe{from{opacity:.5}to{opacity:1}}'
    document.head.appendChild(style)
    const d = document.createElement('div')
    d.style.animation = 'host-probe 1s infinite'
    document.body.appendChild(d)
    const actor = document.querySelector('.dsh-pet-actor')
    if (!actor) return { error: 'no pet element' }
    const pet = actor.querySelector('.dsh-pet-body') || actor.querySelector('.dsh-pet-figure') || actor
    const parent = actor.parentElement
    document.body.appendChild(actor) // 不在任何 .dsh-pet-layer 下（mood 类仍在 actor 上）
    const outside = getComputedStyle(pet).animationName
    const layer = document.createElement('div')
    layer.className = 'dsh-pet-layer'
    document.body.appendChild(layer) // 必须先进文档：detached 节点的 computed style 全是空串
    layer.appendChild(actor)
    const inside = getComputedStyle(pet).animationName
    if (parent) parent.appendChild(actor)
    layer.remove()
    return { probeAnim: getComputedStyle(d).animationName, outside, inside }
  })
  if (probe.error) fail(probe.error)
  if (probe.probeAnim === 'none') fail('prefers-reduced-motion 下宿主探针动画被关掉（R-03 回归：规则泄漏出 .dsh-pet-layer 了）')
  if (probe.outside === 'none') fail('宠物元素在 .dsh-pet-layer 之外动画就被关了（规则作用域大于声明）')
  if (probe.inside !== 'none') fail(`宠物元素在 .dsh-pet-layer 之内动画没关掉：${probe.inside}`)

  await page.screenshot({ path: join(here, '.browser-preview.png'), fullPage: true })
  await browser.close()

  if (errors.length) fail('页面有 JS 错误：\n  ' + errors.slice(0, 5).join('\n  '))
  console.log('browser.mjs OK：立绘加载 / 3 条片段 Chromium 可播 / 减弱动效作用域正确 / 无页面错误')
} finally {
  server.close()
}
