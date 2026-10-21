    /* ================= 语音（TTS） ================= */

    let voiceCache = null

    function pickVoice() {
      try {
        const synth = window.speechSynthesis
        if (!synth) return null
        const voices = voiceCache || synth.getVoices() || []
        if (!voices.length) return null
        voiceCache = voices
        const zh = voices.filter((v) => /zh|cmn|Chinese|Xiaoxiao|Huihui|Yaoyao|Kangkang|Yunxi/i.test(String(v.lang) + ' ' + String(v.name)))
        return zh[0] || voices[0]
      } catch (e) {
        return null
      }
    }

    let currentAudio = null

    function stopVoice() {
      try {
        if (window.speechSynthesis) window.speechSynthesis.cancel()
      } catch (e) {
        /* ignore */
      }
      try {
        if (currentAudio) {
          currentAudio.pause()
          currentAudio = null
        }
      } catch (e) {
        /* ignore */
      }
      runtime.speaking = false
      runtime.speakUntil = 0
      if (runtime.mood === 'talk') runtime.mood = 'idle'
    }

    function voiceParams() {
      const p = persona()
      const s = runtime.settings
      return {
        pitch: Number(s.voicePitch != null ? s.voicePitch : p.voice.pitch),
        rate: Number(s.voiceRate != null ? s.voiceRate : p.voice.rate),
        voice: s.ttsVoice || 'xiaoxiao',
      }
    }

    /** 探测宿主有没有可用的神经语音；没有就静默用系统语音，不再每句白等 2 秒。 */
    let neuralChecked = false
    function checkNeural() {
      if (neuralChecked) return
      neuralChecked = true
      try {
        const base = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
        fetch(base + '/dsh-pet/tts/status')
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            runtime.neuralOk = !!(j && j.available)
            runtime.neuralReason = (j && j.reason) || ''
            petLog('tts status', { ok: runtime.neuralOk, reason: runtime.neuralReason })
            notify()
          })
          .catch(() => {
            runtime.neuralOk = false
          })
      } catch (e) {
        runtime.neuralOk = false
      }
    }

    function ttsUrl(text) {
      const v = voiceParams()
      const base = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
      const pitch = ((v.pitch - 1) * 100).toFixed(0)
      const rate = ((v.rate - 1) * 100).toFixed(0)
      return (
        base +
        '/dsh-pet/tts?voice=' + encodeURIComponent(v.voice) +
        '&pitch=' + encodeURIComponent((pitch >= 0 ? '+' : '') + pitch + 'Hz') +
        '&rate=' + encodeURIComponent((rate >= 0 ? '+' : '') + rate + '%') +
        '&text=' + encodeURIComponent(text)
      )
    }

    /** 系统 SAPI 兜底（神经语音失败时用）。 */
    function saySapi(text, restore) {
      runtime.lastTts = 'sapi'
      const synth = window.speechSynthesis
      if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') {
        restore()
        return
      }
      try {
        synth.cancel()
        const v = voiceParams()
        const u = new window.SpeechSynthesisUtterance(text)
        u.lang = 'zh-CN'
        u.pitch = clamp(v.pitch, 0, 2)
        u.rate = clamp(v.rate, 0.5, 2)
        u.volume = clamp(runtime.settings.volume, 0, 1)
        const voice = pickVoice()
        if (voice) u.voice = voice
        u.onend = restore
        u.onerror = restore
        synth.speak(u)
      } catch (e) {
        restore()
      }
    }

    function speak(text) {
      if (!text || !runtime.settings.voiceOn) return
      // 跳舞时不要被「说话」这个心情抢走动作（否则中间那 6 秒全在点头）
      const staged = !!runtime.stage
      const prevMood = runtime.mood === 'talk' ? 'idle' : runtime.mood
      const restore = () => {
        runtime.speaking = false
        if (!staged && runtime.mood === 'talk') {
          runtime.mood = prevMood
          runtime.moodUntil = nowMs() + 1500
        }
        notify()
      }

      runtime.speaking = true
      if (!staged) {
        runtime.mood = 'talk'
        runtime.moodUntil = nowMs() + 2200
      }
      // 浏览器静默拦掉语音时 onend 不会来，用估算时长兜底解锁
      runtime.speakUntil = nowMs() + 1600 + text.length * 240

      if (runtime.settings.neuralVoice === false || runtime.neuralOk === false) {
        saySapi(text, restore)
        return
      }
      checkNeural()

      try {
        // 上一句还没播完就先掐掉，避免两句叠在一起
        if (currentAudio) {
          try {
            currentAudio.pause()
          } catch (e) {
            /* ignore */
          }
        }
        const a = new Audio(ttsUrl(text))
        runtime.lastTts = 'neural'
        a.volume = clamp(runtime.settings.volume, 0, 1)
        currentAudio = a
        a.onended = restore
        a.onerror = () => {
          currentAudio = null
          runtime.neuralOk = false
          runtime.neuralReason = 'audio error ' + ((a.error && a.error.code) || '?')
          petLog('neural tts failed, fallback to sapi')
          saySapi(text, restore)
        }
        const pr = a.play()
        if (pr && typeof pr.catch === 'function') {
          pr.catch((err) => {
            currentAudio = null
            runtime.lastTts = 'neural-blocked:' + String((err && err.name) || err)
            saySapi(text, restore)
          })
        }
      } catch (e) {
        saySapi(text, restore)
      }
    }

    /** 把当前形象常用的台词在后台合成好，之后播就是本地缓存，秒出。 */
    function warmVoice() {
      try {
        if (runtime.settings.neuralVoice === false || runtime.neuralOk === false) return
        const p = persona()
        const all = []
        for (const k of Object.keys(p.lines || {})) {
          for (const line of p.lines[k] || []) all.push(String(line))
        }
        const uniq = Array.from(new Set(all)).slice(0, 20)
        if (!uniq.length) return
        const v = voiceParams()
        const pitch = ((v.pitch - 1) * 100).toFixed(0)
        const rate = ((v.rate - 1) * 100).toFixed(0)
        const body = JSON.stringify({
          voice: v.voice,
          pitch: (pitch >= 0 ? '+' : '') + pitch + 'Hz',
          rate: (rate >= 0 ? '+' : '') + rate + '%',
          lines: uniq,
        })
        const warmBase = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
        fetch(warmBase + '/dsh-pet/tts/warm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body,
        })
          .then(() => petLog('warm voice queued', { n: uniq.length }))
          .catch(() => {})
      } catch (e) {
        /* ignore */
      }
    }
