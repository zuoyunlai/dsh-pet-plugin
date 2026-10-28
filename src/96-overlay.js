    function PetOverlay() {
      useRuntime()
      if (!runtime.mountLogged) {
        runtime.mountLogged = true
        petLog('pet mounted', { slot: 'shell.overlay' })
      }
      const s = runtime.settings
      const p = persona()
      const [text, setText] = useState('')
      const rootRef = useRef(null)
      // 心情切到跳舞/走路时，自动播对应的动作序列
      useEffect(() => {
        const name =
          runtime.mood === 'dance' || runtime.mood === 'walk' || runtime.mood === 'stage'
            ? runtime.mood
            : null
        if (name) {
          const pid = persona().id
          if (!runtime.action || runtime.action.name !== name || runtime.action.persona !== pid) {
            // 时长交给片段本身（R02）：心情先变就由下面的 clearAction 收回
            playAction(name, { moodDriven: true })
          }
        } else if (runtime.action && runtime.action.moodDriven && runtime.action.name !== 'hair') {
          // 只收回「心情自己发起」的动作；用户点“跳一段”发起的要让它跳完
          // （否则一次工具报错把 mood 打成 angry，舞就断了）
          clearAction()
        }
      }, [runtime.mood])
      const mood = runtime.mood

      // 自愈：宿主的浮层参照系不一定是窗口（可能被滚动容器/transform 带偏）。
      // 只量「她本人」那块：气泡和设置面板本来就可能顶出视口上沿，
      // 拿整个 root 去判会误伤——点开设置就以为她跑丢了。
      useEffect(() => {
        if (!runtime.visible) return undefined
        const t = setTimeout(() => {
          try {
            const el = rootRef.current
            if (!el) return
            // 面板开着的时候不判：面板高度会把 root 撑出视口，属于正常
            if (runtime.panelOpen) return
            const actor = el.querySelector('.dsh-pet-actor') || el
            const r = actor.getBoundingClientRect()
            const vw = window.innerWidth
            const vh = window.innerHeight
            const host = (el.parentElement || document.body).getBoundingClientRect()
            // 只有「整个人都不在视口里」才算丢了；露出半个身子不动她
            const gone =
              r.width === 0 ||
              r.height === 0 ||
              r.right < 0 ||
              r.left > vw ||
              r.bottom < 0 ||
              r.top > vh
            if (!gone) {
              if (runtime.petOffscreen) {
                runtime.petOffscreen = false
                notify()
              }
              return
            }
            runtime.petOffscreen = true
            // 被拖出视口 = 看不见她 → 立刻闭嘴（音画同步，见 src/50-voice.js 的 onScreen）
            try {
              stopVoice()
            } catch (e) {
              /* ignore */
            }
            // 用户拖过的位置如果已经跑到视口外（换窗口大小/换显示器），
            // 手动的锚点会被保留，那就永远看不见了 —— 这里直接丢掉旧位置。
            if (runtime.settings.pos) {
              runtime.settings.pos = null
              runtime.autoPos = null
              saveSettings()
              petLog('dropped saved pos (off-screen)')
              notify()
              return
            }
            if (runtime.dragPos) return
            runtime.autoPos = {
              x: Math.max(0, Math.min(host.width - r.width, vw - host.left - r.width - 26)),
              y: Math.max(0, Math.min(host.height - r.height, vh - host.top - r.height - 186)),
            }
            petLog('repositioned', {
              rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
              host: { w: Math.round(host.width), h: Math.round(host.height) },
              to: runtime.autoPos,
            })
            notify()
          } catch (e) {
            /* ignore */
          }
        }, 60)
        return () => clearTimeout(t)
      }, [runtime.visible, runtime.panelOpen, s.pos, runtime.resizeTick])

      if (!runtime.visible) return null

      // 输入框的显示方式（1.22.0）：hover = 悬停才滑出（默认）；always = 常显。
      // 聊天框已经打开、或鼠标正停在人物上时，视为「应该展开」。
      const inputHoverMode = s.inputMode !== 'always'
      const inputShown = !inputHoverMode || runtime.hovering || runtime.inputPinned
      const rowClass = 'dsh-pet-row' + (inputHoverMode ? ' is-collapsible' : '') + (inputShown ? '' : ' is-hidden')

      const baseScale = clamp(s.scale, 0.6, 2)
      const style = { '--pet-scale': String(baseScale) }
      // 跳舞时只抬高层级；位移和放大都加在 actor 上，输入框不要跟着跑
      if (runtime.stage) style.zIndex = 90
      // 拖动 > 手动保存 > 自愈落点 > 默认右下角
      const pos = runtime.dragPos || s.pos || runtime.autoPos
      if (pos) {
        // 坐标可能来自旧版本/旧尺寸，落地前先夹到视口内，别让气泡被窗口切掉
        const vw = window.innerWidth || 1200
        const vh = window.innerHeight || 800
        style.left = Math.round(Math.max(8, Math.min(pos.x, vw - 160))) + 'px'
        style.top = Math.round(Math.max(8, Math.min(pos.y, vh - 140))) + 'px'
        style.right = 'auto'
        style.bottom = 'auto'
      }

      const onSend = () => {
        const v = text.trim()
        if (!v) return
        setText('')
        sayToPet(v)
      }

      const onPoke = () => {
        const roll = Math.random()
        const m = roll < 0.5 ? 'poked' : roll < 0.72 ? 'shy' : roll < 0.9 ? 'dance' : 'angry'
        runtime.mood = m
        runtime.moodUntil = nowMs() + 3500
        bubble(randomLine('poked'), 3600, 'poked')
        notify()
      }

      const onPointerDown = (e) => {
        if (e.button !== 0) return
        if (runtime.stage) return
        const el = rootRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const host = (el.parentElement || document.body).getBoundingClientRect()
        const originX = rect.left - host.left
        const originY = rect.top - host.top
        const startX = e.clientX
        const startY = e.clientY
        let moved = false
        const onMove = (ev) => {
          const dx = ev.clientX - startX
          const dy = ev.clientY - startY
          if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return
          moved = true
          runtime.dragPos = {
            x: clamp(originX + dx, 0, Math.max(0, host.width - rect.width)),
            y: clamp(originY + dy, 0, Math.max(0, host.height - rect.height)),
          }
          notify()
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          if (moved) {
            runtime.settings.pos = runtime.dragPos
            runtime.dragPos = null
            saveSettings()
            petLog('moved', runtime.settings.pos)
            // 被拖到新位置后说一句（1.21.0）：台词分类 drag，缺这类台词的形象保持安静
            const line = dragLine()
            if (line && Math.random() < 0.6) bubble(line, null, 'drag')
          } else {
            onPoke()
          }
          notify()
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
      }

      return h(
        'div',
        { className: 'dsh-pet-layer' },
        h(
          'div',
          {
            className: 'dsh-pet-root',
            style,
            ref: (el) => {
              rootRef.current = el
              runtime.rootEl = el
            },
          },
          h('style', null, CSS),
        runtime.panelOpen
          ? h('div', { className: 'dsh-pet-panelwrap', style: runtime.panelPos || undefined }, h(SettingsPanel))
          : null,
        runtime.bubble
          ? h('div', { className: 'dsh-pet-bubble', role: 'status', 'aria-live': 'polite' }, runtime.bubble.text)
          : null,
        runtime.aside
          ? h('div', { className: 'dsh-pet-aside', 'aria-hidden': 'true' }, runtime.aside.text)
          : null,
        // 1.22.0（用户 2026-10-27 反馈）：悬停区域必须同时覆盖「人物」和「输入框」。
        // 首版只把事件挂在人物本体上 → 鼠标刚离开人物、还没到输入框，pointerleave 就
        // 触发了，200ms 宽限也只是延迟这一下，所以「很难命中，偶尔能进去」。
        // 现在把两者放同一个容器里，鼠标在「人物 ↔ 输入框」之间移动都不算离开。
        h(
          'div',
          {
            className: 'dsh-pet-hoverzone',
            onPointerEnter: () => setHover(true),
            onPointerLeave: () => setHover(false),
          },
        h(
          'div',
          // 1.22.0（用户要求）：输入框平时不可见，鼠标移到人物上才滑出。
          // inputMode='always' 或 showInput=false 时退回旧行为（后者整行不渲染内容）。
          { className: rowClass },
          s.showInput
            ? h('span', {
                className:
                  'dsh-pet-dot' +
                  (runtime.ai === 'ok' ? ' on' : '') +
                  (runtime.ai === 'fail' ? ' bad' : '') +
                  (runtime.ai === 'busy' ? ' busy' : ''),
                title:
                  runtime.ai === 'busy'
                    ? t('dot.thinking')
                    : runtime.ai === 'ok'
                      ? t('dot.ok')
                      : runtime.ai === 'fail'
                        ? t('dot.fail')
                        : t('dot.idle'),
              })
            : null,
          s.showInput
            ? h('input', {
                className: 'dsh-pet-input',
                value: text,
                placeholder: t('placeholder.chat', { name: p.name }),
                onChange: (e) => setText(e.target.value),
                onKeyDown: (e) => {
                  // 中文输入法选词时的回车不能当成发送
                  const composing = e.nativeEvent && (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)
                  if (e.key === 'Enter' && !e.shiftKey && !composing) {
                    e.preventDefault()
                    onSend()
                  }
                  if (e.key === 'Escape') e.currentTarget.blur()
                },
                // 1.22.0：聚焦即钉住——鼠标点进来的途中输入框不会先收起来；
                // 失焦再交还给 hover 逻辑。键盘 Tab 进来同样有效。
                onFocus: () => {
                  runtime.inputPinned = true
                  notify()
                },
                onBlur: () => {
                  runtime.inputPinned = false
                  notify()
                },
                'aria-label': t('a11y.talkTo', { name: p.name }),
              })
            : null,
          s.showInput
            ? h(
                'button',
                {
                  className: 'dsh-pet-send',
                  onClick: onSend,
                  disabled: !text.trim(),
                  title: t('a11y.send'),
                  'aria-label': t('a11y.send'),
                },
                '↑',
              )
            : null,
        ),
        h(
          'div',
          { className: 'dsh-pet-actor-wrap', style: { position: 'relative' } },
          h(
            'div',
            {
              className: 'dsh-pet-actor mood-' + mood,
              onPointerDown: onPointerDown,
              // 右键菜单（F3）：比齿轮面板快得多，竞品都是这么做的
              onContextMenu: (e) => {
                try {
                  e.preventDefault()
                  e.stopPropagation()
                } catch (err) {
                  /* ignore */
                }
                const cx = e && e.clientX ? e.clientX : 0
                const cy = e && e.clientY ? e.clientY : 0
                runtime.menu = { x: cx, y: cy }
                runtime.panelOpen = false
                notify()
              },
              'data-phase': runtime.phase,
              title: p.name + ' · ' + p.tag + t('actor.tip'),
              style: {
                // 用真实尺寸缩放而不是 transform：占位一起变大，
                // 输入框会被顶上去，不会被她的头顶住
                width: Math.round((p.image ? 124 : 104) * baseScale) + 'px',
                height: Math.round((p.image ? 200 : 104) * baseScale) + 'px',
                transform: runtime.stage
                  ? 'translate(' +
                    runtime.stage.tx +
                    'px,' +
                    runtime.stage.ty +
                    'px) scale(' +
                    (runtime.stage.zoom || 1) +
                    ')'
                  : 'none',
                transformOrigin: 'center center',
              },
            },
            h(PetArt, { persona: p, mood }),
          ),
          h(
            'button',
            {
              className: 'dsh-pet-gear',
              title: t('panel.settings'),
              'aria-label': t('panel.settings'),
              onClick: (e) => {
                e.stopPropagation()
                runtime.panelOpen = !runtime.panelOpen
                // 面板按她的当前位置摆，别把她盖住
                if (runtime.panelOpen) placePanel()
                notify()
              },
            },
            '⚙',
          ),
        ),
        ),
        ), // .dsh-pet-hoverzone
        h(FxLayer),
        h(PetMenu),
      )
    }

    /** 右键菜单：只做高频动作，设置还是走齿轮面板 */
    function PetMenu() {
      useRuntime()
      const menu = runtime.menu
      const boxRef = useRef(null)
      // 键盘可达（R16）：打开时把焦点移进菜单，Esc 关闭并把焦点还回去。
      // （全屏遮罩是模态菜单的常见做法，本身不算漏洞；缺的是键盘出口。）
      useEffect(() => {
        if (!menu) return undefined
        let prevFocus = null
        try {
          prevFocus = document.activeElement
        } catch (e) {
          prevFocus = null
        }
        const onKey = (e) => {
          if (!e || e.key !== 'Escape') return
          try {
            e.preventDefault()
            e.stopPropagation()
          } catch (err) {
            /* ignore */
          }
          runtime.menu = null
          notify()
        }
        try {
          document.addEventListener('keydown', onKey, true)
        } catch (e) {
          /* ignore */
        }
        try {
          const first = boxRef.current && boxRef.current.querySelector('button')
          if (first && first.focus) first.focus()
        } catch (e) {
          /* ignore */
        }
        return () => {
          try {
            document.removeEventListener('keydown', onKey, true)
          } catch (e) {
            /* ignore */
          }
          try {
            if (prevFocus && prevFocus.focus) prevFocus.focus()
          } catch (e) {
            /* ignore */
          }
        }
      }, [menu ? menu.x + ':' + menu.y : ''])
      if (!menu) return null
      const close = () => {
        runtime.menu = null
        notify()
      }
      const item = (label, onClick) =>
        h(
          'button',
          {
            className: 'dsh-pet-menu-item',
            role: 'menuitem',
            onClick: (e) => {
              try {
                e.stopPropagation()
              } catch (err) {
                /* ignore */
              }
              close()
              try {
                onClick()
              } catch (err) {
                /* ignore */
              }
            },
          },
          label,
        )
      // 跟随点击位置，但不许出界
      let x = menu.x
      let y = menu.y
      try {
        const vw = window.innerWidth || 1280
        const vh = window.innerHeight || 800
        x = Math.max(8, Math.min(x, vw - 150))
        y = Math.max(8, Math.min(y, vh - 210))
      } catch (e) {
        /* ignore */
      }
      return h(
        'div',
        {
          className: 'dsh-pet-menu-mask',
          onPointerDown: close,
          onContextMenu: (e) => { try { e.preventDefault() } catch (err) {} close() },
          // 键盘可达（R-08）：Escape 直接关掉，不用非得点一下遮罩
          onKeyDown: (e) => {
            if (e.key === 'Escape') {
              try { e.stopPropagation() } catch (err) {}
              close()
            }
          },
        },
        h(
          'div',
          {
            className: 'dsh-pet-menu',
            ref: boxRef,
            style: { left: x + 'px', top: y + 'px' },
            role: 'menu',
            'aria-label': t('panel.actions'),
            onPointerDown: (e) => {
              try {
                e.stopPropagation()
              } catch (err) {
                /* ignore */
              }
            },
          },
          item(t('panel.dance'), () => runToCenterAndDance()),
          item(t('panel.hair'), () => playAction('hair', { explicit: true })),
          // 不叫它「叫出来」：藏起来后她整个人不渲染（96-overlay.js:91 返回 null），
          // 这个菜单根本点不到。她看得见的时候，这一项的真实作用是「延长停留」。
          // 把她叫回来请用输入框旁的 🐾 按钮或 /dsh-pet 叫出来。
          item(t('panel.stay'), () => showPet()),
          item(t('panel.hide'), () => hidePet(3600 * 1000)),
          item(t('panel.settings'), () => {
            runtime.panelOpen = true
            placePanel()
            notify()
          }),
        ),
      )
    }

    /** 输入框右侧的 🐾 按钮：宠物不见了/被挡住了，用它把它叫回来。 */
    function PetToggle(props) {
      useRuntime()
      const useSession = props && props.useSession
      const running = typeof useSession === 'function' ? !!useSession((s) => s && s.running) : false

      // 事件联动：一轮跑完就庆祝。长活（>20s）她会跑到中间跳一段，
      // 短活只撒花；跳舞还要求窗口在前台 + 10 分钟冷却，免得打断你。
      useEffect(() => {
        const prev = runtime.lastRunning
        if (running && !prev) runtime.turnStartedAt = nowMs()
        if (!running && prev && runtime.turnStartedAt) {
          const dur = nowMs() - runtime.turnStartedAt
          // 阶段机：刚结束给一个 done 窗口（会换成开心/庆祝的表情）
          runtime.doneUntil = nowMs() + 4000
          if (syncPhase()) notify()
          if (dur > 4000 && runtime.settings.celebrate !== false) {
            let focused = true
            try {
              focused = document.hasFocus()
            } catch (e) {
              focused = true
            }
            const canDance =
              !runtime.reduced && // 减弱动效时不搬到中间跳舞（R10）
              dur > 20000 &&
              focused &&
              runtime.visible &&
              !runtime.stage &&
              nowMs() - (runtime.lastDanceAt || 0) > 10 * 60000
            if (canDance) {
              runtime.lastDanceAt = nowMs()
              petLog('celebrate: dance', { dur })
              runToCenterAndDance()
            } else {
              playFx('confetti', { ttl: 4200 })
            }
          }
        }
        if (!running) runtime.turnStartedAt = 0
        runtime.lastRunning = running
        // 阶段机需要知道「会话是否在跑」；写在 render 里，tick/轮询共用
        runtime.running = running
        if (syncPhase()) notify()
      }, [running])

      return h(
        'button',
        {
          className: 'dsh-pet-toggle' +
            (runtime.petOffscreen && runtime.visible ? ' ' + 'offscreen' : ''),
          // 她藏起来时（!visible）这颗按钮就是唯一的「叫出来」入口，
          // 所以悬停标题要跟着变成「叫出来」，而不是一直写「桌面伴侣」。
          title: !runtime.visible
            ? t('panel.summon')
            : runtime.petOffscreen
              ? t('pet.toggleOff')
              : t('pet.toggle'),
          'aria-label': !runtime.visible ? t('panel.summon') : t('pet.toggle'),
          onClick: () => {
            if (!runtime.visible || runtime.petOffscreen) {
              runtime.settings.pos = null
              runtime.dragPos = null
              runtime.autoPos = null
              runtime.petOffscreen = false
              saveSettings()
              showPet('appear')
            } else {
              runtime.panelOpen = !runtime.panelOpen
              notify()
            }
          },
        },
        h(PetMark),
        runtime.petOffscreen && runtime.visible ? h('i', { className: 'dsh-pet-badge-dot' }) : null,
      )
    }

    /** 输入框右侧的标记：跟插件 icon 同一个剪影。 */
    function PetMark() {
      return h(
        "svg",
        { viewBox: '0 0 1024 1024', width: 18, height: 18, 'aria-hidden': 'true', className: 'dsh-pet-mark' },
        h('path', { fill: '#e95573', d: "M811.008 770.048q-9.216 1.024-19.456 3.584t-18.432 5.632q-10.24 4.096-19.456 9.216-2.048-11.264 1.024-22.528 2.048-10.24 8.192-21.504t20.48-22.528q25.6-17.408 60.928-21.504t66.048 8.192 48.128 42.496 6.144 82.432q-9.216 41.984-37.888 76.288t-76.288 52.736-112.128 17.408-144.384-28.672q-55.296-19.456-87.04-48.64t-47.616-59.904-18.944-57.856-1.024-42.496 12.8-37.888 22.016-43.008q13.312-24.576 29.696-50.176 8.192-13.312 14.336-25.6 5.12-11.264 8.192-22.528t0-21.504q-10.24-26.624-25.6-40.96t-29.696-21.504q-17.408-7.168-35.84-8.192-25.6-1.024-47.104-6.144-18.432-5.12-36.352-13.312t-26.112-25.6q-9.216-17.408-7.68-35.84t7.168-36.352 11.776-34.304 6.144-28.672q0-32.768-34.816-46.08-45.056-11.264-67.584-9.216t-31.744 8.704-9.216 12.288 0 1.536q0 14.336 3.584 36.864t-3.584 43.008q-5.12 12.288-13.824 23.04t-14.848 19.968q-8.192 13.312-13.824 23.04t-4.608 12.8q2.048 4.096 9.728 5.632t11.776 3.584q5.12 3.072 6.656 9.728t7.68 11.776q10.24 10.24 12.288 17.408 1.024 4.096 0 7.168 0 8.192 1.024 19.456 1.024 9.216 2.56 20.992t4.608 23.04q6.144 26.624 14.336 37.376t19.968 13.312 28.16 0.512 39.936-2.048q17.408 1.024 35.84 1.024t32.768 8.192 22.528 22.528 13.312 28.672q4.096 17.408 6.144 35.84 3.072 23.552 3.072 47.104 0 20.48-2.048 44.544t-10.24 47.616q-17.408 48.128-51.2 71.68t-72.704 30.72q-40.96 8.192-77.824 2.048t-66.56-20.48-48.64-34.816-23.04-40.96q-3.072-16.384-0.512-32.256t7.68-30.72 12.288-28.16 12.288-25.6q9.216-19.456 11.264-34.304t0-25.088q-2.048-11.264-8.192-20.48-9.216-10.24-19.456-21.504-8.192-10.24-17.408-22.016t-15.36-26.112q-20.48-41.984-21.504-77.824 0-15.36 0.512-37.376t7.68-41.472q6.144-16.384 30.208-43.52t53.76-70.144q6.144-12.288 10.752-25.6t7.168-24.576 3.584-19.456 1.024-11.264q0-10.24-1.024-22.528t-2.048-25.6q0-6.144-1.024-20.48t2.56-31.744 12.8-35.328 28.672-32.256q15.36-11.264 36.352-15.872t39.424-5.632q21.504-1.024 45.056 1.024 19.456-7.168 40.96-11.264 18.432-4.096 43.008-7.168t51.2-3.072q89.088 2.048 149.504 27.136t99.328 61.44 59.392 78.848 29.696 78.848 10.752 61.44 1.536 26.112q1.024 17.408 12.288 31.744t26.112 29.184 30.72 30.208 27.136 33.792q21.504 38.912 23.552 69.632t-8.192 54.272-28.672 40.448-37.376 28.16-34.816 17.408-19.968 8.192q-33.792 15.36-51.712 33.792t-24.064 36.864-2.56 35.84 14.848 29.696q7.168 9.216 18.432 15.36t23.04 9.216 22.528 3.584 17.92-1.536q16.384-3.072 27.136-14.848t12.8-25.088-5.632-22.528-27.136-8.192z" }),
      )
    }
