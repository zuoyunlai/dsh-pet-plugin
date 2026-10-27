/**
 * 行为回归（1.19.3）：用 tests/harness.mjs 的可控环境，把审计里"台架能看见、
 * smoke 看不见"的缺陷固定成**失败即报错**的用例（而不是"bug 存在即通过"）。
 *
 * 覆盖：R03 单一动作链 / R02 片长与 loop / R01 片段失败回退 / R10 减弱动效 /
 *      R11 面板夹取 / R17 交叉淡入方向 / R08 轮询超时与卸载中止。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeEnv } from './harness.mjs'

const CLIP_MS = 5167
/** metadata 还没到手时的兜底上限（src/41-runtime.js CLIP_MAX_MS） */
const CLIP_GUARD_MS = 12000

/** 渲染树里找所有某类型的节点 */
function findAll(tree, type, out = []) {
  if (!tree || typeof tree !== 'object') return out
  if (typeof tree.type === 'function') {
    findAll(tree.type(tree.props || {}), type, out)
    return out
  }
  if (tree.type === type) out.push(tree)
  for (const c of tree.children || []) findAll(c, type, out)
  return out
}

test('R03 连点 20 次片段动作：只留一个收尾 timer、不再空转', () => {
  const env = makeEnv()
  const R = env.api.runtime
  const base = env.pending()
  for (let i = 0; i < 20; i++) env.api.playAction('hair', { explicit: true })
  assert.equal(env.pending(), base + 1, '20 次播放只该留下 1 个 timer')
  const v0 = R.version
  env.advance(340)
  assert.equal(R.version, v0, '视频模式不该每 340ms 空转 notify（旧实现 8 次/步）')
  env.advance(R.action.until - env.now())
  assert.ok(R.action && R.action.exiting, '到片长先进入 220ms 淡出，不是立刻卸载')
  env.advance(300)
  assert.equal(R.action, null, '淡出结束才收尾')
})

test('R03 帧序列动作（无片段）连点 8 次也只推进一帧', () => {
  const env = makeEnv()
  const R = env.api.runtime
  // 当前四只形象的三个动作都有片段：这里删掉片段，专门测帧序列调度链
  delete env.api.PERSONAS.violet.clips.hair
  for (let i = 0; i < 8; i++) env.api.playAction('hair', { explicit: true })
  const v0 = R.version
  env.advance(340)
  assert.equal(R.version - v0, 1, '一个步进只该 notify 一次')
  assert.equal(R.action.i, 1, '一个步进只推进一帧')
})

test('R03 覆盖动作后旧链立刻失效（不会推新动作）', () => {
  const env = makeEnv()
  const R = env.api.runtime
  delete env.api.PERSONAS.violet.clips.hair // 走帧序列路径，链才可见
  env.api.playAction('hair', { explicit: true })
  env.advance(340)
  const firstGen = R.action.gen
  env.api.playAction('hair', { explicit: true })
  const secondGen = R.action.gen
  assert.notEqual(secondGen, firstGen, '每次播放都要有新的代际令牌')
  const pending0 = env.pending()
  env.advance(340)
  assert.equal(R.action.gen, secondGen)
  assert.equal(R.action.i, 1, '新动作只被自己的链推进一次')
  assert.ok(env.pending() <= pending0, '待执行定时器不应随播放次数累积（旧实现 3→11）')
})

test('R02 片段时长以媒体 metadata 为准（1.20.0：不再写死 5167）', () => {
  const env = makeEnv()
  // metadata 还没到手：用宽上限兜底，真正的收尾由 onEnded 说了算
  env.api.playAction('hair', { explicit: true })
  let act = env.api.runtime.action
  assert.equal(act.until - env.now(), CLIP_GUARD_MS)
  assert.equal(act.clip, 'pet-violet-hair.webm')
  // metadata 到手：记下真实片长，之后的播放按它排
  env.api.noteClipDuration('pet-violet-hair.webm', CLIP_MS / 1000)
  assert.equal(env.api.runtime.clipMs['pet-violet-hair.webm'], CLIP_MS)
  env.api.playAction('hair', { explicit: true })
  act = env.api.runtime.action
  assert.equal(act.until - env.now(), CLIP_MS, '已知片长时收尾时间必须等于真实片长')
})

