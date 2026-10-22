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
            playFx,
            notify,
            runToCenterAndDance,
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

        // 事件联动 + 阶段机：轮询 /ping 拿宿主的工具活动与失败时间戳
        ctx.effect(() => {
          let stop = false
          const poll = async () => {
            if (stop) return
            // 1.10.0 起 /api 前缀已删除，只剩这一个相对路径 + 注入的绝对地址
            const base = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
            const urls = [base + '/dsh-pet/ping', '/dsh-pet/ping']
            for (const url of urls) {
              if (!url) continue
              try {
                const res = await fetch(url, { credentials: 'include' })
                const j = await res.json()
                if (!j || !j.ok) continue
                if (j.lastErrorAt && j.lastErrorAt > (runtime.lastErrorAt || 0)) {
                  runtime.lastErrorAt = j.lastErrorAt
                  if (runtime.settings.chaos !== false) playFx('cloud', { ttl: 4200 })
                }
                if (j.lastToolAt) runtime.lastToolAt = j.lastToolAt
                if (j.lastToolName) runtime.lastToolName = String(j.lastToolName).slice(0, 40)
                // 斜杠命令：序号变大才执行，轮询重复拿到同一条不会重放
                if (j.commandSeq && j.commandSeq > (runtime.lastCommandSeq || 0)) {
                  runtime.lastCommandSeq = j.commandSeq
                  if (j.command === 'hide') hidePet(60 * 60 * 1000)
                  else if (j.command === 'show') showPet()
                }
                if (syncPhase()) notify()
                return
              } catch (err) {
                /* 换下一个地址 */
              }
            }
          }
          poll()
          const t = setInterval(poll, 8000)
          return () => {
            stop = true
            clearInterval(t)
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
