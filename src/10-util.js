    /* ================= 工具 ================= */

    const clamp = (n, a, b) => Math.min(b, Math.max(a, n))
    const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
    const pick = (arr) => (arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : '')
    const nowMs = () => Date.now()

    function weighted(table) {
      const keys = Object.keys(table)
      let total = 0
      for (const k of keys) total += table[k]
      let r = Math.random() * total
      for (const k of keys) {
        r -= table[k]
        if (r <= 0) return k
      }
      return keys[keys.length - 1]
    }

    function toMinutes(hhmm) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim())
      if (!m) return null
      const hh = clamp(parseInt(m[1], 10), 0, 23)
      const mm = clamp(parseInt(m[2], 10), 0, 59)
      return hh * 60 + mm
    }

    /** 活跃时段判定；支持跨零点（22:00 → 03:00）。 */
    function inActiveWindow(date, startStr, endStr) {
      const s = toMinutes(startStr)
      const e = toMinutes(endStr)
      if (s === null || e === null) return true
      const t = date.getHours() * 60 + date.getMinutes()
      if (s === e) return true
      return s < e ? t >= s && t < e : t >= s || t < e
    }
