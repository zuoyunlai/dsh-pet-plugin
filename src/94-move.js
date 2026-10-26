    // 「走到屏幕中间跳一段」的两种实现：
    //   ① 有 clips.stage（一条「走进来 → 中间跳 → 走回去」的单镜头片段）时，只播这一条，
    //      位移交给相位排程 —— 全片一个镜头，没有片段切换点，也就没有「抖一下」。
    //   ② 没有 stage 片段的老形象，仍走「walk 片段 + dance 片段 + 两次平移」。
    let stageGen = 0

    /** 舞台相位：按片长百分比收尾，避免再写死 5167/7100 这种数字。 */
    function planStage(gen, clip, delay) {
      const ms = clipMsOf(clip)
      const at = (frac, fn) => {
        const wait = Math.max(0, Math.round(ms * frac) - delay)
        later(() => {
          if (gen !== stageGen) return
          try {
            fn()
          } catch (e) {
            /* 单个相位失败不影响后续 */
          }
        }, wait)
      }
      // 30%~70% 是片段自己的舞蹈窗口：这时候撒花 + 台词，不要去动 stage（会打断表演）
      at(0.32, () => {
        playFx('confetti', { ttl: 4200 })
        bubble(randomLine('dance'), 3200, 'dance')
        notify()
      })
      at(0.7, () => {
        // 走回去：位置先回角落，片段里她本来就在迈步
        runtime.stage = { tx: 0, ty: 0, zoom: 1 }
        notify()
      })
      at(0.99, () => {
        runtime.stage = null
        runtime.mood = 'idle'
        runtime.moodUntil = nowMs() + 3000
        stageGen++
        notify()
      })
    }

    function runToCenterAndDance() {
      try {
        // 减弱动效（R10）：不搬到屏幕中间、不撒花，只在原地放一次舞。
        // 这是用户显式点播（面板「跳一段」/庆祝），所以动作本身仍然放行。
        if (runtime.reduced) {
          playAction('dance', { explicit: true })
          bubble(randomLine('dance'), 3200, 'dance')
          notify()
          return
        }
        const el = runtime.rootEl
        if (!el) return
        if (runtime.stage) return
        const actor = el.querySelector('.dsh-pet-actor')
        if (!actor) return
        const ar = actor.getBoundingClientRect()
        const host = (el.parentElement || document.body).getBoundingClientRect()
        const dx = host.width / 2 - (ar.left - host.left + ar.width / 2)
        const dy = Math.max(20, host.height / 2 - (ar.top - host.top + ar.height / 2) - 20)
        const p = persona()
        const stageClip = p.clips && p.clips.stage ? p.clips.stage : null
        if (stageClip) {
          // 一条连贯片段（1.20.0）：不切片段，位移按片长百分比排程
          const gen = ++stageGen
          runtime.stage = { tx: Math.round(dx), ty: Math.round(dy), zoom: 1.8 }
          runtime.mood = 'stage'
          runtime.moodUntil = nowMs() + clipMsOf(stageClip)
          bubble(randomLine('idle'), 2400, 'idle')
          notify()
          // 片长要等 media metadata（~200ms 内到）；先等一拍再按真实时长排相位
          later(() => {
            if (gen === stageGen) planStage(gen, stageClip, 200)
          }, 200)
          return
        }
        runtime.stage = { tx: Math.round(dx), ty: Math.round(dy), zoom: 1.8 }
        runtime.mood = 'walk'
        runtime.moodUntil = nowMs() + 1700
        bubble(randomLine('idle'), 2400, 'idle')
        notify()
        // 舞蹈窗口与片段对齐（R02）：6000ms 会让 5.167s 的片段在 loop 处跳回；
        // 后续两个收尾时点按「舞 stop 之后 250ms / 1950ms」平移。
        later(() => {
          runtime.mood = 'dance'
          runtime.moodUntil = nowMs() + 5167
          playFx('confetti', { ttl: 4200 })
          bubble(randomLine('dance'), 3200, 'dance')
          notify()
        }, 1650)
        // 裸 setTimeout 不受 clearLater 管辖（R08）：统一走 later，卸载时一起清
        later(() => {
          runtime.stage = { tx: 0, ty: 0, zoom: 1 }
          runtime.mood = 'walk'
          runtime.moodUntil = nowMs() + 1700
          notify()
        }, 7100)
        later(() => {
          runtime.stage = null
          runtime.mood = 'idle'
          runtime.moodUntil = nowMs() + 3000
          notify()
        }, 8800)
      } catch (e) {
        petLog('dance failed', String((e && e.message) || e))
      }
    }
