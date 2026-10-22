// DSH 桌宠的端到端探测工具：无头 Chrome + CDP，一个入口、多个场景。
//
// 用法：
//   node tools/probe.mjs <dsh-url> --scenario=video   [--shot=out.png]
//   node tools/probe.mjs <dsh-url> --scenario=panel   [--shot=out.png]
//   node tools/probe.mjs <dsh-url> --scenario=clips
//   node tools/probe.mjs <dsh-url> --scenario=dom
//
// 场景：
//   video  —— 点"跳一段"，检查 <video> 是否加载、是否实时播放、是否带透明通道
//   panel  —— 打开设置面板，量它与宠物的重叠（应当为 0）
//   clips  —— 逐个切换形象，确认每只的 dance 片段都能播
//   dom    —— 打印宠物节点的位置、尺寸、可见文本与已挂载字段（通用排查）
//
// 共同点：先写 localStorage 的 dsh-pet.debug 标记再重载，这样页面会暴露
// window.__dshPet 调试句柄；所有断言都在页面内 evaluate，结果以 JSON 打印。
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const args = process.argv.slice(2)
const url = args.find((a) => !a.startsWith('--'))
const scenarioArg = (args.find((a) => a.startsWith('--scenario=')) || '').split('=')[1] || 'dom'
const shotArg = (args.find((a) => a.startsWith('--shot=')) || '').split('=')[1] || null
const portArg = (args.find((a) => a.startsWith('--port=')) || '').split('=')[1] || '9333'

if (!url) {
  console.error('usage: node tools/probe.mjs <dsh-url> --scenario=video|panel|clips|dom [--shot=out.png]')
  process.exit(2)
}

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(portArg)
const PROFILE = `${process.env.TEMP || '/tmp'}/chrome-dsh-probe-${scenarioArg}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${PROFILE}`,
  `--remote-debugging-port=${PORT}`,
  '--window-size=1400,860',
  'about:blank',
])
chrome.on('error', (e) => {
  console.error('chrome spawn failed:', e.message)
  process.exit(1)
})

