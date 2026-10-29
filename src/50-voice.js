    /* ================= 语音（TTS） ================= */

    let voiceCache = null

    function pickVoice() {
      try {
        const synth = window.speechSynthesis
        if (!synth) return null
        const voices = voiceCache || synth.getVoices() || []
        if (!voices.length) return null
        voiceCache = voices
        // P2-5（2026-10-29 审计）：按当前界面语言挑嗓子。旧写法硬编码中文关键字，
        // 英/西/葡/印界面走 SAPI 兜底时会挑到中文嗓（u.lang 与 voice.lang 不一致，
        // 读音全歪）。现在先按语言前缀筛，筛不到才退回第一个。
        const want = String(SAPI_LANG[PET_LANG] || 'zh-CN').toLowerCase()
        const byLang = voices.filter((v) => String(v.lang || '').toLowerCase().startsWith(want.slice(0, 2)))
        return byLang[0] || voices[0]
      } catch (e) {
        return null
      }
    }

    let currentAudio = null
    let currentAudioUrl = null
    /** 回收 blob URL（P3-4）：打断/替换/卸载都要调，否则长会话会一直累积 */
    function dropAudioUrl(url) {
      try {
        if (url) window.URL.revokeObjectURL(url)
      } catch (e) {
        /* ignore */
      }
      if (currentAudioUrl && currentAudioUrl === url) currentAudioUrl = null
    }

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
      // P3-4：旧写法只 pause 不 revoke，被打断的那句 blob 永远不回收到
      dropAudioUrl(currentAudioUrl)
      runtime.speaking = false
      runtime.speakUntil = 0
      if (runtime.mood === 'talk') runtime.mood = 'idle'
    }

    // 每说一句自增：异步拿到 blob 时用它判断这句是不是已经过期
    let speakSeq = 0

    /**
     * 这次失败是不是「一次性环境问题」：限流 / 自动播放被拦 / 网络抖动。
     *
     * P2-4（2026-10-29 审计）：旧实现把这些也计进「连续失败 3 次 → 本会话永久 SAPI」，
     * 一次限流或一次手势策略抖动就把整场语音降级成机器人，而且开关切回也不恢复。
     */
    const isTransientNeuralFail = (reason) =>
      /429|rate|too many|NotAllowed|play\(\)|AbortError|network|Failed to fetch|tts http 5\d\d/i.test(
        String(reason || ''),
      )

    /** 连续失败 3 次才降级成系统语音；成功一次就清零 */
    function noteNeuralFail(reason) {
      runtime.neuralReason = reason
      if (isTransientNeuralFail(reason)) {
        petLog('neural tts transient failure', { reason })
        return
      }
      runtime.neuralFails = (runtime.neuralFails || 0) + 1
      petLog('neural tts failed', { n: runtime.neuralFails, reason })
      if (runtime.neuralFails >= 3) runtime.neuralOk = false
    }

    function noteNeuralOk() {
      if (runtime.neuralFails) runtime.neuralFails = 0
      if (runtime.neuralOk === false && runtime.settings.neuralVoice !== false) runtime.neuralOk = undefined
    }

    /** 用户重新打开「神经」开关时恢复到「再试一次」——降级不该是永久的（P2-4） */
    function resetNeural() {
      runtime.neuralFails = 0
      runtime.neuralOk = undefined
      runtime.neuralReason = ''
      neuralChecked = false
    }

    /** 系统语音用的 locale 标签（神经音色由宿主按 lang 选） */
    const SAPI_LANG = { zh: 'zh-CN', en: 'en-US', es: 'es-ES', pt: 'pt-BR', hi: 'hi-IN' }

    /**
     * 演绎参数 = 形象基座（pack.voice.pitch / rate）× 这一句的心情方向（pack.voice.moods[mood]）。
     *
     * 「LLM 当导演、TTS 当演员」的落点就在这里：导演层不是每句话去调一次模型，而是把
     * 表演纲领（每个心情的升降调幅度、语速倍率、音量倍率）写进角色包，运行时只查表相乘。
     * 零延迟、零费用、可复现；想改演出只改 pack.json 那一行。
     *
     * 音色：用户手选了具体音色就用手选的；'auto' 时优先形象自带音色（voiced[语言]），
     * 五只角色因此各自一个嗓子，而不是同一个人变调。
     */
    function voiceParams(mood) {
      const p = persona()
      const s = runtime.settings
      // P1-2：渲染/设置面板都会读这里。缺 voice（用户自建 pack）不能让整块 UI 抛错，
      // 缺失时按「基座 1 / 1」处理——听感是普通音高语速，而不是崩掉面板。
      const voice = p && p.voice && typeof p.voice === 'object' ? p.voice : {}
      const dir = (voice.moods && voice.moods[mood || runtime.mood]) || null
      const pt = s.pitchTrim == null ? 1 : Number(s.pitchTrim)
      const rt = s.rateTrim == null ? 1 : Number(s.rateTrim)
      const basePitchNum = Number(voice.pitch)
      const baseRateNum = Number(voice.rate)
      const basePitch = (Number.isFinite(basePitchNum) ? basePitchNum : 1) * (isFinite(pt) ? pt : 1)
      const baseRate = (Number.isFinite(baseRateNum) ? baseRateNum : 1) * (isFinite(rt) ? rt : 1)
      // mood 导演表的数字也要兜底：宿主校验挡不住老宿主/中间层灌进来的 'abc'
      const dPitch = dir && Number.isFinite(Number(dir.pitch)) ? Number(dir.pitch) : 0
      const dRate = dir && Number.isFinite(Number(dir.rate)) ? Number(dir.rate) : 1
      const pitch = basePitch * (1 + dPitch / 100)
      const rate = baseRate * dRate
      const manual = s.ttsVoice && s.ttsVoice !== 'auto' ? s.ttsVoice : ''
      const own = (voice.voiced && voice.voiced[PET_LANG]) || ''
      return {
        pitch: clamp(pitch, 0.5, 2),
        rate: clamp(rate, 0.5, 2),
        volume: dir && dir.volume != null ? clamp(Number(dir.volume), 0, 2) : 1,
        voice: manual || own,
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
            if (!j) {
              // 端点异常（非 2xx / 空 body）：置「未知」并允许下次说话重试
              runtime.neuralOk = undefined
              neuralChecked = false
              return
            }
            // P2-3（2026-10-29 审计）：宿主明确说 available:false（没装 edge-tts）
            // 时直接降级成系统语音。旧写法把它写成 undefined（= 未知），于是每句
            // 都要先去 /tts 白付一次 503，连续三次才降级。
            runtime.neuralOk = j.available ? true : false
            runtime.neuralReason = j.reason || ''
            petLog('tts status', { ok: runtime.neuralOk, reason: runtime.neuralReason })
            notify()
          })
          .catch(() => {
            // 网络抖动 ≠ 不可用（R-08）：置「未知」并允许下次说话重试；
            // 只有上面 .then 里明确的 available:false 才直接降级
            runtime.neuralOk = undefined
            neuralChecked = false
          })
      } catch (e) {
        runtime.neuralOk = false
      }
    }

    /** POST 到 /dsh-pet/tts，拿回 mp3 的 objectURL（GET 端点已取消） */
    async function ttsBlobUrl(text, mood) {
      const v = voiceParams(mood)
      const base = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
      const pitch = ((v.pitch - 1) * 100).toFixed(0)
      const rate = ((v.rate - 1) * 100).toFixed(0)
      const vol = ((v.volume - 1) * 100).toFixed(0)
      const body = {
        text,
        lang: v.lang,
        voice: v.voice || undefined,
        pitch: (pitch >= 0 ? '+' : '') + pitch + 'Hz',
        rate: (rate >= 0 ? '+' : '') + rate + '%',
        volume: (vol >= 0 ? '+' : '') + vol + '%',
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
    function saySapi(text, restore, mood) {
      runtime.lastTts = 'sapi'
      const synth = window.speechSynthesis
      if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') {
        restore()
        return
      }
      try {
        synth.cancel()
        const v = voiceParams(mood)
        const u = new window.SpeechSynthesisUtterance(text)
        u.lang = SAPI_LANG[PET_LANG] || 'zh-CN'
        u.pitch = clamp(v.pitch, 0, 2)
        u.rate = clamp(v.rate, 0.5, 2)
        u.volume = clamp(Number(runtime.settings.volume) * v.volume, 0, 1)
        const voice = pickVoice()
        if (voice) u.voice = voice
        u.onend = restore
        u.onerror = restore
        synth.speak(u)
      } catch (e) {
        restore()
      }
    }

    /**
     * 音画同步的唯一判据：人不在屏幕上就不发任何声。
     * 三种「不在」：藏起来（visible=false，整层不渲染）、被拖出视口（petOffscreen）、
     * 还没挂载（rootEl 为空）。判据只放在这一个函数里，其他分支一律调它。
     */
    function onScreen() {
      return !!(runtime.visible && !runtime.petOffscreen && runtime.rootEl)
    }

    function speak(text, mood) {
      if (!text || !runtime.settings.voiceOn) return
      // 人不在屏幕上就别出声（2026-10-25 用户报：人都藏起来了，她还在说话）
      if (!onScreen()) return
      // 安静态（1.26.0）：与 bubble 同一套判据，kind 由调用方透传（第三参）。
      // 单独再判一次是因为 speak 可以被绕过 bubble 直接调用，声音是最讨厌的那一种打扰。
      if (isQuiet() && !isAddressedKind(mood)) return
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
        saySapi(text, restore, mood)
        return
      }
      checkNeural()

      try {
        // 上一句还没播完就先掐掉，避免两句叠在一起。（P3-4：同时回收它的 blob URL）
        if (currentAudio) {
          try {
            currentAudio.pause()
          } catch (e) {
            /* ignore */
          }
          currentAudio = null
          dropAudioUrl(currentAudioUrl)
        }
        const seq = ++speakSeq
        ttsBlobUrl(text, mood)
          .then((url) => {
            // 期间又说了新的一句：丢掉这条，别让两句抢着播
            if (seq !== speakSeq) {
              dropAudioUrl(url)
              return
            }
            // 合成是异步的（几百毫秒）：等它回来时人可能已经被藏起来了，
            // 这时候不能再出声，否则就是「人不见了声音还在」。
            if (!onScreen()) {
              dropAudioUrl(url)
              restore()
              return
            }
            const a = new Audio(url)
            runtime.lastTts = 'neural'
            a.volume = clamp(runtime.settings.volume, 0, 1)
            currentAudio = a
            currentAudioUrl = url
            const drop = () => {
              dropAudioUrl(url)
              if (currentAudio === a) currentAudio = null
            }
            a.onended = () => {
              drop()
              restore()
            }
            a.onerror = () => {
              drop()
              noteNeuralFail(
                'audio error ' +
                  ((a.error && a.error.code) || '?') +
                  ' size=' +
                  (runtime.lastBlobSize || 0) +
                  ' type=' +
                  (runtime.lastBlobType || '-'),
              )
              saySapi(text, restore, mood)
            }
            a.onplaying = () => noteNeuralOk()
            const pr = a.play()
            if (pr && typeof pr.catch === 'function') {
              pr.catch((err) => {
                drop()
                runtime.lastTts = 'neural-blocked:' + String((err && err.name) || err)
                // 自动播放被拦是一次性的手势策略问题，不算神经语音坏了（P2-4）
                noteNeuralFail('NotAllowed ' + String((err && err.name) || err))
                saySapi(text, restore, mood)
              })
            }
          })
          .catch((err) => {
            if (seq !== speakSeq) return
            noteNeuralFail(String((err && err.message) || err))
            saySapi(text, restore, mood)
          })
      } catch (e) {
        saySapi(text, restore)
      }
    }

    /**
     * 把当前形象常用的台词在后台合成好，之后播就是本地缓存，秒出。
     *
     * 有了「心情方向」之后，同一句话在 idle / dance 下的音高语速不同，所以按**类别分组**
     * 预热（每类一次请求、各带一套参数），而不是把全部台词用同一套参数烤一遍——
     * 那样只有一类能命中缓存。
     */
    function warmVoice() {
      try {
        if (runtime.settings.neuralVoice === false || runtime.neuralOk === false) return
        const p = persona()
        // P2-2（2026-10-29 审计）：必须烤**当前语言**的台词。
        // 旧写法只看 p.lines（中文原稿），英/西/葡/印用户预热全部无效。
        const langKey = 'lines' + PET_LANG.charAt(0).toUpperCase() + PET_LANG.slice(1)
        const pack =
          (PET_LANG !== 'zh' && p[langKey]) ||
          (PET_LANG === 'zh' || !p.linesEn ? p.lines : p.linesEn) ||
          p.lines ||
          {}
        const groups = []
        for (const k of Object.keys(pack)) {
          const lines = (pack[k] || []).map((x) => String(x)).filter(Boolean)
          if (lines.length) groups.push({ mood: k, lines })
        }
        if (!groups.length) return
        groups.sort((a, b) => b.lines.length - a.lines.length)
        const warmBase = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
        let budget = 18
        const sends = []
        for (const g of groups.slice(0, 3)) {
          if (budget <= 0) break
          const lines = Array.from(new Set(g.lines)).slice(0, Math.min(8, budget))
          budget -= lines.length
          if (!lines.length) continue
          const v = voiceParams(g.mood)
          const pitch = ((v.pitch - 1) * 100).toFixed(0)
          const rate = ((v.rate - 1) * 100).toFixed(0)
          const vol = ((v.volume - 1) * 100).toFixed(0)
          sends.push({
            mood: g.mood,
            n: lines.length,
            body: {
              lang: v.lang,
              voice: v.voice,
              pitch: (pitch >= 0 ? '+' : '') + pitch + 'Hz',
              rate: (rate >= 0 ? '+' : '') + rate + '%',
              volume: (vol >= 0 ? '+' : '') + vol + '%',
              lines,
            },
          })
        }
        // P2-2：服务端是单飞预热（同一时刻只允许一条），三条并发只会被 429 掉两条。
        // 客户端改为串行发送，并检查 res.ok —— 被限流/失败时不能记成 "queued"。
        ;(async () => {
          for (const item of sends) {
            try {
              const res = await fetch(warmBase + '/dsh-pet/tts/warm', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(item.body),
              })
              if (res && res.ok) {
                petLog('warm voice queued', { mood: item.mood, n: item.n, lang: PET_LANG })
              } else {
                petLog('warm voice skipped', { mood: item.mood, status: res && res.status })
              }
            } catch (e) {
              /* 预热是锦上添花：失败静默 */
            }
          }
        })()
      } catch (e) {
        /* ignore */
      }
    }
