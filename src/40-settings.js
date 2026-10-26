    /* ================= 设置（localStorage） ================= */

    const STORAGE_KEY = 'dsh-pet.settings.v1'

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
      showInput: true, // 宠物旁边的小输入框
      scale: 1.15,
      chaos: true, // 恶作剧总开关（泼墨/起雾/炸弹）
      celebrate: true, // 一轮跑完时庆祝（长活会跑到中间跳舞）
      // 默认位置：右下角但抬高一截，避开同样钉在右下角的其它挂件（比如余额小鲸鱼）
      pos: null, // { x, y } 左上角像素，null = 用默认右下角锚点
    }

    const SETTINGS_LANGS = new Set(['auto', 'en', 'zh', 'es', 'pt', 'hi'])
    const SETTINGS_MODES = new Set(['always', 'random'])
    const CLOCK_RE = /^([01]\\d|2[0-3]):[0-5]\\d$/

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
      if (typeof source.persona === 'string' && PERSONAS[source.persona]) out.persona = source.persona
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
      out.scale = finiteNumber(source.scale, out.scale, 0.5, 2)
      out.chaos = booleanSetting(source.chaos, out.chaos)
      out.celebrate = booleanSetting(source.celebrate, out.celebrate)
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
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runtime.settings))
      } catch (e) {
        /* 隐私模式等场景静默失败 */
      }
    }
