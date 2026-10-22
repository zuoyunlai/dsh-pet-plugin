    /* ================= 说话气泡 ================= */

    /**
     * 阶段机：把「会话在跑 / 刚调过工具 / 刚出错 / 正在说话 / 刚结束」压成一个
     * 字符串，界面只按它换表情与动作。全部来自已有信号，不新增宿主要求：
     *   - running：客户端 useSession 拿到的布尔量
     *   - lastToolAt / lastErrorAt：宿主 tool/result 事件的时间戳，经 /ping 回传
     *   - speaking / doneUntil：本地状态
     */
    const TOOL_WINDOW = 5000 // 工具活动后保持「在调工具」的时长
    const ERROR_WINDOW = 8000 // 出错后保持「生气/乌云」的时长
    const DONE_WINDOW = 4000 // 一轮结束后「done」的时长

    function computePhase() {
      const now = nowMs()
      if (runtime.speaking) return 'speak'
      if (runtime.lastErrorAt && now - runtime.lastErrorAt < ERROR_WINDOW) return 'error'
      if (runtime.lastToolAt && now - runtime.lastToolAt < TOOL_WINDOW) return 'tool'
      if (runtime.running) return 'working'
      if (runtime.doneUntil && now < runtime.doneUntil) return 'done'
      return 'idle'
    }

    /** 重算并落库；有变化时返回新阶段，否则返回 '' */
    function syncPhase() {
      const next = computePhase()
      if (next === runtime.phase) return ''
      runtime.phase = next
      return next
    }

    function bubble(text, ttl) {
      if (!text) return
      const s = runtime.settings
      const t = String(text)
      runtime.bubble = { text: t, at: nowMs(), ttl: ttl || clamp(2200 + t.length * 90, 2600, 9000) }
      if (s.voiceOn) speak(t)
      notify()
    }

    function randomLine(mood) {
      const p = persona()
      // 语言包优先：lines<Lang> → linesEn → lines（中文原稿）
      const key = 'lines' + PET_LANG.charAt(0).toUpperCase() + PET_LANG.slice(1)
      const pack = (p[key] && PET_LANG !== 'zh' ? p[key] : null) || (PET_LANG === 'zh' || !p.linesEn ? p.lines : p.linesEn)
      const list = (pack && pack[mood]) || (p.lines && p.lines[mood]) || (p.lines && p.lines.idle) || []
      return list.length ? pick(list) : ''
    }

    /* ================= 出现 / 消失 ================= */

    function showPet(kind) {
      const wasVisible = runtime.visible
      // 手动叫出来必须解除「藏 1 小时」，否则 5 秒后 tick 又把她藏回去
      runtime.snoozeUntil = 0
      runtime.visible = true
      runtime.visibleUntil = nowMs() + randInt(45, 150) * 1000
      runtime.mood = kind === 'dance' ? 'dance' : 'happy'
      runtime.moodUntil = nowMs() + randInt(3000, 5000)
      if (!wasVisible && runtime.settings.chatter) bubble(randomLine(kind === 'dance' ? 'dance' : 'appear'))
      notify()
    }

    /** 藏起来；传 snoozeMs 就是「藏这么久」（0 = 只藏到下次 tick） */
    function hidePet(snoozeMs) {
      if (snoozeMs) runtime.snoozeUntil = nowMs() + Number(snoozeMs)
      runtime.visible = false
      runtime.chatOpen = false
      stopVoice()
      notify()
    }

    /**
     * 设置面板摆哪儿：默认贴右下角会把她整个人盖住，所以按她的实际位置算。
     * 上方空间够就放她上方（右对齐），不够就放她左侧（底对齐）。
     * 面板定宽 196px，与 CSS 里 .dsh-pet-panel 的 width 保持一致。
     */
    const PANEL_W = 196
    const PANEL_GAP = 8

    function placePanel() {
      try {
        const el = (typeof document !== 'undefined' && document.querySelector('.dsh-pet-actor-wrap')) || runtime.rootEl
        const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null
        const vw = window.innerWidth || 1280
        const vh = window.innerHeight || 800
        if (!r || !r.height) {
          runtime.panelPos = null
          return
        }
        const spaceAbove = r.top - 16
        if (spaceAbove >= 300) {
          // 上方放得下：右边缘对齐，底边贴着她头顶
          runtime.panelPos = {
            right: Math.max(8, vw - r.right) + 'px',
            bottom: Math.max(8, vh - r.top + PANEL_GAP) + 'px',
            maxHeight: Math.min(spaceAbove, 560) + 'px',
            width: PANEL_W + 'px',
          }
        } else {
          // 上方不够：放她左边，底边与她脚底对齐
          runtime.panelPos = {
            right: Math.max(8, vw - r.left + PANEL_GAP) + 'px',
            bottom: Math.max(8, vh - r.bottom) + 'px',
            maxHeight: Math.min(Math.max(r.height + 60, 260), 520) + 'px',
            width: PANEL_W + 'px',
          }
        }
      } catch (e) {
        runtime.panelPos = null
      }
    }

    /* ================= 心情循环 ================= */

    let lastChatterAt = 0

    function scheduleMood() {
      const p = persona()
      const prev = runtime.mood
      const m = weighted(p.temper)
      runtime.mood = m
      runtime.moodUntil = nowMs() + randInt(4000, 9000)
      if (runtime.settings.chatter && m !== 'talk' && m !== 'idle') {
        const line = randomLine(m)
        if (line && Math.random() < 0.55) bubble(line)
      }
      // 心情没变就不用重渲染（bubble 自己会 notify）
      if (m !== prev) notify()
    }

    function tick() {
      const now = nowMs()
      const s = runtime.settings

      // 阶段机：先算阶段，再按阶段给一点情绪反馈
      const prevPhase = runtime.phase
      syncPhase()
      if (runtime.phase !== prevPhase) {
        if (runtime.phase === 'error') {
          runtime.mood = 'angry'
          runtime.moodUntil = now + 3000
        } else if (runtime.phase === 'done' && runtime.settings.celebrate !== false) {
          runtime.mood = 'happy'
          runtime.moodUntil = now + 3500
        } else if (runtime.phase === 'tool' && runtime.mood === 'idle' && runtime.visible) {
          // 在调工具时轻轻踱两步，别一直僵着
          runtime.mood = 'walk'
          runtime.moodUntil = now + Math.min(TOOL_WINDOW, 3000)
        }
      }

      // 出现逻辑
      if (s.mode === 'always') {
        if (now < runtime.snoozeUntil) {
          if (runtime.visible) hidePet()
        } else if (!runtime.visible) {
          runtime.visible = true
          runtime.visibleUntil = 0
          if (s.chatter) bubble(randomLine('appear'))
          notify()
        }
      } else {
        const inWindow = inActiveWindow(new Date(), s.activeStart, s.activeEnd)
        if (runtime.visible) {
          if (!runtime.visibleUntil) runtime.visibleUntil = now + randInt(45, 150) * 1000
          if (!inWindow || now > runtime.visibleUntil) hidePet()
        } else if (inWindow) {
          // probability 是「每小时出现概率」，换算成每个 tick 的概率
          const perTick = (clamp(s.probability, 0, 100) / 100) * (TICK_MS / 3600000)
          if (Math.random() < perTick) showPet('dance')
        }
      }

      // 气泡过期
      if (runtime.bubble && now - runtime.bubble.at > runtime.bubble.ttl) {
        runtime.bubble = null
        notify()
      }

      // 语音兜底解锁：自动播放被浏览器拦掉时 onend 不会来
      if (runtime.speaking && runtime.speakUntil && now > runtime.speakUntil) {
        runtime.speaking = false
        runtime.speakUntil = 0
        if (runtime.mood === 'talk') runtime.mood = 'idle'
        notify()
      }

      // 心情轮换（跳舞期间锁住，别被随机心情打断）
      if (!runtime.stage && now > runtime.moodUntil && !runtime.speaking) scheduleMood()

      // 闲聊
      if (runtime.visible && s.chatter && !runtime.speaking && now - lastChatterAt > randInt(150, 300) * 1000) {
        lastChatterAt = now
        const line = randomLine('idle')
        if (line) bubble(line)
      }

      // 偶尔撩一下头发（白天的「活人感」主要靠这个）
      if (runtime.visible && !runtime.action && Math.random() < 0.008) playAction('hair', { ms: 1300 })

      // 低频恶作剧：墨水/起雾 ~2 小时一次，炸弹 ~4 小时一次
      if (s.chaos !== false && runtime.visible && !runtime.fx.length) {
        const roll = Math.random()
        if (roll < 0.00035) playFx('boom', { ttl: 2600 })
        else if (roll < 0.0011) playFx(Math.random() < 0.55 ? 'ink' : 'fog', { ttl: 6500 })
      }
    }

    const TICK_MS = 5000

    /* ================= 跟宠物单聊（一次性模型调用，不进会话） ================= */

    function petLog(...args) {
      try {
        console.info('[dsh-pet]', ...args)
      } catch (e) {
        /* ignore */
      }
    }

    const HISTORY_KEY = 'dsh-pet.history.v1'

    function pushHistory(role, content) {
      try {
        runtime.history.push({ role, content: String(content).slice(0, 800) })
        if (runtime.history.length > 8) runtime.history.splice(0, runtime.history.length - 8)
        // 刷新页面也不失忆：只留最近 8 条
        try {
          window.localStorage.setItem(HISTORY_KEY, JSON.stringify(runtime.history.slice(-8)))
        } catch (e) {
          /* 隐私模式/配额满，忽略 */
        }
      } catch (e) {
        /* ignore */
      }
    }

    function loadHistory() {
      try {
        const raw = window.localStorage.getItem(HISTORY_KEY)
        const arr = raw ? JSON.parse(raw) : []
        if (Array.isArray(arr)) {
          runtime.history = arr
            .filter((m) => m && typeof m.content === 'string')
            .slice(-8)
            .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
        }
      } catch (e) {
        runtime.history = []
      }
    }

    async function chatWithPet(text) {
      const body = {
        text,
        history: runtime.history.slice(-8),
        // 只给 id：人设文本留在宿主，页面无法往 system prompt 里塞东西
        personaId: runtime.settings.persona,
        lang: PET_LANG,
      }

      // 宿主注入的绝对地址最可靠（网页版与 dsh-app:// 壳都适用），
      // 没有注入时才退回同源相对路径。
      const urls = []
      const injected = typeof window !== 'undefined' && window.__DSH_PET_API__
      if (typeof injected === 'string' && injected) urls.push(injected)
      if (urls.indexOf('/dsh-pet/chat') === -1) urls.push('/dsh-pet/chat')

      let lastErr = null
      for (const url of urls) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
          })
          const raw = await res.text()
          let data = null
          try {
            data = JSON.parse(raw)
          } catch (e) {
            throw new Error('HTTP ' + res.status + ' 非 JSON')
          }
          if (!res.ok || !data.reply) {
            throw new Error((data && (data.message || data.error)) || 'HTTP ' + res.status)
          }
          petLog('chat ok', { via: url })
          return String(data.reply)
        } catch (e) {
          lastErr = e
          petLog('chat attempt failed', { via: url, msg: String((e && e.message) || e) })
        }
      }
      throw lastErr || new Error('没有可用的接口地址')
    }

    function sayToPet(text) {
      const p = persona()
      pushHistory('user', text)
      runtime.ai = 'busy'
      bubble('……', 60000)
      notify()
      chatWithPet(text)
        .then((reply) => {
          runtime.ai = 'ok'
          pushHistory('assistant', reply)
          bubble(reply, Math.max(3200, Math.min(12000, 900 + reply.length * 120)))
        })
        .catch((e) => {
          runtime.ai = 'fail'
          const msg = String((e && e.message) || e)
          let origin = '?'
          let api = 'none'
          try {
            origin = window.location.origin || 'null'
            api = window.__DSH_PET_API__ ? 'injected' : 'none'
          } catch (err) {
            /* ignore */
          }
          petLog('chat failed', { msg, origin, api })
          if (/SIGN_IN|ACCOUNT|auth/i.test(msg)) {
            bubble('得先在 DSH 里登录 DeepSeek，我才用得上大模型。', 6000)
          } else {
            bubble(
              (pick(p.lines.error) || '我这会儿脑子有点卡住了。') +
                '\n[origin=' +
                origin +
                ' api=' +
                api +
                ']\n' +
                msg.slice(0, 160),
              15000,
            )
          }
        })
        .finally(() => notify())
    }
