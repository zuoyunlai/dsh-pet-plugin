/**
 * 1.9.4 客户端修订：
 *   1. 「恢复默认」同时清掉聊天历史（原来只删 settings）
 *   2. 设置做类型/范围校验（localStorage 可被任意脚本改写，NaN/字符串会让她消失）
 *   3. 音色切换不再每动一下滑杆就灌一次 warm（防抖 600ms）
 *   4. 神经音色在面板里明示「朗读文本会发往微软」
 */
const fs = require('fs')

// ---------- 1) 恢复默认清历史 ----------
let c = fs.readFileSync('src/90-components.js', 'utf8')
const before1 = `              onClick: () => {
                try {
                  window.localStorage.removeItem(STORAGE_KEY)
                } catch (e) {
                  /* ignore */
                }`
if (!c.includes(before1)) throw new Error('reset anchor')
c = c.replace(
  before1,
  `              onClick: () => {
                try {
                  // 历史里是用户和宠物的对话明文，恢复默认必须一起清掉
                  window.localStorage.removeItem(STORAGE_KEY)
                  window.localStorage.removeItem(HISTORY_KEY)
                } catch (e) {
                  /* ignore */
                }`,
)

// ---------- 2) 音色切换防抖 ----------
const before2 = '          setTimeout(() => warmVoice(), 50)'
if (!c.includes(before2)) throw new Error('warm anchor')
c = c.replace(
  before2,
  `          // 滑杆/下拉每动一下就灌一次预处理会把 worker 队列塞满：防抖 600ms
          if (runtime.warmTimer) clearTimeout(runtime.warmTimer)
          runtime.warmTimer = setTimeout(() => warmVoice(), 600)`,
)

// ---------- 3) 隐私提示 ----------
const before3 = "        h('div', { className: 'dsh-pet-hint' }, t('hint.neuralOff'))"
if (!c.includes(before3)) throw new Error('privacy anchor')
c = c.replace(
  before3,
  `        h('div', { className: 'dsh-pet-hint' }, t('hint.neuralOff')),
        s.neuralVoice ? h('div', { className: 'dsh-pet-hint' }, t('hint.privacy')) : null`,
)
fs.writeFileSync('src/90-components.js', c)

// ---------- 4) 设置校验 ----------
let st = fs.readFileSync('src/40-settings.js', 'utf8')
const before4 = `        if (!PERSONAS[merged.persona]) merged.persona = DEFAULT_SETTINGS.persona`
if (!st.includes(before4)) throw new Error('settings anchor')
st = st.replace(
  before4,
  `        // localStorage 里的值不可信：任意脚本都能改。逐项收紧类型与范围，
        // 否则一个 NaN/字符串就能让她消失（scale: 'NaNpx'）。
        const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi ? v : undefined)
        merged.lang = ['auto', 'zh', 'en', 'es', 'pt', 'hi'].indexOf(merged.lang) >= 0 ? merged.lang : 'auto'
        merged.scale = num(merged.scale, 0.6, 2.5) ?? DEFAULT_SETTINGS.scale
        merged.volume = num(merged.volume, 0, 1) ?? DEFAULT_SETTINGS.volume
        merged.probability = num(merged.probability, 1, 100) ?? DEFAULT_SETTINGS.probability
        if (merged.voicePitch != null) merged.voicePitch = num(merged.voicePitch, 0.5, 2) ?? null
        if (merged.voiceRate != null) merged.voiceRate = num(merged.voiceRate, 0.5, 2) ?? null
        if (merged.ttsVoice != null && typeof merged.ttsVoice !== 'string') merged.ttsVoice = DEFAULT_SETTINGS.ttsVoice
        if (merged.pos != null) {
          const ok = merged.pos && num(merged.pos.x, -20000, 20000) != null && num(merged.pos.y, -20000, 20000) != null
          if (!ok) merged.pos = null
        }
        if (!PERSONAS[merged.persona]) merged.persona = DEFAULT_SETTINGS.persona`,
)
fs.writeFileSync('src/40-settings.js', st)

console.log('client patches ok')
