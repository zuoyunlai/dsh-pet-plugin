    /* ================= 文案（i18n） ================= */
    // 字典由 build.mjs 从 locale/<lang>.json 注入（标记 @locales）；改文案请改 locale/ 再 build。
    // 语言跟随 DSH 界面语言：优先读 <html lang>（宿主切换语言时会改它），
    // 其次 navigator.language，最后回落英文。可用 localStorage['dsh-pet.lang'] 手动覆盖。
    const PET_LOCALES = /* @locales */ {}
    const PET_LANGS = ["en","zh","es","pt","hi"]
    const PET_LANG_KEY = 'dsh-pet.lang'

    function normalizeLang(tag) {
      const l = String(tag || '').slice(0, 2).toLowerCase()
      return PET_LANGS.indexOf(l) >= 0 ? l : ''
    }

    function detectLang() {
      // 1) 手动覆盖（面板里的「语言」下拉，或控制台设置）
      try {
        const manual = normalizeLang(window.localStorage.getItem(PET_LANG_KEY))
        if (manual) return manual
      } catch (e) {
        /* ignore */
      }
      // 2) 宿主界面语言：DSH 切语言时会写 <html lang>
      try {
        const docLang = normalizeLang(document.documentElement.getAttribute('lang'))
        if (docLang) return docLang
      } catch (e) {
        /* ignore */
      }
      // 3) 浏览器语言
      try {
        const nav = normalizeLang(navigator.language)
        if (nav) return nav
      } catch (e) {
        /* ignore */
      }
      return 'en'
    }

    let PET_LANG = detectLang()

    function setLang(next) {
      const v = normalizeLang(next)
      if (!v) return PET_LANG
      if (v === PET_LANG) return PET_LANG
      PET_LANG = v
      return PET_LANG
    }

    /**
     * 面板里的语言下拉：auto = 跟随宿主（清掉覆盖），其它 = 写 localStorage 覆盖。
     * 立即重渲染，不用等下一次 tick。
     */
    function syncLangOverride(v) {
      try {
        if (!v || v === 'auto') window.localStorage.removeItem(PET_LANG_KEY)
        else window.localStorage.setItem(PET_LANG_KEY, v)
      } catch (e) {
        /* ignore */
      }
      setLang(detectLang())
      try {
        notify()
      } catch (e) {
        /* runtime 还没起来 */
      }
    }

    /**
     * 宿主切换语言时只改 <html lang>，不会通知插件。盯住这个属性，
     * 一变就重算语言并重渲染（手动手动覆盖优先，见 detectLang）。
     */
    function watchHostLang() {
      let mo = null
      try {
        const el = document.documentElement
        if (!el || typeof MutationObserver === 'undefined') return () => {}
        mo = new MutationObserver(() => {
          const before = PET_LANG
          const next = detectLang()
          if (next !== before) {
            setLang(next)
            try {
              notify()
            } catch (e) {
              /* ignore */
            }
          }
        })
        mo.observe(el, { attributes: true, attributeFilter: ['lang'] })
      } catch (e) {
        return () => {}
      }
      return () => {
        try {
          if (mo) mo.disconnect()
        } catch (e) {
          /* ignore */
        }
      }
    }

    function t(key, vars) {
      const d = PET_LOCALES[PET_LANG] || PET_LOCALES.en
      let out = (d && d[key]) || PET_LOCALES.en[key] || key
      if (vars) {
        for (const k of Object.keys(vars)) out = out.split('{' + k + '}').join(String(vars[k]))
      }
      return out
    }
