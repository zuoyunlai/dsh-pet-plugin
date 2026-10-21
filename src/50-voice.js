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

    // 每说一句自增：异步拿到 blob 时用它判断这句是不是已经过期
    let speakSeq = 0

    /** 连续失败 3 次才降级成系统语音；成功一次就清零 */
    function noteNeuralFail(reason) {
      runtime.neuralFails = (runtime.neuralFails || 0) + 1
      runtime.neuralReason = reason
      petLog('neural tts failed', { n: runtime.neuralFails, reason })
      if (runtime.neuralFails >= 3) runtime.neuralOk = false
    }

    function noteNeuralOk() {
      if (runtime.neuralFails) runtime.neuralFails = 0
      if (runtime.neuralOk === false && runtime.settings.neuralVoice !== false) runtime.neuralOk = undefined
    }

    /** 系统语音用的 locale 标签（神经音色由宿主按 lang 选） */
    const SAPI_LANG = { zh: 'zh-CN', en: 'en-US', es: 'es-ES', pt: 'pt-BR', hi: 'hi-IN' }

    function voiceParams() {
      const p = persona()
      const s = runtime.settings
      return {
        pitch: Number(s.voicePitch != null ? s.voicePitch : p.voice.pitch),
        rate: Number(s.voiceRate != null ? s.voiceRate : p.voice.rate),
        // 'auto' = 交给宿主按界面语言挑；其余是用户手选的具体音色
        voice: s.ttsVoice && s.ttsVoice !== 'auto' ? s.ttsVoice : '',
        lang: PET_LANG,
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
            // 探测失败不永久关闭：置 undefined，下次说话再试（3 次连续失败才降级）
            runtime.neuralOk = j && j.available ? true : undefined
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

    /** POST 到 /dsh-pet/tts，拿回 mp3 的 objectURL（GET 端点已取消） */
    async function ttsBlobUrl(text) {
      const v = voiceParams()
      const base = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
      const pitch = ((v.pitch - 1) * 100).toFixed(0)
      const rate = ((v.rate - 1) * 100).toFixed(0)
      const body = {
        text,
        lang: v.lang,
        voice: v.voice || undefined,
        pitch: (pitch >= 0 ? '+' : '') + pitch + 'Hz',
        rate: (rate >= 0 ? '+' : '') + rate + '%',
      }
      const res = await fetch(base + '/dsh-pet/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('tts http ' + res.status)
      const blob = await res.blob()
      try {
        runtime.lastBlobSize = blob.size
        runtime.lastBlobType = blob.type
      } catch (e) {
        /* ignore */
      }
      if (!blob || !blob.size) throw new Error('tts empty body')
      return window.URL.createObjectURL(blob)
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
        u.lang = SAPI_LANG[PET_LANG] || 'zh-CN'
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
        const seq = ++speakSeq
        ttsBlobUrl(text)
          .then((url) => {
            // 期间又说了新的一句：丢掉这条，别让两句抢着播
            if (seq !== speakSeq) {
              try {
                window.URL.revokeObjectURL(url)
              } catch (e) {
                /* ignore */
              }
              return
            }
            const a = new Audio(url)
            runtime.lastTts = 'neural'
            a.volume = clamp(runtime.settings.volume, 0, 1)
            currentAudio = a
            const drop = () => {
              try {
                window.URL.revokeObjectURL(url)
              } catch (e) {
                /* ignore */
              }
            }
            a.onended = () => {
              drop()
              restore()
            }
            a.onerror = () => {
              drop()
              currentAudio = null
              noteNeuralFail('audio error ' + ((a.error && a.error.code) || '?') + ' size=' + (runtime.lastBlobSize || 0) + ' type=' + (runtime.lastBlobType || '-'))
              saySapi(text, restore)
            }
            a.onplaying = () => noteNeuralOk()
            const pr = a.play()
            if (pr && typeof pr.catch === 'function') {
              pr.catch((err) => {
                drop()
                currentAudio = null
                runtime.lastTts = 'neural-blocked:' + String((err && err.name) || err)
                saySapi(text, restore)
              })
            }
          })
          .catch((err) => {
            if (seq !== speakSeq) return
            noteNeuralFail(String((err && err.message) || err))
            saySapi(text, restore)
          })
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