/** 页面内执行的场景脚本（字符串，避免闭包序列化问题） */
const SCENARIOS = {
  video: `(async () => {
    const api = window.__dshPet
    if (!api) return { error: 'no __dshPet handle' }
    api.runtime.visible = true
    api.runtime.settings.persona = 'violet'
    api.notify()
    await new Promise((r) => setTimeout(r, 400))
    api.playAction('dance', { ms: 5000 })
    await new Promise((r) => setTimeout(r, 1200))
    const v = document.querySelector('.dsh-pet-video')
    if (!v) return { error: 'no .dsh-pet-video' }
    const t0 = v.currentTime
    await new Promise((r) => setTimeout(r, 800))
    return {
      found: true,
      src: String(v.currentSrc || v.src).split('/').pop(),
      readyState: v.readyState,
      paused: v.paused,
      loop: v.loop,
      muted: v.muted,
      size: v.videoWidth + 'x' + v.videoHeight,
      duration: Math.round(v.duration * 1000) / 1000,
      advanced: Math.round((v.currentTime - t0) * 1000) / 1000,
    }
  })()`,

  panel: `(async () => {
    const api = window.__dshPet
    if (!api) return { error: 'no __dshPet handle' }
    api.runtime.visible = true
    api.runtime.panelOpen = true
    if (api.placePanel) api.placePanel()
    api.notify()
    await new Promise((r) => setTimeout(r, 600))
    const pet = document.querySelector('.dsh-pet-actor-wrap') || document.querySelector('.dsh-pet-actor')
    const panel = document.querySelector('.dsh-pet-panel')
    const wrap = document.querySelector('.dsh-pet-panelwrap')
    if (!pet || !panel) return { error: 'missing nodes', hasPet: !!pet, hasPanel: !!panel }
    const pr = pet.getBoundingClientRect()
    const nr = (wrap || panel).getBoundingClientRect()
    const ox = Math.max(0, Math.min(pr.right, nr.right) - Math.max(pr.left, nr.left))
    const oy = Math.max(0, Math.min(pr.bottom, nr.bottom) - Math.max(pr.top, nr.top))
    return {
      panel: { x: Math.round(nr.left), y: Math.round(nr.top), w: Math.round(nr.width), h: Math.round(nr.height) },
      pet: { x: Math.round(pr.left), y: Math.round(pr.top), w: Math.round(pr.width), h: Math.round(pr.height) },
      overlap: Math.round(ox) + 'x' + Math.round(oy),
      overlapArea: Math.round(ox * oy),
      viewport: window.innerWidth + 'x' + window.innerHeight,
    }
  })()`,

  clips: `(async () => {
    const api = window.__dshPet
    if (!api) return { error: 'no __dshPet handle' }
    api.runtime.visible = true
    const rows = []
    const ACTIONS = ['dance', 'walk', 'hair']
    for (const id of Object.keys(api.PERSONAS)) {
      const has = api.PERSONAS[id].clips || {}
      for (const act of ACTIONS) {
        // 没有片段的动作走帧动画，这里只验"有片段的动作确实播了视频"
        if (!has[act]) {
          rows.push({ id, act, clip: null, skipped: 'no clip (frame animation)' })
          continue
        }
        api.runtime.settings.persona = id
        api.runtime.action = null
        api.runtime.lastErrorAt = 0
        api.runtime.mood = act
        api.runtime.moodUntil = Date.now() + 6000
        api.notify()
        await new Promise((r) => setTimeout(r, 320))
        api.playAction(act, { ms: 3000 })
        await new Promise((r) => setTimeout(r, 800))
        const v = document.querySelector('.dsh-pet-video')
        if (!v) {
          rows.push({ id, act, clip: has[act], video: false, mood: api.runtime.mood })
          continue
        }
        const t0 = v.currentTime
        await new Promise((r) => setTimeout(r, 450))
        rows.push({
          id,
          act,
          src: String(v.currentSrc || v.src).split('/').pop(),
          readyState: v.readyState,
          playing: !v.paused,
          size: v.videoWidth + 'x' + v.videoHeight,
          advanced: Math.round((v.currentTime - t0) * 1000) / 1000,
        })
      }
    }
    return rows
  })()`,

  dom: `(() => {
    const el = document.querySelector('.dsh-pet-root') || document.querySelector('.dsh-pet-actor')
    const api = window.__dshPet
    const r = el ? el.getBoundingClientRect() : null
    return {
      api: typeof api,
      petEls: document.querySelectorAll('.dsh-pet-actor').length,
      rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
      visibleText: el ? (el.innerText || '').slice(0, 200) : null,
      mounted: api && api.runtime ? Object.keys(api.runtime).slice(0, 12) : null,
      phase: api && api.runtime ? api.runtime.phase : null,
      lang: api && api.lang ? api.lang() : null,
    }
  })()`,
}

async function main() {
  if (!SCENARIOS[scenarioArg]) {
    console.error('unknown scenario:', scenarioArg)
    process.exit(2)
  }

  // 1. 等 Chrome 起来
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

  // 2. 打开页面，写调试标记，重载（句柄只在挂载时读标记）
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url })
  await sleep(8000)
  await send('Runtime.evaluate', {
    expression: "try{localStorage.setItem('dsh-pet.debug','1')}catch(e){}",
    returnByValue: true,
  })
  await send('Page.reload', {})
  await sleep(9000)

  // 3. 跑场景
  const r = await send('Runtime.evaluate', {
    expression: SCENARIOS[scenarioArg],
    awaitPromise: true,
    returnByValue: true,
  })
  if (r.result && r.result.exceptionDetails) {
    console.error('page error:', JSON.stringify(r.result.exceptionDetails).slice(0, 400))
    process.exit(1)
  }
  const value = r.result && r.result.result ? r.result.result.value : null
  console.log(JSON.stringify(value, null, 2))

  // 4. 可选截图
  if (shotArg) {
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    if (shot.result && shot.result.data) {
      fs.writeFileSync(shotArg, Buffer.from(shot.result.data, 'base64'))
      console.log('screenshot:', shotArg)
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
