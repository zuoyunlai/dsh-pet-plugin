// 打开设置面板并截图，检查它是否还盖住宠物
// 用法：node tools/probe-panel.mjs <dsh-url> [out.png]
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const URL_ARG = process.argv[2]
const OUT = process.argv[3] || null
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9334
const profile = `${process.env.TEMP || '/tmp'}/chrome-dsh-panel-probe`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${PORT}`,
  '--window-size=1400,860',
  'about:blank',
])

async function main() {
  let targets = []
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      targets = await r.json()
      if (targets.some((t) => t.type === 'page')) break
    } catch (e) {
      /* not up yet */
    }
    await sleep(300)
  }
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('chrome did not come up')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  const send = (method, params) =>
    new Promise((res) => {
      const myId = ++id
      pending.set(myId, res)
      ws.send(JSON.stringify({ id: myId, method, params: params || {} }))
    })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: URL_ARG })
  await sleep(8000)
  await send('Runtime.evaluate', { expression: "try{localStorage.setItem('dsh-pet.debug','1')}catch(e){}" })
  await send('Page.reload', {})
  await sleep(9000)

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result && r.result.exceptionDetails) return { __error: r.result.exceptionDetails.text }
    return r.result && r.result.result ? r.result.result.value : null
  }

  const result = await evaluate(`(async () => {
    const api = window.__dshPet
    if (!api) return { error: 'no __dshPet' }
    api.runtime.visible = true
    api.runtime.panelOpen = true
    if (api.placePanel) api.placePanel()
    api.notify()
    await new Promise((r) => setTimeout(r, 600))
    const pet = document.querySelector('.dsh-pet-actor-wrap') || document.querySelector('.dsh-pet-actor')
    const panel = document.querySelector('.dsh-pet-panel')
    const wrap = document.querySelector('.dsh-pet-panelwrap')
    if (!pet || !panel) return { error: 'missing', hasPet: !!pet, hasPanel: !!panel }
    const pr = pet.getBoundingClientRect()
    const nr = (wrap || panel).getBoundingClientRect()
    const overlapX = Math.max(0, Math.min(pr.right, nr.right) - Math.max(pr.left, nr.left))
    const overlapY = Math.max(0, Math.min(pr.bottom, nr.bottom) - Math.max(pr.top, nr.top))
    return {
      panel: { x: Math.round(nr.left), y: Math.round(nr.top), w: Math.round(nr.width), h: Math.round(nr.height) },
      pet: { x: Math.round(pr.left), y: Math.round(pr.top), w: Math.round(pr.width), h: Math.round(pr.height) },
      overlapPx: Math.round(overlapX) + 'x' + Math.round(overlapY),
      viewport: window.innerWidth + 'x' + window.innerHeight,
    }
  })()`)
  console.log(JSON.stringify(result, null, 2))

  if (OUT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    if (shot.result && shot.result.data) {
      fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'))
      console.log('screenshot:', OUT)
    }
  }
  ws.close()
  chrome.kill()
}

main().catch((e) => {
  console.error('probe failed:', e.message)
  try {
    chrome.kill()
  } catch (err) {
    /* ignore */
  }
  process.exit(1)
})
