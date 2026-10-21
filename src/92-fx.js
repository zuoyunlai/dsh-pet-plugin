    /* ================= 特效 ================= */

    let fxSeq = 0

    function playFx(type, opts) {
      const o = opts || {}
      const id = ++fxSeq
      const item = { id, type, at: nowMs(), ttl: o.ttl || 4200 }

      if (type === 'ink') {
        item.blots = [0, 1, 2].map(() => ({
          left: 10 + Math.random() * 72,
          top: 8 + Math.random() * 62,
          size: 70 + Math.random() * 110,
          rot: Math.random() * 360 - 180,
          drip: Math.random() < 0.6 ? 20 + Math.random() * 80 : 0,
          color: Math.random() < 0.5 ? '#1d222c' : '#12161d',
          seed: Math.random(),
        }))
      } else if (type === 'confetti') {
        const palette = ['#ff8fab', '#ffd166', '#8ecae6', '#b5e48c', '#c8b6ff']
        item.pieces = Array.from({ length: 46 }, (_, i) => ({
          left: Math.random() * 100,
          delay: Math.random() * 420,
          dur: 1600 + Math.random() * 1500,
          drift: (Math.random() * 2 - 1) * 130,
          rot: Math.random() * 720 - 360,
          color: palette[i % palette.length],
          w: 5 + Math.random() * 5,
        }))
      } else if (type === 'boom') {
        item.arc = { x1: 64, y1: 74, x2: 12 + Math.random() * 56, y2: 10 + Math.random() * 38 }
        item.seed = Math.random()
      }

      runtime.fx.push(item)
      if (runtime.fx.length > 8) runtime.fx.shift()
      notify()
      later(() => {
        runtime.fx = runtime.fx.filter((f) => f.id !== id)
        notify()
      }, item.ttl)
    }

    /** 不规则斑块：绕一圈取点，用二次贝塞尔把中点连起来，边缘就不会像圆。 */
    function blobPath(seed) {
      let s = Math.max(0.01, (seed % 1) * 0.999)
      const rnd = () => {
        s = (s * 9301 + 49297) % 233280
        return s / 233280
      }
      const n = 14
      const pts = []
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        let r = 34 + rnd() * 10
        if (rnd() < 0.22) r += 6 + rnd() * 10 // 甩出去的尖角
        pts.push([50 + Math.cos(a) * r, 50 + Math.sin(a) * r])
      }
      let d = ''
      for (let i = 0; i < n; i++) {
        const p = pts[i]
        const q = pts[(i + 1) % n]
        const mx = (p[0] + q[0]) / 2
        const my = (p[1] + q[1]) / 2
        if (i === 0) d += 'M ' + mx.toFixed(1) + ' ' + my.toFixed(1) + ' '
        const x2 = (q[0] + pts[(i + 2) % n][0]) / 2
        const y2 = (q[1] + pts[(i + 2) % n][1]) / 2
        d += 'Q ' + q[0].toFixed(1) + ' ' + q[1].toFixed(1) + ' ' + x2.toFixed(1) + ' ' + y2.toFixed(1) + ' '
      }
      return d + 'Z'
    }

    function FxInk({ fx }) {
      return h(
        'div',
        { className: 'dsh-pet-fx-ink' },
        fx.blots.map((b, i) =>
          h(
            'i',
            {
              key: i,
              style: {
                left: b.left + '%',
                top: b.top + '%',
                width: b.size + 'px',
                height: b.size + 'px',
                rotate: b.rot.toFixed(0) + 'deg',
                animationDelay: i * 80 + 'ms',
              },
            },
            h(
              'svg',
              { viewBox: '0 0 100 100' },
              h('path', { d: blobPath(b.seed), fill: b.color }),
              b.drip
                ? h('path', {
                    d:
                      'M ' + (50 + (b.seed * 20 - 10)).toFixed(1) + ' 78 q 4 0 4 ' + (b.drip * 0.4).toFixed(0) +
                      ' q 0 5 -4 5 q -4 0 -4 -5 q 0 -' + (b.drip * 0.4).toFixed(0) + ' 4 0 z',
                    fill: b.color,
                  })
                : null,
              h('ellipse', { cx: 42, cy: 40, rx: 9, ry: 6, fill: '#fff', opacity: 0.12, transform: 'rotate(-25 42 40)' }),
            ),
          ),
        ),
      )
    }

    function FxConfetti({ fx }) {
      return h(
        'div',
        { className: 'dsh-pet-fx-confetti' },
        fx.pieces.map((p, i) =>
          h('i', {
            key: i,
            style: {
              left: p.left + '%',
              width: p.w + 'px',
              height: p.w * 1.6 + 'px',
              background: p.color,
              animationDelay: p.delay + 'ms',
              animationDuration: p.dur + 'ms',
              '--drift': p.drift.toFixed(0) + 'px',
              '--rot': p.rot.toFixed(0) + 'deg',
            },
          }),
        ),
      )
    }

    function FxCloud() {
      return h(
        'div',
        { className: 'dsh-pet-fx-cloud' },
        h(
          'svg',
          { viewBox: '0 0 120 108' },
          h('ellipse', { cx: 60, cy: 44, rx: 42, ry: 22, fill: '#4b5266' }),
          h('ellipse', { cx: 36, cy: 38, rx: 22, ry: 17, fill: '#5b6378' }),
          h('ellipse', { cx: 84, cy: 40, rx: 20, ry: 15, fill: '#5b6378' }),
          h('path', {
            className: 'fx-bolt',
            d: 'M64 66 L54 86 L63 86 L57 104 L76 80 L66 80 Z',
            fill: '#ffd166',
          }),
          [0, 1, 2].map((i) =>
            h('line', {
              key: i,
              className: 'fx-rain',
              x1: 42 + i * 18,
              y1: 70,
              x2: 36 + i * 18,
              y2: 96,
              stroke: '#8ecae6',
              strokeWidth: 2,
              strokeLinecap: 'round',
            }),
          ),
        ),
      )
    }

    function FxBoom({ fx }) {
      const a = fx.arc
      const W = typeof window !== 'undefined' ? window.innerWidth : 1200
      const H = typeof window !== 'undefined' ? window.innerHeight : 800
      const fromX = W * 0.64
      const fromY = H * 0.72
      const toX = (W * a.x2) / 100
      const toY = (H * a.y2) / 100

      // 裂纹用「像素空间 + 由粗到细的填充多边形」画，才不会像蜘蛛腿
      let sd = Math.max(0.01, (fx.seed || 0.3) % 1)
      const rnd = () => {
        sd = (sd * 9301 + 49297) % 233280
        return sd / 233280
      }
      const polylines = []
      for (let i = 0; i < 11; i++) {
        const ang = (i / 11) * Math.PI * 2 + rnd() * 0.55
        const pts = [[toX, toY]]
        let x = toX
        let y = toY
        let aa = ang
        const segs = 3 + Math.floor(rnd() * 3)
        for (let k = 0; k < segs; k++) {
          aa += (rnd() - 0.5) * 0.6
          const l = 26 + rnd() * 52
          x += Math.cos(aa) * l
          y += Math.sin(aa) * l
          pts.push([x, y])
        }
        polylines.push({ pts, w: 2.6 })
        if (rnd() < 0.6 && pts.length > 2) {
          const base = pts[2]
          const bp = [[base[0], base[1]]]
          let bx = base[0]
          let by = base[1]
          let ba = ang + (rnd() < 0.5 ? 0.85 : -0.85)
          for (let k = 0; k < 2; k++) {
            ba += (rnd() - 0.5) * 0.6
            const l = 18 + rnd() * 30
            bx += Math.cos(ba) * l
            by += Math.sin(ba) * l
            bp.push([bx, by])
          }
          polylines.push({ pts: bp, w: 1.6 })
        }
      }
      // 再补几条细碎的分支，裂纹才不是一棵光秃秃的树
      for (let i = 0; i < 7; i++) {
        let x = toX
        let y = toY
        let aa = rnd() * Math.PI * 2
        const pts = [[x, y]]
        for (let k = 0; k < 2; k++) {
          aa += (rnd() - 0.5) * 0.9
          const l = 18 + rnd() * 40
          x += Math.cos(aa) * l
          y += Math.sin(aa) * l
          pts.push([x, y])
        }
        polylines.push({ pts, w: 1.1 })
      }
      const polys = polylines.map(({ pts, w: w0 }) => {
        const left = []
        const right = []
        for (let k = 0; k < pts.length; k++) {
          const t = k / (pts.length - 1)
          const w = w0 * (1 - t) + 0.1
          const p = pts[k]
          const q = pts[Math.min(k + 1, pts.length - 1)]
          const r = pts[Math.max(k - 1, 0)]
          const dx = q[0] - r[0]
          const dy = q[1] - r[1]
          const m = Math.hypot(dx, dy) || 1
          left.push([p[0] - (dy / m) * w, p[1] + (dx / m) * w])
          right.push([p[0] + (dy / m) * w, p[1] - (dx / m) * w])
        }
        return left.concat(right.reverse()).map(([px, py]) => px.toFixed(1) + ',' + py.toFixed(1)).join(' ')
      })

      return h(
        'div',
        { className: 'dsh-pet-fx-boom' },
        h(
          'div',
          { className: 'fx-shake' },
          h(
            'svg',
            {
              className: 'fx-crack',
              viewBox: '0 0 ' + W + ' ' + H,
              preserveAspectRatio: 'none',
              width: '100%',
              height: '100%',
            },
            h(
              'g',
              null,
              polys.map((p, i) => h('polygon', { key: i, points: p, fill: 'currentColor' })),
            ),
            h('circle', {
              className: 'fx-impact',
              cx: toX,
              cy: toY,
              r: 30,
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.5,
            }),
          ),
          h('div', { className: 'fx-flash' }),
        ),
        h(
          'div',
          {
            className: 'fx-bomb',
            style: {
              left: fromX + 'px',
              top: fromY + 'px',
              '--tx': (toX - fromX).toFixed(0) + 'px',
              '--ty': (toY - fromY).toFixed(0) + 'px',
            },
          },
          h(
            'svg',
            { viewBox: '0 0 24 24' },
            h('path', { d: 'M15 5 q3 -3 6 0', fill: 'none', stroke: '#c9a227', strokeWidth: 1.6, strokeLinecap: 'round' }),
            h('circle', { className: 'fx-spark', cx: 21, cy: 5, r: 1.8, fill: '#ffcf5c' }),
            h('circle', { cx: 11, cy: 14, r: 8, fill: '#1b1f27' }),
            h('ellipse', { cx: 8, cy: 11, rx: 2.6, ry: 1.7, fill: '#fff', opacity: 0.35, transform: 'rotate(-30 8 11)' }),
          ),
        ),
      )
    }

    function FogFx({ fx }) {
      const maskId = 'dsh-pet-fog-' + fx.id
      const svgRef = useRef(null)
      const holesRef = useRef(null)

      useEffect(() => {
        const svg = svgRef.current
        const holes = holesRef.current
        if (!svg || !holes) return undefined
        const wipe = (e) => {
          const r = svg.getBoundingClientRect()
          const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
          c.setAttribute('cx', String(e.clientX - r.left))
          c.setAttribute('cy', String(e.clientY - r.top))
          c.setAttribute('r', '54')
          c.setAttribute('fill', 'black')
          holes.appendChild(c)
        }
        let down = false
        const onDown = (e) => {
          down = true
          wipe(e)
        }
        const onMove = (e) => {
          if (down) wipe(e)
        }
        const onUp = () => {
          down = false
        }
        svg.addEventListener('pointerdown', onDown)
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        return () => {
          svg.removeEventListener('pointerdown', onDown)
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
        }
      }, [])

      return h(
        'svg',
        { className: 'dsh-pet-fx-fog', ref: svgRef },
        h(
          'defs',
          null,
          h(
            'mask',
            { id: maskId },
            h('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: 'white' }),
            h('g', { ref: holesRef }),
          ),
        ),
        h('rect', {
          x: 0,
          y: 0,
          width: '100%',
          height: '100%',
          fill: '#dbe4f0',
          opacity: 0.62,
          mask: 'url(#' + maskId + ')',
        }),
      )
    }

    function FxItem({ fx }) {
      if (fx.type === 'ink') return h(FxInk, { fx })
      if (fx.type === 'confetti') return h(FxConfetti, { fx })
      if (fx.type === 'cloud') return h(FxCloud, { fx })
      if (fx.type === 'boom') return h(FxBoom, { fx })
      if (fx.type === 'fog') return h(FogFx, { fx })
      return null
    }

    function FxLayer() {
      useRuntime()
      return h('div', { className: 'dsh-pet-fx' }, runtime.fx.map((fx) => h(FxItem, { key: fx.id, fx })))
    }

    /** 跑到窗口中间跳一段，再走回原位。
     *  只挪「她」这一块（actor），输入框和气泡留在原地；跳舞时放大 1.8 倍。 */