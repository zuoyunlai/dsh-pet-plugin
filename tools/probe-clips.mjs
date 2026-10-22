// 逐个切换形象，验证每个人的 dance 片段都能加载并播放
// 用法：node tools/probe-clips.mjs <dsh-url>
import { spawn } from 'node:child_process'

const URL_ARG = process.argv[2]
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9335
const profile = `${process.env.TEMP || '/tmp'}/chrome-dsh-clip-probe`
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
      /* not up */
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

  const out = await evaluate(`(async () => {
    const api = window.__dshPet
    if (!api) return { error: 'no __dshPet' }
    api.runtime.visible = true
    const ids = Object.keys(api.PERSONAS)
    const rows = []
    for (const id of ids) {
      api.runtime.settings.persona = id
      api.runtime.action = null
      api.notify()
      await new Promise((r) => setTimeout(r, 350))
      api.playAction('dance', { ms: 3000 })
      await new Promise((r) => setTimeout(r, 900))
      const v = document.querySelector('.dsh-pet-video')
      if (!v) {
        rows.push({ id, video: false, clips: api.PERSONAS[id].clips, mood: api.runtime.mood })
        continue
      }
      const t0 = v.currentTime
      await new Promise((r) => setTimeout(r, 500))
      rows.push({
        id,
        src: String(v.currentSrc || v.src).split('/').pop(),
        readyState: v.readyState,
        playing: !v.paused,
        size: v.videoWidth + 'x' + v.videoHeight,
        advanced: Math.round((v.currentTime - t0) * 1000) / 1000,
      })
    }
    return rows
  })()`)
  console.log(JSON.stringify(out, null, 2))
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
