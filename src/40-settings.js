    /* ================= 设置（localStorage） ================= */

    const STORAGE_KEY = 'dsh-pet.settings.v1'

    /* —— 跨设备状态（P0-1，2026-10-29 审计）——
     * 旧实现只写 localStorage，从不回传宿主；启动时又「宿主有就覆盖本地」，
     * 于是改完设置一刷新就被首次安装的快照打回去。现在的约定：
     *   - 每次本地保存都记一个时间戳（STATE_AT_KEY），作为 updatedAt 的来源；
     *   - 保存后 500ms 防抖回传宿主（/state POST），用户的每一次改动都会落地；
     *   - 宿主里的那份比本地新时，宿主在响应里回 stale + state，本地采纳它。
     */
    const STATE_AT_KEY = 'dsh-pet.stateAt.v1'
    const STATE_PUSH_DELAY = 500
    let statePushTimer = null

    function localStateAt() {
      try {
        const n = Number(window.localStorage.getItem(STATE_AT_KEY))
        return Number.isFinite(n) && n > 0 ? n : 0
      } catch (e) {
        return 0
      }
    }

    function setLocalStateAt(at) {
      try {
        window.localStorage.setItem(STATE_AT_KEY, String(at || nowMs()))
      } catch (e) {
        /* 隐私模式：没有时间戳就退回「谁先到谁算」 */
      }
    }

    /**
     * 老用户升级迁移：localStorage 里已有设置、但没有时间戳时，把它视为「刚刚保存」。
     * 否则本地那份（用户实际在用的）会被宿主里更旧的快照按 updatedAt 规则压回去，
     * 正是审计 P0-1 里「改完刷新全回退」的现场。
     */
    function ensureLocalStateAt() {
      try {
        if (window.localStorage.getItem(STATE_AT_KEY)) return
        if (window.localStorage.getItem(STORAGE_KEY)) setLocalStateAt(nowMs())
      } catch (e) {
        /* ignore */
      }
    }

    function stateEndpoint() {
      const base = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
      return base + '/dsh-pet/state'
    }

    function scheduleStatePush(delay) {
      try {
        if (typeof setTimeout !== 'function') return
        if (statePushTimer) clearTimeout(statePushTimer)
        statePushTimer = setTimeout(() => {
          statePushTimer = null
          pushStateNow()
        }, typeof delay === 'number' ? delay : STATE_PUSH_DELAY)
      } catch (e) {
        /* ignore */
      }
    }

    /** 把本地状态推给宿主；宿主更新时（stale）采纳宿主的那份。 */
    function pushStateNow() {
      try {
        if (typeof fetch !== 'function') return Promise.resolve()
        // P0-1：历史只有**真的变过**才回传。否则「这台机器从没聊过天」的空数组会把
        // 另一台设备刚同步过来的历史冲掉——这是跨设备状态最容易踩的数据丢失。
        const withHistory = !!runtime.historyDirty
        const payload = { settings: runtime.settings, updatedAt: localStateAt() || nowMs() }
        if (withHistory) payload.history = runtime.history
        const body = JSON.stringify(payload)
        return fetch(stateEndpoint(), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body,
        })
          .then((res) => (res && res.ok ? res.json() : null))
          .then((j) => {
            if (j && j.stale && j.state) {
              adoptHostState(j.state)
              return
            }
            if (withHistory && runtime.historyDirty) runtime.historyDirty = false
          })
          .catch(() => {})
      } catch (e) {
        return Promise.resolve()
      }
    }

    /** 只落 localStorage（不改宿主）：采纳宿主状态时用，避免「采纳 → 立刻回传」的抖动 */
    function persistSettings(at) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runtime.settings))
        setLocalStateAt(at || nowMs())
      } catch (e) {
        /* 隐私模式等场景静默失败 */
      }
    }

    const DEFAULT_SETTINGS = {
      persona: 'violet',
      lang: 'auto', // 'auto' 跟随 DSH 界面语言 | en/zh/es/pt/hi 手动锁定
      mode: 'always', // 'always' 常驻 | 'random' 随机出现
      probability: 35, // 随机模式：每小时出现概率（%）
      activeStart: '09:00',
      activeEnd: '23:00',
      voiceOn: true,
      volume: 0.8,
      pitchTrim: null, // null = 完全跟随形象；否则是「在形象基座上的倍率」(0.85–1.15)
      rateTrim: null, // null = 完全跟随形象；否则是倍率 (0.8–1.25)
      neuralVoice: true, // 用 edge-tts 的神经音色（失败自动退回系统 SAPI）
      ttsVoice: 'auto', // 'auto' = 跟随角色（pack.voice.voiced）| 其余是手选固定音色
      chatter: true, // 主动蹦话
      showInput: true, // 宠物旁边的小输入框（保留旧语义：false = 完全不出现）
      // 1.22.0：输入框显示方式。'hover' = 平时收起、鼠标移到人物上才滑出（默认）；
      // 'always' = 一直显示。showInput=false 时无论如何都不渲染。
      inputMode: 'hover',
      scale: 1.15,
      chaos: true, // 恶作剧总开关（泼墨/起雾/炸弹）
      celebrate: true, // 一轮跑完时庆祝（长活会跑到中间跳舞）
      turnNotify: false, // 1.26.0：你不在时，长活跑完弹一条通知（默认关，避免装完就挨弹窗）
      // 默认位置：右下角但抬高一截，避开同样钉在右下角的其它挂件（比如余额小鲸鱼）
      statusBubbles: 'auto', // 'auto' 阶段机自动台词 | 'off' 关掉（点按/拖拽/announce 不受影响）
      pos: null, // { x, y } 左上角像素，null = 用默认右下角锚点
    }

    const SETTINGS_LANGS = new Set(['auto', 'en', 'zh', 'es', 'pt', 'hi'])
    const SETTINGS_MODES = new Set(['always', 'random'])
    const SETTINGS_BUBBLES = new Set(['auto', 'off'])
    const SETTINGS_INPUT = new Set(['hover', 'always'])
    // HH:MM 校验（R-01，2026-10-28 审计：曾误写成 \\d 双反斜杠——正则字面量里
    // 那是「字面反斜杠+d」，任何合法时间都匹配失败，活跃时段每次重载被重置）
    const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/

    function finiteNumber(value, fallback, min, max) {
      const n = typeof value === 'number' && Number.isFinite(value) ? value : Number(value)
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
    }

    function booleanSetting(value, fallback) {
      return typeof value === 'boolean' ? value : fallback
    }

    function clockSetting(value, fallback) {
      return typeof value === 'string' && CLOCK_RE.test(value) ? value : fallback
    }

    function normalizeSettings(input) {
      const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
      const out = { ...DEFAULT_SETTINGS }
      // persona 校验对着「当前注册表」（R-01）：宿主表换入后，用户存的 id 仍有效
      if (typeof source.persona === 'string' && PERSONA_REG.map[source.persona]) out.persona = source.persona
      if (typeof source.lang === 'string' && SETTINGS_LANGS.has(source.lang)) out.lang = source.lang
      if (typeof source.mode === 'string' && SETTINGS_MODES.has(source.mode)) out.mode = source.mode
      out.probability = finiteNumber(source.probability, out.probability, 0, 100)
      out.activeStart = clockSetting(source.activeStart, out.activeStart)
      out.activeEnd = clockSetting(source.activeEnd, out.activeEnd)
      out.voiceOn = booleanSetting(source.voiceOn, out.voiceOn)
      out.volume = finiteNumber(source.volume, out.volume, 0, 1)
      out.pitchTrim = source.pitchTrim == null ? null : finiteNumber(source.pitchTrim, DEFAULT_SETTINGS.pitchTrim, 0.85, 1.15)
      out.rateTrim = source.rateTrim == null ? null : finiteNumber(source.rateTrim, DEFAULT_SETTINGS.rateTrim, 0.8, 1.25)
      out.neuralVoice = booleanSetting(source.neuralVoice, out.neuralVoice)
      if (typeof source.ttsVoice === 'string' && source.ttsVoice.length <= 120) out.ttsVoice = source.ttsVoice
      out.chatter = booleanSetting(source.chatter, out.chatter)
      out.showInput = booleanSetting(source.showInput, out.showInput)
      if (typeof source.inputMode === 'string' && SETTINGS_INPUT.has(source.inputMode)) {
        out.inputMode = source.inputMode
      }
      out.scale = finiteNumber(source.scale, out.scale, 0.5, 2)
      out.chaos = booleanSetting(source.chaos, out.chaos)
      out.celebrate = booleanSetting(source.celebrate, out.celebrate)
      out.turnNotify = booleanSetting(source.turnNotify, out.turnNotify)
      if (typeof source.statusBubbles === 'string' && SETTINGS_BUBBLES.has(source.statusBubbles)) {
        out.statusBubbles = source.statusBubbles
      }
      if (source.pos && typeof source.pos === 'object' && !Array.isArray(source.pos)) {
        const x = finiteNumber(source.pos.x, NaN, -100000, 100000)
        const y = finiteNumber(source.pos.y, NaN, -100000, 100000)
        if (Number.isFinite(x) && Number.isFinite(y)) out.pos = { x, y }
      }
      return out
    }

    function loadSettings() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (!raw) return { ...DEFAULT_SETTINGS }
        const parsed = JSON.parse(raw)
        // 迁移：voicePitch/voiceRate 曾是「绝对值」，会盖掉每只角色自己的音高，导致五只听起来一样
        if (parsed && typeof parsed === 'object') {
          delete parsed.voicePitch
          delete parsed.voiceRate
        }
        return normalizeSettings(parsed)
      } catch (e) {
        return { ...DEFAULT_SETTINGS }
      }
    }

    function saveSettings() {
      persistSettings()
      // P0-1：本地保存之后必须回传宿主，否则换浏览器/清缓存就回到旧快照
      scheduleStatePush()
    }
