/**
 * 生成 preview.html：把 3 个形象 × 8 种心情的真实渲染结果排成一张图，
 * 用无头 Chrome 截图就能在装进 DSH 之前先看它长什么样。
 *
 *   node tests/preview.mjs
 *   chrome --headless=new --screenshot=preview.png --window-size=1240,780 file://.../preview.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const source = readFileSync(join(root, 'client.js'), 'utf8')

const React = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.flat(Infinity).filter((c) => c != null && c !== false) }
  },
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect() {},
  useCallback: (fn) => fn,
}

const ctx = createContext({ console, Date, Math, JSON, String, Number, Object, Array, Set, Map, RegExp, parseInt, setInterval: () => 0, clearInterval: () => {}, requestAnimationFrame: (f) => f() })
ctx.window = ctx
ctx.window.localStorage = { getItem: () => null, setItem() {} }
ctx.window.speechSynthesis = { cancel() {}, getVoices: () => [], speak() {} }
ctx.window.SpeechSynthesisUtterance = class {}
ctx.window.__ModuleLoader__ = { load: (spec) => (ctx.__factory = spec.factory) }

runInContext(source, ctx, { filename: 'client.js' })
ctx.__factory((id) => React)
const api = ctx.__dshPet
if (!api) throw new Error('client.js 没有暴露 __dshPet 自检出口')

const KEEP = new Set(['viewBox', 'role', 'aria-label'])
function attrName(key) {
  if (KEEP.has(key) || key.startsWith('aria-') || key.startsWith('data-')) return key
  if (key === 'className') return 'class'
  return key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
}

function toHtml(node) {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(toHtml).join('')
  const attrs = Object.entries(node.props || {})
    .filter(([, v]) => v != null && v !== false)
    .map(([k, v]) => ` ${attrName(k)}="${String(v).replace(/"/g, '&quot;')}"`)
    .join('')
  return `<${node.type}${attrs}>${(node.children || []).map(toHtml).join('')}</${node.type}>`
}

const MOODS = ['idle', 'walk', 'dance', 'shy', 'angry', 'sleep', 'talk', 'happy']
const moodLabel = { idle: '待机', walk: '走路', dance: '跳舞', shy: '害羞', angry: '发怒', sleep: '打盹', talk: '说话', happy: '开心' }

let grid = ''
for (const pid of Object.keys(api.PERSONAS)) {
  const p = api.PERSONAS[pid]
  grid += `<div class="row"><div class="who"><b>${p.name}</b><span>${p.tag}</span></div>`
  for (const mood of MOODS) {
    grid += `<div class="cell"><div class="dsh-pet-actor mood-${mood}">${toHtml(api.PetArt({ persona: p, mood }))}</div><i>${moodLabel[mood]}</i></div>`
  }
  grid += '</div>'
}

const html = `<!doctype html><meta charset="utf-8"><title>dsh-pet preview</title>
<style>
body{margin:0;background:#14161b;color:#e9ecf1;font-family:system-ui,"Microsoft YaHei",sans-serif}
h1{font-size:15px;font-weight:600;padding:18px 22px 6px;margin:0}
p.sub{margin:0;padding:0 22px 10px;font-size:12px;opacity:.55}
.row{display:flex;align-items:center;gap:4px;padding:6px 18px}
.who{width:132px;font-size:12px;display:flex;flex-direction:column;gap:2px}
.who span{opacity:.5;font-size:11px}
.cell{width:124px;display:flex;flex-direction:column;align-items:center}
.cell i{font-style:normal;font-size:10.5px;opacity:.45;margin-top:-6px}
${api.CSS.replace(/\.dsh-pet-body\{/g, 'body .dsh-pet-body{')}
</style>
<h1>dsh-pet · 三种形象 × 八种心情</h1>
<p class="sub">真实渲染结果（client.js 里的 PetArt + CSS），不是示意图。</p>
${grid}
`

const out = join(root, 'preview.html')
writeFileSync(out, html, 'utf8')
console.log('wrote', out)

/* ---------- 第二张：右下角挂件实况（气泡 + 小输入框 + 宠物） ---------- */
const gremlin = api.PERSONAS.gremlin
const widgetArt = toHtml(api.PetArt({ persona: gremlin, mood: 'talk' }))

const widgetHtml = `<!doctype html><meta charset="utf-8"><title>dsh-pet widget</title>
<style>
body{margin:0;background:#14161b;color:#e9ecf1;font-family:system-ui,"Microsoft YaHei",sans-serif}
.stage{position:relative;width:980px;height:520px;overflow:hidden;display:flex;gap:18px;padding:18px}
.pane{position:relative;flex:1;border-radius:12px;background:#191c22;border:1px solid rgba(255,255,255,.06);overflow:hidden}
.pane .fake{position:absolute;inset:0;padding:18px;font-size:12.5px;line-height:1.7;opacity:.35}
.pane .tag{position:absolute;left:12px;top:10px;font-size:11px;opacity:.4;z-index:2}
${api.CSS}
</style>
<div class="stage">
  <div class="pane">
    <div class="tag">常驻 · 主动说话</div>
    <div class="fake">> 帮我把这个模块的测试补一下<br><br>好的，我先看一下现有用例⋯</div>
    <div class="dsh-pet-root" style="position:absolute;right:18px;bottom:16px">
      <div class="dsh-pet-bubble">刚刚那行报错我看见了，但我决定不说。</div>
      <div class="dsh-pet-row">
        <input class="dsh-pet-input" placeholder="跟${gremlin.name}说句话…">
        <button class="dsh-pet-send">↑</button>
      </div>
      <div class="dsh-pet-actor-wrap" style="position:relative">
        <div class="dsh-pet-actor mood-talk">${widgetArt}</div>
        <button class="dsh-pet-gear" style="opacity:1">⚙</button>
      </div>
    </div>
  </div>
  <div class="pane">
    <div class="tag">随机出现 · 藏起来的时候什么都不占</div>
    <div class="fake" style="opacity:.18">（这里平时就是干净的聊天界面）</div>
  </div>
</div>
`
const out2 = join(root, 'preview-widget.html')
writeFileSync(out2, widgetHtml, 'utf8')
console.log('wrote', out2)
