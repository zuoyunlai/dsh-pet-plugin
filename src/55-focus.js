    /* ================= 失焦感知：安静态 ================= *
     *
     * 1.26.0 起，「人不在就别出声」从语音这一条闸门推广到整个组件：
     * 窗口失焦超过 QUIET_AFTER_MS（或用户手动开了勿扰），就进安静态——
     * 气泡静默、语音静音、停止自发动作。重新聚焦时「醒」过来。
     *
     * 为什么单独一个模块：判断「人在不在」只能靠 document 上的几个信号，
     * 而它们各有各的坑（见 isFocused）。集中在一处，改判定只改一处。
     *
     * 平台无关：只用 document.visibilityState / document.hasFocus()，
     * Windows / macOS / Linux / 各浏览器行为一致，不涉及任何平台分支。
     */

    /** 失焦多久算「人走了」：60s（用户 2026-10-28 拍板，考虑共享屏幕开会场景） */
    const QUIET_AFTER_MS = 60 * 1000
    /** 手动「勿扰」的时长 */
    const DONT_DISTURB_MS = 60 * 60 * 1000

    /**
     * 当前是否在前台。
     *
     * 两个信号都要看，因为**两个都会骗人**，方向还相反：
     *   - document.hasFocus() 在某些点按 / 子窗口场景下窗口明明在前台却报 false；
     *   - visibilityState 在窗口被别的应用完整遮住时仍然是 'visible'。
     * 取 AND 是最保守的组合：两个都说在，才算在。
     * 判错了的后果不对称——误判成「不在」只是她安静一会儿；
     * 误判成「在」就是开会共享屏幕时她突然开口。所以宁可偏向安静。
     */
    function isFocused() {
      try {
        if (typeof document === 'undefined') return true
        if (document.visibilityState && document.visibilityState !== 'visible') return false
        if (typeof document.hasFocus === 'function') return document.hasFocus()
      } catch (e) {
        /* 读不到就当在前台：不能因为探测失败让她永久失联 */
      }
      return true
    }

    /**
     * 安静态判定。返回 '' 表示不安静，否则返回原因（给 /ping 诊断与单测用）：
     *   'dnd'   —— 手动勿扰中
     *   'blur'  —— 失焦超过阈值
     */
    function quietReason() {
      const now = nowMs()
      if (runtime.dndUntil && now < runtime.dndUntil) return 'dnd'
      if (!runtime.blurredAt) return ''
      if (now - runtime.blurredAt < QUIET_AFTER_MS) return ''
      return 'blur'
    }

    /** 她此刻是否应该保持安静 */
    function isQuiet() {
      return quietReason() !== ''
    }

    /**
     * 这类气泡/台词是否属于「有事」，安静态下也要放行。
     *
     * 区分标准不是「谁触发的」，而是**用户是否在等这句话**：
     *   - announce：外部脚本让她说话（CI 挂了、git hook 提醒），属于有事；
     *   - chatAck / chatErr：用户刚跟她说话，在等她回，属于有事；
     *   - 其余（idle / dance / poked / drag / 心情台词）都是自发演绎，安静态一律不出。
     */
    function isAddressedKind(kind) {
      return kind === 'announce' || kind === 'chatAck' || kind === 'chatErr'
    }

    /** 手动「勿扰 1 小时」开关。开着就关，关着就开。 */
    function toggleDontDisturb() {
      if (runtime.dndUntil && nowMs() < runtime.dndUntil) runtime.dndUntil = 0
      else runtime.dndUntil = nowMs() + DONT_DISTURB_MS
      runtime.quietReason = quietReason()
      notify()
    }

    /** 勿扰还剩多少毫秒（菜单文案用；没开是 0） */
    function dndRemainingMs() {
      const left = (runtime.dndUntil || 0) - nowMs()
      return left > 0 ? left : 0
    }

    /**
     * 启动失焦监听。返回卸载函数，交给 ctx.effect。
     * 只在 window/document 上挂三个事件，所有清理都在返回值里（prelude 红线）。
     */
    function watchFocus() {
      const markBlurred = () => {
        if (!runtime.blurredAt) runtime.blurredAt = nowMs()
      }
      const markFocused = () => {
        runtime.blurredAt = 0
      }
      const onFocus = () => {
        markFocused()
        runtime.quietReason = quietReason()
        // 通知标题前缀（56-notify.js）在用户回来时撤掉——人已经在了，不用再在任务栏喊他
        if (typeof titlePrefix === 'function') titlePrefix(false)
        notify()
      }
      // 标签页切走 / 切回（比 hasFocus 更早反映 visibilityState）
      const onVisibility = () => {
        try {
          if (document.visibilityState === 'hidden') markBlurred()
          else markFocused()
        } catch (e) {
          /* ignore */
        }
        runtime.quietReason = quietReason()
        notify()
      }

      try {
        window.addEventListener('blur', markBlurred)
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onVisibility)
      } catch (e) {
        /* 装不上监听就退回「永不安静」，不能因为监听失败让功能整体挂掉 */
      }

      // 启动时如果本来就在后台（比如刷新于一个隐藏标签），立刻记一笔
      try {
        if (document.visibilityState === 'hidden') runtime.blurredAt = nowMs()
      } catch (e) {
        /* ignore */
      }

      return () => {
        try {
          window.removeEventListener('blur', markBlurred)
          window.removeEventListener('focus', onFocus)
          document.removeEventListener('visibilitychange', onVisibility)
        } catch (e) {
          /* ignore */
        }
      }
    }

    /**
     * 安静态的边界条件：进入/退出时要做的事。
     * 由 tick 每轮调用一次，自己比较前后两个状态，只在**跨越边界**时动作。
     */
    function syncQuiet() {
      const now = quietReason()
      const prev = runtime.quietReason || ''
      runtime.quietReason = now
      if (prev === now) return
      // 进入安静：记时间戳，外层据此播一次「打哈欠趴下」
      if (now && !prev) {
        runtime.quietSince = nowMs()
        runtime.wokeAt = 0
      }
      // 退出安静：记「刚醒」，外层据此播一次「抻懒腰」
      if (!now && prev) {
        runtime.quietSince = 0
        runtime.wokeAt = nowMs()
      }
      notify()
    }
