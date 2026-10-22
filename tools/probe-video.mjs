// 在真实 Chromium 里验证：VP9 + alpha 的 <video> 能不能加载、播放、且带透明通道
// 用法：node tools/probe-video.mjs <dsh-web-url> [screenshot.png]
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const URL_ARG = process.argv[2]
const OUT = process.argv[3] || null
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9333
const profile = `${process.env.TEMP || '/tmp'}/chrome-dsh-video-probe`

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
chrome.on('error', (e) => {
  console.error('chrome spawn failed:', e.message)
  process.exit(1)
})

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

  // 调试句柄只在挂载时读得到这个标记：先写标记，再重载一次
  await send('Runtime.evaluate', {
    expression: "try{localStorage.setItem('dsh-pet.debug','1')}catch(e){}",
    returnByValue: true,
  })
  await send('Page.reload', {})
  await sleep(9000)

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result && r.result.exceptionDetails) return { __error: r.result.exceptionDetails.text }
    return r.result && r.result.result ? r.result.result.value : null
  }

  const result = await evaluate(`(async () => {
    try {
      if (localStorage.getItem('dsh-pet.debug') !== '1') localStorage.setItem('dsh-pet.debug', '1')
    } catch (e) {}
    const api = window.__dshPet
    if (!api) return { error: 'no __dshPet handle' }
    api.runtime.visible = true
    api.runtime.settings.persona = 'violet'
    api.notify()
    await new Promise((r) => setTimeout(r, 400))
    api.playAction('dance', { ms: 5000 })
    await new Promise((r) => setTimeout(r, 1500))
    const v = document.querySelector('.dsh-pet-video')
    if (!v) return { error: 'no .dsh-pet-video', actor: (document.querySelector('.dsh-pet-actor') || {}).innerHTML }
    const t0 = v.currentTime
    await new Promise((r) => setTimeout(r, 800))
    return {
      found: true,
      src: String(v.currentSrc || v.src).split('/').pop(),
      readyState: v.readyState,
      paused: v.paused,
      loop: v.loop,
      muted: v.muted,
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      duration: Math.round(v.duration * 1000) / 1000,
      advanced: Math.round((v.currentTime - t0) * 1000) / 1000,
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
