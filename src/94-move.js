    function runToCenterAndDance() {
      try {
        // 减弱动效（R10）：不搬到屏幕中间、不撒花，只在原地放一次舞。
        // 这是用户显式点播（面板「跳一段」/庆祝），所以动作本身仍然放行。
        if (runtime.reduced) {
          playAction('dance', { explicit: true })
          bubble(randomLine('dance'), 3200)
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
        runtime.stage = { tx: Math.round(dx), ty: Math.round(dy), zoom: 1.8 }
        runtime.mood = 'walk'
        runtime.moodUntil = nowMs() + 1700
        bubble(randomLine('idle'), 2400)
        notify()
        // 舞蹈窗口与片段对齐（R02）：6000ms 会让 5.167s 的片段在 loop 处跳回；
        // 后续两个收尾时点按「舞 stop 之后 250ms / 1950ms」平移。
        later(() => {
          runtime.mood = 'dance'
          runtime.moodUntil = nowMs() + 5167
          playFx('confetti', { ttl: 4200 })
          bubble(randomLine('dance'), 3200)
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
