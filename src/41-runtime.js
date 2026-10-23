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
      lastToolAt: 0, // 宿主最近一次 tools/result 的时间戳（来自 /ping）
      lastToolName: '',
      lastErrorAt: 0, // 宿主最近一次工具失败的时间戳（来自 /ping）
      menu: null, // 右键菜单 { x, y }，null=关着
      reduced: false, // 系统是否要求减弱动效（apply 时读一次，随后跟随 matchMedia）
      clipFailed: {}, // 片段加载失败记忆 { src: true }：同一个文件不再反复尝试
      clipPlaying: '', // 当前正在播放的片段名（'' = 还没起来）：决定静帧 poster 是否撤掉
      lastClipError: '', // 最近一次片段加载失败的文件名（诊断用）
    }

    // 12 条动作片段（VP9 + alpha，400 高）都是同一批参数生成的 5.167s。
    // 动作存活时间默认取它——1.19.x 在调用点手写 1300/2400ms，会让 video 在手势
    // 半途被卸载；dance 的 6000ms 又会撞上 loop 回跳。改此处即可统一口径。
    const CLIP_DURATION_MS = 5167

    // 动作代际与唯一调度：同名动作连续触发时，旧链必须失效（R03）。
    let actionGen = 0
    let actionTimer = null

    function clearActionTimer() {
      if (actionTimer) {
        clearTimeout(actionTimer)
        runtime.timers.delete(actionTimer)
        actionTimer = null
      }
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

    /** 播放一段动作（帧序列逐帧交叉淡入；有视频片段时由片段自己动）。 */
    function playAction(name, opts) {
      const p = persona()
      const clip = p.clips && p.clips[name] ? p.clips[name] : null
      const frames = (p.actions && p.actions[name]) || null
      // 有视频片段的动作：帧序列可以缺席（视频自己会动），但要维持 action 存活到 until
      if ((!frames || !frames.length) && !clip) return false
      const o = opts || {}
      // 减弱动效（1.19.3 R10）：自动发起的动作不播；用户显式点播仍然放行
      if (runtime.reduced && !o.explicit) return false
      const gen = ++actionGen
      // 覆盖旧动作：旧调度链立刻失效，任何时刻只有一条（1.19.3 R03）
      clearActionTimer()
      // 帧时长跟着帧数走：3 帧用 340ms，6 帧用 230ms，整套循环长度基本不变
      const step = o.step || (frames && frames.length >= 6 ? 230 : 340)
      // 存活时间默认跟着媒体走：有片段就取片长，没片段才用旧的 2400ms。
      // （1.19.x 在调用点手写 1300/2400ms，会在手势半途卸载 video。）
      const until = nowMs() + (o.ms || (clip ? CLIP_DURATION_MS : 2400))
      // moodDriven：这个动作是「心情」自动发起的（不是用户点的），心情变了可以收回
      runtime.clipPlaying = ''
      runtime.action = {
        name,
        frames: frames || [],
        i: 0,
        step,
        until,
        persona: p.id,
        clip,
        gen,
        moodDriven: !!o.moodDriven,
        explicit: !!o.explicit,
      }
      notify()
      if (clip) {
        // 视频自己会动：不排翻帧 timer（旧写法每 230/340ms 空转并 notify），
        // 只留一个到点收尾的 timeout。
        actionTimer = later(
          () => endAction(gen),
          Math.max(0, until - nowMs()),
        )
        return true
      }
      const advance = () => {
        const act = runtime.action
        if (!act || act.gen !== gen) return
        if (nowMs() > act.until) {
          endAction(gen)
          return
        }
        // 空帧数组不取模（无片段又无帧的动作上面已经拦掉，这里兜底）
        if (!act.frames || !act.frames.length) {
          endAction(gen)
          return
        }
        act.i = (act.i + 1) % act.frames.length
        notify()
        actionTimer = later(advance, act.step)
      }
      actionTimer = later(advance, step)
      return true
    }

    /** 结束当前动作；只有「当前这一代」有权结束它（旧链的回调到此为止）。 */
    function endAction(gen) {
      const act = runtime.action
      if (!act || act.gen !== gen) return
      runtime.action = null
      runtime.clipPlaying = ''
      clearActionTimer()
      notify()
    }

    /** 主动收回动作（心情变化/隐藏/换人设），同时作废在途调度链。 */
    function clearAction() {
      actionGen++
      clearActionTimer()
      runtime.clipPlaying = ''
      if (runtime.action) {
        runtime.action = null
        notify()
      }
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