test('R02 metadata 比兜底更短时，当场把收尾时间收回来', () => {
  const env = makeEnv()
  env.api.playAction('hair', { explicit: true })
  assert.equal(env.api.runtime.action.until - env.now(), CLIP_GUARD_MS)
  env.api.noteClipDuration('pet-violet-hair.webm', CLIP_MS / 1000)
  assert.equal(env.api.runtime.action.until - env.now(), CLIP_MS, '要不早不晚地按片长收尾')
  env.advance(CLIP_MS)
  assert.ok(env.api.runtime.action && env.api.runtime.action.exiting, '到片长应先淡出')
  env.advance(300)
  assert.equal(env.api.runtime.action, null)
})

test('R02 长片段（10s）不会被 5.167s 的旧口径截断', () => {
  const env = makeEnv()
  env.api.noteClipDuration('pet-azure-dance.webm', 10)
  env.api.PERSONAS.violet.clips.hair = 'pet-azure-dance.webm'
  env.api.playAction('hair', { explicit: true })
  const act = env.api.runtime.action
  assert.equal(act.until - env.now(), 10000)
  env.advance(6000)
  assert.ok(env.api.runtime.action, '10s 的片段在 6s 时不该已经结束')
  env.advance(4000)
  assert.ok(env.api.runtime.action && env.api.runtime.action.exiting, '10s 到点才淡出')
})

test('R02 片段动作不排翻帧 timer（播放期间没有空转）', () => {
  const env = makeEnv()
  env.api.playAction('hair', { explicit: true })
  const timers0 = env.pending()
  env.advance(1000)
  assert.equal(env.pending(), timers0, '视频模式不应每 340ms 空转一次翻帧')
})

test('R02 dance 的窗口不再超过片段长度（避免 loop 回跳）', () => {
  const env = makeEnv()
  const R = env.api.runtime
  R.rootEl = {
    querySelector: () => ({ getBoundingClientRect: () => ({ left: 100, top: 100, width: 104, height: 200 }) }),
    parentElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
  }
  // 这条测的是**旧路径**（walk → dance → walk）里的 dance 窗口：
  // 1.20.0 起五只形象都有 clips.stage，会走 stage 分支，所以先把 stage 摘掉。
  const p = env.api.PERSONAS.violet
  const saved = p.clips.stage
  delete p.clips.stage
  try {
    env.api.runToCenterAndDance()
    env.advance(1700) // walk → dance
    assert.equal(R.mood, 'dance')
    assert.ok(R.moodUntil - env.now() <= CLIP_MS, 'dance 心情窗口不能超过片段长度')
  } finally {
    if (saved) p.clips.stage = saved
  }
})

test('R01 片段有 onError 回退，且不再 loop', () => {
  const env = makeEnv()
  env.api.playAction('hair', { explicit: true })
  const tree = env.api.PetArt({ persona: env.api.PERSONAS.violet, mood: 'idle' })
  const videos = findAll(tree, 'video')
  assert.equal(videos.length, 1)
  const p = videos[0].props
  assert.equal(p.loop, false, '一次性手势不能 loop')
  assert.equal(typeof p.onError, 'function', '必须有失败回退')
  assert.equal(typeof p.onPlaying, 'function', '必须等真正播放后再淡入')
  assert.equal(typeof p.onEnded, 'function', '播完要由媒体事件收尾')
  // 还没播起来：静帧顶着（人物必须可见）
  assert.ok(findAll(tree, 'img').length >= 1, '起播前不能空白')
})

