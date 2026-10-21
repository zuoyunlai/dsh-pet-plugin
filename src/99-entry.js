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
          globalThis.__dshPet = { runtime, PERSONAS, inActiveWindow, toMinutes, weighted, pick, tick, showPet, hidePet, bubble, playFx, notify, runToCenterAndDance, PetArt, CSS }
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

        // 事件联动：宿主有工具失败就飘一朵乌云
        ctx.effect(() => {
          let last = 0
          let stop = false
          const poll = async () => {
            if (stop) return
            for (const url of ['/dsh-pet/ping', '/api/dsh-pet/ping']) {
              try {
                const res = await fetch(url, { credentials: 'include' })
                const j = await res.json()
                if (j && j.ok) {
                  if (j.lastErrorAt && j.lastErrorAt > last) {
                    last = j.lastErrorAt
                    if (runtime.settings.chaos !== false) playFx('cloud', { ttl: 4200 })
                  }
                  return
                }
              } catch (err) {
                /* 试下一个 */
              }
            }
          }
          const t = setInterval(poll, 15000)
          return () => {
            stop = true
            clearInterval(t)
          }
        })

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'dsh-pet', order: 200, label: t('panel.title'), locale: 'pet' }, PetOverlay),
        )

        // 输入框右侧的常驻入口：宠物被挡住/藏起来时的唯一可靠入口
        ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register({ name: 'conversation.input.right', id: 'dsh-pet-toggle', order: 50, label: t('pet.toggle'), locale: 'pet' }, PetToggle),
        )
      },
    }
  },
})
