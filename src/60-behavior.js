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
      // —— 宿主直出（R-02，反哺报告 2026-10-27）：新鲜窗口内优先采用宿主投影 ——
      // thinking → working（模型推理中，她在屏幕上溜达等结果）
      // review → speak（回答文本在流，正好借说话的口型）
      // tool / working 原样；done 只认前 DONE_WINDOW 秒——一轮回答结束后不能
      // 在 15s 新鲜窗口里一直「庆祝」。过期或宿主没有 phase 就回落本地推导。
      const hp = runtime.hostPhase
      const hpAt = runtime.hostPhaseAt || 0
      if (hp && hp !== 'idle' && hpAt && now - hpAt < 15000) {
        if (hp === 'thinking' || hp === 'working') return 'working'
        if (hp === 'tool') return 'tool'
        if (hp === 'review') return 'speak'
        if (hp === 'done' && now - hpAt < DONE_WINDOW) return 'done'
      }
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

    /**
     * 自动台词闸（R-03）：statusBubbles='off' 时关掉「自言自语」类的气泡
     * （心情台词 / 阶段台词 / 闲聊 / 出现问候）。点按、拖拽、announce 公告
     * 这类「有明确触发」的仍然走 bubble()，不受这个开关影响。
     */
    function statusBubble(text, ttl, mood) {
      if (runtime.settings.statusBubbles === 'off') return
      bubble(text, ttl, mood)
    }

    function bubble(text, ttl, mood) {
      if (!text) return
      // 人不在屏幕上（藏起来 / 被拖出视口）就不冒泡、不发声：
      // 用户 2026-10-25 报的「人物不在桌面了，可她还在说话」就是这条漏了闸。
      if (!runtime.visible || runtime.petOffscreen) return
      const s = runtime.settings
      const t = String(text)
      runtime.bubble = { text: t, at: nowMs(), ttl: ttl || clamp(2200 + t.length * 90, 2600, 9000) }
      // 第三参是该句所属的类别（appear/dance/poked/drag…），交给导演层查演绎方向
      if (s.voiceOn) speak(t, mood)
      maybeAside()
      notify()
    }

    /**
     * 心声（1.21.0）：只在自带 lines.aside 的形象上出现，灰色小字、不出声——
     * 借的是「人设包装层」的思维链写法：正式台词之外，偶尔漏一句没经过脑子的
     * 内心 OS，制造反差。低频（ASIDE_RATE）是关键，多了就腻。
     */
    const ASIDE_RATE = 0.07

    /** 精确取某一类台词（不回落 idle）：缺这类就返回 ''，让「没有这类台词的形象」保持安静 */
    function linesOf(mood) {
      const p = persona()
      const key = 'lines' + PET_LANG.charAt(0).toUpperCase() + PET_LANG.slice(1)
      const pack = (p[key] && PET_LANG !== 'zh' ? p[key] : null) || (PET_LANG === 'zh' || !p.linesEn ? p.lines : p.linesEn)
      return (pack && pack[mood]) || (p.lines && p.lines[mood]) || []
    }

    function asideLine() {
      const list = linesOf('aside')
      return list.length ? pick(list) : ''
    }

    /** 被拖动时说的一句；形象没写 drag 这类台词就不吭声（不回落到 idle，免得答非所问） */
    function dragLine() {
      const list = linesOf('drag')
      return list.length ? pick(list) : ''
    }

    function maybeAside(rate) {
      const text = asideLine()
      if (!text) return ''
      if (Math.random() >= (typeof rate === 'number' ? rate : ASIDE_RATE)) return ''
      runtime.aside = { text, at: nowMs(), ttl: clamp(1800 + text.length * 70, 2200, 6000) }
      return text
    }

    function clearAside() {
      if (!runtime.aside) return false
      runtime.aside = null
      return true
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
      if (!wasVisible && runtime.settings.chatter) {
        const k = kind === 'dance' ? 'dance' : 'appear'
        bubble(randomLine(k), null, k)
      }
      notify()
    }

    /** 藏起来；传 snoozeMs 就是「藏这么久」（0 = 只藏到下次 tick） */
    function hidePet(snoozeMs) {
      if (snoozeMs) runtime.snoozeUntil = nowMs() + Number(snoozeMs)
      runtime.visible = false
      // 藏起来就把在播的动作收回：不留一条还在跑的调度链（R03/R08）
      clearAction()
      stopVoice()
      notify()
    }

    /**
     * 设置面板摆哪儿：默认贴右下角会把她整个人盖住，所以按她的实际位置算。
     * 上方空间够就放她上方（右对齐），不够就放她左侧（底对齐）。
     * 面板定宽 196px，与 CSS 里 .dsh-pet-panel 的 width 保持一致。
     *
     * 1.19.3（R11）：算出位置之后必须**四面夹取**。旧写法只夹了 right/bottom 的
     * 下界，宠物贴左边缘时会得到 right≈vw，面板整个跑到屏幕左侧（实测 left=-184px）。
     */
    const PANEL_W = 196
    const PANEL_GAP = 8
    const VIEW_MARGIN = 8

    /**
     * 顶栏（DSH 标题栏/工具栏）的安全区高度：面板与气泡都不许压到它上面。
     *
     * 起因（2026-10-27 用户反馈）：宠物被拖到屏幕上方时，面板贴到视口顶部，
     * 标题栏里右上角的 × 正好被顶栏盖住——看得见、点不到，关不掉面板。
     *
     * 为什么是探测而不是写死常量：DSH 顶栏高度随主题/密度/缩放变化，
     * 写死必然在下一个主题里失效。优先量覆盖层父容器的 top 偏移，
     * 测不到再依次尝试常见选择器，最后给保守默认值。
     */
    const DEFAULT_HEADER_SAFE = 44

    function headerSafeArea() {
      try {
        if (typeof document === 'undefined') return DEFAULT_HEADER_SAFE
        // ① overlay 的父容器：它是插件真正可用的那块区域
        const host = runtime.rootEl && runtime.rootEl.parentElement
        if (host && host.getBoundingClientRect) {
          const hr = host.getBoundingClientRect()
          // 父容器若被贴到 (0,0)，说明它铺满全屏（顶栏是浮在上面的兄弟节点），量不到信息
          if (hr.top > 0 && hr.top < 200) return Math.round(hr.top)
        }
        // ② 常见顶栏选择器
        const sel = [
          'header[role=banner]',
          '.dsh-titlebar',
          '.dsh-header',
          '.dsh-topbar',
          '[data-dsh-titlebar]',
        ].join(',')
        const nodes = document.querySelectorAll ? document.querySelectorAll(sel) : []
        for (const n of nodes) {
          const nr = n.getBoundingClientRect && n.getBoundingClientRect()
          if (nr && nr.height > 0 && nr.top <= 1 && nr.height < 200) return Math.round(nr.bottom)
        }
      } catch (e) {
        /* 量不到就走默认值 */
      }
      return DEFAULT_HEADER_SAFE
    }

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
        // 可用区域的上下边界：顶部让出顶栏，底部留边距
        const safeTop = headerSafeArea() + VIEW_MARGIN
        const availH = Math.max(160, vh - safeTop - VIEW_MARGIN)
        const spaceAbove = r.top - safeTop
        let right
        let bottom
        let maxHeight
        if (spaceAbove >= 300) {
          // 上方放得下：右边缘对齐，底边贴着她头顶
          right = Math.max(VIEW_MARGIN, vw - r.right)
          bottom = Math.max(VIEW_MARGIN, vh - r.top + PANEL_GAP)
          maxHeight = Math.min(spaceAbove, 560)
        } else {
          // 上方不够：放她左边，底边与她脚底对齐
          right = Math.max(VIEW_MARGIN, vw - r.left + PANEL_GAP)
          bottom = Math.max(VIEW_MARGIN, vh - r.bottom)
          maxHeight = Math.min(Math.max(r.height + 60, 260), 520)
        }
        // 夹取：right ∈ [8, vw-W-8] 保证左右都在视口内；
        // bottom 的上界由 maxHeight 反推，且不得超过「顶栏安全区」，
        // 否则面板顶部（含右上角 ×）会钻到顶栏底下。
        const maxH = Math.max(160, Math.min(maxHeight, availH))
        const rightMax = Math.max(VIEW_MARGIN, vw - PANEL_W - VIEW_MARGIN)
        const bottomMax = Math.max(VIEW_MARGIN, vh - safeTop - maxH)
        runtime.panelPos = {
          right: clamp(right, VIEW_MARGIN, rightMax) + 'px',
          bottom: clamp(bottom, VIEW_MARGIN, bottomMax) + 'px',
          maxHeight: maxH + 'px',
          width: PANEL_W + 'px',
        }
      } catch (e) {
        runtime.panelPos = null
      }
    }

    /* ================= 输入框悬停展开（1.22.0） ================= */

    /**
     * 用户要求：输入框平时不可见，鼠标移到人物上才滑出。
     *
     * 移开时延迟收起——人物与输入框之间有几像素间隙，鼠标穿过去的那一瞬间会先触发
     * actor 的 pointerleave、再进入输入框；不延迟就会闪一下再弹回来。200ms 够穿过去，
     * 又不至于让「移开」显得迟钝。
     */
    const HOVER_HIDE_DELAY = 200

    function setHover(on) {
      if (runtime.hoverTimer) {
        clearTimeout(runtime.hoverTimer)
        runtime.hoverTimer = null
      }
      if (on) {
        if (!runtime.hovering) {
          runtime.hovering = true
          notify()
        }
        return
      }
      runtime.hoverTimer = setTimeout(() => {
        runtime.hoverTimer = null
        if (!runtime.hovering) return
        runtime.hovering = false
        notify()
      }, HOVER_HIDE_DELAY)
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
        if (line && Math.random() < 0.55) statusBubble(line, null, m)
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
        } else if (
          (runtime.phase === 'tool' || runtime.phase === 'working') &&
          runtime.mood === 'idle' &&
          runtime.visible
        ) {
          // 在调工具 / 模型推理时轻轻踱两步，别一直僵着（working 来自 R-02 宿主 thinking 投影）
          runtime.mood = 'walk'
          runtime.moodUntil = now + 3000
        } else if (runtime.phase === 'speak' && runtime.hostPhase === 'review' && runtime.visible && !runtime.action && !runtime.speaking) {
          // 回答在流（宿主 review）：让她撩着头发等字出来（R-02）
          playAction('hair')
        }
      }

      // 出现逻辑
      if (s.mode === 'always') {
        if (now < runtime.snoozeUntil) {
          if (runtime.visible) hidePet()
        } else if (!runtime.visible) {
          runtime.visible = true
          runtime.visibleUntil = 0
          if (s.chatter) statusBubble(randomLine('appear'), null, 'appear')
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

      // 心声过期（比主台词短，先消失，看起来才像「嘀咕完就收」）
      if (runtime.aside && now - runtime.aside.at > runtime.aside.ttl) {
        runtime.aside = null
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
        if (line) statusBubble(line, null, 'idle')
      }

      // 偶尔撩一下头发（白天的「活人感」主要靠这个）
      if (runtime.visible && !runtime.action && Math.random() < 0.008) playAction('hair')  // 自动发起：不显式、时长取片长（R02）

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

    /**
     * 宿主状态合并（R-04，反哺报告 2026-10-27）：宿主侧 $DSH_HOME 的状态文件
     * 是跨设备真相源——宿主有 → 宿主优先覆盖本地（同键才覆盖，本地多出来的键保留），
     * 并归一化后落回 localStorage。history 直接替换（本就只留最近 8 条）。
     */
    function mergeHostState(host) {
      try {
        if (host.settings && typeof host.settings === 'object' && !Array.isArray(host.settings)) {
          runtime.settings = normalizeSettings({ ...runtime.settings, ...host.settings })
          saveSettings()
        }
        if (Array.isArray(host.history) && host.history.length) {
          runtime.history = host.history
            .filter((m) => m && typeof m.content === 'string')
            .slice(-8)
            .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
          try {
            window.localStorage.setItem(HISTORY_KEY, JSON.stringify(runtime.history))
          } catch (e) {
            /* 隐私模式/配额满，忽略 */
          }
        }
        notify()
      } catch (e) {
        /* ignore */
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
        // 客户端超时（R-09）：服务端默认 30s（可配到 120s），挂起的 fetch 不能
        // 让「……」气泡和 busy 状态一直挂到浏览器自身超时（约 5 分钟）
        let ctrl = null
        let guard = 0
        if (typeof AbortController === 'function') {
          ctrl = new AbortController()
          guard = setTimeout(() => {
            try {
              ctrl.abort()
            } catch (e) {
              /* ignore */
            }
          }, 90000)
        }
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
            signal: ctrl ? ctrl.signal : undefined,
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
        } finally {
          if (guard) clearTimeout(guard)
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
          bubble(reply, Math.max(3200, Math.min(12000, 900 + reply.length * 120)), 'chatAck')
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
            bubble(t('chat.needSignIn'), 6000)
          } else {
            bubble(
              (pick(p.lines.error) || t('chat.stuck')) +
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