test('R01 一旦播起来就撤掉静帧（alpha 视频下不能叠出两个人物）', () => {
  const env = makeEnv()
  const R = env.api.runtime
  env.api.playAction('dance', { explicit: true })
  const persona = env.api.PERSONAS.violet
  // 模拟 onPlaying：runtime 记下正在播的片段，然后重渲染
  R.clipPlaying = persona.clips.dance
  const tree = env.api.PetArt({ persona, mood: 'dance' })
  assert.equal(findAll(tree, 'img').length, 0, '播放中不能再画静帧，否则舞姿会透出底图（重叠）')
  const videos = findAll(tree, 'video')
  assert.equal(videos.length, 1)
  assert.ok(/is-ready/.test(videos[0].props.className), 'video 应该立即不透明')
  // 动作结束后回到静帧
  R.clipPlaying = ''
  R.action = null
  const idleTree = env.api.PetArt({ persona, mood: 'dance' })
  assert.ok(findAll(idleTree, 'img').length >= 1, '动作结束后必须回到静帧')
})

test('R01 失败后被记住：下一次直接走静帧，不再挂 video', () => {
  const env = makeEnv()
  const R = env.api.runtime
  R.clipFailed['pet-violet-hair.webm'] = true
  env.api.playAction('hair', { explicit: true })
  const tree = env.api.PetArt({ persona: env.api.PERSONAS.violet, mood: 'idle' })
  assert.equal(findAll(tree, 'video').length, 0, '失败记忆生效后不应再渲染 video')
  assert.ok(findAll(tree, 'img').length >= 1, '仍然要有人物静帧')
})

test('R10 减弱动效时不自动播动作，显式点播仍然放行', () => {
  const env = makeEnv({ reduced: true })
  const R = env.api.runtime
  assert.equal(R.reduced, true, 'apply 时应读到系统设置')
  assert.equal(env.api.playAction('walk', { moodDriven: true }), false, '自动动作不播')
  assert.equal(R.action, null)
  assert.equal(env.api.playAction('hair', { explicit: true }), true, '用户点播允许')
  assert.equal(R.action.name, 'hair')
})

test('R10 舞蹈在减弱动效下不搬到屏幕中间', () => {
  const env = makeEnv({ reduced: true })
  const R = env.api.runtime
  R.rootEl = { querySelector: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 104, height: 200 }) }) }
  env.api.runToCenterAndDance()
  assert.equal(R.stage, null, 'reduce 模式不应移动舞台')
  assert.equal(R.action && R.action.name, 'dance')
})

test('R21 有 stage 片段时：一条连贯片段演完，中途不再切 walk/dance', () => {
  const env = makeEnv()
  const R = env.api.runtime
  R.settings.persona = 'azure'
  R.rootEl = {
    querySelector: () => ({ getBoundingClientRect: () => ({ left: 100, top: 100, width: 104, height: 200 }) }),
    parentElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
  }
  env.api.runToCenterAndDance()
  assert.equal(R.mood, 'stage', 'stage 片段走单独的心情值')
  assert.ok(R.stage && R.stage.zoom === 1.8, '仍然搬到屏幕中间')
  // 相位排程要等一拍再按真实片长算；记一次「心情变过没有」
  const seen = new Set()
  // metadata 在测试里拿不到 → 兜底 CLIP_GUARD_MS(12s)，相位按它排；多给两拍余量
  for (let i = 0; i < 60; i++) {
    env.advance(260)
    seen.add(R.mood)
    if (R.mood === 'idle' && !R.stage) break
  }
  assert.ok(!seen.has('dance'), 'stage 片段期间不应切到 dance（那会换片段 → 抖动）')
  assert.ok(!seen.has('walk'), 'stage 片段期间也不应切到 walk')
  assert.equal(R.stage, null, '演完必须回到角落')
  assert.equal(R.mood, 'idle', '演完心情回 idle')
})

