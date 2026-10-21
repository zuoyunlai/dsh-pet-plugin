// Headless probe: open a DSH web URL in Chrome, then report what the pet did.
// Usage: node probe.mjs <url> [outPrefix]
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

// 自检出口现在要显式开启：给 URL 补 ?petdebug=1
const rawUrl = process.argv[2]
const url = rawUrl && !/[?&]petdebug=1/.test(rawUrl) ? rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'petdebug=1' : rawUrl
const out = process.argv[3] || 'probe'
const PORT = 9333
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = `${process.env.TEMP || '/tmp'}/chrome-dsh-probe`

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--window-size=1400,900',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  ...(process.env.PROBE_LANG ? ['--lang=' + process.env.PROBE_LANG] : []),
  url,
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await r.json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page
    } catch {}
    await sleep(300)
  }
  throw new Error('chrome did not come up')
}

const page = await targets()
const ws = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()
const logs = []

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
    logs.push(`[${msg.params.type}] ${text}`)
  } else if (msg.method === 'Runtime.exceptionThrown') {
    logs.push(`[exception] ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description || ''}`)
  }
})

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })

await new Promise((r) => ws.addEventListener('open', r))
await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url })
await sleep(2500)
// 自检出口默认关闭：先写 localStorage 再刷一次，确保 bundle 二次执行时能读到
await send('Runtime.evaluate', { expression: "localStorage.setItem('dsh-pet.debug','1')" })
await send('Page.reload', { ignoreCache: false })
await sleep(6000)

const pick = `(() => {
  const el = document.querySelector('.dsh-pet-root')
  const r = el ? el.getBoundingClientRect() : null
  return JSON.stringify({
    api: typeof window.__dshPet,
    petEls: document.querySelectorAll('.dsh-pet-root').length,
    rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
    visibleText: el ? el.innerText.slice(0, 80) : null,
    style: el ? getComputedStyle(el).display + '/' + getComputedStyle(el).visibility + '/' + getComputedStyle(el).opacity + '/z' + getComputedStyle(el).zIndex : null,
    overlayHosts: [...document.querySelectorAll('[class*=overlay]')].slice(0, 5).map(e => e.className + ' => ' + getComputedStyle(e).position + '/' + getComputedStyle(e).zIndex),
    mounted: window.__dshPet ? Object.keys(window.__dshPet.runtime).slice(0, 8) : null,
    mountedFlag: window.__dshPet ? { mountLogged: window.__dshPet.runtime.mountLogged, visible: window.__dshPet.runtime.visible, bridge: !!window.__dshPet.runtime.input } : null,
  })
})()`

const evalRes = await send('Runtime.evaluate', { expression: pick, returnByValue: true })
console.log('=== DOM ===')
console.log(evalRes.result?.result?.value ?? JSON.stringify(evalRes.result))

// 可选：第四参数是给宠物的一句话，会真的走一次 /dsh-pet/chat
const chat = process.argv[4]
if (chat) {
  const expr = `(async () => {
    const r = await fetch('/dsh-pet/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: ${JSON.stringify(chat)}, persona: { name: '阿捣', tag: '无厘头捣蛋鬼' } }),
    })
    return r.status + ' ' + (await r.text()).slice(0, 400)
  })()`
  const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  console.log('=== chat ===')
  console.log(res.result?.result?.value ?? JSON.stringify(res.result))
}

// 可选：第五参数是逗号分隔的特效名，逐个播放并截图
const fxList = process.argv[5]
if (fxList) {
  // 关掉首次启动的说明弹窗，否则全屏特效会被它盖住
  await send('Runtime.evaluate', {
    expression: `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '继续'); if (b) b.click(); return !!b })()`,
  })
  await sleep(400)
  for (const type of fxList.split(',')) {
    await send('Runtime.evaluate', {
      expression: `window.__dshPet && window.__dshPet.playFx(${JSON.stringify(type)}, { ttl: 60000 })`,
    })
    await sleep(type === 'boom' ? 1200 : 700)
    const s = await send('Page.captureScreenshot', { format: 'png' })
    if (s.result?.data) {
      const p = `${process.env.TEMP || '/tmp'}/${out}-${type}.png`
      writeFileSync(p, Buffer.from(s.result.data, 'base64'))
      console.log('fx screenshot:', p)
    }
    await send('Runtime.evaluate', { expression: 'window.__dshPet && (window.__dshPet.runtime.fx = [])' })
    await sleep(200)
  }
}

// 可选：第六参数是一段要在截图前执行的 JS（用来切形象、摆姿势）
const preShot = process.argv[6]
if (preShot) {
  const r = await send('Runtime.evaluate', {
    expression: preShot,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  console.log('=== pre ===')
  console.log(r.result?.result?.value ?? JSON.stringify(r.result?.exceptionDetails || ''))
  await sleep(900)
}

const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) {
  writeFileSync(`${process.env.TEMP || '/tmp'}/${out}.png`, Buffer.from(shot.result.data, 'base64'))
  console.log('screenshot:', `${process.env.TEMP || '/tmp'}/${out}.png`)
}

console.log('=== console ===')
console.log(logs.slice(-25).join('\n') || '(none)')

ws.close()
chrome.kill()
