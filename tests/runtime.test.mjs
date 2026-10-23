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
  env.advance(5167)
  assert.equal(R.action, null, '到片长就收尾')
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

test('R02 动作默认时长 = 片段时长（不再手写 1300/2400ms）', () => {
  const env = makeEnv()
  env.api.playAction('hair', { explicit: true })
  const act = env.api.runtime.action
  assert.equal(act.until - env.now(), CLIP_MS)
  assert.equal(act.clip, 'pet-violet-hair.webm')
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
  env.api.runToCenterAndDance()
  env.advance(1700) // walk → dance
  assert.equal(R.mood, 'dance')
  assert.ok(R.moodUntil - env.now() <= CLIP_MS, 'dance 心情窗口不能超过片段长度')
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
