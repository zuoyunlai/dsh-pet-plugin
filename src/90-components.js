    /* ================= 组件 ================= */

    function useRuntime() {
      const [, force] = useState(0)
      useEffect(() => {
        const fn = () => force((v) => v + 1)
        runtime.subs.add(fn)
        return () => {
          runtime.subs.delete(fn)
        }
      }, [])
      return runtime
    }

    function PetSelect({ value, options, onChange }) {
      const [open, setOpen] = useState(false)
      const cur = options.filter((o) => o.value === value)[0] || options[0]
      return h(
        'div',
        { className: 'dsh-pet-sel' + (open ? ' open' : '') },
        h(
          'button',
          { type: 'button', className: 'dsh-pet-sel-btn', onClick: () => setOpen(!open) },
          h('span', { className: 'v' }, cur ? cur.label : ''),
          h('span', { className: 'a' }, '▾'),
        ),
        open
          ? h(
              'div',
              { className: 'dsh-pet-sel-list', role: 'listbox' },
              options.map((o) =>
                h(
                  'button',
                  {
                    key: o.value,
                    type: 'button',
                    role: 'option',
                    'aria-selected': o.value === value,
                    className: 'dsh-pet-sel-item' + (o.value === value ? ' on' : ''),
                    onClick: () => {
                      setOpen(false)
                      onChange(o.value)
                    },
                  },
                  o.label,
                ),
              ),
            )
          : null,
      )
    }

    function Toggle({ label, checked, onChange }) {
      return h(
        'label',
        { className: 'dsh-pet-tg' },
        h('input', { type: 'checkbox', checked: !!checked, 'aria-label': label, onChange: (e) => onChange(e.target.checked) }),
        h('i', null),
        h('span', null, label),
      )
    }

    function Slider({ label, min, max, step, value, suffix, onChange }) {
      return h(
        'div',
        { className: 'dsh-pet-field' },
        h('span', { className: 'lb' }, label),
        h('input', { type: 'range', min, max, step, value, 'aria-label': label, onChange: (e) => onChange(Number(e.target.value)) }),
        h('span', { className: 'val' }, String(value) + (suffix || '')),
      )
    }

    function SettingsPanel() {
      const s = runtime.settings
      const p = persona()
      const update = (patch) => {
        Object.assign(runtime.settings, patch)
        saveSettings()
        notify()
        if (patch.persona || patch.ttsVoice || patch.voicePitch != null || patch.voiceRate != null) {
          setTimeout(() => warmVoice(), 50)
        }
      }
      const personaOpts = Object.keys(PERSONAS).map((k) => ({
        value: k,
        label: PERSONAS[k].name + ' · ' + (PET_LANG === 'zh' || !PERSONAS[k].tagEn ? PERSONAS[k].tag : PERSONAS[k].tagEn),
      }))
      const voiceOpts = [
        { value: 'auto', label: t('voice.auto') },
        { value: 'xiaoxiao', label: t('voice.xiaoxiao') },
        { value: 'xiaoyi', label: t('voice.xiaoyi') },
        { value: 'ava', label: 'Ava · en' },
        { value: 'emma', label: 'Emma · en' },
        { value: 'elvira', label: 'Elvira · es' },
        { value: 'francisca', label: 'Francisca · pt' },
        { value: 'swara', label: 'Swara · hi' },
      ]
      const pitch = Number(s.voicePitch != null ? s.voicePitch : p.voice.pitch)
      const rate = Number(s.voiceRate != null ? s.voiceRate : p.voice.rate)
      const sep = () => h('div', { className: 'dsh-pet-sep' })
      const sec = (t) => h('div', { className: 'dsh-pet-sec' }, t)

      return h(
        'div',
        { className: 'dsh-pet-panel', onClick: (e) => e.stopPropagation() },
        h(
          'h4',
          null,
          h('span', null, t('panel.title')),
          h('button', { className: 'x', onClick: () => { runtime.panelOpen = false; notify() }, title: t('panel.close') }, '×'),
        ),
        sec(t('panel.look')),
        h('div', { className: 'dsh-pet-field wide' }, h(PetSelect, { value: s.persona, options: personaOpts, onChange: (v) => update({ persona: v }) })),
        h(
          'div',
          { className: 'dsh-pet-field wide' },
          h('span', { className: 'lb' }, t('panel.lang')),
          h(PetSelect, {
            value: s.lang || 'auto',
            options: [
              { value: 'auto', label: t('panel.langAuto') },
              { value: 'zh', label: '中文' },
              { value: 'en', label: 'English' },
              { value: 'es', label: 'Español' },
              { value: 'pt', label: 'Português' },
              { value: 'hi', label: 'हिन्दी' },
            ],
            onChange: (v) => {
              update({ lang: v })
              syncLangOverride(v)
            },
          }),
        ),
        h(
          'div',
          { className: 'dsh-pet-seg' },
          h('button', { className: s.mode === 'always' ? 'on' : '', onClick: () => update({ mode: 'always' }) }, t('panel.always')),
          h('button', { className: s.mode === 'random' ? 'on' : '', onClick: () => update({ mode: 'random' }) }, t('panel.random')),
        ),
        s.mode === 'random'
          ? h(Slider, { label: t('panel.probability'), min: 5, max: 95, step: 5, value: s.probability, suffix: '%', onChange: (v) => update({ probability: v }) })
          : null,
        h(
          'div',
          { className: 'dsh-pet-field' },
          h('span', { className: 'lb' }, t('panel.active')),
          h('input', { type: 'time', value: s.activeStart, onChange: (e) => update({ activeStart: e.target.value }) }),
          h('span', { className: 'val' }, '→'),
          h('input', { type: 'time', value: s.activeEnd, onChange: (e) => update({ activeEnd: e.target.value }) }),
        ),
        sep(),
        sec(t('panel.voice')),
        h(
          'div',
          { className: 'dsh-pet-grid2' },
          h(Toggle, { label: t('panel.voiceOn'), checked: s.voiceOn, onChange: (v) => update({ voiceOn: v }) }),
          h(Toggle, { label: t('panel.neural'), checked: s.neuralVoice !== false, onChange: (v) => update({ neuralVoice: v }) }),
        ),
        h('div', { className: 'dsh-pet-field wide' }, h(PetSelect, { value: s.ttsVoice || 'xiaoxiao', options: voiceOpts, onChange: (v) => update({ ttsVoice: v }) })),
        runtime.neuralOk === false
          ? h('div', { className: 'dsh-pet-hint' }, t('hint.neuralOff'))
          : null,
        s.neuralVoice ? h('div', { className: 'dsh-pet-hint' }, t('hint.privacy')) : null,
        h(Slider, { label: t('panel.volume'), min: 0, max: 1, step: 0.1, value: s.volume, onChange: (v) => update({ volume: v }) }),
        h(Slider, { label: t('panel.pitch'), min: 0.6, max: 2, step: 0.02, value: pitch.toFixed(2), onChange: (v) => update({ voicePitch: v }) }),
        h(Slider, { label: t('panel.rate'), min: 0.6, max: 1.5, step: 0.02, value: rate.toFixed(2), onChange: (v) => update({ voiceRate: v }) }),
        sep(),
        sec(t('panel.display')),
        h(
          'div',
          { className: 'dsh-pet-grid2' },
          h(Toggle, { label: t('panel.inputBox'), checked: s.showInput, onChange: (v) => update({ showInput: v }) }),
          h(Toggle, { label: t('panel.chatter'), checked: s.chatter, onChange: (v) => update({ chatter: v }) }),
          h(Toggle, { label: t('panel.celebrate'), checked: s.celebrate !== false, onChange: (v) => update({ celebrate: v }) }),
          h(Toggle, { label: t('panel.chaos'), checked: s.chaos !== false, onChange: (v) => update({ chaos: v }) }),
        ),
        h(Slider, { label: t('panel.size'), min: 0.8, max: 2, step: 0.1, value: Number(s.scale).toFixed(1), suffix: '×', onChange: (v) => update({ scale: v }) }),
        sep(),
        sec(t('panel.actions')),
        h(
          'div',
          { className: 'dsh-pet-seg' },
          h('button', { onClick: () => { runtime.panelOpen = false; runToCenterAndDance() } }, t('panel.dance')),
          h('button', { onClick: () => playAction('hair', { ms: 1300 }) }, t('panel.hair')),
          h('button', { onClick: () => showPet('dance') }, t('panel.summon')),
          h('button', { onClick: () => { runtime.snoozeUntil = nowMs() + 3600 * 1000; hidePet(); runtime.panelOpen = false; notify() } }, t('panel.hide')),
        ),
        sec(t('panel.effects')),
        h(
          'div',
          { className: 'dsh-pet-seg' },
          h('button', { onClick: () => playFx('ink') }, t('panel.ink')),
          h('button', { onClick: () => playFx('confetti') }, t('panel.confetti')),
          h('button', { onClick: () => playFx('cloud') }, t('panel.cloud')),
          h('button', { onClick: () => playFx('fog', { ttl: 7000 }) }, t('panel.fog')),
          h('button', { onClick: () => playFx('boom', { ttl: 2600 }) }, t('panel.bomb')),
        ),
        sep(),
        h(
          'div',
          { className: 'dsh-pet-seg' },
          h('button', { onClick: () => { runtime.dragPos = null; update({ pos: null }) } }, t('panel.resetPos')),
          h(
            'button',
            {
              className: 'danger',
              onClick: () => {
                try {
                  window.localStorage.removeItem(STORAGE_KEY)
                } catch (e) {
                  /* ignore */
                }
                runtime.panelOpen = false
                notify()
                try {
                  window.location.reload()
                } catch (e) {
                  /* ignore */
                }
              },
            },
            t('panel.resetAll'),
          ),
        ),
      )
    }
