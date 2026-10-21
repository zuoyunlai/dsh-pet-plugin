    /* ================= 文案（i18n） ================= */
    // 字典由 build.mjs 从 locale/<lang>.json 注入（标记 @locales）；改文案请改 locale/ 再 build。
    // 语言取浏览器界面语言；没有对应语言时回落英文。
    const PET_LOCALES = /* @locales */ {}
    const PET_LANGS = ["en","zh","es","pt","hi"]
    const PET_LANG = (() => {
      try {
        const l = String((navigator.language || 'en')).slice(0, 2).toLowerCase()
        return PET_LANGS.indexOf(l) >= 0 ? l : 'en'
      } catch (e) {
        return 'en'
      }
    })()
    function t(key, vars) {
      const d = PET_LOCALES[PET_LANG] || PET_LOCALES.en
      let out = (d && d[key]) || PET_LOCALES.en[key] || key
      if (vars) {
        for (const k of Object.keys(vars)) out = out.split('{' + k + '}').join(String(vars[k]))
      }
      return out
    }
