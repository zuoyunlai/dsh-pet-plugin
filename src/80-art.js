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
    function CrossImage({ src, alt }) {
      const [cur, setCur] = useState(src)
      const [prev, setPrev] = useState(null)
      const swap = useRef(0)
      if (src !== cur) {
        setPrev(cur)
        setCur(src)
      }
      useEffect(() => {
        if (!prev) return undefined
        const t = setTimeout(() => setPrev(null), 220)
        return () => clearTimeout(t)
      }, [prev, cur])
      // 方向左右交替：连续换帧时像真的在动，而不是原地淡
      swap.current = (swap.current + 1) % 2
      const dx = swap.current === 0 ? 3 : -3
      return h(
        'div',
        { className: 'dsh-pet-imgwrap', style: { '--pet-dx': dx + 'px' } },
        prev ? h('img', { className: 'dsh-pet-img dsh-pet-img-prev', src: assetUrl(prev), alt: '', draggable: false }) : null,
        h('img', { key: cur, className: 'dsh-pet-img dsh-pet-img-cur', src: assetUrl(cur), alt, draggable: false }),
      )
    }

    function PetArt({ persona: p, mood }) {
      const c = p.colors
      // 有贴图的形象直接用立绘；表情靠整体动作 + 贴纸
      if (p.image) {
        const variant = (p.images && p.images[mood]) || null
        const act = runtime.action
        // 1.16：这个动作有视频片段（VP9 + alpha）就播视频，帧序列只作兜底
        const clip = act && p.clips && p.clips[act.name] ? p.clips[act.name] : null
        const actFrame = act && act.frames && act.frames[act.i]
        return h(
          'div',
          { className: 'dsh-pet-body dsh-pet-figure' },
          h(
            'div',
            { className: 'dsh-pet-figbox' },
            clip
              ? h('video', {
                  className: 'dsh-pet-video',
                  src: assetUrl(clip),
                  autoPlay: true,
                  muted: true,
                  loop: true,
                  playsInline: true,
                  preload: 'auto',
                  'aria-label': p.name,
                })
              : h(CrossImage, { src: actFrame || variant || p.image, alt: p.name }),
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
