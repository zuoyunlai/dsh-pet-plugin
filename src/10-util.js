    /* ================= 工具 ================= */

    const clamp = (n, a, b) => Math.min(b, Math.max(a, n))
    const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
    const pick = (arr) => (arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : '')
    const nowMs = () => Date.now()

    /**
     * 构建期注入的插件版本（build.mjs 会把下面这个占位符替换成 package.json 的 version）。
     * 用途（P3-10，2026-10-29 审计）：资产 URL 带 ?v=<version>，升级后不会被 1 小时
     * 公共缓存钉在旧立绘上。未构建（占位符还在）时不加参数，方便本地调试。
     */
    const PET_BUILD_VERSION = '__PET_VERSION__'
    const PET_ASSET_QS =
      PET_BUILD_VERSION.indexOf('__') === 0 ? '' : '?v=' + encodeURIComponent(PET_BUILD_VERSION)

    /** 系统是否要求减弱动效（读不到就当没有要求）。 */
    function prefersReduced() {
      try {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      } catch (e) {
        return false
      }
    }

    /**
     * 按权重抽样。P1-2（2026-10-29 审计）：旧实现在 table 为空/非对象时
     * Object.keys(undefined) 直接抛，且非数字权重会让抽样退化。现在：
     *   - 空表 → 'idle'（调用方 scheduleMood 拿到的是合法心情）；
     *   - 非正数/NaN 的权重被跳过；全都不合法时退回第一个键。
     */
    function weighted(table) {
      const keys = table && typeof table === 'object' && !Array.isArray(table) ? Object.keys(table) : []
      if (!keys.length) return 'idle'
      const valid = (k) => {
        const w = Number(table[k])
        return Number.isFinite(w) && w > 0 ? w : 0
      }
      const total = keys.reduce((sum, k) => sum + valid(k), 0)
      if (!(total > 0)) return keys[0]
      let r = Math.random() * total
      for (const k of keys) {
        const w = valid(k)
        if (!w) continue
        r -= w
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
