    /* ================= 运行时状态 ================= */

    const runtime = {
      settings: loadSettings(),
      visible: false,
      visibleUntil: 0,
      snoozeUntil: 0,
      mood: 'idle',
      moodUntil: 0,
      bubble: null, // { text, at, ttl }
      chatOpen: false,
      panelOpen: false,
      ai: 'unknown', // 'unknown' | 'busy' | 'ok' | 'fail'
      fx: [], // 正在播的特效
      stage: null, // 跑到窗口中间跳舞时的位移 { tx, ty }
      action: null, // 正在播的动作序列 { name, frames, i, step, until }
      rootEl: null, // 宠物根节点，给视线跟随用
      history: [], // 跟它单聊的最近几轮（落 localStorage，刷新不失忆）
      input: null, // 兼容旧字段
      speaking: false,
      speakUntil: 0,
      subs: new Set(),
      version: 0,
      timer: null,
      timers: new Set(), // 所有长延时，卸载时统一清
      neuralOk: null, // null=未探测 / true / false
      neuralReason: '',
      petOffscreen: false, // 她是否被画到视口外（给 🐾 按钮提示用）
      resizeTick: 0,
      // —— 阶段机（F1）：idle / working / tool / error / speak / done ——
      phase: 'idle',
      running: false, // 宿主会话是否在跑（PetToggle 的 useSession 写进来）
      doneUntil: 0, // 一轮刚结束的庆祝窗口
      lastToolAt: 0, // 宿主最近一次 tool/result 的时间戳（来自 /ping）
      lastToolName: '',
      lastErrorAt: 0, // 宿主最近一次工具失败的时间戳（来自 /ping）
      menu: null, // 右键菜单 { x, y }，null=关着
    }

    function notify() {
      runtime.version++
      for (const fn of Array.from(runtime.subs)) {
        try {
          fn()
        } catch (e) {
          /* 单个订阅者异常不影响其它 */
        }
      }
    }

    /** 所有长延时都记在 runtime.timers 里，卸载时统一清，避免"在已卸载组件上更新"。 */
    function later(fn, ms) {
      const id = setTimeout(() => {
        runtime.timers.delete(id)
        try {
          fn()
        } catch (e) {
          /* ignore */
        }
      }, ms)
      runtime.timers.add(id)
      return id
    }

    function clearLater() {
      for (const id of Array.from(runtime.timers)) clearTimeout(id)
      runtime.timers.clear()
    }

    /** 播放一段动作序列（逐帧交叉淡入，像翻页动画）。 */
    function playAction(name, opts) {
      const p = persona()
      const frames = (p.actions && p.actions[name]) || null
      if (!frames || !frames.length) return false
      const o = opts || {}
      const step = o.step || 340
      const until = nowMs() + (o.ms || 2400)
      runtime.action = { name, frames, i: 0, step, until, persona: p.id }
      notify()
      const advance = () => {
        const act = runtime.action
        if (!act || act.name !== name || act.persona !== persona().id) return
        if (nowMs() > act.until) {
          runtime.action = null
          notify()
          return
        }
        act.i = (act.i + 1) % act.frames.length
        notify()
        later(advance, step)
      }
      later(advance, step)
      return true
    }

    function persona() {
      return PERSONAS[runtime.settings.persona] || PERSONAS.violet
    }

    /** 贴图地址：桌面壳里相对路径不通，用宿主注入的绝对 origin。 */
    function assetUrl(name) {
      let base = ''
      try {
        base = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
      } catch (e) {
        base = ''
      }
      return base + '/dsh-pet/assets/' + name
    }
