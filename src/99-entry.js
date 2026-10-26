    /* ================= 开发期自检出口（不影响插件契约） ================= */
    try {
      if (typeof globalThis !== 'undefined') {
        // 自检出口默认不挂：生产环境别把 runtime / 台词 / 特效入口交给页面任意脚本。
        // 需要时在控制台执行 localStorage.setItem('dsh-pet.debug','1') 再刷新，
        // 或给页面 URL 加 ?petdebug=1。
        let petDebug = false
        try {
          petDebug =
            window.localStorage.getItem('dsh-pet.debug') === '1' ||
            /[?&]petdebug=1/.test(String(window.location.search || ''))
        } catch (e) {
          petDebug = false
        }
        if (petDebug) {
          globalThis.__dshPet = {
            runtime,
            PERSONAS,
            inActiveWindow,
            toMinutes,
            weighted,
            pick,
            tick,
            showPet,
            hidePet,
            bubble,
            asideLine,
            dragLine,
            linesOf,
            maybeAside,
            clearAside,
            // 导演层（1.21.0）：心情 + 语言 → 音色 / 音高 / 语速 / 音量
            voiceParams,
            playFx,
            notify,
            runToCenterAndDance,
            // 片段时长（1.20.0）：媒体 metadata 到手后写进 runtime.clipMs，
            // 收尾时间按真实片长重排；台架走同一个入口固定这条规则。
            noteClipDuration,
            PetArt,
            CSS,
            // 自检用：当前语言 + 任意心情会抽到的那句台词 / 当前生效的文案
            lang: () => PET_LANG,
            lineFor: (mood) => randomLine(mood || 'appear'),
            text: (key) => t(key),
            setLang,
            syncLangOverride,
            // 阶段机（1.11.0）：读当前阶段 / 立即重算
            phase: () => computePhase(),
            syncPhase,
            hidePet,
            showPet,
            playAction,
            placePanel,
          }
        }
      }
    } catch (e) {
      /* ignore */
    }

    /* ================= 插件入口 ================= */

    return {
      inject: ['slots'],
      apply(ctx) {
        // 减弱动效（R10）：读一次，随后跟随系统设置变化
        runtime.reduced = prefersReduced()
        ctx.effect(() => {
          let mq = null
          const onChange = () => {
            const next = prefersReduced()
            if (next === runtime.reduced) return
            runtime.reduced = next
            if (next) clearAction()
            notify()
          }
          // DSH 的 Electron/Chromium 版本都支持 MediaQueryList.addEventListener
          try {
            mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
            if (mq && mq.addEventListener) mq.addEventListener('change', onChange)
          } catch (e) {
            mq = null
          }
          return () => {
            try {
              if (mq) mq.removeEventListener('change', onChange)
            } catch (e) {
              /* ignore */
            }
          }
        })
        ctx.effect(() => {
          runtime.timer = setInterval(() => {
            try {
              tick()
            } catch (e) {
              /* 引擎异常不能拖垮整页 */
            }
          }, TICK_MS)
          // 常驻模式立刻出现
          try {
            lastChatterAt = nowMs()
            loadHistory()
            if (runtime.settings.mode === 'always') showPet('appear')
            setTimeout(() => warmVoice(), 2500)
          } catch (e) {
            /* ignore */
          }
          // 窗口尺寸变了要重新量一次（可能把她挤到视口外）
          let resizeTimer = 0
          const onResize = () => {
            clearTimeout(resizeTimer)
            resizeTimer = setTimeout(() => {
              runtime.resizeTick++
              // 面板是 fixed 定位的：窗口变了必须重新夹取，否则会留在视口外（R11）
              if (runtime.panelOpen) placePanel()
              notify()
            }, 250)
          }
          try {
            window.addEventListener('resize', onResize)
          } catch (e) {
            /* ignore */
          }
          return () => {
            try {
              window.removeEventListener('resize', onResize)
            } catch (e) {
              /* ignore */
            }
            clearTimeout(resizeTimer)
            if (runtime.timer) clearInterval(runtime.timer)
            runtime.timer = null
            clearLater()
            stopVoice()
          }
        })

        // 视线跟随：只写 CSS 变量，不触发 React 重渲染
        ctx.effect(() => {
          const onMove = (e) => {
            try {
              const el = runtime.rootEl
              if (!el) return
              const r = el.getBoundingClientRect()
              const cx = r.left + r.width * 0.62
              const cy = r.top + r.height * 0.42
              el.style.setProperty('--gx', clamp((e.clientX - cx) / 55, -2.6, 2.6).toFixed(2) + 'px')
              el.style.setProperty('--gy', clamp((e.clientY - cy) / 55, -2.2, 2.2).toFixed(2) + 'px')
            } catch (err) {
              /* ignore */
            }
          }
          window.addEventListener('mousemove', onMove, { passive: true })
          return () => window.removeEventListener('mousemove', onMove)
        })

        // 事件联动 + 阶段机：轮询 /ping 拿宿主的工具活动与失败时间戳。
        // 宠物不可见时暂停轮询（省 CPU 和网络）——她被藏起来时没人看，
        // 阶段数据缓一拍没影响，showPet / 斜杠命令唤醒时会补拉。
        ctx.effect(() => {
          let stop = false
          // 1.10.0 起 /api 前缀已删除，只剩这一个相对路径 + 注入的绝对地址
          const base = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
          const urls = [base + '/dsh-pet/ping', '/dsh-pet/ping']
          // 一次轮询的预算（R08）：没有这个，一个永不返回的 fetch 会让整条链
          // 永远停在这里，而 showPet 的补拉还会再起一条同样会挂的链。
          const POLL_TIMEOUT = 8000
          let ctrl = null
          let failures = 0
          const doPoll = async () => {
            if (stop) return
            ctrl =
              typeof AbortController === 'function'
                ? new AbortController()
                : null
            const guard = setTimeout(() => {
              try {
                if (ctrl) ctrl.abort()
              } catch (e) {
                /* ignore */
              }
            }, POLL_TIMEOUT)
            try {
              for (const url of urls) {
                if (!url || stop) continue
                try {
                  const res = await fetch(url, { credentials: 'include', signal: ctrl ? ctrl.signal : undefined })
                  const j = await res.json()
                  // 卸载/超时后拿到的响应一律不写状态（R08b）
                  if (stop || !j || !j.ok) continue
                  if (j.lastErrorAt && j.lastErrorAt > (runtime.lastErrorAt || 0)) {
                    runtime.lastErrorAt = j.lastErrorAt
                    if (runtime.settings.chaos !== false) playFx('cloud', { ttl: 4200 })
                  }
                  if (j.lastToolAt) runtime.lastToolAt = j.lastToolAt
                  if (j.lastToolName) runtime.lastToolName = String(j.lastToolName).slice(0, 40)
                  if (j.toolEvents) runtime.toolEvents = j.toolEvents
                  // 斜杠命令：序号变大才执行，轮询重复拿到同一条不会重放
                  if (j.commandSeq && j.commandSeq > (runtime.lastCommandSeq || 0)) {
                    runtime.lastCommandSeq = j.commandSeq
                    if (j.command === 'hide') hidePet(60 * 60 * 1000)
                    else if (j.command === 'show') showPet()
                  }
                  if (syncPhase()) notify()
                  return true
                } catch (err) {
                  /* 换下一个地址（含超时中止） */
                }
              }
              return false
            } finally {
              clearTimeout(guard)
              ctrl = null
            }
          }
          const schedule = () => {
            if (stop) return
            // 正常状态按可见性轮询；连续失败指数退避，避免宿主不可用时打满请求。
            const baseGap = runtime.visible || runtime.panelOpen ? 8000 : 30000
            const gap = Math.min(120000, baseGap * Math.pow(2, Math.min(failures, 4)))
            timer = setTimeout(async () => {
              try {
                const ok = await doPoll()
                failures = ok ? 0 : Math.min(failures + 1, 4)
              } catch (e) {
                failures = Math.min(failures + 1, 4)
              }
              schedule()
            }, gap)
          }
          let timer = null
          doPoll().catch(() => {})
          schedule()
          return () => {
            stop = true
            if (timer) clearTimeout(timer)
            try {
              if (ctrl) ctrl.abort()
            } catch (e) {
              /* ignore */
            }
          }
        })

        // 语言：settings.lang 手动锁定则写进 localStorage 覆盖，否则跟随 <html lang>
        try {
          const saved = runtime.settings && runtime.settings.lang
          if (saved && saved !== 'auto') window.localStorage.setItem(PET_LANG_KEY, saved)
          setLang(detectLang())
        } catch (e) {
          /* ignore */
        }
        ctx.effect(() => watchHostLang())

        /**
         * 挂 slot。宿主版本太旧时（slot 名在 0.2 世代才统一成现在这套），
         * 宁可打一行明确日志、什么都不挂，也不要把异常抛进 boot 把整个 bundle 打掉。
         */
        const mountSlot = (slot, spec, Component) => {
          try {
            ctx.slots.inject(slot, () => ctx.slots.register(spec, Component))
          } catch (e) {
            try {
              console.warn(
                '[dsh-pet] 这个宿主没有 "' +
                  slot +
                  '" 插槽，桌宠无法挂载。需要 dsh >= 0.2.1-alpha.2（本插件实测版本）。',
              )
            } catch (e2) {
              /* ignore */
            }
          }
        }

        mountSlot(
          'shell.overlay',
          { name: 'shell.overlay', id: 'dsh-pet', order: 200, label: t('panel.title'), locale: 'pet' },
          PetOverlay,
        )

        // 输入框右侧的常驻入口：宠物被挡住/藏起来时的唯一可靠入口
        mountSlot(
          'conversation.input.right',
          { name: 'conversation.input.right', id: 'dsh-pet-toggle', order: 50, label: t('pet.toggle'), locale: 'pet' },
          PetToggle,
        )
      },
    }
  },
})
