    /* ================= 运行时状态 ================= */

    const runtime = {
      settings: loadSettings(),
      visible: false,
      visibleUntil: 0,
      snoozeUntil: 0,
      mood: 'idle',
      moodUntil: 0,
      bubble: null, // { text, at, ttl }
      aside: null, // 心声：灰色小字，{ text, at, ttl }，只在自带 lines.aside 的形象上出现
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
      clipMs: {}, // 片段实测时长 { 文件名: ms }：metadata 到手后写进来
      lastClipError: '', // 最近一次片段加载失败的文件名（诊断用）
    }

    // 片段时长不再写死（1.20.0）：早期 12 条都是同一批参数生成的 5.167s，写死没问题；
    // 「走进画面 → 跳舞 → 走回去」这种叙事片段有 10s，写死会在半途把 video 卸掉。
    // 现在以媒体自己的 metadata 为准，没拿到之前用一个宽上限兜底，真正的收尾靠 onEnded。
    const CLIP_MAX_MS = 12000 // 兜底上限：媒体迟迟不触发 ended 时不至于永久占着动作

    /** 某条片段的时长：拿到过 metadata 就用实测值，否则用宽上限。 */
    function clipMsOf(clip) {
      const ms = runtime.clipMs[clip]
      return ms > 0 ? ms : CLIP_MAX_MS
    }

    /**
     * 媒体 metadata 到手：记下真实时长，并把这一代的收尾时间按它重排。
     * 首次播放时用的是 20s 兜底，若真的等到 20s 才收尾，片段播完（ended）本来就会
     * 更早结束动作——这里补的是「兜底比片段短」的反向情况（旧片段 5.167s）。
     */
    function noteClipDuration(clip, seconds) {
      if (!clip || !(seconds > 0)) return
      runtime.clipMs[clip] = Math.round(seconds * 1000)
      const act = runtime.action
      if (!act || act.clip !== clip) return
      const want = nowMs() + runtime.clipMs[clip]
      if (want >= act.until) return // 兜底更宽松，交给 onEnded 收尾
      act.until = want
      clearActionTimer()
      actionTimer = later(() => endAction(act.gen), Math.max(0, want - nowMs()))
    }

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
      // 存活时间默认跟着媒体走：有片段就取片长（实测优先），没片段才用旧的 2400ms。
      // （1.19.x 在调用点手写 1300/2400ms，会在手势半途卸载 video。）
      const until = nowMs() + (o.ms || (clip ? clipMsOf(clip) : 2400))
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

    /**
     * 结束当前动作；只有「当前这一代」有权结束它（旧链的回调到此为止）。
     *
     * 片段动作不再直接卸载：先标记 exiting，让 video 用 220ms 淡回立绘，再真正移除。
     * 旧写法是「until 到点 → 立刻 action=null」，画面从片段最后一帧硬切到静止立绘
     * （跳舞结尾切笑脸尤其明显）。
     */
    const CLIP_EXIT_MS = 220

    function endAction(gen) {
      const act = runtime.action
      if (!act || act.gen !== gen || act.exiting) return
      clearActionTimer()
      if (!act.clip) {
        runtime.action = null
        runtime.clipPlaying = ''
        notify()
        return
      }
      act.exiting = true
      runtime.clipPlaying = '' // 不再算「正在播」：静帧垫上来，video 淡出
      notify()
      later(() => {
        const cur = runtime.action
        if (cur && cur.gen === gen && cur.exiting) {
          runtime.action = null
          notify()
        }
      }, CLIP_EXIT_MS)
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
      const map = PERSONA_REG.map
      return map[runtime.settings.persona] || map[Object.keys(map)[0]]
    }

    /**
     * 运行期注册表替换（R-01）：宿主 /personas 成功返回非空表时整表换入。
     * 空表/坏表一律拒收（宿主扫描失败时保持内置表）；换表后当前 persona
     * 若不在新表里，回落到新表第一只，避免渲染一个查无此人的形象。
     */
    function setPersonas(list) {
      if (!Array.isArray(list) || !list.length) return false
      const map = {}
      for (const p of list) {
        if (p && typeof p === 'object' && p.id) map[p.id] = p
      }
      if (!Object.keys(map).length) return false
      PERSONA_REG.map = map
      if (!map[runtime.settings.persona]) {
        runtime.settings.persona = Object.keys(map)[0]
      }
      notify()
      return true
    }

    /**
     * 贴图地址：桌面壳里相对路径不通，用宿主注入的绝对 origin。
     * R-01：贴图不一定还在包内 assets/ —— 用户包走 /dsh-pet/pets/<id>/，
     * 由 pack 的 assetBase 指路；内置包没有该字段，回落默认路径。
     */
    function assetUrl(name, p) {
      let base = ''
      try {
        base = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
      } catch (e) {
        base = ''
      }
      const assetBase = (p && p.assetBase) || '/dsh-pet/assets'
      return base + assetBase + '/' + name
    }
