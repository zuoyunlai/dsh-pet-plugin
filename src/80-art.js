    /* ================= 形象（SVG） ================= */

    function Ears({ kind, c }) {
      if (kind === 'cat') {
        return h(
          'g',
          null,
          h('path', { d: 'M48 54 L44 34 L64 46 Z', fill: c.body2 }),
          h('path', { d: 'M92 54 L96 34 L76 46 Z', fill: c.body2 }),
          h('path', { d: 'M50 51 L47 39 L60 47 Z', fill: c.accent, opacity: 0.35 }),
          h('path', { d: 'M90 51 L93 39 L80 47 Z', fill: c.accent, opacity: 0.35 }),
        )
      }
      if (kind === 'round') {
        return h(
          'g',
          null,
          h('circle', { cx: 50, cy: 50, r: 11, fill: c.body2 }),
          h('circle', { cx: 90, cy: 50, r: 11, fill: c.body2 }),
        )
      }
      return h(
        'g',
        null,
        h('line', { x1: 70, y1: 48, x2: 70, y2: 30, stroke: c.body2, strokeWidth: 3, strokeLinecap: 'round' }),
        h('circle', { cx: 70, cy: 27, r: 5, fill: c.accent }),
      )
    }

    function Face({ mood, c }) {
      const sleepy = mood === 'sleep'
      const angry = mood === 'angry'
      const shy = mood === 'shy'
      const happy = mood === 'happy' || mood === 'dance'
      const talk = mood === 'talk'

      const brows = angry
        ? [
            h('line', { key: 'bl', x1: 53, y1: 62, x2: 64, y2: 66, stroke: c.eye, strokeWidth: 2.4, strokeLinecap: 'round' }),
            h('line', { key: 'br', x1: 87, y1: 62, x2: 76, y2: 66, stroke: c.eye, strokeWidth: 2.4, strokeLinecap: 'round' }),
          ]
        : shy
          ? [
              h('line', { key: 'sl', x1: 54, y1: 64, x2: 64, y2: 61, stroke: c.eye, strokeWidth: 2, strokeLinecap: 'round', opacity: 0.8 }),
              h('line', { key: 'sr', x1: 86, y1: 64, x2: 76, y2: 61, stroke: c.eye, strokeWidth: 2, strokeLinecap: 'round', opacity: 0.8 }),
            ]
          : null

      let mouth
      if (sleepy) mouth = h('ellipse', { cx: 70, cy: 92, rx: 4, ry: 3.2, fill: c.eye, opacity: 0.75 })
      else if (angry) mouth = h('path', { d: 'M62 94 L70 88 L78 94', fill: 'none', stroke: c.eye, strokeWidth: 2.2, strokeLinejoin: 'round', strokeLinecap: 'round' })
      else if (shy) mouth = h('ellipse', { cx: 70, cy: 92, rx: 3.4, ry: 2.6, fill: c.eye, opacity: 0.7 })
      else if (talk) mouth = h('ellipse', { className: 'dsh-pet-mouth', cx: 70, cy: 92, rx: 5, ry: 4, fill: '#7a2436' })
      else if (happy) mouth = h('path', { d: 'M60 89 Q70 101 80 89 Z', fill: '#7a2436', opacity: 0.85 })
      else mouth = h('path', { d: 'M63 91 Q70 96 77 91', fill: 'none', stroke: c.eye, strokeWidth: 2, strokeLinecap: 'round' })

      return h(
        'g',
        null,
        brows,
        sleepy
          ? [
              h('path', { key: 'el', d: 'M53 72 Q59 78 65 72', fill: 'none', stroke: c.eye, strokeWidth: 2.4, strokeLinecap: 'round' }),
              h('path', { key: 'er', d: 'M75 72 Q81 78 87 72', fill: 'none', stroke: c.eye, strokeWidth: 2.4, strokeLinecap: 'round' }),
            ]
          : [
              h('ellipse', { key: 'el', className: 'dsh-pet-eye', cx: 59, cy: 73, rx: 5.2, ry: 6, fill: '#fff' }),
              h('ellipse', { key: 'er', className: 'dsh-pet-eye', cx: 81, cy: 73, rx: 5.2, ry: 6, fill: '#fff' }),
              h(
                'g',
                { key: 'pupils', className: 'dsh-pet-pupils' },
                h('circle', { cx: 59 + (shy ? -1 : 0), cy: 74 + (shy ? 1 : 0), r: 2.9, fill: c.eye }),
                h('circle', { cx: 81 + (shy ? -1 : 0), cy: 74 + (shy ? 1 : 0), r: 2.9, fill: c.eye }),
                h('circle', { cx: 57.6, cy: 71.6, r: 1.1, fill: '#fff', opacity: 0.9 }),
                h('circle', { cx: 79.6, cy: 71.6, r: 1.1, fill: '#fff', opacity: 0.9 }),
              ),
            ],
        shy
          ? [
              h('ellipse', { key: 'b1', cx: 49, cy: 84, rx: 6, ry: 3.4, fill: '#ff7b93', opacity: 0.55 }),
              h('ellipse', { key: 'b2', cx: 91, cy: 84, rx: 6, ry: 3.4, fill: '#ff7b93', opacity: 0.55 }),
            ]
          : null,
        angry ? h('text', { x: 100, y: 52, fontSize: 12, fill: '#ff5d6c' }, '💢') : null,
        sleepy ? h('text', { className: 'dsh-pet-zzz', x: 96, y: 48, fill: c.eye }, 'z') : null,
        mouth,
      )
    }

    /** 贴图形象的表情：没有五官层，只能用贴纸（腮红/青筋/zzz/星星）。 */
    function FigureMarks({ mood }) {
      const marks = []
      if (mood === 'shy') {
        marks.push(h('i', { key: 'bl', className: 'fx-mark blush', style: { left: '40%', top: '5%' } }))
        marks.push(h('i', { key: 'sw', className: 'fx-mark sweat', style: { left: '60%', top: '4%' } }))
      } else if (mood === 'angry') {
        marks.push(h('i', { key: 'iv', className: 'fx-mark vein', style: { left: '57%', top: '0%' } }, '💢'))
      } else if (mood === 'sleep') {
        marks.push(h('i', { key: 'z1', className: 'fx-mark zzz', style: { left: '57%', top: '-2%' } }, 'z'))
        marks.push(h('i', { key: 'z2', className: 'fx-mark zzz z2', style: { left: '63%', top: '-6%' } }, 'z'))
      } else if (mood === 'happy' || mood === 'dance') {
        marks.push(h('i', { key: 's1', className: 'fx-mark spark', style: { left: '37%', top: '-2%' } }, '✨'))
        marks.push(h('i', { key: 's2', className: 'fx-mark spark', style: { left: '61%', top: '4%' } }, '✨'))
      }
      if (!marks.length) return null
      return h('div', { className: 'dsh-pet-marks', 'aria-hidden': 'true' }, marks)
    }

    /** 换表情/换动作帧时做一次带方向的交叉淡入淡出，硬切在照片上会很跳。 */
    function CrossImage({ src, alt, persona }) {
      const [cur, setCur] = useState(src)
      const [prev, setPrev] = useState(null)
      const swap = useRef(0)
      if (src !== cur) {
        // 方向只跟着「真的换了图」翻转（1.19.3 R17）。旧写法在渲染体里无条件
        // 自增，任何一次无关重渲染都会把方向翻过去。
        swap.current = (swap.current + 1) % 2
        setPrev(cur)
        setCur(src)
      }
      useEffect(() => {
        if (!prev) return undefined
        const t = setTimeout(() => setPrev(null), 220)
        return () => clearTimeout(t)
      }, [prev, cur])
      const dx = swap.current === 0 ? 3 : -3
      // 静帧水平对齐（1.26.1）：个别形象的表情立绘相对 idle 整体偏了一截
      // （azure 实测 3.5%~5% 画布宽，切表情时会横向跳）。pack.json 的 imageFit
      // 按文件名给出需要的水平位移比例；没有条目就是 0，等价旧行为。
      const imgX = (s) => {
        const v = persona && persona.imageFit && persona.imageFit[s]
        return Number.isFinite(v) ? String(v) : '0'
      }
      return h(
        'div',
        { className: 'dsh-pet-imgwrap', style: { '--pet-dx': dx + 'px' } },
        prev
          ? h('img', {
              className: 'dsh-pet-img dsh-pet-img-prev',
              src: assetUrl(prev, persona),
              style: { '--img-x': imgX(prev) },
              alt: '',
              draggable: false,
            })
          : null,
        h('img', {
          key: cur,
          className: 'dsh-pet-img dsh-pet-img-cur',
          src: assetUrl(cur, persona),
          style: { '--img-x': imgX(cur) },
          alt,
          draggable: false,
        }),
      )
    }

    /**
     * 动作片段层（1.19.3 R01）：视频没起来之前用静帧顶着；**一旦开始播放就把静帧撤掉**。
     *
     * 为什么要撤：这些是 VP9 + alpha 的透明视频，人物背景是空的。静帧如果一直垫在下面，
     * 视频里姿态一变（跳舞时手臂抬起、身体转动），没被视频覆盖到的部分就会透出底下那张
     * 静止立绘——看起来就是「两个人物重叠」。所以静帧只是 poster，不是背景板。
     *
     * - onError / 3s 没起来 → 隐藏 video，退回静帧（人物始终可见）；
     * - 加载失败按文件记忆，同一片段不再反复等 3s；
     * - 播放状态放 runtime（而不是组件 state）：重渲染可观测、也能被台架断言。
     */
    function ClipLayer({ clip, clipName, poster, alt, gen, exiting, persona }) {
      const failed = !!runtime.clipFailed[clip]
      const ready = runtime.clipPlaying === clip
      const [giveUp, setGiveUp] = useState(false)
      useEffect(() => {
        if (failed || giveUp || ready) return undefined
        const t = setTimeout(() => setGiveUp(true), 3000)
        return () => clearTimeout(t)
      }, [failed, giveUp, ready])
      // 失败就在原地退回静帧；正常播放时静帧不能同时留在画面上
      const still = h(CrossImage, { src: poster, alt, persona })
      if (failed || giveUp) return still
      // 人物占比补偿（1.26.1）：pack.json 的 clipFit[动作名] → CSS 变量。
      // s 缩放、y 纵向对齐脚底、x 横向对齐人物中心。
      // 缺省时 s=1 / y=0 / x=0，等价于旧行为（自定义形象没测量过也不会变形）。
      const fit = (persona && persona.clipFit && clipName && persona.clipFit[clipName]) || null
      const fitStyle = fit && Number.isFinite(fit.s) && fit.s > 0
        ? {
            '--clip-s': String(fit.s),
            '--clip-y': String(Number.isFinite(fit.y) ? fit.y : 0),
            '--clip-x': String(Number.isFinite(fit.x) ? fit.x : 0),
          }
        : undefined
      // exiting：动作已结束、片段正在淡出，静帧先垫在下面（否则会硬切成笑脸立绘）
      const showStill = !ready || exiting
      return h(
        'div',
        { className: 'dsh-pet-clipbox' },
        showStill ? still : null,
        h('video', {
          key: clip,
          className:
            'dsh-pet-video' +
            (ready && !exiting ? ' is-ready' : '') +
            (exiting ? ' is-leaving' : ''),
          style: fitStyle,
          src: assetUrl(clip, persona),
          autoPlay: true,
          muted: true,
          loop: false,
          playsInline: true,
          preload: 'auto',
          'aria-label': alt,
          onPlaying: () => {
            runtime.clipPlaying = clip
            notify()
          },
          // 片段时长以媒体为准（1.20.0）：拿到 metadata 就把这一代动作的收尾时间
          // 按真实片长重排，5.167s 的旧片段和 10s 的叙事片段共用一套逻辑。
          onLoadedMetadata: (e) => noteClipDuration(clip, e && e.currentTarget ? e.currentTarget.duration : 0),
          // 自然播完就收尾：不要等到墙钟（片段 5167ms，action 默认也是 5167ms，
          // 两边谁先到都行；这里让「播完」这件事由媒体事件说了算）
          onEnded: () => endAction(gen),
          onError: () => {
            runtime.clipFailed[clip] = true
            runtime.clipPlaying = null
            runtime.lastClipError = clip
            setGiveUp(true)
            notify()
            petLog('clip failed', clip)
          },
        }),
      )
    }

    function PetArt({ persona: p, mood }) {
      const c = p.colors
      // 有贴图的形象直接用立绘；表情靠整体动作 + 贴纸
      if (p.image) {
        const variant = (p.images && p.images[mood]) || null
        const act = runtime.action
        // 有视频片段（VP9 + alpha）就播片段：静帧在下、video 在上淡入（R01）
        const clip = act && p.clips && p.clips[act.name] ? p.clips[act.name] : null
        const actFrame = act && act.frames && act.frames[act.i]
        const stillSrc = actFrame || variant || p.image
        return h(
          'div',
          { className: 'dsh-pet-body dsh-pet-figure' },
          h(
            'div',
            { className: 'dsh-pet-figbox' },
            clip
              ? h(ClipLayer, {
                  key: act.gen,
                  clip,
                  // 动作名用于查 clipFit（clip 是文件名，得用 action 名做键）
                  clipName: act.name,
                  poster: stillSrc,
                  alt: p.name,
                  gen: act.gen,
                  exiting: !!act.exiting,
                  persona: p,
                })
              : h(CrossImage, { src: stillSrc, alt: p.name, persona: p }),
            variant ? null : h(FigureMarks, { mood }),
          ),
        )
      }
      return h(
        'svg',
        { viewBox: '0 0 140 140', role: 'img', 'aria-label': p.name },
        h('ellipse', { cx: 70, cy: 126, rx: 27, ry: 4.6, fill: '#000', opacity: 0.16 }),
        h(
          'g',
          { className: 'dsh-pet-body' },
          Ears({ kind: p.ears, c }),
          h('ellipse', { className: 'dsh-pet-tail', cx: 103, cy: 100, rx: 10, ry: 6, fill: c.body2 }),
          h('ellipse', { cx: 70, cy: 82, rx: 32, ry: 33, fill: c.body }),
          mood === 'angry' ? h('ellipse', { cx: 70, cy: 82, rx: 32, ry: 33, fill: '#ff5d6c', opacity: 0.16 }) : null,
          h('ellipse', { cx: 70, cy: 94, rx: 18, ry: 15, fill: c.belly, opacity: 0.7 }),
          Face({ mood, c }),
          h('ellipse', { cx: 38, cy: 96, rx: 7, ry: 9.5, fill: c.body2 }),
          h('ellipse', { cx: 102, cy: 96, rx: 7, ry: 9.5, fill: c.body2 }),
          h('ellipse', { cx: 56, cy: 118, rx: 9, ry: 5, fill: c.body2 }),
          h('ellipse', { cx: 84, cy: 118, rx: 9, ry: 5, fill: c.body2 }),
        ),
      )
    }
