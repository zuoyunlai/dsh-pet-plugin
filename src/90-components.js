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
        const prevPersona = runtime.settings.persona
        Object.assign(runtime.settings, patch)
        // 换形象：旧动作（以及它的片段/调度链）属于上一个人设，立刻收回
        if (patch.persona && patch.persona !== prevPersona) clearAction()
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
      // 'auto' = 跟随角色（每个形象自带一个嗓子）；其余是用户手选的固定音色。
      const voiceOpts = [
        { value: 'auto', label: t('voice.auto') },
        { value: 'xiaoxiao', label: t('voice.xiaoxiao') },
        { value: 'xiaoyi', label: t('voice.xiaoyi') },
        { value: 'hsiaochen', label: t('voice.hsiaochen') },
        { value: 'xiaobei', label: t('voice.xiaobei') },
        { value: 'ava', label: 'Ava · en' },
        { value: 'emma', label: 'Emma · en' },
        { value: 'aria', label: 'Aria · en' },
        { value: 'jenny', label: 'Jenny · en' },
        { value: 'elvira', label: 'Elvira · es' },
        { value: 'francisca', label: 'Francisca · pt' },
        { value: 'swara', label: 'Swara · hi' },
      ]
      const pitchTrim = s.pitchTrim == null ? 1 : Number(s.pitchTrim)
      const rateTrim = s.rateTrim == null ? 1 : Number(s.rateTrim)
      const eff = voiceParams('idle')
      const voiceLabel = s.ttsVoice && s.ttsVoice !== 'auto' ? s.ttsVoice : (p.voice.voiced && p.voice.voiced[PET_LANG]) || 'auto'
      const effLine = t('panel.voiceEff').replace('{voice}', voiceLabel).replace('{pitch}', (eff.pitch - 1 >= 0 ? '+' : '') + Math.round((eff.pitch - 1) * 100) + '%').replace('{rate}', Math.round(eff.rate * 100) + '%')
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
          h('input', {
            type: 'time',
            value: s.activeStart,
            'aria-label': t('a11y.start'),
            onChange: (e) => update({ activeStart: e.target.value }),
          }),
          h('span', { className: 'val' }, '→'),
          h('input', {
            type: 'time',
            value: s.activeEnd,
            'aria-label': t('a11y.end'),
            onChange: (e) => update({ activeEnd: e.target.value }),
          }),
        ),
        sep(),
        sec(t('panel.voice')),
        h(
          'div',
          { className: 'dsh-pet-grid2' },
          h(Toggle, { label: t('panel.voiceOn'), checked: s.voiceOn, onChange: (v) => update({ voiceOn: v }) }),
          h(Toggle, { label: t('panel.neural'), checked: s.neuralVoice !== false, onChange: (v) => update({ neuralVoice: v }) }),
        ),
        h('div', { className: 'dsh-pet-field wide' }, h(PetSelect, { value: s.ttsVoice || 'auto', options: voiceOpts, onChange: (v) => update({ ttsVoice: v }) })),
        runtime.neuralOk === false
          ? h('div', { className: 'dsh-pet-hint' }, t('hint.neuralOff'))
          : null,
        s.neuralVoice ? h('div', { className: 'dsh-pet-hint' }, t('hint.privacy')) : null,
        h(Slider, { label: t('panel.volume'), min: 0, max: 1, step: 0.1, value: s.volume, onChange: (v) => update({ volume: v }) }),
        h('div', { className: 'dsh-pet-hint' }, effLine),
        h(Slider, { label: t('panel.pitchTrim'), min: 0.85, max: 1.15, step: 0.01, value: pitchTrim.toFixed(2), suffix: '×', onChange: (v) => update({ pitchTrim: Math.abs(v - 1) < 0.005 ? null : v }) }),
        h(Slider, { label: t('panel.rateTrim'), min: 0.8, max: 1.25, step: 0.01, value: rateTrim.toFixed(2), suffix: '×', onChange: (v) => update({ rateTrim: Math.abs(v - 1) < 0.005 ? null : v }) }),
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
          h('button', { onClick: () => playAction('hair', { explicit: true }) }, t('panel.hair')),
          // 面板是从她身上点开的，所以这里点不到「藏起来的她」；
          // 这一项的实际作用是就地开心一下（mood=dance，不走位）。
          h('button', { onClick: () => showPet('dance') }, t('panel.cheer')),
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
