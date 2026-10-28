    /* ================= 失焦通知：一轮跑完提醒 ================= *
     *
     * 1.26.0。把「一轮跑完了，回来验收」送到人眼前——哪怕他切去了别的应用。
     *
     * 纯 Web 标准，跨平台（Windows / macOS / Linux / 各浏览器），不依赖任何宿主能力。
     * 核心是**能力降级链**：每一层失败都静默下移，绝不抛错、绝不刷控制台噪音。
     *
     *   1. Web Notification（permission === 'granted'）
     *   2. 文档标题前缀 ●（永不失败的兜底，任务栏/标签页标题可见）
     *   3. 文档内角标（她头上一个红点）
     *
     * 为什么标题前缀是「永不失败的兜底」而不是冗余：浏览器里 notification.onclick
     * 多数不保证真的把标签页切到前台；标题是任务栏上唯一可靠的「回来吧」信号。
     */

    /** 短于这个时长的一轮不值得弹（4 秒的活弹窗是骚扰） */
    const TURN_NOTIFY_MIN_MS = 10000
    /** 两次通知的最小间隔（避免「连发」） */
    const TURN_NOTIFY_COOLDOWN_MS = 90000

    // —— 自证统计：跨平台方案里「通知到底发出去没有」不能靠猜（见方案 §2.3）——
    // Linux 无通知守护进程、macOS 系统级静音、浏览器权限被撤，这三种情况
    // Notification API 都不报错，只是通知不出现。只有 show / error 事件能说实话。
    const notifyStats = {
      supported: 'none', // 'web' | 'none'
      permission: 'unavailable', // granted | denied | default | unavailable
      sent: 0, // 实际弹出（Notification.show 或标题前缀生效）
      failed: 0, // 探测到 error / 2s 内未触发 show
      lastReason: '', // 最近一次被拦下的原因（诊断用）
      lastAt: 0,
    }

    /** 一次性探测：这个环境能不能用 Web 通知、权限现状如何。结果写 notifyStats。 */
    function probeNotify() {
      try {
        if (typeof window === 'undefined' || !('Notification' in window)) {
          notifyStats.supported = 'none'
          notifyStats.permission = 'unavailable'
          return
        }
        notifyStats.supported = 'web'
        notifyStats.permission = window.Notification.permission || 'default'
      } catch (e) {
        notifyStats.supported = 'none'
        notifyStats.permission = 'unavailable'
      }
    }

    /**
     * 请求通知权限。**只能在用户手势回调里调用**（浏览器会拒绝非手势触发的请求）。
     * 返回最终权限状态；拒绝时调用方要把设置项回弹为 off。
     */
    async function requestNotifyPermission() {
      probeNotify()
      if (notifyStats.supported !== 'web') return notifyStats.permission
      try {
        notifyStats.permission = await window.Notification.requestPermission()
      } catch (e) {
        // 隐私模式 / 沙箱里可能根本无法授予，静默记为 denied，交给降级链
        notifyStats.permission = 'denied'
      }
      return notifyStats.permission
    }

    /** 标题前缀兜底：记下原标题，聚焦时恢复 */
    function titlePrefix(on) {
      try {
        const tag = '● '
        const cur = document.title || ''
        if (on) {
          if (!runtime.notifyTaggedTitle) runtime.notifyTaggedTitle = cur
          if (!cur.startsWith(tag)) document.title = tag + cur
        } else {
          if (runtime.notifyTaggedTitle) {
            if (document.title === tag + runtime.notifyTaggedTitle) document.title = runtime.notifyTaggedTitle
            runtime.notifyTaggedTitle = ''
          }
        }
      } catch (e) {
        /* ignore */
      }
    }

    /** 通知内容的文案（title 用人设名，body 用耗时） */
    function turnNotifyText(dur) {
      const mm = Math.max(1, Math.round(dur / 60000))
      let pname = 'dsh-pet'
      try {
        const p = persona()
        if (p && p.name) pname = p.name
      } catch (e) {
        /* ignore */
      }
      const title = pname
      const body =
        (runtime.settings.lang === 'zh' ? `跑完了，${mm} 分钟，回来验收吧` :
         runtime.settings.lang === 'es' ? `Terminó, ${mm} min, vuelve a revisar.` :
         runtime.settings.lang === 'pt' ? `Terminou, ${mm} min, volte para conferir.` :
         runtime.settings.lang === 'hi' ? `${mm} मिनट में हो गया, वापस आकर देख लीजिए।` :
         `Done, ${mm} min. Come back and review.`)
      return { title, body }
    }

    /**
     * 发一条「跑完了」通知。带降级链与自证回执。
     * @param {number} dur 一轮耗时（毫秒）
     * @returns {string} 实际走到的层：'notification' | 'title' | 'badge' | 'skip:<reason>'
     */
    function sendTurnNotify(dur) {
      probeNotify()
      const now = nowMs()

      // —— 前置条件（全部满足才弹，任一不满足都记 lastReason 后静默跳过）——
      if (dur < TURN_NOTIFY_MIN_MS) return skipNotify('short')
      // 人正看着就别弹：通知的唯一目的就是「把人叫回来」，人已经在看就没必要。
      // 注意这里不看 isQuiet()——安静态管的是「她不主动打扰」，而 turnNotify 是
      // 用户明确授权过的提醒（开了开关），两者是独立的。
      if (isFocused()) return skipNotify('focused')
      if (now - (notifyStats.lastAt || 0) < TURN_NOTIFY_COOLDOWN_MS) return skipNotify('cooldown')

      const { title, body } = turnNotifyText(dur)

      // 第 1 层：Web Notification
      if (notifyStats.supported === 'web' && notifyStats.permission === 'granted') {
        let n = null
        try {
          n = new window.Notification(title, {
            body,
            tag: 'dsh-pet-turn-end', // 同 tag 自动替换，天然去重
            silent: true,
            requireInteraction: false,
            lang: runtime.settings.lang || 'en',
          })
        } catch (e) {
          // 移动端 / 某些环境构造即抛 TypeError，落到下一层
          n = null
        }
        if (n) {
          // 自证核心：只有 show 事件真的触发才算「发出去了」。
          // Linux 无通知守护进程 / macOS 系统静音 / 权限被中途撤掉，这三种情况
          // API 都不报错、不触发 show、也不触发 error——只是通知不出现。
          // 所以用「2s 内未 show 也未 error」判定静默失败，落到标题兜底。
          let settled = false
          const onShow = () => {
            if (settled) return
            settled = true
            notifyStats.sent++
            notifyStats.lastReason = ''
            notifyStats.lastAt = now
          }
          const onError = () => {
            if (settled) return
            settled = true
            notifyStats.failed++
            notifyStats.lastReason = 'error'
            titlePrefix(true) // 通知报错 → 标题兜底
          }
          try {
            n.addEventListener('show', onShow)
            n.addEventListener('error', onError)
          } catch (e) {
            /* ignore */
          }
          // 静默失败的自证窗口：2s 内没 show 也没 error → no-daemon
          later(() => {
            if (!settled) {
              settled = true
              notifyStats.failed++
              notifyStats.lastReason = 'no-daemon'
              titlePrefix(true)
            }
          }, 2000)
          if (typeof n.show === 'function') {
            try {
              n.show()
            } catch (e) {
              onError()
            }
          }
          // 通知路径上无论最终 show/error，标题都先打上——点击通知不保证切回
          // 标签页，标题是任务栏上唯一可靠的双保险。
          titlePrefix(true)
          notifyStats.lastAt = now
          return 'notification'
        }
      }

      // 第 2 层：标题前缀（永不失败）
      titlePrefix(true)
      notifyStats.sent++
      notifyStats.lastReason = 'title-fallback'
      notifyStats.lastAt = now
      return 'title'

      // 第 3 层（角标）留到 overlay 层有视觉载体时再挂，避免现在为一个红点开一条 UI 线
    }

    function skipNotify(reason) {
      notifyStats.lastReason = reason
      return 'skip:' + reason
    }
