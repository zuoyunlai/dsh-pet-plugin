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
            // R-01：debug 出口也读运行期注册表（与下拉一致）。
            // 用 getter：/personas 整表替换后，旧引用会指向上一个对象（P1-2 回归测试踩到）。
            get PERSONAS() {
              return PERSONA_REG.map
            },
            setPersonas,
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
            // 跨设备状态（P0-1）：台架直接驱动「采纳宿主状态 / 回传」，不用等轮询时序
            adoptHostState,
            pushStateNow,
            localStateAt,
            saveSettings,
            clearHistory,
            loadHistory,
            // 导演层（1.21.0）：心情 + 语言 → 音色 / 音高 / 语速 / 音量
            voiceParams,
            playFx,
            notify,
            runToCenterAndDance,
            // 失焦感知（1.26.0）：安静态判定要能被台架直接问到，
            // 否则只能靠肉眼观察「她是不是真的闭嘴了」。
            isQuiet,
            quietReason,
            isAddressedKind,
            isFocused,
            syncQuiet,
            toggleDontDisturb,
            dndRemainingMs,
            QUIET_AFTER_MS,
            DONT_DISTURB_MS,
            // 失焦通知（1.26.0）：降级链与自证统计，台架要能直接驱动与断言
            probeNotify,
            requestNotifyPermission,
            sendTurnNotify,
            titlePrefix,
            notifyStats,
            TURN_NOTIFY_MIN_MS,
            TURN_NOTIFY_COOLDOWN_MS,
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
            headerSafeArea,
            setHover,
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
          // 失焦感知（1.26.0）：安静态的事件源。与 tick 同生命周期，
          // 卸载函数由 watchFocus 返回，统一在这里清理。
          const stopFocus = watchFocus()
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
            // P0-1：老用户升级时给现有本地设置补一个时间戳，避免被宿主旧快照按 updatedAt 压回去
            ensureLocalStateAt()
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
            try {
              stopFocus()
            } catch (e) {
              /* ignore */
            }
            clearLater()
            stopVoice()
          }
        })

        // 视线跟随：只写 CSS 变量，不触发 React 重渲染。
        // 照片形象（五只内置全是）没有瞳孔层 .dsh-pet-pupils——那是 SVG 形象专用的；
        // 对它们来说每次 mousemove 的 getBoundingClientRect 是纯开销，还是强制 reflow
        //（2026-10-28 审计④b）。先查形象再动手。
        ctx.effect(() => {
          const onMove = (e) => {
            try {
              if (persona().image) return
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
        // 可见时 8s 一轮；藏起来时退到 30s（不是「暂停」——斜杠命令/公告要靠它唤醒），
        // 省 CPU 与网络又不至于错过「叫出来」。
        ctx.effect(() => {
          let stop = false
          // 1.10.0 起 /api 前缀已删除，只剩这一个相对路径 + 注入的绝对地址
          const base = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
          // 去重（R-05）：base 为空（网页版无注入）时两个地址相同，
          // 不去重会让失败轮询白跑一遍 8s 预算（chatWithPet 同款写法）
          const urls = []
          for (const u of [base + '/dsh-pet/ping', '/dsh-pet/ping']) {
            if (u && urls.indexOf(u) < 0) urls.push(u)
          }
          // 一次轮询的预算（R08）：没有这个，一个永不返回的 fetch 会让整条链
          // 永远停在这里，而 showPet 的补拉还会再起一条同样会挂的链。
          const POLL_TIMEOUT = 8000
          // P2-8（2026-10-29 审计）：公告/命令的消费序号必须跨刷新持久化。
          // 只放内存里的话，刷新一次就把上一条公告再念一遍、把 /dsh-pet hide 再执行一次。
          const SEQ_KEY = 'dsh-pet.seq.v1'
          const loadSeq = () => {
            try {
              const o = JSON.parse(window.localStorage.getItem(SEQ_KEY) || '{}')
              return o && typeof o === 'object' ? o : {}
            } catch (e) {
              return {}
            }
          }
          const saveSeq = (patch) => {
            try {
              const o = loadSeq()
              Object.assign(o, patch)
              window.localStorage.setItem(SEQ_KEY, JSON.stringify(o))
            } catch (e) {
              /* 隐私模式：退化为内存去重 */
            }
          }
          if (!runtime.seqLoaded) {
            runtime.seqLoaded = true
            const seqs = loadSeq()
            runtime.lastAnnounceSeq = Number(seqs.announce) || 0
            runtime.lastCommandSeq = Number(seqs.command) || 0
          }
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
                  // —— 宿主 phase 投影（R-02）：写进 runtime 供 computePhase 融合 ——
                  if (j.phase) runtime.hostPhase = String(j.phase)
                  if (j.phaseAt) runtime.hostPhaseAt = Number(j.phaseAt) || 0
                  // 宿主重启会把 seq 归零（P2-8 的持久化游标副作用）：检测到回退就把本地
                  // 游标清掉，否则重启后的新公告/新命令会被当成「重放」永久忽略。
                  if (typeof j.commandSeq === 'number' && j.commandSeq < (runtime.lastCommandSeq || 0)) {
                    runtime.lastCommandSeq = 0
                    saveSeq({ command: 0 })
                  }
                  if (
                    j.announce &&
                    typeof j.announce.seq === 'number' &&
                    j.announce.seq < (runtime.lastAnnounceSeq || 0)
                  ) {
                    runtime.lastAnnounceSeq = 0
                    saveSeq({ announce: 0 })
                  }
                  // —— 公告（R-03）：序号变大才播，轮询重复拿到同一条不重放 ——
                  if (
                    j.announce &&
                    j.announce.seq > (runtime.lastAnnounceSeq || 0) &&
                    typeof j.announce.text === 'string' &&
                    j.announce.text
                  ) {
                    runtime.lastAnnounceSeq = j.announce.seq
                    saveSeq({ announce: j.announce.seq })
                    // announce 是外部触发（脚本/其它插件点名要她说），不走 statusBubbles 闸
                    bubble(String(j.announce.text).slice(0, 300), null, 'announce')
                  }
                  // 斜杠命令：序号变大才执行，轮询重复拿到同一条不会重放
                  if (j.commandSeq && j.commandSeq > (runtime.lastCommandSeq || 0)) {
                    runtime.lastCommandSeq = j.commandSeq
                    saveSeq({ command: j.commandSeq })
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

        // —— personas / 跨设备状态（R-01 / R-04，反哺报告 2026-10-27）：启动各拉一次 ——
        // personas：宿主扫描到的形象整表下发；失败/空表保持内置表（setPersonas 拒收空表）。
        // state：宿主有 → 宿主优先合并；宿主空 → 本地状态推上云（$DSH_HOME），换浏览器/设备不失忆。
        ctx.effect(() => {
          let stop = false
          const base = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
          const withTimeout = (url, ms, init) => {
            if (typeof AbortController !== 'function') return fetch(url, init)
            const c = new AbortController()
            const t = setTimeout(() => {
              try {
                c.abort()
              } catch (e) {
                /* ignore */
              }
            }, ms)
            return fetch(url, { credentials: 'include', ...init, signal: c.signal }).finally(() => clearTimeout(t))
          }
          ;(async () => {
            try {
              const res = await withTimeout(base + '/dsh-pet/personas', 8000)
              if (!stop && res.ok) {
                const j = await res.json()
                if (j && j.ok && Array.isArray(j.personas)) setPersonas(j.personas)
              }
            } catch (e) {
              /* 老宿主没有这个端点：保持内置表 */
            }
            try {
              const res = await withTimeout(base + '/dsh-pet/state', 8000)
              if (!stop && res.ok) {
                const j = await res.json()
                const host = (j && j.state) || {}
                const hostAt = Number(host.updatedAt) || 0
                const localAt = localStateAt()
                const hasHost =
                  (host.settings && Object.keys(host.settings).length) || (host.history && host.history.length)
                // 新者胜（P0-1，2026-10-29 审计）：
                //   - 本地从没保存过（localAt=0）且宿主有状态 → 采纳宿主（换浏览器/换设备恢复）；
                //   - 宿主更新时间 >= 本地 → 采纳宿主（另一台机器刚改过）；
                //   - 否则本地更新 → 把本地推上去覆盖宿主。
                // 旧版本留下的宿主文件没有 updatedAt（hostAt=0），而本地升级时
                // ensureLocalStateAt() 已经给现有设置打了「刚刚保存」的时间戳，
                // 所以「旧快照打回新设置」这个 P0 场景自然落到最后一条。
                if (hasHost && hostAt >= localAt) adoptHostState(host)
                else pushStateNow()
              }
            } catch (e) {
              /* 老宿主没有这个端点：本地 localStorage 照旧 */
            }
          })()
          return () => {
            stop = true
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
                  '" 插槽，桌面伴侣无法挂载。需要 dsh >= 0.2.1-alpha.2（本插件实测版本）。',
              )
            } catch (e2) {
              /* ignore */
            }
          }
        }

        mountSlot(
          'shell.overlay',
          { name: 'shell.overlay', id: 'dsh-pet', order: 200, label: t('panel.title'), locale: 'pet' },
          // P1-2：PetRoot = PetBoundary(PetOverlay)，渲染期异常回落到安全占位而不是白屏
          PetRoot,
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