test('R21 没有 stage 片段的形象仍走旧的 walk → dance → walk', () => {
  const env = makeEnv()
  const R = env.api.runtime
  R.rootEl = {
    querySelector: () => ({ getBoundingClientRect: () => ({ left: 100, top: 100, width: 104, height: 200 }) }),
    parentElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
  }
  // 1.20.0 起五只形象都有 clips.stage；这条守的是「万一某只没有 stage」的回落路径，
  // 所以显式把 stage 摘掉再测，别依赖哪只形象恰好缺素材。
  const p = env.api.PERSONAS.violet
  const saved = p.clips.stage
  delete p.clips.stage
  try {
    env.api.runToCenterAndDance()
    assert.equal(R.mood, 'walk', '没有 stage 片段时应先用 walk 走过去')
    env.advance(1700)
    assert.equal(R.mood, 'dance')
  } finally {
    if (saved) p.clips.stage = saved
  }
})

test('R11 宠物贴左右上下四边时，面板都完整落在视口内', () => {
  const cases = [
    { name: '左边缘', rect: { left: 20, top: 100, right: 124, bottom: 204 } },
    { name: '右边缘', rect: { left: 1150, top: 700, right: 1254, bottom: 800 } },
    { name: '顶部', rect: { left: 600, top: 0, right: 704, bottom: 104 } },
    { name: '底部', rect: { left: 600, top: 696, right: 704, bottom: 800 } },
  ]
  for (const c of cases) {
    const env = makeEnv({ innerWidth: 1280, innerHeight: 800, actorRect: { ...c.rect, width: 104, height: c.rect.bottom - c.rect.top } })
    env.api.placePanel()
    const pos = env.api.runtime.panelPos
    assert.ok(pos, c.name + '：应算出位置')
    const W = parseFloat(pos.width)
    const H = parseFloat(pos.maxHeight)
    const right = parseFloat(pos.right)
    const bottom = parseFloat(pos.bottom)
    const left = 1280 - right - W
    const top = 800 - bottom - H
    assert.ok(left >= 7.5, `${c.name}：左边缘 ${left} 越界`)
    assert.ok(top >= 7.5, `${c.name}：上边缘 ${top} 越界`)
    assert.ok(right >= 7.5 && bottom >= 7.5, `${c.name}：右/下边距`)
  }
})

test('R11 窄窗口（800×600）也不越界', () => {
  const env = makeEnv({ innerWidth: 800, innerHeight: 600, actorRect: { left: 10, top: 50, right: 114, bottom: 154, width: 104, height: 104 } })
  env.api.placePanel()
  const pos = env.api.runtime.panelPos
  const left = 800 - parseFloat(pos.right) - parseFloat(pos.width)
  const top = 600 - parseFloat(pos.bottom) - parseFloat(pos.maxHeight)
  assert.ok(left >= 7.5 && top >= 7.5, `窄窗口越界：left=${left} top=${top}`)
})

test('R17 交叉淡入方向只跟着 src 变化翻转', () => {
  const env = makeEnv()
  const p = env.api.PERSONAS.violet
  const dx = []
  for (let i = 0; i < 4; i++) {
    const tree = env.api.PetArt({ persona: p, mood: 'idle' })
    const wraps = []
    const walk = (n) => {
      if (!n || typeof n !== 'object') return
      if (typeof n.type === 'function') return walk(n.type(n.props || {}))
      if (n.props && typeof n.props.className === 'string' && n.props.className.includes('dsh-pet-imgwrap')) wraps.push(n.props.style)
      for (const c of n.children || []) walk(c)
    }
    walk(tree)
    dx.push(wraps.length ? wraps[0]['--pet-dx'] : null)
  }
  assert.deepEqual(dx, ['3px', '3px', '3px', '3px'], '同一个 src 反复渲染不能翻转方向')
})

