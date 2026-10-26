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

    function loadSettings() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (!raw) return { ...DEFAULT_SETTINGS }
        const parsed = JSON.parse(raw)
        // 迁移：voicePitch/voiceRate 曾是「绝对值」，会盖掉每只角色自己的音高，导致五只听起来一样
        delete parsed.voicePitch
        delete parsed.voiceRate
        const merged = { ...DEFAULT_SETTINGS }
        for (const k of Object.keys(DEFAULT_SETTINGS)) {
          if (parsed[k] !== undefined) merged[k] = parsed[k]
        }
        if (!PERSONAS[merged.persona]) merged.persona = DEFAULT_SETTINGS.persona
        if (merged.mode !== 'always' && merged.mode !== 'random') merged.mode = 'always'
        return merged
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
