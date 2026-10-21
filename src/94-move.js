    function runToCenterAndDance() {
      try {
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
        later(() => {
          runtime.mood = 'dance'
          runtime.moodUntil = nowMs() + 6000
          playFx('confetti', { ttl: 4200 })
          bubble(randomLine('dance'), 3200)
          notify()
        }, 1650)
        setTimeout(() => {
          runtime.stage = { tx: 0, ty: 0, zoom: 1 }
          runtime.mood = 'walk'
          runtime.moodUntil = nowMs() + 1700
          notify()
        }, 7900)
        setTimeout(() => {
          runtime.stage = null
          runtime.mood = 'idle'
          runtime.moodUntil = nowMs() + 3000
          notify()
        }, 9600)
      } catch (e) {
        petLog('dance failed', String((e && e.message) || e))
      }
    }