test('R08 轮询有超时：卡住的请求会被中止并继续排下一次', async () => {
  const aborted = []
  const env = makeEnv({
    fetchHandler: (url, init) =>
      new Promise((resolve, reject) => {
        const signal = init && init.signal
        if (!signal) return // 没有 signal 就永远挂着（旧实现就是这样卡死的）
        signal.addEventListener('abort', () => {
          aborted.push(String(url))
          reject(new Error('aborted'))
        })
      }),
  })
  env.advance(9000) // 超过 8s 预算，触发 abort
  await new Promise((r) => setImmediate(r))
  env.advance(9000)
  await new Promise((r) => setImmediate(r))
  const pings = env.fetchLog.filter((f) => f.url.indexOf('/dsh-pet/ping') >= 0)
  assert.ok(aborted.length >= 1, '超时后必须 abort 在途请求')
  assert.ok(pings.length >= 2, '链不能停在第一个请求上，实际 ' + pings.length)
})

test('R08 卸载会中止在途请求，且不再写状态', async () => {
  let seen = 0
  const env = makeEnv({
    fetchHandler: (url, init) => {
      seen++
      return new Promise((resolve, reject) => {
        const signal = init && init.signal
        if (signal) signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    },
  })
  await new Promise((r) => setImmediate(r))
  const before = env.api.runtime.lastToolAt
  env.disposeAll()
  env.advance(9000)
  await new Promise((r) => setImmediate(r))
  assert.equal(env.api.runtime.lastToolAt, before, '卸载后不能改写 runtime')
  assert.ok(seen >= 1)
})

test('F2 音画同步：人不在屏幕上就不冒泡、不说话', () => {
  const env = makeEnv()
  const R = env.api.runtime
  R.rootEl = { querySelector: () => null, parentElement: null }
  // ① 藏起来（visible=false）
  R.visible = false
  R.petOffscreen = false
  R.bubble = null
  R.speaking = false
  env.api.bubble('藏起来了还说话是 bug')
  assert.equal(R.bubble, null, '不可见时不能挂台词气泡')
  assert.equal(R.speaking, false, '不可见时不能进入说话状态')

  // ② 被拖出视口（petOffscreen）
  R.visible = true
  R.petOffscreen = true
  env.api.bubble('拖出屏幕也不许说话')
  assert.equal(R.bubble, null, 'petOffscreen 时不能挂台词气泡')

  // ③ 正常可见：照旧
  R.petOffscreen = false
  env.api.bubble('这句可以说')
  assert.ok(R.bubble && R.bubble.text === '这句可以说', '可见时必须正常说话')
})

test('F2 藏起来会立刻掐断正在说的那句（音画同步收口）', () => {
  const env = makeEnv()
  const R = env.api.runtime
  R.rootEl = { querySelector: () => null, parentElement: null }
  R.visible = true
  R.petOffscreen = false
  env.api.bubble('正在说话')
  assert.ok(R.speaking, '可见时应当进入说话状态')
  env.api.hidePet(0)
  assert.equal(R.visible, false)
  assert.equal(R.speaking, false, '藏起来必须立刻 stopVoice（否则声音还在）')
})

test('F1 阶段机：lastToolAt / lastErrorAt 驱动 tool 与 error 两态', () => {
  const env = makeEnv()
  const R = env.api.runtime
  R.speaking = false
  R.speakUntil = 0
  R.bubble = null
  R.running = true
  R.lastToolAt = 1
  R.lastErrorAt = 1
  assert.equal(env.api.phase(), 'error', 'error 优先于 tool')
  R.lastErrorAt = 0
  assert.equal(env.api.phase(), 'tool')
  R.lastToolAt = 0
  assert.equal(env.api.phase(), 'working')
  R.running = false
  assert.equal(env.api.phase(), 'idle')
})

test('片段结束时有淡出窗口：静帧垫在下面，video 走 is-leaving', () => {
  const env = makeEnv()
  const R = env.api.runtime
  const persona = env.api.PERSONAS.violet
  env.api.playAction('dance', { explicit: true })
  const gen = R.action.gen
  R.clipPlaying = persona.clips.dance
  // 播到片长：进入 exiting
  env.advance(R.action.until - env.now())
  assert.ok(R.action && R.action.exiting, '应当先进入淡出')
  assert.equal(R.clipPlaying, '', '淡出期间不再算正在播放')
  const tree = env.api.PetArt({ persona, mood: 'dance' })
  const imgs = findAll(tree, 'img')
  const videos = findAll(tree, 'video')
  assert.ok(imgs.length >= 1, '淡出期间静帧必须在下面（否则就是硬切）')
  assert.equal(videos.length, 1)
  assert.ok(/is-leaving/.test(videos[0].props.className), 'video 应带 is-leaving 淡出类')
  // 淡出结束后只剩静帧
  env.advance(220)
  assert.equal(R.action, null)
  assert.equal(findAll(env.api.PetArt({ persona, mood: 'dance' }), 'video').length, 0)
})

test('F3 心声：只有写了 lines.aside 的形象才冒，且不出声', () => {
  const env = makeEnv()
  const R = env.api.runtime
  R.rootEl = { querySelector: () => null, parentElement: null }
  R.visible = true
  R.petOffscreen = false
  R.bubble = null
  R.aside = null
  R.speaking = false

  // 1.23.0：五只都补齐了 aside，不能再靠「某个形象没写」来验证降级。
  // 改为人为挖掉**五语**的 aside（只删中文会被 linesEn 兜住），
  // 证明缺这类台词时安静、且绝不回落 idle。
  const p = env.api.PERSONAS.violet
  const KEYS = ['lines', 'linesEn', 'linesEs', 'linesPt', 'linesHi']
  const saved = KEYS.map((k) => p[k] && p[k].aside)
  try {
    for (const k of KEYS) if (p[k]) delete p[k].aside
    R.settings.persona = 'violet'
    assert.equal(env.api.asideLine(), '', '没有 aside 台词的形象不该有可抽的心声')
    assert.equal(env.api.maybeAside(1), '', '没有 aside 台词时强制概率也不冒')
    assert.ok(env.api.linesOf('idle').length > 0, 'idle 仍然可用——证明不是靠清空全部台词才安静的')
  } finally {
    KEYS.forEach((k, i) => {
      if (p[k] && saved[i] !== undefined) p[k].aside = saved[i]
    })
  }

  // 有 aside：强制概率必中，且只出字不出声
  R.settings.persona = 'azure'
  const text = env.api.maybeAside(1)
  assert.ok(text, 'azure 应当有心声可抽')
  assert.equal(R.aside && R.aside.text, text, '心声要挂到 runtime.aside')
  assert.equal(R.aside.ttl > 0, true, '心声要有存活时间')
  assert.equal(R.speaking, false, '心声是内心 OS，不许出声')
  assert.equal(R.bubble, null, '心声不能顶替正式台词气泡')
})

test('F3 心声会自己过期消失', () => {
  const env = makeEnv()
  const R = env.api.runtime
  R.rootEl = { querySelector: () => null, parentElement: null }
  R.visible = true
  R.petOffscreen = false
  R.settings.persona = 'azure'
  R.settings.chatter = false
  R.aside = null
  env.api.maybeAside(1)
  assert.ok(R.aside, '先有一条心声')
  const ttl = R.aside.ttl
  env.advance(ttl + 6000)
  assert.equal(R.aside, null, '超过存活时间要清掉，否则会一直挂在屏幕上')
})

test('F3 人不在屏幕上也不冒心声', () => {
  const env = makeEnv()
  const R = env.api.runtime
  R.rootEl = { querySelector: () => null, parentElement: null }
  R.settings.persona = 'azure'
  R.aside = null
  R.visible = false
  env.api.bubble('藏起来了')
  assert.equal(R.aside, null, '不可见时连心声也不能挂')
})

test('F4 导演层：auto 时用形象自带音色，五只各不相同', () => {
  const env = makeEnv()
  const R = env.api.runtime
  R.settings.ttsVoice = 'auto'
  R.settings.voicePitch = null
  R.settings.voiceRate = null
  const seen = {}
  for (const pid of ['violet', 'crimson', 'indigo', 'silver', 'azure']) {
    R.settings.persona = pid
    const v = env.api.voiceParams('idle')
    assert.ok(v.voice, pid + ' 应当自带音色（auto 不能落回全局默认）')
    seen[pid] = v.voice
  }
  // 至少要有 3 个不同嗓子，否则还是「同一个人变调」
  const uniq = new Set(Object.values(seen))
  assert.ok(uniq.size >= 3, '五个形象至少三种音色，实际 ' + JSON.stringify(seen))

  // 手选了具体音色就覆盖角色自带
  R.settings.persona = 'silver'
  R.settings.ttsVoice = 'xiaobei'
  assert.equal(env.api.voiceParams('idle').voice, 'xiaobei', '手选音色必须优先')
})

test('F4 基座音高不许飘到「幼稚」区间', () => {
  const env = makeEnv()
  const P = env.api.PERSONAS
  // 薇是成熟御姐，基座抬到 1.18 会变成小女孩嗓音（用户实测反馈）
  assert.ok(P.violet.voice.pitch <= 1.04, '薇的基座音高不应高于 1.04，现在 ' + P.violet.voice.pitch)
  for (const id of Object.keys(P)) {
    const v = P[id].voice
    assert.ok(v.pitch >= 0.88 && v.pitch <= 1.16, id + ' 基座音高越界：' + v.pitch)
    assert.ok(v.rate >= 0.75 && v.rate <= 1.05, id + ' 基座语速越界：' + v.rate)
  }
})

test('F4 导演层：心情改演绎，且不越界', () => {
  const env = makeEnv()
  const R = env.api.runtime
  R.settings.ttsVoice = 'auto'
  R.settings.voicePitch = null
  R.settings.voiceRate = null
  R.settings.persona = 'crimson'
  const idle = env.api.voiceParams('idle')
  const dance = env.api.voiceParams('dance')
  const sleep = env.api.voiceParams('sleep')
  assert.ok(dance.pitch > idle.pitch, '跳舞要比平时亮')
  assert.ok(dance.rate > idle.rate, '跳舞要比平时快')
  assert.ok(sleep.rate < idle.rate, '入睡要比平时慢')
  assert.ok(sleep.volume < idle.volume, '入睡要比平时轻')
  for (const v of [idle, dance, sleep]) {
    assert.ok(v.pitch >= 0.5 && v.pitch <= 2, 'pitch 必须夹在 0.5–2')
    assert.ok(v.rate >= 0.5 && v.rate <= 2, 'rate 必须夹在 0.5–2')
    assert.ok(v.volume >= 0 && v.volume <= 2, 'volume 必须夹在 0–2')
  }
  // 没有 moods 的方向表时按基座走，不能崩
  R.settings.persona = 'violet'
  const p = env.api.PERSONAS.violet
  const saved = p.voice.moods
  try {
    delete p.voice.moods
    const v = env.api.voiceParams('anything')
    assert.equal(v.volume, 1, '没有方向表时音量应为 1')
    assert.ok(v.pitch > 0, '没有方向表时仍要给出基座音高')
  } finally {
    p.voice.moods = saved
  }
})

test('F3 被拖动台词：有 drag 才说，没有就安静（不回落 idle）', () => {
  const env = makeEnv()
  const R = env.api.runtime
  R.settings.persona = 'azure'
  assert.ok(env.api.dragLine(), 'azure 应当有拖动台词')

  // 1.23.0：五只都补齐了 drag，改用人为挖掉**五语**的 drag 来验证降级机制
  // （只删中文会被 linesEn 兜住，那样测不到降级）
  const p = env.api.PERSONAS.violet
  const KEYS = ['lines', 'linesEn', 'linesEs', 'linesPt', 'linesHi']
  const saved = KEYS.map((k) => p[k] && p[k].drag)
  try {
    for (const k of KEYS) if (p[k]) delete p[k].drag
    R.settings.persona = 'violet'
    assert.equal(env.api.dragLine(), '', '没有 drag 台词时不能拿 idle 台词顶上')
    assert.ok(env.api.linesOf('idle').length > 0, 'idle 仍然正常可用')
  } finally {
    KEYS.forEach((k, i) => {
      if (p[k] && saved[i] !== undefined) p[k].drag = saved[i]
    })
  }

  // 补齐后五只都必须有 drag/aside（防回归：新增形象漏写会立刻红）
  for (const id of Object.keys(env.api.PERSONAS)) {
    R.settings.persona = id
    assert.ok(env.api.dragLine(), id + ' 缺少 drag 台词')
    assert.ok(env.api.asideLine(), id + ' 缺少 aside 台词')
  }
})

test('1.22.0 面板顶部让开顶栏（用户报：X 被顶栏盖住点不到）', () => {
  // 宠物拖到屏幕最上方：旧实现只保证 top>=8，面板顶部会钻进顶栏，
  // 右上角的 × 正好被盖住。现在顶部至少让出 headerSafeArea（测不到时 44px）+ 边距。
  const env = makeEnv({
    innerWidth: 1280,
    innerHeight: 800,
    actorRect: { left: 600, top: 0, right: 704, bottom: 104, width: 104, height: 104 },
  })
  env.api.placePanel()
  const pos = env.api.runtime.panelPos
  const top = 800 - parseFloat(pos.bottom) - parseFloat(pos.maxHeight)
  assert.ok(top >= 52, `面板顶部 ${top} 未让开顶栏安全区 52`)
})

test('1.22.0 低分辨率下面板按可用高度收缩，不超出屏幕', () => {
  for (const vh of [600, 768, 900]) {
    const env = makeEnv({
      innerWidth: 1024,
      innerHeight: vh,
      actorRect: { left: 860, top: vh - 150, right: 964, bottom: vh - 46, width: 104, height: 104 },
    })
    env.api.placePanel()
    const pos = env.api.runtime.panelPos
    const H = parseFloat(pos.maxHeight)
    const top = vh - parseFloat(pos.bottom) - H
    assert.ok(top >= 7.5, `vh=${vh}：顶部越界 top=${top}`)
    assert.ok(top + H <= vh, `vh=${vh}：底部越界`)
    assert.ok(H < vh, `vh=${vh}：面板比屏幕还高`)
  }
})

test('1.22.0 输入框默认是悬停模式，不常显', () => {
  const env = makeEnv()
  const s = env.api.runtime.settings
  assert.equal(s.inputMode, 'hover', '默认应为悬停模式')
  assert.equal(s.showInput, true, 'showInput 仍为 true（只控制是否渲染，不控制常显）')
  assert.equal(env.api.runtime.hovering, false, '初始不处于 hover')
})

test('1.22.0 悬停人物会展开输入框，移开（延迟后）收起', () => {
  const env = makeEnv()
  const A = env.api
  const R = A.runtime
  A.setHover(true)
  assert.equal(R.hovering, true, '悬停应立即展开')
  A.setHover(false)
  // 关键：宽限期内必须仍展开。这里断言「100ms 时还开着」，
  // 把延迟改成 0 会立刻抓红（只断言「最终收起」是抓不到的）。
  env.advance(100)
  assert.equal(R.hovering, true, '移开后 100ms 内应保持展开（给鼠标穿过间隙的时间）')
  env.advance(200)
  assert.equal(R.hovering, false, '宽限期过后应收起')
})

test('1.22.0 鼠标快速移回会取消收起（不会闪一下）', () => {
  const env = makeEnv()
  const A = env.api
  const R = A.runtime
  A.setHover(true)
  A.setHover(false) // 触发延迟
  env.advance(100) // 还没到 200ms
  A.setHover(true) // 又移回来了
  env.advance(400)
  assert.equal(R.hovering, true, '移回后应保持展开，不能被挂起的收起定时器关掉')
})
