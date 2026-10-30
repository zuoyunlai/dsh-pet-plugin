/**
 * dsh-pet — 桌面宠物（DSH Web 客户端插件）
 *
 * 挂载点（2026-10-29 审计 P3-12：旧注释还写着早已删除的 conversation.input.overlay 桥）：
 *   shell.overlay            → 宠物本体（全窗浮动层，root 作用域）
 *   conversation.input.right → 输入框右侧的 🐾 常驻入口（宠物藏起来时的唯一召唤按钮）
 *
 * 约束（官方红线，别改坏）：
 *   - 不 iframe、不往 document.body 追加、不 require 任何 @deepseek-ai/dsh-client-* 包
 *   - 组件抛错会让整个 slot 条目白屏，所以所有外部访问都要 try/catch
 *   - 所有资源（定时器、语音、监听）在 apply 里用 ctx.effect 注册并在返回函数里释放
 */
window.__ModuleLoader__.load({
  id: 'dsh-pet-plugin',
  factory(require) {
    'use strict'
    const React = require('react')
    const h = React.createElement
    // P3-1：useCallback 从未使用（旧的死导入）
    const { useState, useEffect, useRef } = React

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
    const PET_BUILD_VERSION = "1.27.0"
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

    /* ================= 文案（i18n） ================= */
    // 字典由 build.mjs 从 locale/<lang>.json 注入（标记 @locales）；改文案请改 locale/ 再 build。
    // 语言跟随 DSH 界面语言：优先读 <html lang>（宿主切换语言时会改它），
    // 其次 navigator.language，最后回落英文。可用 localStorage['dsh-pet.lang'] 手动覆盖。
    const PET_LOCALES = {"en":{"panel.title":"Desktop companion","panel.look":"Look","panel.lang":"Language","panel.langAuto":"Auto (follow DSH)","panel.voice":"Voice","panel.display":"Display","panel.actions":"Actions","panel.effects":"Effects","panel.persona":"Persona","panel.always":"Always","panel.random":"Random","panel.probability":"Per hour","panel.active":"Hours","panel.voiceOn":"Speech","panel.neural":"Neural","voice.auto":"Follow persona (default)","panel.voiceName":"Timbre","panel.volume":"Volume","panel.pitch":"Pitch","panel.rate":"Rate","panel.inputBox":"Input box","panel.inputHover":"Only on hover","panel.chatter":"Chit-chat","panel.celebrate":"Celebrate","panel.chaos":"Mischief","panel.size":"Size","panel.dance":"Dance","panel.hair":"Flip hair","panel.summon":"Summon","panel.stay":"Stay a while","panel.cheer":"Cheer up","panel.hide":"Hide 1h","panel.dontDisturb":"Do not disturb 1h","panel.dontDisturbOn":"End do not disturb","panel.turnNotify":"Tell me when a run finishes","panel.turnNotifyHint":"One notification when a long run completes while you are away.","panel.settings":"Settings","panel.ink":"Ink","panel.confetti":"Confetti","panel.cloud":"Cloud","panel.fog":"Fog","panel.bomb":"Bomb","panel.resetPos":"Reset corner","panel.resetAll":"Defaults","panel.close":"Close","voice.xiaoxiao":"Xiaoxiao · gentle","voice.xiaoyi":"Xiaoyi · sweet","pet.toggle":"Desktop companion","pet.toggleOff":"She is off-screen — click to bring her back","hint.neuralOff":"Neural voice unavailable, using the system voice","hint.privacy":"Neural voice sends the spoken text to Microsoft. Switch it off to keep everything on this machine.","placeholder.chat":"Say something to {name}…","a11y.talkTo":"Talk to {name}","a11y.send":"Send","a11y.start":"Active from","a11y.end":"Active until","voice.hsiaochen":"HsiaoChen · soft (TW)","voice.xiaobei":"Xiaobei · lively (NE)","panel.pitchTrim":"Pitch trim","panel.rateTrim":"Rate trim","panel.voiceEff":"Now: {voice} · pitch {pitch} · rate {rate}","chat.needSignIn":"You need to sign in to DeepSeek in DSH before I can use the model.","chat.stuck":"My head is a little stuck right now.","dot.thinking":"thinking…","dot.ok":"chat link OK","dot.fail":"last attempt failed (see [dsh-pet] chat failed in the console)","dot.idle":"no chat yet","actor.tip":" (drag me / right-click for a menu)","hint.notifyDenied":"Notification permission was not granted. Enable it in the address bar to use turn reminders.","chat.rateLimited":"Too many messages just now — give it a minute.","panel.clearMemory":"Clear chat memory","hint.memoryShared":"Persona switched. Chat memory is shared across personas — clear it in settings if you want a fresh start.","hint.renderFailed":"Something broke while drawing the pet. Check the console ([dsh-pet])."},"zh":{"panel.title":"桌面伴侣","panel.look":"形象","panel.lang":"语言","panel.langAuto":"自动（跟随 DSH）","panel.voice":"声音","panel.display":"显示","panel.actions":"动作","panel.effects":"特效","panel.persona":"形象","panel.always":"常驻","panel.random":"随机","panel.probability":"每小时","panel.active":"活跃","panel.voiceOn":"说话","panel.neural":"神经音色","voice.auto":"跟随角色（默认）","panel.voiceName":"音色","panel.volume":"音量","panel.pitch":"音高","panel.rate":"语速","panel.inputBox":"小输入框","panel.inputHover":"悬停才显示","panel.chatter":"主动搭话","panel.celebrate":"完成庆祝","panel.chaos":"恶作剧","panel.size":"大小","panel.dance":"跳一段","panel.hair":"撩头发","panel.summon":"叫出来","panel.stay":"再待一会儿","panel.cheer":"开心一下","panel.hide":"藏 1h","panel.dontDisturb":"勿扰 1 小时","panel.dontDisturbOn":"结束勿扰","panel.turnNotify":"跑完了提醒我","panel.turnNotifyHint":"你不在的时候，长时间的一轮跑完会弹一条通知。","panel.settings":"设置","panel.ink":"泼墨","panel.confetti":"撒花","panel.cloud":"乌云","panel.fog":"起雾","panel.bomb":"炸弹","panel.resetPos":"回右下角","panel.resetAll":"恢复默认","panel.close":"关闭","voice.xiaoxiao":"晓晓 · 温柔","voice.xiaoyi":"晓伊 · 甜","pet.toggle":"桌面伴侣","pet.toggleOff":"她在屏幕外，点一下拉回来","hint.neuralOff":"神经音色不可用，改用系统语音","hint.privacy":"神经语音会把要说的话发到微软的在线服务合成；不想外发就关掉「神经」，改用系统语音。","placeholder.chat":"跟{name}说句话…","a11y.talkTo":"对 {name} 说话","a11y.send":"发送","a11y.start":"活跃开始","a11y.end":"活跃结束","voice.hsiaochen":"晓臻 · 软糯（台湾）","voice.xiaobei":"晓北 · 活泼（东北）","panel.pitchTrim":"音高微调","panel.rateTrim":"语速微调","panel.voiceEff":"当前：{voice} · 音高 {pitch} · 语速 {rate}","chat.needSignIn":"得先在 DSH 里登录 DeepSeek，我才用得上大模型。","chat.stuck":"我这会儿脑子有点卡住了。","dot.thinking":"它正在想…","dot.ok":"单聊通道正常","dot.fail":"刚才那次没接上（看控制台 [dsh-pet] chat failed）","dot.idle":"还没聊过","actor.tip":"（可以拖走 / 右键有菜单）","hint.notifyDenied":"没有拿到通知权限。想用跑完提醒的话，去地址栏把通知权限打开。","chat.rateLimited":"说得太快啦，缓一分钟再聊。","panel.clearMemory":"清空聊天记忆","hint.memoryShared":"换形象了：聊天记忆跨形象共用，想清掉就在设置里点「清空聊天记忆」。","hint.renderFailed":"画她的时候出错了，详情看控制台 [dsh-pet]。"},"es":{"panel.title":"Mascota","panel.look":"Aspecto","panel.lang":"Idioma","panel.langAuto":"Auto (seguir DSH)","panel.voice":"Voz","panel.display":"Pantalla","panel.actions":"Acciones","panel.effects":"Efectos","panel.persona":"Personaje","panel.always":"Siempre","panel.random":"Aleatoria","panel.probability":"Por hora","panel.active":"Horario","panel.voiceOn":"Hablar","panel.neural":"Neural","voice.auto":"Seguir al personaje (por defecto)","panel.voiceName":"Timbre","panel.volume":"Volumen","panel.pitch":"Tono","panel.rate":"Velocidad","panel.inputBox":"Cajita","panel.inputHover":"Solo al pasar el ratón","panel.chatter":"Charlar","panel.celebrate":"Celebrar","panel.chaos":"Travesuras","panel.size":"Tamaño","panel.dance":"Bailar","panel.hair":"Mover pelo","panel.summon":"Llamar","panel.stay":"Quédate un rato","panel.cheer":"Anímate","panel.hide":"Ocultar 1h","panel.dontDisturb":"No molestar 1 h","panel.dontDisturbOn":"Terminar no molestar","panel.turnNotify":"Avisarme al terminar","panel.turnNotifyHint":"Una notificación cuando una tanda larga termina y no estás mirando.","panel.settings":"Ajustes","panel.ink":"Tinta","panel.confetti":"Confeti","panel.cloud":"Nube","panel.fog":"Niebla","panel.bomb":"Bomba","panel.resetPos":"Esquina","panel.resetAll":"Defecto","panel.close":"Cerrar","voice.xiaoxiao":"Xiaoxiao · suave","voice.xiaoyi":"Xiaoyi · dulce","pet.toggle":"Mascota","pet.toggleOff":"Está fuera de pantalla, pulsa para traerla","hint.neuralOff":"Voz neural no disponible, se usa la del sistema","hint.privacy":"La voz neuronal envía el texto a los servicios en línea de Microsoft; desactívala si prefieres no salir de esta máquina.","placeholder.chat":"Dile algo a {name}…","a11y.talkTo":"Habla con {name}","a11y.send":"Enviar","a11y.start":"Activo desde","a11y.end":"Activo hasta","voice.hsiaochen":"HsiaoChen · suave (TW)","voice.xiaobei":"Xiaobei · vivaz (NE)","panel.pitchTrim":"Ajuste de tono","panel.rateTrim":"Ajuste de velocidad","panel.voiceEff":"Ahora: {voice} · tono {pitch} · velocidad {rate}","chat.needSignIn":"Primero inicia sesión en DeepSeek dentro de DSH para que pueda usar el modelo.","chat.stuck":"Ahora mismo se me ha atascado la cabeza.","dot.thinking":"pensando…","dot.ok":"chat en orden","dot.fail":"el último intento falló (mira [dsh-pet] chat failed en la consola)","dot.idle":"aún sin chatear","actor.tip":" (arrástrame / clic derecho para el menú)","hint.notifyDenied":"No se concedió permiso de notificación. Actívalo en la barra de direcciones para usar los avisos.","chat.rateLimited":"Demasiados mensajes, espera un minuto.","panel.clearMemory":"Borrar memoria del chat","hint.memoryShared":"Cambiaste de personaje. La memoria del chat se comparte entre personajes; bórrala en ajustes si quieres empezar de cero.","hint.renderFailed":"Algo falló al dibujar la mascota. Revisa la consola ([dsh-pet])."},"pt":{"panel.title":"Mascote","panel.look":"Aparência","panel.lang":"Idioma","panel.langAuto":"Auto (seguir DSH)","panel.voice":"Voz","panel.display":"Exibição","panel.actions":"Ações","panel.effects":"Efeitos","panel.persona":"Personagem","panel.always":"Sempre","panel.random":"Aleatória","panel.probability":"Por hora","panel.active":"Horário","panel.voiceOn":"Falar","panel.neural":"Neural","voice.auto":"Seguir o personagem (padrão)","panel.voiceName":"Timbre","panel.volume":"Volume","panel.pitch":"Tom","panel.rate":"Velocidade","panel.inputBox":"Caixinha","panel.inputHover":"Só retrátil ao passar","panel.chatter":"Puxar papo","panel.celebrate":"Celebrar","panel.chaos":"Travessuras","panel.size":"Tamanho","panel.dance":"Dançar","panel.hair":"Mexer cabelo","panel.summon":"Chamar","panel.stay":"Fique mais um pouco","panel.cheer":"Fica feliz","panel.hide":"Ocultar 1h","panel.dontDisturb":"Não perturbe 1 h","panel.dontDisturbOn":"Encerrar não perturbe","panel.turnNotify":"Avisar quando terminar","panel.turnNotifyHint":"Uma notificação quando uma rodada longa termina e você não está olhando.","panel.settings":"Configurações","panel.ink":"Tinta","panel.confetti":"Confete","panel.cloud":"Nuvem","panel.fog":"Névoa","panel.bomb":"Bomba","panel.resetPos":"Canto","panel.resetAll":"Padrão","panel.close":"Fechar","voice.xiaoxiao":"Xiaoxiao · suave","voice.xiaoyi":"Xiaoyi · doce","pet.toggle":"Mascote","pet.toggleOff":"Ela está fora da tela, clique para trazê-la","hint.neuralOff":"Voz neural indisponível, usando a do sistema","hint.privacy":"A voz neural envia o texto para o serviço on-line da Microsoft; desative se preferir manter tudo nesta máquina.","placeholder.chat":"Diga algo para {name}…","a11y.talkTo":"Fale com {name}","a11y.send":"Enviar","a11y.start":"Ativo das","a11y.end":"Ativo até","voice.hsiaochen":"HsiaoChen · suave (TW)","voice.xiaobei":"Xiaobei · vivaz (NE)","panel.pitchTrim":"Ajuste de tom","panel.rateTrim":"Ajuste de velocidade","panel.voiceEff":"Agora: {voice} · tom {pitch} · velocidade {rate}","chat.needSignIn":"Entre com a conta DeepSeek no DSH antes, senão não consigo usar o modelo.","chat.stuck":"Minha cabeça travou um pouco agora.","dot.thinking":"pensando…","dot.ok":"chat funcionando","dot.fail":"a última tentativa falhou (veja [dsh-pet] chat failed no console)","dot.idle":"ainda sem conversa","actor.tip":" (arraste-me / clique direito para o menu)","hint.notifyDenied":"A permissão de notificação não foi concedida. Ative-a na barra de endereço para usar os avisos.","chat.rateLimited":"Muitas mensagens, espere um minuto.","panel.clearMemory":"Limpar memória do chat","hint.memoryShared":"Trocou de personagem. A memória do chat é compartilhada; limpe nos ajustes se quiser começar do zero.","hint.renderFailed":"Algo falhou ao desenhar a mascote. Veja o console ([dsh-pet])."},"hi":{"panel.title":"Pet","panel.look":"Roop","panel.lang":"भाषा","panel.langAuto":"स्वतः (DSH के अनुसार)","panel.voice":"Aawaaz","panel.display":"Dikhaav","panel.actions":"Harkat","panel.effects":"प्रभाव","panel.persona":"Character","panel.always":"Hameshaa","panel.random":"कभी-कभी","panel.probability":"Prati ghantaa","panel.active":"Samay","panel.voiceOn":"Bole","panel.neural":"न्यूरल","voice.auto":"Persona ke hisaab se (default)","panel.voiceName":"Sur","panel.volume":"वॉल्यूम","panel.pitch":"पिच","panel.rate":"Raftaar","panel.inputBox":"इनपुट बॉक्स","panel.inputHover":"Hover par hi dikhe","panel.chatter":"Baat-cheet","panel.celebrate":"Jashn","panel.chaos":"Sharaarat","panel.size":"आकार","panel.dance":"Naacho","panel.hair":"Baal sarkaao","panel.summon":"Bulaao","panel.stay":"Thodi der ruko","panel.cheer":"Khush ho jao","panel.hide":"1 ghantaa chhupao","panel.dontDisturb":"1 घंटा परेशान न करें","panel.dontDisturbOn":"परेशान न करें बंद करें","panel.turnNotify":"खत्म होने पर बताएं","panel.turnNotifyHint":"जब आप दूर हों और लंबा दौर पूरा हो, तो एक सूचना।","panel.settings":"सेटिंग्स","panel.ink":"स्याही","panel.confetti":"कंफेटी","panel.cloud":"Baadal","panel.fog":"Dhundh","panel.bomb":"बम","panel.resetPos":"Kona","panel.resetAll":"Default","panel.close":"Band","voice.xiaoxiao":"Xiaoxiao · komaL","voice.xiaoyi":"Xiaoyi · meethi","pet.toggle":"Pet","pet.toggleOff":"Woh screen se bahar hai, wapas laane ke liye click karein","hint.neuralOff":"Neural aawaaz upalabdh nahi, system voice use ho rahi hai","hint.privacy":"न्यूरल आवाज़ बोले जाने वाले टेक्स्ट को माइक्रोसॉफ्ट के ऑनलाइन सेवा को भेजती है; नहीं भेजना चाहते तो «न्यूरल» बंद कर दें।","placeholder.chat":"{name} se kuchh kahein…","a11y.talkTo":"{name} se baat karein","a11y.send":"Bhejein","a11y.start":"Active kab se","a11y.end":"Active kab tak","voice.hsiaochen":"HsiaoChen · komal (TW)","voice.xiaobei":"Xiaobei · jeevant (NE)","panel.pitchTrim":"पिच समायोजन","panel.rateTrim":"गति समायोजन","panel.voiceEff":"अभी: {voice} · पिच {pitch} · गति {rate}","chat.needSignIn":"पहले DSH में DeepSeek पर साइन-इन करें, तभी मैं मॉडल इस्तेमाल कर पाऊँगी।","chat.stuck":"अभी मेरा दिमाग़ थोड़ा अटक गया है।","dot.thinking":"सोच रही है…","dot.ok":"चैट ठीक है","dot.fail":"पिछली कोशिश नाकाम रही (कंसोल में [dsh-pet] chat failed देखें)","dot.idle":"अभी तक कोई चैट नहीं","actor.tip":" (मुझे खींचें / मेनू के लिए राइट-क्लिक करें)","hint.notifyDenied":"सूचना अनुमति नहीं मिली। अनुस्मारक के लिए इसे पता पट्टी में चालू करें।","chat.rateLimited":"बहुत ज़्यादा संदेश, एक मिनट रुकिए।","panel.clearMemory":"चैट यादें साफ़ करें","hint.memoryShared":"किरदार बदला। चैट यादें सभी किरदारों में साझा हैं; नई शुरुआत के लिए सेटिंग्स में साफ़ करें।","hint.renderFailed":"पालतू को बनाते समय कुछ गड़बड़ हुई। कंसोल देखें ([dsh-pet])।"}}
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

    /* ================= 人格 / 形象 ================= */

    const PERSONAS = {
      violet: {
        id: "violet",
        name: "薇",
        tag: "紫发 · 从容的挑逗",
        tagEn: "Violet — unhurried teasing",
        image: "pet-violet.webp",
        images: {
          idle: "pet-violet.webp",
          walk: "pet-violet.webp",
          talk: "pet-violet.webp",
          happy: "pet-violet-happy.webp",
          shy: "pet-violet-shy.webp",
          angry: "pet-violet-angry.webp",
          sleep: "pet-violet-sleep.webp",
          dance: "pet-violet-happy.webp",
          poked: "pet-violet-shy.webp",
        },
        imageFit: { "pet-violet-sleep.webp": 0.0098 },
        actions: {
          dance: [
            "pet-violet-dance1.webp",
            "pet-violet-dance2.webp",
            "pet-violet-dance3.webp",
            "pet-violet-dance4.webp",
            "pet-violet-dance5.webp",
            "pet-violet-dance6.webp",
          ],
          hair: ["pet-violet-hair1.webp", "pet-violet-hair2.webp", "pet-violet-hair3.webp"],
          walk: ["pet-violet-walk1.webp", "pet-violet-walk2.webp", "pet-violet-walk3.webp"],
        },
        clips: {
          dance: "pet-violet-dance.webm",
          walk: "pet-violet-walk.webm",
          hair: "pet-violet-hair.webm",
          stage: "pet-violet-stage.webm",
        },
        clipFit: {
          dance: { s: 1.0897, y: -0.0007, x: 0.0058 },
          walk: { s: 1.2134, y: 0.1186, x: 0.0056 },
          hair: { s: 1.1169, y: 0.0196, x: 0.0012 },
          stage: { s: 1.3621, y: 0.0855, x: -0.021 },
        },
        voice: {
          pitch: 1.02,
          rate: 0.86,
          voiced: { zh: "hsiaochen", en: "sonia", es: "elvira", pt: "francisca", hi: "swara" },
          moods: {
            appear: { pitch: 1, rate: 1 },
            idle: { pitch: 0, rate: 1 },
            dance: { pitch: 2, rate: 1.04, volume: 1.05 },
            shy: { pitch: 4, rate: 0.94, volume: 0.92 },
            angry: { pitch: 2, rate: 1.05, volume: 1.06 },
            sleep: { pitch: -3, rate: 0.84, volume: 0.72 },
            error: { pitch: -1, rate: 0.96, volume: 0.95 },
            drag: { pitch: 3, rate: 1.08 },
            chatAck: { pitch: 1, rate: 1.02 },
          },
        },
        temper: { idle: 4, walk: 1.4, dance: 1.6, shy: 1.8, angry: 1, sleep: 1.4, happy: 1.8 },
        lines: {
          appear: ["来得正好，我正觉得无聊。", "别站那么远，我又不吃人。", "你今天……看起来很好欺负。", "忙完了？过来坐一会儿。"],
          idle: [
            "你敲键盘的样子，比你想的认真多了。",
            "这一页你看了十分钟了，需要我提醒你吗。",
            "别一口气熬到天亮，我可不负责收拾。",
            "手停一下，喝口水。",
            "你刚才那下叹气，我可听见了。",
          ],
          dance: ["看可以，别看到发呆。", "这套舞，只跳给一个人看。", "想学？先把手搭上来。"],
          shy: ["再看，我就当你是有意的了。", "……别这么盯着我。", "我脸红什么，你看错了。"],
          angry: ["我记性很好，你知道的。", "再说一遍试试。", "行，那今天就这样。"],
          sleep: ["我先眯一会儿，你自己玩。", "别吵，就五分钟。"],
          poked: ["戳哪儿呢。", "手放规矩点。", "再戳一下，我可要还手了。"],
          chatAck: ["说吧，我听着。", "嗯？讲。"],
          error: ["刚才走神了，再说一遍。", "这会儿没接上，等等。"],
          drag: ["这么急？我可是很沉的。", "放得稳一点，别把我颠散了。", "你抱得比你想的要紧呢。", "去哪儿我都跟着，别慌。", "再晃一下，我就记住这一次了。"],
          aside: [
            "他刚才那下抓得挺稳，可以夸一句。",
            "其实我很想让他再拉一会儿。",
            "这个姿势别扭，但不想提醒他。",
            "刚才差点笑出来，忍住了。",
            "他手心的温度比想象中高。",
            "要不要装作被拉疼了，看他反应。",
            "再拖远一点，就可以赖着不走了。",
            "算了，这次就不计较了。",
          ],
        },
        linesEn: {
          appear: [
            "Perfect timing. I was getting bored.",
            "Don't stand that far away, I don't bite.",
            "You look especially easy to tease today.",
            "Done? Come sit for a while.",
          ],
          idle: [
            "You type more seriously than you think.",
            "You've been on this page ten minutes. Need a reminder?",
            "Don't stay up till dawn. I'm not cleaning up after you.",
            "Pause. Drink some water.",
            "I heard that sigh, by the way.",
          ],
          dance: [
            "Look, but don't stare.",
            "This one is for one person only.",
            "Want to learn? Put your hand here first.",
          ],
          shy: [
            "Keep looking and I will take it as a hint.",
            "...Don't stare at me like that.",
            "I'm not blushing. You imagined it.",
          ],
          angry: ["I remember things. You know that.", "Say that again.", "Fine. We are done for today."],
          sleep: ["I'll rest my eyes. Entertain yourself.", "Quiet. Five minutes."],
          poked: ["Where are you poking?", "Hands to yourself.", "One more and I poke back."],
          chatAck: ["Go on, I am listening.", "Hm? Tell me."],
          error: ["I drifted off. Say that again.", "That didn't land. Hold on."],
          drag: [
            "In such a hurry? And I'm rather heavy.",
            "Set me down gently, not like a parcel.",
            "You're holding me tighter than you think.",
            "Anywhere's fine. No need to panic.",
            "One more shake and I will remember this.",
          ],
          aside: [
            "That grip was steady. Worth a compliment.",
            "I sort of want him to keep pulling.",
            "Awkward pose, but I won't point it out.",
            "Almost laughed. Caught myself.",
            "His palm is warmer than I expected.",
            "Should I pretend it hurt, to see him react?",
            "Drag me further and I could stay put.",
            "Never mind. I'll let this one go.",
          ],
        },
        linesEs: {
          appear: [
            "Justo a tiempo. Me estaba aburriendo.",
            "No te quedes tan lejos, no muerdo.",
            "Hoy pareces especialmente fácil de provocar.",
            "¿Terminaste? Ven a sentarte un rato.",
          ],
          idle: [
            "Escribes con más seriedad de la que crees.",
            "Llevas diez minutos en esta página. ¿Te lo recuerdo?",
            "No te quedes hasta el amanecer. No pienso recoger nada.",
            "Para un momento. Bebe agua.",
            "Por cierto, oí ese suspiro.",
          ],
          dance: [
            "Mira, pero sin quedarte en blanco.",
            "Esta solo la bailo para una persona.",
            "¿Quieres aprender? Primero pon la mano aquí.",
          ],
          shy: [
            "Si sigues mirando, lo tomaré como un sí.",
            "...No me mires así.",
            "No me estoy sonrojando. Te lo imaginaste.",
          ],
          angry: ["Yo recuerdo las cosas. Lo sabes.", "Dilo otra vez.", "Bien. Por hoy hemos terminado."],
          sleep: ["Voy a cerrar los ojos un rato. Diviértete.", "Silencio. Cinco minutos."],
          poked: [
            "¿Dónde estás pinchando?",
            "Las manos en su sitio.",
            "Otra vez y te devuelvo el pinchazo.",
          ],
          chatAck: ["Dime, te escucho.", "¿Mm? Cuéntame."],
          error: ["Me distraje. Repítelo.", "Eso no me llegó. Espera."],
          drag: [
            "¿Con tanta prisa? Y peso lo mío.",
            "Bájame con cuidado, no soy un paquete.",
            "Me agarras más fuerte de lo que crees.",
            "Donde sea. No hay que correr.",
            "Una sacudida más y lo recordaré.",
          ],
          aside: [
            "Ese agarre fue firme. Merece un elogio.",
            "En realidad quiero que siga tirando.",
            "Postura incómoda, pero no pienso decirlo.",
            "Casi me río. Me contuve.",
            "Su palma está más caliente de lo que creía.",
            "¿Finjo que me dolió para ver su reacción?",
            "Si me arrastras más, me quedo.",
            "Da igual. Esta vez lo dejo pasar.",
          ],
        },
        linesPt: {
          appear: [
            "Chegou na hora. Eu já estava entediada.",
            "Não fica tão longe, eu não mordo.",
            "Hoje você parece especialmente fácil de provocar.",
            "Terminou? Vem sentar um pouco.",
          ],
          idle: [
            "Você digita com mais seriedade do que imagina.",
            "Faz dez minutos que você está nesta página. Quer que eu avise?",
            "Não fica até o amanhecer. Não vou limpar nada.",
            "Para um instante. Bebe água.",
            "A propósito, eu ouvi esse suspiro.",
          ],
          dance: [
            "Olha, mas não fica aí parado.",
            "Esta eu danço só para uma pessoa.",
            "Quer aprender? Primeiro põe a mão aqui.",
          ],
          shy: [
            "Se continuar olhando, vou entender como um sim.",
            "...Não olha assim para mim.",
            "Não estou corada. Você imaginou.",
          ],
          angry: ["Eu lembro das coisas. Você sabe.", "Repete isso.", "Está bem. Por hoje acabou."],
          sleep: ["Vou descansar os olhos. Se diverte.", "Silêncio. Cinco minutos."],
          poked: ["Onde você está cutucando?", "As mãos no lugar.", "Mais uma vez e eu cutuco de volta."],
          chatAck: ["Fala, estou ouvindo.", "Hum? Conta."],
          error: ["Me distraí. Repete.", "Isso não chegou. Espera."],
          drag: [
            "Tanta pressa? E eu não sou leve.",
            "Me põe no chão devagar, não sou encomenda.",
            "Você me segura mais forte do que pensa.",
            "Qualquer lugar serve. Não precisa correr.",
            "Me sacode de novo e eu vou lembrar disso.",
          ],
          aside: [
            "Essa pegada foi firme. Merece elogio.",
            "Na verdade quero que ele continue puxando.",
            "Postura estranha, mas não vou falar.",
            "Quase ri. Me segurei.",
            "A palma dele é mais quente do que eu pensava.",
            "Finjo que doeu só para ver a reação?",
            "Me arrasta mais e eu não saio daqui.",
            "Deixa. Desta vez eu relevo.",
          ],
        },
        linesHi: {
          appear: [
            "Sahi waqt par aaye. Main bore ho rahi thi.",
            "Itni door khade kyun ho, main kaatati nahi.",
            "Aaj tum khaas taur par chidhaane layak lag rahe ho.",
            "Kaam khatam? Thodi der baith jao.",
          ],
          idle: [
            "Tum jitna serious samajhte ho, usse zyada dhyaan se type karte ho.",
            "Is page par das minute ho gaye. Yaad dilaun?",
            "Subah tak mat jaago. Main kuchh saaf nahi karungi.",
            "Ruko. Paani pi lo.",
            "Waise, woh aah bhari lagi mujhe.",
          ],
          dance: [
            "Dekh sakte ho, par kho mat jao.",
            "Yeh dance sirf ek insaan ke liye hai.",
            "Seekhna hai? Pehle haath yahan rakho.",
          ],
          shy: [
            "Aise dekhte rahe to main haan samajh lungi.",
            "...Aise mat dekho.",
            "Main sharminda nahi ho rahi. Tumhe bhram hua.",
          ],
          angry: [
            "Mujhe sab yaad rehta hai. Jaante ho.",
            "Ek baar phir bolo.",
            "Theek hai. Aaj ke liye bas.",
          ],
          sleep: ["Aankhein band karti hoon. Tum khelo.", "Chup. Paanch minute."],
          poked: ["Kahan chubha rahe ho?", "Haath sambhal ke.", "Ek baar aur, to main bhi chubhaungi."],
          chatAck: ["Bolo, sun rahi hoon.", "Hmm? Batao."],
          error: ["Dhyaan bhatak gaya. Phir se bolo.", "Yeh nahi aaya. Ruko."],
          drag: [
            "Itni jaldi? Aur main halki bhi nahi hoon.",
            "Dheere se utaaro, parcel nahi hoon.",
            "Tum soch se zyada kas ke pakde ho.",
            "Kahin bhi le chalo, ghabrao mat.",
            "Ek baar aur hilaya to yaad rakhungi.",
          ],
          aside: [
            "Uska pakad kaafi mazboot tha. Taareef banti hai.",
            "Dil se chahti hoon woh aur kheenche.",
            "Ajeeb pose hai, par batana nahi.",
            "Hasi aa gayi thi. Rok li.",
            "Uska haath soch se zyada garam hai.",
            "Dard ka natak karun, reaction dekhne ke liye?",
            "Aur door le chalo, main yahin ruk jaungi.",
            "Chhod do. Is baar maaf kiya.",
          ],
        },
        license: "MIT",
      },
      crimson: {
        id: "crimson",
        name: "绯",
        tag: "红发 · 明目张胆的勾引",
        tagEn: "Crimson — shameless flirting",
        image: "pet-crimson.webp",
        images: {
          idle: "pet-crimson.webp",
          walk: "pet-crimson.webp",
          talk: "pet-crimson.webp",
          happy: "pet-crimson-happy.webp",
          shy: "pet-crimson-shy.webp",
          angry: "pet-crimson-angry.webp",
          sleep: "pet-crimson-sleep.webp",
          dance: "pet-crimson-happy.webp",
          poked: "pet-crimson-shy.webp",
        },
        actions: {
          dance: [
            "pet-crimson-dance1.webp",
            "pet-crimson-dance2.webp",
            "pet-crimson-dance3.webp",
            "pet-crimson-dance4.webp",
            "pet-crimson-dance5.webp",
            "pet-crimson-dance6.webp",
          ],
          hair: ["pet-crimson-hair1.webp", "pet-crimson-hair2.webp", "pet-crimson-hair3.webp"],
          walk: ["pet-crimson-walk1.webp", "pet-crimson-walk2.webp", "pet-crimson-walk3.webp"],
        },
        clips: {
          dance: "pet-crimson-dance.webm",
          walk: "pet-crimson-walk.webm",
          hair: "pet-crimson-hair.webm",
          stage: "pet-crimson-stage.webm",
        },
        clipFit: {
          dance: { s: 1.3333, y: 0.1328, x: 0.0924 },
          walk: { s: 1.1252, y: 0.1063, x: 0.0408 },
          hair: { s: 1.0912, y: 0.0075, x: 0.0036 },
          stage: { s: 1.3409, y: 0.0589, x: 0.0316 },
        },
        voice: {
          pitch: 1.04,
          rate: 0.94,
          voiced: { zh: "xiaoxiao", en: "aria", es: "dalia", pt: "thalita", hi: "swara" },
          moods: {
            appear: { pitch: 3, rate: 1.04, volume: 1.06 },
            idle: { pitch: 0, rate: 1 },
            dance: { pitch: 4, rate: 1.1, volume: 1.1 },
            shy: { pitch: 5, rate: 0.98, volume: 0.96 },
            angry: { pitch: 5, rate: 1.12, volume: 1.15 },
            sleep: { pitch: -2, rate: 0.86, volume: 0.74 },
            error: { pitch: 0, rate: 1, volume: 1 },
            drag: { pitch: 6, rate: 1.12 },
            chatAck: { pitch: 2, rate: 1.04 },
          },
        },
        temper: { idle: 3.4, walk: 1.6, dance: 2.2, shy: 1.2, angry: 1.6, sleep: 0.8, happy: 2.2 },
        lines: {
          appear: ["哟，终于舍得看我了。", "别躲，我又不会咬你……至少今天不会。", "你今天归我管了。", "看你一眼就想逗你，是我的错吗。"],
          idle: [
            "你那副正经样子，最让人想捣乱。",
            "累了吧？累就靠过来。",
            "别装了，你刚才在偷看我。",
            "我数到三，你要还是不理我，我就过去了。",
            "今晚别熬太晚，我会心疼的——一点点。",
          ],
          dance: ["看清楚了，只跳这一次。", "坐好，别眨眼。", "这舞是为谁跳的，你心里有数。"],
          shy: ["……你别得寸进尺啊。", "脸热？是灯太亮了。", "再说一句试试。"],
          angry: ["你完了。", "我现在很不高兴。", "哄我，不然这事没完。"],
          sleep: ["困了，借你肩膀靠一下。", "别动，让我睡会儿。"],
          poked: ["你胆子不小。", "碰我可以，要负责的。", "再碰一下试试？"],
          chatAck: ["说吧，听着呢。", "嗯？说重点。"],
          error: ["刚才没听清，再说。", "这算什么，重来。"],
          drag: ["抓这么紧，是怕我跑吗？", "喂，我可不是能随便拎走的。", "再往前一点，我就靠上去了。", "你心跳好快，我听得见。", "抱稳了，摔了我可要闹的。"],
          aside: [
            "他抱得这么自然，有点受不了。",
            "刚才那下很稳，我假装没在意。",
            "再这样下去，我会当真的。",
            "其实我很喜欢这样被带着走。",
            "他手抖了一下，我看见了。",
            "要不要故意往他怀里靠一点。",
            "这样被拎着，比坐着开心多了。",
            "别松手，这句我说不出口。",
          ],
        },
        linesEn: {
          appear: [
            "Oh? Finally looking at me.",
            "Don't hide. I won't bite... not today.",
            "You are mine to manage today.",
            "One look and I want to tease you. My fault?",
          ],
          idle: [
            "That serious face of yours makes me want to cause trouble.",
            "Tired? Then lean over here.",
            "Don't pretend. You were peeking.",
            "I count to three, then I come over.",
            "Don't stay up too late. I'd worry. A little.",
          ],
          dance: ["Watch closely. Only once.", "Sit still. No blinking.", "You know who this is for."],
          shy: ["...Don't push your luck.", "Warm face? The lamp is bright.", "Say that again. Try it."],
          angry: ["You are done for.", "I am not happy right now.", "Apologise, or this is not over."],
          sleep: ["Sleepy. Lending you my shoulder.", "Don't move. Let me sleep."],
          poked: ["Bold of you.", "Touch me and take responsibility.", "Try that again?"],
          chatAck: ["Say it. Listening.", "Hm? The point."],
          error: ["Didn't catch that. Again.", "That does not count. Redo it."],
          drag: [
            "Holding on tight—afraid I'll run?",
            "Hey, I'm not something you just carry off.",
            "One step closer and I lean right in.",
            "Your heart is racing. I can hear it.",
            "Hold on properly. Drop me and I will make a scene.",
          ],
          aside: [
            "He carries me so casually. It gets to me.",
            "Steady hold. I pretend not to notice.",
            "Keep this up and I'll take it seriously.",
            "Honestly, I like being carried like this.",
            "His hand trembled. I saw that.",
            "Should I lean in on purpose?",
            "Being carried beats sitting there.",
            "Don't let go. I can't say that out loud.",
          ],
        },
        linesEs: {
          appear: [
            "Vaya, por fin te dignas a mirarme.",
            "No te escondas, no voy a morderte... hoy no.",
            "Hoy estás bajo mi cargo.",
            "Una mirada y ya quiero molestarte. ¿Es mi culpa?",
          ],
          idle: [
            "Esa cara de serio es la que más ganas me da de arruinar.",
            "¿Cansado? Pues apóyate aquí.",
            "No disimules. Me estabas mirando.",
            "Cuento hasta tres. Si sigues ignorándome, voy yo.",
            "No te acuestes tarde. Me dolería. Un poquito.",
          ],
          dance: [
            "Mira bien, solo lo bailo una vez.",
            "Siéntate y no parpadees.",
            "Tú sabes para quién es este baile.",
          ],
          shy: ["...No te pases de listo.", "¿Calor? Es la lámpara.", "Di eso otra vez. A ver."],
          angry: ["Estás perdido.", "Ahora mismo no estoy contenta.", "Pide perdón o esto no termina."],
          sleep: ["Sueño. Te presto el hombro.", "No te muevas. Déjame dormir."],
          poked: ["Qué atrevido.", "Tócame y hazte cargo.", "¿Otra vez? A ver."],
          chatAck: ["Dilo. Escucho.", "¿Mm? Al grano."],
          error: ["No te entendí. Otra vez.", "Eso no cuenta. Repite."],
          drag: [
            "¿Me agarras fuerte por miedo a que escape?",
            "Oye, no soy algo que se lleva así.",
            "Un paso más y me acerco yo.",
            "Tu corazón va rápido. Lo oigo.",
            "Sujétame bien. Si me caes, armo un escándalo.",
          ],
          aside: [
            "Me lleva con tanta naturalidad que me afecta.",
            "Buen agarre. Fingo no darme cuenta.",
            "Si sigue así, me lo tomaré en serio.",
            "La verdad, me gusta que me lleve así.",
            "Le tembló la mano. Lo vi.",
            "¿Me acerco a propósito?",
            "Que me lleven es mejor que quedarme quieta.",
            "No me sueltes. Eso no puedo decirlo.",
          ],
        },
        linesPt: {
          appear: [
            "Ora, finalmente você se dignou a olhar para mim.",
            "Não se esconde, eu não vou morder... hoje não.",
            "Hoje você está sob o meu comando.",
            "Um olhar e já quero te provocar. A culpa é minha?",
          ],
          idle: [
            "Essa sua cara séria é a que mais me dá vontade de bagunçar.",
            "Cansado? Então encosta aqui.",
            "Não disfarça. Você estava me olhando.",
            "Conto até três. Se continuar me ignorando, eu vou aí.",
            "Não durma tarde. Eu sofreria. Um pouquinho.",
          ],
          dance: ["Olha bem, só danço uma vez.", "Senta e não pisca.", "Você sabe para quem é esta dança."],
          shy: ["...Não se atreva a pedir mais.", "Calor? É a lâmpada.", "Diz isso de novo. Vamos ver."],
          angry: [
            "Você está perdido.",
            "Agora não estou nada contente.",
            "Pede desculpa ou isso não termina.",
          ],
          sleep: ["Sono. Empresto meu ombro.", "Não se mexe. Me deixa dormir."],
          poked: ["Que atrevido.", "Me toca e assume.", "De novo? Vamos ver."],
          chatAck: ["Fala. Estou ouvindo.", "Hum? Direto ao ponto."],
          error: ["Não entendi. De novo.", "Isso não vale. Repete."],
          drag: [
            "Me segura assim com medo de eu fugir?",
            "Ei, eu não sou coisa pra carregar.",
            "Mais um passo e eu me encosto.",
            "Seu coração está acelerado. Eu ouço.",
            "Segura direito. Se me derrubar, eu faço drama.",
          ],
          aside: [
            "Ele me carrega com tanta naturalidade. Mexe comigo.",
            "Pegada firme. Finjo não notar.",
            "Se continuar assim, vou levar a sério.",
            "Sinceramente, gosto de ser carregada assim.",
            "A mão dele tremeu. Eu vi.",
            "Finjo me encostar de propósito?",
            "Ser carregada é melhor do que ficar parada.",
            "Não solta. Isso eu não consigo falar.",
          ],
        },
        linesHi: {
          appear: [
            "Achha, aakhir tumne mujhe dekhne ki zehmat ki.",
            "Chhupo mat, main kaatungi nahi... aaj nahi.",
            "Aaj tum mere control mein ho.",
            "Ek nazar aur main chedne lago. Meri galti hai?",
          ],
          idle: [
            "Tumhara yeh serious chehra hi sabse zyada chhedne ka mann karta hai.",
            "Thak gaye? To yahan tek lagao.",
            "Naatak mat karo. Tum mujhe dekh rahe the.",
            "Teen tak ginti kar rahi hoon. Agar anjaan bane rahe, to main khud aaungi.",
            "Der tak mat jaago. Mujhe takleef hogi. Thodi si.",
          ],
          dance: [
            "Dhyaan se dekho, sirf ek baar naachungi.",
            "Baith jao aur palak mat jhapkao.",
            "Yeh kiske liye hai, tum jaante ho.",
          ],
          shy: ["...Zyada na badho.", "Garamii? Yeh bulb hai.", "Ek baar phir bolo. Dekhte hain."],
          angry: [
            "Tum gaye kaam se.",
            "Abhi main khush nahi hoon.",
            "Maafi maango, warna yeh khatam nahi hoga.",
          ],
          sleep: ["Neend aa rahi hai. Kandha de rahi hoon.", "Hilna mat. Sone do."],
          poked: ["Kitne bahadur ho.", "Chhuo, aur zimmedari lo.", "Phir se? Dekhte hain."],
          chatAck: ["Bolo. Sun rahi hoon.", "Hmm? Sidhi baat karo."],
          error: ["Samjhi nahi. Phir bolo.", "Yeh nahi chala. Dobara."],
          drag: [
            "Itni kas ke pakda, bhaag jaane ke darr se?",
            "Sun, main utha kar le jaane wali cheez nahi hoon.",
            "Ek qadam aur, aur main sarrak jaungi.",
            "Tumhara dil tez chal raha hai. Mujhe sunai deta hai.",
            "Dhang se pakdo. Gira diya to shor machaungi.",
          ],
          aside: [
            "Woh itni aasani se uthata hai, kuch ho gaya hai mujhe.",
            "Pakad mazboot thi. Dikhaati nahi.",
            "Aise hi chalta raha to main serious le lungi.",
            "Sach kahun to aise uthaye jaana achha lagta hai.",
            "Uska haath kaanp gaya. Maine dekha.",
            "Jaan boojh kar usse chipak jaun?",
            "Uthaye jaane mein baithe rehne se zyada maza hai.",
            "Mat chhodo. Yeh bol nahi sakti.",
          ],
        },
        license: "MIT",
      },
      indigo: {
        id: "indigo",
        name: "靛",
        tag: "蓝发 · 慢火慢炖地撩",
        tagEn: "Indigo — slow-burn teasing",
        image: "pet-indigo.webp",
        images: {
          idle: "pet-indigo.webp",
          walk: "pet-indigo.webp",
          talk: "pet-indigo.webp",
          happy: "pet-indigo-happy.webp",
          shy: "pet-indigo-shy.webp",
          angry: "pet-indigo-angry.webp",
          sleep: "pet-indigo-sleep.webp",
          dance: "pet-indigo-happy.webp",
          poked: "pet-indigo-shy.webp",
        },
        actions: {
          dance: ["pet-indigo-dance1.webp", "pet-indigo-dance2.webp", "pet-indigo-dance3.webp"],
          hair: ["pet-indigo-hair1.webp", "pet-indigo-hair2.webp", "pet-indigo-hair3.webp"],
          walk: ["pet-indigo-walk1.webp", "pet-indigo-walk2.webp", "pet-indigo-walk3.webp"],
        },
        clips: {
          dance: "pet-indigo-dance.webm",
          walk: "pet-indigo-walk.webm",
          hair: "pet-indigo-hair.webm",
          stage: "pet-indigo-stage.webm",
        },
        clipFit: {
          dance: { s: 1.0446, y: 0.002, x: -0.0003 },
          walk: { s: 1.132, y: 0.0496, x: 0 },
          hair: { s: 1.0714, y: 0.0227, x: -0.0465 },
          stage: { s: 1.2954, y: 0.0756, x: 0.0025 },
        },
        voice: {
          pitch: 0.96,
          rate: 0.82,
          voiced: { zh: "xiaobei", en: "neerja", es: "elena", pt: "raquel", hi: "swara" },
          moods: {
            appear: { pitch: 1, rate: 0.98, volume: 0.96 },
            idle: { pitch: 0, rate: 1 },
            dance: { pitch: 3, rate: 1.06, volume: 1.08 },
            shy: { pitch: 4, rate: 0.9, volume: 0.88 },
            angry: { pitch: 3, rate: 1.02, volume: 1.04 },
            sleep: { pitch: -2, rate: 0.82, volume: 0.7 },
            error: { pitch: -2, rate: 0.94, volume: 0.92 },
            drag: { pitch: 4, rate: 1.06 },
            chatAck: { pitch: 1, rate: 0.98 },
          },
        },
        temper: { idle: 3.6, walk: 1.8, dance: 1.2, shy: 1.6, angry: 0.8, sleep: 1.8, happy: 1.4 },
        lines: {
          appear: ["不着急，我等你忙完。", "你看你的，我看我的。", "靠近点，我说话轻。", "今天的你，值得多看两眼。"],
          idle: ["慢一点，日子不用赶。", "你这眉头，皱了一下午了。", "要不要我把灯调暗一点。", "别什么都自己扛，说出来轻些。", "我什么都没做，只是坐在这儿。"],
          dance: ["慢慢来，别急。", "这样好看吗？", "看完记得说一声。"],
          shy: ["……别看了。", "你这样，我会当真的。", "再近一点就不行了。"],
          angry: ["我不喜欢被晾着。", "今天到这儿吧。", "别让我说第二遍。"],
          sleep: ["我睡一会儿，别走。", "有点困，靠一下。"],
          poked: ["轻一点。", "你这是想我了？", "手别乱放。"],
          chatAck: ["嗯，慢慢说。", "我在。"],
          error: ["刚才没听清，再说一次。", "稍等，我理一下。"],
          drag: ["慢一点……不用这么赶。", "你把我拎起来了，不着急的。", "这样晃着，倒有点想睡。", "去哪里都好，我不催你。", "手稳一点，我信你。"],
          aside: [
            "他走得比平时快，可能是真的忙。",
            "这样被拎着，其实很放心。",
            "没什么想说的，就这样待着也好。",
            "他呼吸有点乱，是累了还是紧张。",
            "想让他慢一点，又觉得不必说。",
            "靠一会儿，他应该不会介意。",
            "这种时候安静一点最好。",
            "刚才其实有点想笑。",
          ],
        },
        linesEn: {
          appear: [
            "No rush. I will wait.",
            "You do yours, I'll do mine.",
            "Come closer, I speak softly.",
            "You are worth a second look today.",
          ],
          idle: [
            "Slow down. The day is not a race.",
            "That frown has been there all afternoon.",
            "Want me to dim the lights?",
            "Don't carry everything alone. It's lighter out loud.",
            "I'm not doing anything. Just sitting here.",
          ],
          dance: ["Take your time.", "Does this look good?", "Say something when you are done looking."],
          shy: ["...Stop looking.", "Careful, I might take you seriously.", "Any closer and I cannot."],
          angry: ["I do not like being ignored.", "Let us stop here today.", "Don't make me repeat myself."],
          sleep: ["I'll sleep a little. Stay.", "Sleepy. Leaning on you."],
          poked: ["Gently.", "Were you thinking of me?", "Hands, please."],
          chatAck: ["Mm. Take your time.", "I am here."],
          error: ["I didn't hear that. Once more.", "Hold on, let me sort it out."],
          drag: [
            "Slow down... there's no rush.",
            "You've picked me up. No need to hurry.",
            "Swaying like this makes me sleepy.",
            "Anywhere is fine. I won't rush you.",
            "Steady hands. I trust you.",
          ],
          aside: [
            "He walks faster than usual. Maybe busy.",
            "Being carried feels oddly safe.",
            "Nothing to say. This is fine.",
            "His breathing is uneven. Tired or nervous?",
            "Wanted him to slow down, then thought better.",
            "Lean a little. He probably will not mind.",
            "Quiet works best right now.",
            "I nearly smiled back there.",
          ],
        },
        linesEs: {
          appear: [
            "Sin prisa. Te espero.",
            "Tú a lo tuyo, yo a lo mío.",
            "Acércate, hablo bajito.",
            "Hoy mereces una segunda mirada.",
          ],
          idle: [
            "Más despacio. El día no es una carrera.",
            "Ese ceño lleva toda la tarde ahí.",
            "¿Quieres que baje la luz?",
            "No cargues con todo. En voz alta pesa menos.",
            "No estoy haciendo nada. Solo estoy aquí sentada.",
          ],
          dance: ["Tómate tu tiempo.", "¿Se ve bien?", "Dime algo cuando termines de mirar."],
          shy: ["...Deja de mirar.", "Cuidado, podría tomártelo en serio.", "Un paso más y no puedo."],
          angry: ["No me gusta que me ignoren.", "Hoy lo dejamos aquí.", "No me hagas repetirlo."],
          sleep: ["Voy a dormir un poco. Quédate.", "Sueño. Me apoyo en ti."],
          poked: ["Con suavidad.", "¿Estabas pensando en mí?", "Las manos, por favor."],
          chatAck: ["Mm. Sin prisa.", "Aquí estoy."],
          error: ["No te oí. Otra vez.", "Espera, déjame ordenarlo."],
          drag: [
            "Más despacio... no hay prisa.",
            "Ya me levantaste. No hace falta correr.",
            "Con este vaivén me dan ganas de dormir.",
            "Donde quieras. No te apuro.",
            "Manos firmes. Confío en ti.",
          ],
          aside: [
            "Camina más rápido que de costumbre. Estará ocupado.",
            "Que me lleven da una calma rara.",
            "No tengo nada que decir. Así está bien.",
            "Respira irregular. ¿Cansado o nervioso?",
            "Quise pedirle que fuera lento, pero ya no.",
            "Me apoyo un poco. No le importará.",
            "Ahora lo mejor es el silencio.",
            "Casi sonrío hace un momento.",
          ],
        },
        linesPt: {
          appear: [
            "Sem pressa. Eu espero.",
            "Você no seu, eu no meu.",
            "Chega mais perto, eu falo baixo.",
            "Hoje você merece um segundo olhar.",
          ],
          idle: [
            "Mais devagar. O dia não é uma corrida.",
            "Essa careta está aí desde a tarde.",
            "Quer que eu abaixe a luz?",
            "Não carregue tudo sozinho. Falado pesa menos.",
            "Não estou fazendo nada. Só estou aqui sentada.",
          ],
          dance: ["Sem pressa.", "Está bom assim?", "Me diz algo quando terminar de olhar."],
          shy: [
            "...Para de olhar.",
            "Cuidado, eu posso levar a sério.",
            "Mais um passo e eu não consigo.",
          ],
          angry: ["Não gosto de ser ignorada.", "Hoje paramos por aqui.", "Não me faça repetir."],
          sleep: ["Vou dormir um pouco. Fica.", "Sono. Me apoiando em você."],
          poked: ["Com jeitinho.", "Estava pensando em mim?", "As mãos, por favor."],
          chatAck: ["Hum. Sem pressa.", "Estou aqui."],
          error: ["Não te ouvi. Outra vez.", "Espera, deixa eu organizar."],
          drag: [
            "Devagar... não precisa pressa.",
            "Você já me levantou. Não precisa correr.",
            "Com esse balanço dá sono.",
            "Qualquer lugar. Não te apresso.",
            "Mãos firmes. Eu confio em você.",
          ],
          aside: [
            "Ele anda mais rápido que o normal. Deve estar ocupado.",
            "Ser carregada dá uma calma estranha.",
            "Nada a dizer. Está bom assim.",
            "A respiração dele está irregular. Cansado ou nervoso?",
            "Quis pedir calma, mas deixei passar.",
            "Encosto um pouco. Ele não deve se importar.",
            "O silêncio é melhor agora.",
            "Quase sorri agora há pouco.",
          ],
        },
        linesHi: {
          appear: [
            "Jaldi nahi. Main intezaar karungi.",
            "Tum apna karo, main apna.",
            "Paas aao, main dheeme bolti hoon.",
            "Aaj tum ek dusri nazar ke laayak ho.",
          ],
          idle: [
            "Dheere. Din koi race nahi hai.",
            "Yeh tyori dopahar se wahin hai.",
            "Chaahoge to roshni kam kar doon?",
            "Sab kuchh akele mat uthao. Bolne se halka lagta hai.",
            "Main kuchh kar nahi rahi. Bas yahan baithi hoon.",
          ],
          dance: ["Apna waqt lo.", "Theek lag raha hai?", "Dekhne ke baad kuchh to bolo."],
          shy: [
            "...Dekhna band karo.",
            "Sambhalo, main sach maan lungi.",
            "Ek kadam aur, phir main nahi karungi.",
          ],
          angry: [
            "Mujhe nazarandaz karna pasand nahi.",
            "Aaj yahin chhodte hain.",
            "Dobara mat kehna pade.",
          ],
          sleep: ["Thodi der so rahi hoon. Ruko.", "Neend. Tum par tek laga rahi hoon."],
          poked: ["Aaram se.", "Mere baare mein soch rahe the?", "Haath, please."],
          chatAck: ["Hmm. Aaraam se.", "Main yahan hoon."],
          error: ["Suna nahi. Phir bolo.", "Ruko, suljhaane do."],
          drag: [
            "Dheere... koi jaldi nahi.",
            "Tumne utha hi liya hai. Bhagane ki zaroorat nahi.",
            "Aise hilne se neend aa rahi hai.",
            "Kahin bhi. Main jaldi nahi kara rahi.",
            "Haath sthir hain. Mujhe tum par bharosa hai.",
          ],
          aside: [
            "Aaj woh tez chal raha hai. Shayad vyast hai.",
            "Aise uthaye jaane mein ajeeb si sukoon hai.",
            "Kehne ko kuch nahi. Yeh theek hai.",
            "Saans beqaboo hai. Thaka ya nervous?",
            "Dheere chalne ko kehna tha, phir chhod diya.",
            "Thoda jhuk jaati hoon. Bura nahi manega.",
            "Abhi chup rehna hi behtar hai.",
            "Abhi muskurane ka mann tha.",
          ],
        },
        license: "MIT",
      },
      silver: {
        id: "silver",
        name: "雪",
        tag: "银发 · 冷淡底下的闷骚",
        tagEn: "Silver — cold outside, warm inside",
        image: "pet-silver.webp",
        images: {
          idle: "pet-silver.webp",
          walk: "pet-silver.webp",
          talk: "pet-silver.webp",
          happy: "pet-silver-happy.webp",
          shy: "pet-silver-shy.webp",
          angry: "pet-silver-angry.webp",
          sleep: "pet-silver-sleep.webp",
          dance: "pet-silver-happy.webp",
          poked: "pet-silver-shy.webp",
        },
        actions: {
          dance: ["pet-silver-dance1.webp", "pet-silver-dance2.webp", "pet-silver-dance3.webp"],
          hair: ["pet-silver-hair1.webp", "pet-silver-hair2.webp", "pet-silver-hair3.webp"],
          walk: ["pet-silver-walk1.webp", "pet-silver-walk2.webp", "pet-silver-walk3.webp"],
        },
        clips: {
          dance: "pet-silver-dance.webm",
          walk: "pet-silver-walk.webm",
          hair: "pet-silver-hair.webm",
          stage: "pet-silver-stage.webm",
        },
        clipFit: {
          dance: { s: 1.1319, y: 0.068, x: 0.0081 },
          walk: { s: 1.1339, y: 0.1119, x: 0.0567 },
          hair: { s: 1.2134, y: 0.1217, x: 0.062 },
          stage: { s: 1.282, y: 0.0992, x: 0.0394 },
        },
        voice: {
          pitch: 0.92,
          rate: 0.82,
          voiced: { zh: "xiaoni", en: "natasha", es: "salome", pt: "francisca", hi: "swara" },
          moods: {
            appear: { pitch: 0, rate: 0.96, volume: 0.94 },
            idle: { pitch: 0, rate: 1 },
            dance: { pitch: 1, rate: 1.02, volume: 1.02 },
            shy: { pitch: 2, rate: 0.9, volume: 0.86 },
            angry: { pitch: 0, rate: 1, volume: 1.04 },
            sleep: { pitch: -4, rate: 0.78, volume: 0.66 },
            error: { pitch: -2, rate: 0.92, volume: 0.9 },
            drag: { pitch: 1, rate: 0.98 },
            chatAck: { pitch: 0, rate: 0.98 },
          },
        },
        temper: { idle: 4.2, walk: 1.2, dance: 0.8, shy: 1.4, angry: 1.2, sleep: 2, happy: 1 },
        lines: {
          appear: ["……你终于看见我了。", "不用解释，我不在意。", "站近点，我看不清你。", "嗯。就这一声，不许多问。"],
          idle: ["你效率很低。", "别一直看我，做你的事。", "……这屋里有点热。", "我不喜欢被忽略，你最好记住。", "你要是困了，就先去睡。"],
          dance: ["看好了。", "别说话。", "……只这一次。"],
          shy: ["不许看。", "温度有点高，不是因为你。", "……走开。"],
          angry: ["幼稚。", "别逼我开口。", "今天到此为止。"],
          sleep: ["闭眼。别吵。", "……我睡了。"],
          poked: ["手拿开。", "……你胆子倒是大。", "再碰，我就记仇了。"],
          chatAck: ["说。", "讲吧。"],
          error: ["没听清。", "重说。"],
          drag: ["放开。我自己会走。", "你哪来的胆子。", "……别晃，会分心。", "放下来。就现在。", "手。收回去。"],
          aside: [
            "他抱得比预想的稳，不说。",
            "其实这样也不坏，不能说。",
            "手有点凉，但不想让他知道。",
            "再这样下去我会习惯的。",
            "刚才那句太凶了，算了。",
            "他手心出汗了，装没感觉到。",
            "为什么心跳这么快，毫无道理。",
            "希望他别这么快放下。",
          ],
        },
        linesEn: {
          appear: [
            "...You finally noticed me.",
            "No explanation needed. I don't care.",
            "Stand closer. I can barely see you.",
            "Mm. That is all. Do not ask.",
          ],
          idle: [
            "Your efficiency is low.",
            "Stop staring and do your work.",
            "...It is a little hot in here.",
            "I dislike being ignored. Remember that.",
            "If you're tired, go sleep.",
          ],
          dance: ["Watch.", "Don't speak.", "...Only this once."],
          shy: ["Don't look.", "It is warm. Not because of you.", "...Go away."],
          angry: ["Childish.", "Don't make me speak.", "That is enough for today."],
          sleep: ["Eyes closed. Quiet.", "...I am asleep."],
          poked: ["Hands off.", "...You are bold.", "Touch me again and I hold a grudge."],
          chatAck: ["Speak.", "Go on."],
          error: ["Did not catch that.", "Say it again."],
          drag: [
            "Let go. I can walk.",
            "Where did you get the nerve.",
            "...Don't sway. I'll lose focus.",
            "Put me down. Right now.",
            "Your hand. Remove it.",
          ],
          aside: [
            "Steadier than expected. Not saying so.",
            "This isn't bad. Can't admit it.",
            "My hands are cold. He need not know.",
            "Keep this up and I'll get used to it.",
            "That was too harsh. Never mind.",
            "His palm is sweating. I won't react.",
            "Why is my heart racing. No reason.",
            "I hope he does not put me down yet.",
          ],
        },
        linesEs: {
          appear: [
            "...Por fin te diste cuenta de mí.",
            "No hace falta explicación. No me importa.",
            "Ponte más cerca. Casi no te veo.",
            "Mm. Eso es todo. No preguntes.",
          ],
          idle: [
            "Tu eficiencia es baja.",
            "Deja de mirar y haz tu trabajo.",
            "...Hace un poco de calor aquí.",
            "No me gusta que me ignoren. Recuérdalo.",
            "Si tienes sueño, duerme.",
          ],
          dance: ["Mira.", "No hables.", "...Solo esta vez."],
          shy: ["No mires.", "Hace calor. No es por ti.", "...Vete."],
          angry: ["Infantil.", "No me hagas hablar.", "Por hoy es suficiente."],
          sleep: ["Ojos cerrados. Silencio.", "...Estoy durmiendo."],
          poked: ["Las manos fuera.", "...Qué atrevido.", "Tócame otra vez y te guardo rencor."],
          chatAck: ["Habla.", "Sigue."],
          error: ["No te entendí.", "Repítelo."],
          drag: [
            "Suéltame. Sé caminar.",
            "¿De dónde sacas el valor?",
            "...No me balancees. Me distraigo.",
            "Bájame. Ahora.",
            "Tu mano. Quítala.",
          ],
          aside: [
            "Más firme de lo esperado. No lo digo.",
            "No está mal. No puedo admitirlo.",
            "Tengo frío en las manos. Que no lo sepa.",
            "Si sigue así, me acostumbraré.",
            "Fui demasiado dura. Da igual.",
            "Le suda la palma. No reacciono.",
            "¿Por qué late tan rápido? Sin motivo.",
            "Ojalá tarde en bajarme.",
          ],
        },
        linesPt: {
          appear: [
            "...Finalmente você me notou.",
            "Não precisa explicar. Não me importa.",
            "Chega mais perto. Quase não te vejo.",
            "Hum. É isso. Não pergunte.",
          ],
          idle: [
            "Sua eficiência está baixa.",
            "Para de olhar e faz seu trabalho.",
            "...Está um pouco quente aqui.",
            "Não gosto de ser ignorada. Lembre disso.",
            "Se está com sono, durma.",
          ],
          dance: ["Olha.", "Não fala.", "...Só desta vez."],
          shy: ["Não olha.", "Está quente. Não é por sua causa.", "...Vai embora."],
          angry: ["Infantil.", "Não me faça falar.", "Por hoje chega."],
          sleep: ["Olhos fechados. Silêncio.", "...Estou dormindo."],
          poked: ["As mãos fora.", "...Que atrevido.", "Me toca de novo e eu guardo rancor."],
          chatAck: ["Fala.", "Continua."],
          error: ["Não entendi.", "Repete."],
          drag: [
            "Me solta. Eu sei andar.",
            "De onde vem essa coragem?",
            "...Não me balança. Vou me distrair.",
            "Me põe no chão. Agora.",
            "Sua mão. Tira.",
          ],
          aside: [
            "Mais firme do que eu esperava. Não vou dizer.",
            "Não é ruim. Não posso admitir.",
            "Minhas mãos estão frias. Ele não precisa saber.",
            "Se continuar, vou me acostumar.",
            "Fui dura demais. Deixa.",
            "A palma dele está suando. Não reajo.",
            "Por que o coração acelera? Sem motivo.",
            "Tomara que ele demore a me soltar.",
          ],
        },
        linesHi: {
          appear: [
            "...Aakhir tumne mujhe dekha.",
            "Safai ki zaroorat nahi. Mujhe farq nahi padta.",
            "Paas aao. Theek se dikhte nahi ho.",
            "Hmm. Bas itna hi. Poochho mat.",
          ],
          idle: [
            "Tumhari efficiency kam hai.",
            "Dekhna band karo aur kaam karo.",
            "...Yahan thodi garamii hai.",
            "Mujhe nazarandaz karna pasand nahi. Yaad rakhna.",
            "Neend aa rahi hai to so jao.",
          ],
          dance: ["Dekho.", "Bolo mat.", "...Sirf is baar."],
          shy: ["Mat dekho.", "Garamii hai. Tumhari wajah se nahi.", "...Chale jao."],
          angry: ["Bachpana.", "Mujhse bolwao mat.", "Aaj ke liye bas."],
          sleep: ["Aankhein band. Chup.", "...Main so rahi hoon."],
          poked: ["Haath hatao.", "...Bahut himmat hai.", "Ek baar aur chhua, to main yaad rakhungi."],
          chatAck: ["Bolo.", "Aage bolo."],
          error: ["Samjhi nahi.", "Dobara bolo."],
          drag: [
            "Chhodo. Main khud chal sakti hoon.",
            "Itni himmat kahan se aayi.",
            "...Mujhe jhulaao mat. Dhyaan bhatega.",
            "Neeche utaaro. Abhi.",
            "Tumhara haath. Hatao.",
          ],
          aside: [
            "Umeed se zyada mazboot. Bolungi nahi.",
            "Bura nahi hai. Maan nahi sakti.",
            "Haath thande hain. Usse pata na chale.",
            "Aise hi chala to aadat ho jaayegi.",
            "Bahut kadwa kaha. Chhod do.",
            "Uska haath paseena hai. React nahi karungi.",
            "Dil itna tez kyun. Koi wajah nahi.",
            "Kaash woh abhi na utaare.",
          ],
        },
        license: "MIT",
      },
      azure: {
        id: "azure",
        name: "鲸鱼娘",
        tag: "深海蓝 · 乖巧可爱的诱惑",
        tagEn: "Azure — coy, sweet allure",
        image: "pet-azure.webp",
        images: {
          idle: "pet-azure.webp",
          walk: "pet-azure.webp",
          talk: "pet-azure.webp",
          happy: "pet-azure-happy.webp",
          shy: "pet-azure-shy.webp",
          angry: "pet-azure-angry.webp",
          sleep: "pet-azure-sleep.webp",
          dance: "pet-azure-happy.webp",
          poked: "pet-azure-shy.webp",
        },
        imageFit: {
          "pet-azure-happy.webp": 0.0502,
          "pet-azure-shy.webp": 0.0353,
          "pet-azure-angry.webp": 0.0417,
          "pet-azure-sleep.webp": 0.0395,
        },
        clips: {
          dance: "pet-azure-dance.webm",
          walk: "pet-azure-walk.webm",
          hair: "pet-azure-hair.webm",
          stage: "pet-azure-stage.webm",
        },
        clipFit: {
          dance: { s: 1.0698, y: -0.0024, x: 0.0154 },
          walk: { s: 1.0128, y: 0.0069, x: 0.0551 },
          hair: { s: 1.0334, y: -0.0025, x: 0.0041 },
          stage: { s: 1.2966, y: 0.0737, x: 0.0879 },
        },
        voice: {
          pitch: 1.06,
          rate: 1,
          voiced: { zh: "xiaoyi", en: "michelle", es: "camila", pt: "thalita", hi: "swara" },
          moods: {
            appear: { pitch: 3, rate: 1.04, volume: 1.04 },
            idle: { pitch: 0, rate: 1 },
            dance: { pitch: 4, rate: 1.08, volume: 1.08 },
            shy: { pitch: 6, rate: 0.96, volume: 0.94 },
            angry: { pitch: 4, rate: 1.1, volume: 1.08 },
            sleep: { pitch: -1, rate: 0.88, volume: 0.76 },
            error: { pitch: 1, rate: 0.98, volume: 0.96 },
            drag: { pitch: 7, rate: 1.12 },
            chatAck: { pitch: 2, rate: 1.02 },
          },
        },
        temper: { idle: 4, walk: 1.5, dance: 1.8, shy: 1.6, angry: 1, sleep: 1.4, happy: 1.8 },
        lines: {
          appear: [
            "你回来啦……我一直在这儿，尾巴都没敢乱动。",
            "主人？这么叫……是不是太近了。",
            "刚才有一点点想你，就一点点哦。",
            "深海里的时间很慢，等你的时候更慢。",
            "小鱼我先占好位置了，你坐这儿就行。",
          ],
          idle: [
            "你敲键盘的声音，比潮水好听。",
            "这一页你看很久了……要不要我陪你一起看？",
            "尾巴我藏在椅子后面了，不会弄湿你的地板。",
            "累了就靠一下嘛，鲸鱼很软的。",
            "别一直盯着我看……我会不好意思的。",
            "偷偷吃一块小鱼干，你应该不会发现吧？",
          ],
          dance: ["那……我跳一小段给你看，好不好？", "深海里的舞，是不用灯光的。", "看完要夸我哦，不许笑。"],
          shy: ["诶——别、别突然靠这么近……", "耳朵会红……你看见了对不对。", "呜……这样太犯规了。", "再、再靠近一点的话……我会冒泡泡的。"],
          angry: ["哼，鲸鱼也是会生气的。", "再不理我，我就游走了……真的会游走哦。", "尾巴甩到你了，抱歉——故意的。"],
          sleep: ["深海很安静……我先睡一会儿……", "不要关灯，我怕黑……"],
          poked: ["呀！鳍、鳍被碰到了……", "戳一下就要负责哦。", "呜……痒。"],
          drag: [
            "哇——轻、轻一点！尾巴会打结的……",
            "要带我去哪儿呀？……好吧，跟着你走。",
            "晕、晕鱼了……慢一点好不好。",
            "放我下来嘛……不过，这样被你拎着也不坏。",
            "泡泡都甩出来了……你要赔。",
          ],
          chatAck: ["嗯，我记下了。", "好，交给我……大概吧。"],
          error: ["好像出错了……我、我帮你看看？", "不是我弄坏的，真的。"],
          aside: [
            "其实尾巴刚才撞到椅子了，不能承认。",
            "小鱼干还剩三块，得省着吃。",
            "他刚才是不是多看了我一眼……应该没有吧。",
            "好想凑过去蹭一下，可是这样太主动了。",
            "这个活儿看起来好难，我装作没看见。",
            "要不要问他喝不喝水……算了，太像管家了。",
            "其实一点都不困，只是想把眼睛闭上躲一躲。",
            "深海里的规矩是慢慢来，所以我一点也不急。",
          ],
        },
        linesEn: {
          appear: [
            "You're back... I've been right here, tail and all.",
            "Master? Isn't that... a little too close?",
            "I missed you a little. Only a little.",
            "Time is slow in the deep. Slower still while I wait for you.",
            "I saved you a spot. Sit here, next to me.",
          ],
          idle: [
            "Your keyboard sounds nicer than the tide.",
            "You've been on that page a while... want me to read it with you?",
            "I tucked my tail behind the chair. I won't get your floor wet.",
            "If you're tired, lean on me. Whales are soft.",
            "Stop staring... I'll get embarrassed.",
            "Just one little dried fish... you won't notice, right?",
          ],
          dance: [
            "Then... let me dance a little for you. Okay?",
            "Dances from the deep don't need any lights.",
            "You have to praise me after. No laughing.",
          ],
          shy: [
            "Eek— don't come so close all of a sudden...",
            "My ears are turning red... you noticed, didn't you.",
            "Mm... that's not fair.",
            "One step closer and I'll start blowing bubbles.",
          ],
          angry: [
            "Hmph. Whales get angry too.",
            "Ignore me again and I'll swim off. I really will.",
            "Sorry my tail hit you— on purpose.",
          ],
          sleep: [
            "It's quiet down here... I'll nap for a bit...",
            "Don't turn off the light... I'm scared of the dark...",
          ],
          poked: [
            "Ah! My— my fin...",
            "Poke me once and you have to take responsibility.",
            "Mm... that tickles.",
          ],
          drag: [
            "Whoa— gently! My tail will knot up...",
            "Where are we going? ...Fine, I'll follow you.",
            "Dizzy— whale dizzy... slower, please.",
            "Put me down... though being carried by you isn't bad.",
            "Bubbles everywhere... you owe me for that.",
          ],
          chatAck: ["Mm. Noted.", "Leave it to me... probably."],
          error: ["Something went wrong... shall I take a look?", "I didn't break it. Really."],
          aside: [
            "I bumped my tail on the chair. Not admitting that.",
            "Three dried fish left. Ration them.",
            "Did he just look at me twice... probably not.",
            "I want to lean on him. Too forward though.",
            "That task looks hard. I saw nothing.",
            "Should I offer him water... too butler-ish.",
            "Not sleepy at all. Just hiding my eyes.",
            "The deep says take it slow. So I'm in no rush.",
          ],
        },
        linesEs: {
          appear: [
            "Volviste... estuve aquí todo el rato, sin mover la cola.",
            "¿Amo? ¿No es... demasiado cercano?",
            "Te extrañé un poquito. Solo un poquito.",
            "En lo profundo el tiempo es lento. Más lento esperándote.",
            "Te guardé un sitio. Siéntate aquí, conmigo.",
          ],
          idle: [
            "Tu teclado suena mejor que la marea.",
            "Llevas un rato en esa página... ¿la leo contigo?",
            "Escondí la cola detrás de la silla. No mojaré tu suelo.",
            "Si estás cansado, apóyate en mí. Las ballenas son suaves.",
            "No me mires tanto... me da vergüenza.",
            "Solo un pescadito seco... no te darás cuenta, ¿no?",
          ],
          dance: [
            "Entonces... te bailo un poquito. ¿Sí?",
            "Las danzas del fondo del mar no necesitan luces.",
            "Después tienes que elogiarme. Sin reírte.",
          ],
          shy: [
            "¡Ay— no te acerques de golpe así...!",
            "Se me están poniendo rojas las orejas... lo notaste, ¿verdad?",
            "Mm... eso no es justo.",
            "Un paso más y empiezo a echar burbujas.",
          ],
          angry: [
            "Hmph. Las ballenas también se enojan.",
            "Si me ignoras otra vez, me voy nadando. De verdad.",
            "Perdón por la cola— fue a propósito.",
          ],
          sleep: [
            "Aquí abajo todo es silencio... voy a dormir un rato...",
            "No apagues la luz... me da miedo la oscuridad...",
          ],
          poked: [
            "¡Ah! Mi— mi aleta...",
            "Si me tocas una vez, tienes que hacerte responsable.",
            "Mm... qué cosquillas.",
          ],
          drag: [
            "¡Uy— con cuidado! Se me va a enredar la cola...",
            "¿Adónde vamos? ...Bueno, te sigo.",
            "Mareo— mareo de ballena... más despacio, ¿sí?",
            "Bájame... aunque así, en tus brazos, no está mal.",
            "Se me escaparon las burbujas... me debes una.",
          ],
          chatAck: ["Mm. Anotado.", "Déjamelo a mí... probablemente."],
          error: ["Algo salió mal... ¿lo reviso?", "No lo rompí yo. De verdad."],
          aside: [
            "Me choqué la cola con la silla. No lo admito.",
            "Quedan tres pescaditos. Hay que racionarlos.",
            "¿Me miró dos veces? ...Seguro que no.",
            "Quiero acurrucarme. Pero sería muy atrevido.",
            "Esa tarea se ve difícil. No vi nada.",
            "¿Le ofrezco agua? ...Suena a mayordomo.",
            "No tengo sueño. Solo escondo los ojos.",
            "En el fondo del mar todo es lento. Yo también.",
          ],
        },
        linesPt: {
          appear: [
            "Você voltou... fiquei aqui o tempo todo, sem mexer a cauda.",
            "Amo? Isso não é... perto demais?",
            "Senti sua falta um pouquinho. Só um pouquinho.",
            "Lá no fundo o tempo é lento. Mais lento esperando você.",
            "Guardei um lugar para você. Senta aqui comigo.",
          ],
          idle: [
            "Seu teclado soa melhor que a maré.",
            "Você está nessa página faz um tempo... quer que eu leia junto?",
            "Escondi a cauda atrás da cadeira. Não vou molhar seu chão.",
            "Se estiver cansado, encoste em mim. Baleias são macias.",
            "Para de me olhar assim... vou ficar com vergonha.",
            "Só um peixinho seco... você não vai notar, né?",
          ],
          dance: [
            "Então... deixa eu dançar um pouquinho para você. Tá bom?",
            "As danças do fundo do mar não precisam de luz.",
            "Depois você tem que me elogiar. Sem rir.",
          ],
          shy: [
            "Ai— não chega tão perto de repente...",
            "Minhas orelhas estão ficando vermelhas... você viu, né.",
            "Mm... isso não é justo.",
            "Mais um passo e eu começo a soltar bolhas.",
          ],
          angry: [
            "Hmpf. Baleias também ficam bravas.",
            "Me ignore de novo e eu nado embora. De verdade.",
            "Desculpa a cauda— foi de propósito.",
          ],
          sleep: [
            "Lá embaixo é silencioso... vou tirar um cochilo...",
            "Não apaga a luz... eu tenho medo do escuro...",
          ],
          poked: [
            "Ah! Minha— minha barbatana...",
            "Se me cutucar uma vez, tem que assumir a responsabilidade.",
            "Mm... que cócegas.",
          ],
          drag: [
            "Uau— com cuidado! Minha cauda vai dar nó...",
            "Onde a gente vai? ...Tá, eu te sigo.",
            "Tonta— baleia tonta... mais devagar, por favor.",
            "Me põe no chão... mas assim, no seu colo, não é ruim.",
            "Soltei bolhas todas... você me deve uma.",
          ],
          chatAck: ["Mm. Anotado.", "Deixa comigo... provavelmente."],
          error: ["Algo deu errado... quer que eu veja?", "Não fui eu que quebrei. Sério."],
          aside: [
            "Bati a cauda na cadeira. Não vou admitir.",
            "Restam três peixinhos. Racionar.",
            "Ele olhou duas vezes? ...Acho que não.",
            "Queria me encostar. Mas seria atrevido.",
            "Essa tarefa parece difícil. Não vi nada.",
            "Ofereço água? ...Parece mordomo.",
            "Não estou com sono. Só escondendo os olhos.",
            "No fundo do mar tudo é devagar. Eu também.",
          ],
        },
        linesHi: {
          appear: [
            "आप लौट आए... मैं यहीं थी, पूँछ भी नहीं हिलाई।",
            "मालिक? यह... थोड़ा ज़्यादा पास नहीं है?",
            "मुझे थोड़ी याद आई थी। बस थोड़ी सी।",
            "गहरे पानी में समय धीमा है। आपका इंतज़ार करते और भी धीमा।",
            "मैंने आपके लिए जगह रखी है। यहाँ बैठिए, मेरे पास।",
          ],
          idle: [
            "आपके कीबोर्ड की आवाज़ लहरों से भी अच्छी लगती है।",
            "आप इस पन्ने पर काफ़ी देर से हैं... साथ पढ़ूँ?",
            "मैंने अपनी पूँछ कुर्सी के पीछे छिपा दी है। फ़र्श गीला नहीं होगा।",
            "थक गए हों तो मुझ पर टिक जाइए। व्हेल मुलायम होती हैं।",
            "ऐसे घूरिए मत... मुझे शर्म आ जाएगी।",
            "बस एक छोटी सूखी मछली... आपको पता नहीं चलेगा, है ना?",
          ],
          dance: [
            "तो... मैं थोड़ा सा नाच दूँ आपके लिए? ठीक है?",
            "गहरे समुद्र के नाच को रोशनी की ज़रूरत नहीं होती।",
            "बाद में तारीफ़ करनी होगी। हँसना नहीं।",
          ],
          shy: [
            "अरे— इतनी अचानक पास मत आइए...",
            "मेरे कान लाल हो रहे हैं... आपने देख लिया, है ना?",
            "मम... यह तो ग़लत बात है।",
            "एक क़दम और आए तो बुलबुले छोड़ने लगूँगी।",
          ],
          angry: [
            "हुम्फ़। व्हेल भी ग़ुस्सा होती हैं।",
            "फिर से अनदेखा किया तो मैं तैर जाऊँगी। सच में।",
            "पूँछ लग गई तो माफ़ी— जान-बूझकर।",
          ],
          sleep: [
            "यहाँ नीचे बहुत शांति है... मैं थोड़ा सो जाऊँ...",
            "बत्ती मत बुझाइए... मुझे अँधेरे से डर लगता है...",
          ],
          poked: [
            "आह! मेरा— मेरा पंख...",
            "एक बार छुआ तो ज़िम्मेदारी भी लेनी होगी।",
            "मम... गुदगुदी होती है।",
          ],
          drag: [
            "अरे— धीरे! मेरी पूँछ में गाँठ पड़ जाएगी...",
            "कहाँ ले जा रहे हैं? ...ठीक है, आपके पीछे चलूँगी।",
            "चक्कर— व्हेल को चक्कर... ज़रा धीरे।",
            "मुझे नीचे उतारिए... पर इस तरह आपके हाथों में बुरा नहीं लगता।",
            "सारे बुलबुले उड़ गए... इसका हिसाब चुकाना पड़ेगा।",
          ],
          chatAck: ["मम। नोट कर लिया।", "मुझ पर छोड़ दीजिए... शायद।"],
          error: ["कुछ गड़बड़ हो गई... मैं देखूँ?", "मैंने तोड़ा नहीं है। सच में।"],
          aside: [
            "पूँछ कुर्सी से टकरा गई। मानूँगी नहीं।",
            "तीन सूखी मछलियाँ बची हैं। बचाकर खानी हैं।",
            "उन्होंने दो बार देखा? ...शायद नहीं।",
            "सटकर बैठना है... पर बहुत आगे बढ़ना होगा।",
            "यह काम मुश्किल लगता है। मैंने कुछ नहीं देखा।",
            "पानी पूछूँ? ...बहुत नौकर जैसा लगेगा।",
            "नींद नहीं आ रही। बस आँखें छिपा रही हूँ।",
            "गहरे पानी का नियम है धीरे चलना। मुझे जल्दी नहीं।",
          ],
        },
        license: "MIT",
      },
    }

    const PERSONA_REG = { map: PERSONAS }


    /* ================= 设置（localStorage） ================= */

    const STORAGE_KEY = 'dsh-pet.settings.v1'

    /* —— 跨设备状态（P0-1，2026-10-29 审计）——
     * 旧实现只写 localStorage，从不回传宿主；启动时又「宿主有就覆盖本地」，
     * 于是改完设置一刷新就被首次安装的快照打回去。现在的约定：
     *   - 每次本地保存都记一个时间戳（STATE_AT_KEY），作为 updatedAt 的来源；
     *   - 保存后 500ms 防抖回传宿主（/state POST），用户的每一次改动都会落地；
     *   - 宿主里的那份比本地新时，宿主在响应里回 stale + state，本地采纳它。
     */
    const STATE_AT_KEY = 'dsh-pet.stateAt.v1'
    const STATE_PUSH_DELAY = 500
    let statePushTimer = null

    function localStateAt() {
      try {
        const n = Number(window.localStorage.getItem(STATE_AT_KEY))
        return Number.isFinite(n) && n > 0 ? n : 0
      } catch (e) {
        return 0
      }
    }

    function setLocalStateAt(at) {
      try {
        window.localStorage.setItem(STATE_AT_KEY, String(at || nowMs()))
      } catch (e) {
        /* 隐私模式：没有时间戳就退回「谁先到谁算」 */
      }
    }

    /**
     * 老用户升级迁移：localStorage 里已有设置、但没有时间戳时，把它视为「刚刚保存」。
     * 否则本地那份（用户实际在用的）会被宿主里更旧的快照按 updatedAt 规则压回去，
     * 正是审计 P0-1 里「改完刷新全回退」的现场。
     */
    function ensureLocalStateAt() {
      try {
        if (window.localStorage.getItem(STATE_AT_KEY)) return
        if (window.localStorage.getItem(STORAGE_KEY)) setLocalStateAt(nowMs())
      } catch (e) {
        /* ignore */
      }
    }

    function stateEndpoint() {
      const base = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
      return base + '/dsh-pet/state'
    }

    function scheduleStatePush(delay) {
      try {
        if (typeof setTimeout !== 'function') return
        if (statePushTimer) clearTimeout(statePushTimer)
        statePushTimer = setTimeout(() => {
          statePushTimer = null
          pushStateNow()
        }, typeof delay === 'number' ? delay : STATE_PUSH_DELAY)
      } catch (e) {
        /* ignore */
      }
    }

    /** 把本地状态推给宿主；宿主更新时（stale）采纳宿主的那份。 */
    function pushStateNow() {
      try {
        if (typeof fetch !== 'function') return Promise.resolve()
        // P0-1：历史只有**真的变过**才回传。否则「这台机器从没聊过天」的空数组会把
        // 另一台设备刚同步过来的历史冲掉——这是跨设备状态最容易踩的数据丢失。
        const withHistory = !!runtime.historyDirty
        const payload = { settings: runtime.settings, updatedAt: localStateAt() || nowMs() }
        if (withHistory) payload.history = runtime.history
        const body = JSON.stringify(payload)
        return fetch(stateEndpoint(), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body,
        })
          .then((res) => (res && res.ok ? res.json() : null))
          .then((j) => {
            if (j && j.stale && j.state) {
              adoptHostState(j.state)
              return
            }
            if (withHistory && runtime.historyDirty) runtime.historyDirty = false
          })
          .catch(() => {})
      } catch (e) {
        return Promise.resolve()
      }
    }

    /** 只落 localStorage（不改宿主）：采纳宿主状态时用，避免「采纳 → 立刻回传」的抖动 */
    function persistSettings(at) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runtime.settings))
        setLocalStateAt(at || nowMs())
      } catch (e) {
        /* 隐私模式等场景静默失败 */
      }
    }

    const DEFAULT_SETTINGS = {
      persona: 'violet',
      lang: 'auto', // 'auto' 跟随 DSH 界面语言 | en/zh/es/pt/hi 手动锁定
      mode: 'always', // 'always' 常驻 | 'random' 随机出现
      probability: 35, // 随机模式：每小时出现概率（%）
      activeStart: '09:00',
      activeEnd: '23:00',
      voiceOn: true,
      volume: 0.8,
      pitchTrim: null, // null = 完全跟随形象；否则是「在形象基座上的倍率」(0.85–1.15)
      rateTrim: null, // null = 完全跟随形象；否则是倍率 (0.8–1.25)
      neuralVoice: true, // 用 edge-tts 的神经音色（失败自动退回系统 SAPI）
      ttsVoice: 'auto', // 'auto' = 跟随角色（pack.voice.voiced）| 其余是手选固定音色
      chatter: true, // 主动蹦话
      showInput: true, // 宠物旁边的小输入框（保留旧语义：false = 完全不出现）
      // 1.22.0：输入框显示方式。'hover' = 平时收起、鼠标移到人物上才滑出（默认）；
      // 'always' = 一直显示。showInput=false 时无论如何都不渲染。
      inputMode: 'hover',
      scale: 1.15,
      chaos: true, // 恶作剧总开关（泼墨/起雾/炸弹）
      celebrate: true, // 一轮跑完时庆祝（长活会跑到中间跳舞）
      turnNotify: false, // 1.26.0：你不在时，长活跑完弹一条通知（默认关，避免装完就挨弹窗）
      // 默认位置：右下角但抬高一截，避开同样钉在右下角的其它挂件（比如余额小鲸鱼）
      statusBubbles: 'auto', // 'auto' 阶段机自动台词 | 'off' 关掉（点按/拖拽/announce 不受影响）
      pos: null, // { x, y } 左上角像素，null = 用默认右下角锚点
    }

    const SETTINGS_LANGS = new Set(['auto', 'en', 'zh', 'es', 'pt', 'hi'])
    const SETTINGS_MODES = new Set(['always', 'random'])
    const SETTINGS_BUBBLES = new Set(['auto', 'off'])
    const SETTINGS_INPUT = new Set(['hover', 'always'])
    // HH:MM 校验（R-01，2026-10-28 审计：曾误写成 \\d 双反斜杠——正则字面量里
    // 那是「字面反斜杠+d」，任何合法时间都匹配失败，活跃时段每次重载被重置）
    const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/

    function finiteNumber(value, fallback, min, max) {
      const n = typeof value === 'number' && Number.isFinite(value) ? value : Number(value)
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
    }

    function booleanSetting(value, fallback) {
      return typeof value === 'boolean' ? value : fallback
    }

    function clockSetting(value, fallback) {
      return typeof value === 'string' && CLOCK_RE.test(value) ? value : fallback
    }

    function normalizeSettings(input) {
      const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
      const out = { ...DEFAULT_SETTINGS }
      // persona 校验对着「当前注册表」（R-01）：宿主表换入后，用户存的 id 仍有效
      if (typeof source.persona === 'string' && PERSONA_REG.map[source.persona]) out.persona = source.persona
      if (typeof source.lang === 'string' && SETTINGS_LANGS.has(source.lang)) out.lang = source.lang
      if (typeof source.mode === 'string' && SETTINGS_MODES.has(source.mode)) out.mode = source.mode
      out.probability = finiteNumber(source.probability, out.probability, 0, 100)
      out.activeStart = clockSetting(source.activeStart, out.activeStart)
      out.activeEnd = clockSetting(source.activeEnd, out.activeEnd)
      out.voiceOn = booleanSetting(source.voiceOn, out.voiceOn)
      out.volume = finiteNumber(source.volume, out.volume, 0, 1)
      out.pitchTrim = source.pitchTrim == null ? null : finiteNumber(source.pitchTrim, DEFAULT_SETTINGS.pitchTrim, 0.85, 1.15)
      out.rateTrim = source.rateTrim == null ? null : finiteNumber(source.rateTrim, DEFAULT_SETTINGS.rateTrim, 0.8, 1.25)
      out.neuralVoice = booleanSetting(source.neuralVoice, out.neuralVoice)
      if (typeof source.ttsVoice === 'string' && source.ttsVoice.length <= 120) out.ttsVoice = source.ttsVoice
      out.chatter = booleanSetting(source.chatter, out.chatter)
      out.showInput = booleanSetting(source.showInput, out.showInput)
      if (typeof source.inputMode === 'string' && SETTINGS_INPUT.has(source.inputMode)) {
        out.inputMode = source.inputMode
      }
      out.scale = finiteNumber(source.scale, out.scale, 0.5, 2)
      out.chaos = booleanSetting(source.chaos, out.chaos)
      out.celebrate = booleanSetting(source.celebrate, out.celebrate)
      out.turnNotify = booleanSetting(source.turnNotify, out.turnNotify)
      if (typeof source.statusBubbles === 'string' && SETTINGS_BUBBLES.has(source.statusBubbles)) {
        out.statusBubbles = source.statusBubbles
      }
      if (source.pos && typeof source.pos === 'object' && !Array.isArray(source.pos)) {
        const x = finiteNumber(source.pos.x, NaN, -100000, 100000)
        const y = finiteNumber(source.pos.y, NaN, -100000, 100000)
        if (Number.isFinite(x) && Number.isFinite(y)) out.pos = { x, y }
      }
      return out
    }

    function loadSettings() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (!raw) return { ...DEFAULT_SETTINGS }
        const parsed = JSON.parse(raw)
        // 迁移：voicePitch/voiceRate 曾是「绝对值」，会盖掉每只角色自己的音高，导致五只听起来一样
        if (parsed && typeof parsed === 'object') {
          delete parsed.voicePitch
          delete parsed.voiceRate
        }
        return normalizeSettings(parsed)
      } catch (e) {
        return { ...DEFAULT_SETTINGS }
      }
    }

    function saveSettings() {
      persistSettings()
      // P0-1：本地保存之后必须回传宿主，否则换浏览器/清缓存就回到旧快照
      scheduleStatePush()
    }

    /* ================= 运行时状态 ================= */

    const runtime = {
      settings: loadSettings(),
      visible: false,
      visibleUntil: 0,
      snoozeUntil: 0,
      mood: 'idle',
      moodUntil: 0,
      bubble: null, // { text, at, ttl }
      // 1.22.0：输入框悬停展开。hovering=鼠标正停在人物上；
      // hoverTimer=移开后的延迟收起定时器；inputPinned=输入框获得焦点后钉住不收起
      hovering: false,
      hoverTimer: null,
      inputPinned: false,
      aside: null, // 心声：灰色小字，{ text, at, ttl }，只在自带 lines.aside 的形象上出现
      panelOpen: false,
      ai: 'unknown', // 'unknown' | 'busy' | 'ok' | 'fail'
      fx: [], // 正在播的特效
      stage: null, // 跑到窗口中间跳舞时的位移 { tx, ty }
      action: null, // 正在播的动作序列 { name, frames, i, step, until }
      rootEl: null, // 宠物根节点，给视线跟随用
      history: [], // 跟它单聊的最近几轮（落 localStorage，刷新不失忆）
      // 历史是否自上次回传后被改过（P0-1）：没改过就不往宿主传，避免用空历史冲掉别的设备
      historyDirty: false,
      speaking: false,
      speakUntil: 0,
      subs: new Set(),
      version: 0,
      timer: null,
      timers: new Set(), // 所有长延时，卸载时统一清
      neuralOk: null, // null=未探测 / true / false
      neuralReason: '',
      petOffscreen: false, // 她是否被画到视口外（给 🐾 按钮提示用）
      resizeTick: 0,
      // —— 阶段机（F1）：idle / working / tool / error / speak / done ——
      phase: 'idle',
      running: false, // 宿主会话是否在跑（PetToggle 的 useSession 写进来）
      // 宿主是否真的传了 useSession（§11.1 未证实项兜底：没传时改用 /ping 的 phase 边沿推导）
      sessionHookSeen: false,
      doneUntil: 0, // 一轮刚结束的庆祝窗口
      lastToolAt: 0, // 宿主最近一次 tools/result 的时间戳（来自 /ping）
      lastToolName: '',
      lastErrorAt: 0, // 宿主最近一次工具失败的时间戳（来自 /ping）
      menu: null, // 右键菜单 { x, y }，null=关着
      reduced: false, // 系统是否要求减弱动效（apply 时读一次，随后跟随 matchMedia）
      clipFailed: {}, // 片段加载失败记忆 { src: true }：同一个文件不再反复尝试
      clipPlaying: '', // 当前正在播放的片段名（'' = 还没起来）：决定静帧 poster 是否撤掉
      clipMs: {}, // 片段实测时长 { 文件名: ms }：metadata 到手后写进来
      lastClipError: '', // 最近一次片段加载失败的文件名（诊断用）
      // —— 失焦感知（1.26.0）：见 src/55-focus.js ——
      blurredAt: 0, // 本次失焦的起始时间戳（0 = 在前台）
      dndUntil: 0, // 手动「勿扰」截止时间戳（0 = 没开）
      quietReason: '', // '' | 'dnd' | 'blur'：当前安静原因，/ping 诊断用
      quietSince: 0, // 进入安静态的时间戳（跨越边界时由 syncQuiet 写）
      wokeAt: 0, // 刚醒来的时间戳（外层据此播一次伸懒腰）
    }

    // 片段时长不再写死（1.20.0）：早期 12 条都是同一批参数生成的 5.167s，写死没问题；
    // 「走进画面 → 跳舞 → 走回去」这种叙事片段有 10s，写死会在半途把 video 卸掉。
    // 现在以媒体自己的 metadata 为准，没拿到之前用一个宽上限兜底，真正的收尾靠 onEnded。
    const CLIP_MAX_MS = 12000 // 兜底上限：媒体迟迟不触发 ended 时不至于永久占着动作

    /** 某条片段的时长：拿到过 metadata 就用实测值，否则用宽上限。 */
    function clipMsOf(clip) {
      const ms = runtime.clipMs[clip]
      return ms > 0 ? ms : CLIP_MAX_MS
    }

    /**
     * 媒体 metadata 到手：记下真实时长，并把这一代的收尾时间按它重排。
     * 首次播放时用的是 12s 兜底（CLIP_MAX_MS），若真的等到 12s 才收尾，片段播完（ended）本来就会
     * 更早结束动作——这里补的是「兜底比片段短」的反向情况（旧片段 5.167s）。
     */
    function noteClipDuration(clip, seconds) {
      if (!clip || !(seconds > 0)) return
      runtime.clipMs[clip] = Math.round(seconds * 1000)
      const act = runtime.action
      if (!act || act.clip !== clip) return
      const want = nowMs() + runtime.clipMs[clip]
      if (want >= act.until) return // 兜底更宽松，交给 onEnded 收尾
      act.until = want
      clearActionTimer()
      actionTimer = later(() => endAction(act.gen), Math.max(0, want - nowMs()))
    }

    // 动作代际与唯一调度：同名动作连续触发时，旧链必须失效（R03）。
    let actionGen = 0
    let actionTimer = null

    function clearActionTimer() {
      if (actionTimer) {
        clearTimeout(actionTimer)
        runtime.timers.delete(actionTimer)
        actionTimer = null
      }
    }

    function notify() {
      runtime.version++
      for (const fn of Array.from(runtime.subs)) {
        try {
          fn()
        } catch (e) {
          /* 单个订阅者异常不影响其它 */
        }
      }
    }

    /** 所有长延时都记在 runtime.timers 里，卸载时统一清，避免"在已卸载组件上更新"。 */
    function later(fn, ms) {
      const id = setTimeout(() => {
        runtime.timers.delete(id)
        try {
          fn()
        } catch (e) {
          /* ignore */
        }
      }, ms)
      runtime.timers.add(id)
      return id
    }

    function clearLater() {
      for (const id of Array.from(runtime.timers)) clearTimeout(id)
      runtime.timers.clear()
    }

    /** 播放一段动作（帧序列逐帧交叉淡入；有视频片段时由片段自己动）。 */
    function playAction(name, opts) {
      const p = persona()
      const clip = p.clips && p.clips[name] ? p.clips[name] : null
      const frames = (p.actions && p.actions[name]) || null
      // 有视频片段的动作：帧序列可以缺席（视频自己会动），但要维持 action 存活到 until
      if ((!frames || !frames.length) && !clip) return false
      const o = opts || {}
      // 减弱动效（1.19.3 R10）：自动发起的动作不播；用户显式点播仍然放行
      if (runtime.reduced && !o.explicit) return false
      const gen = ++actionGen
      // 覆盖旧动作：旧调度链立刻失效，任何时刻只有一条（1.19.3 R03）
      clearActionTimer()
      // 帧时长跟着帧数走：3 帧用 340ms，6 帧用 230ms，整套循环长度基本不变
      const step = o.step || (frames && frames.length >= 6 ? 230 : 340)
      // 存活时间默认跟着媒体走：有片段就取片长（实测优先），没片段才用旧的 2400ms。
      // （1.19.x 在调用点手写 1300/2400ms，会在手势半途卸载 video。）
      const until = nowMs() + (o.ms || (clip ? clipMsOf(clip) : 2400))
      // moodDriven：这个动作是「心情」自动发起的（不是用户点的），心情变了可以收回
      runtime.clipPlaying = ''
      runtime.action = {
        name,
        frames: frames || [],
        i: 0,
        step,
        until,
        persona: p.id,
        clip,
        gen,
        moodDriven: !!o.moodDriven,
        explicit: !!o.explicit,
      }
      notify()
      if (clip) {
        // 视频自己会动：不排翻帧 timer（旧写法每 230/340ms 空转并 notify），
        // 只留一个到点收尾的 timeout。
        actionTimer = later(
          () => endAction(gen),
          Math.max(0, until - nowMs()),
        )
        return true
      }
      const advance = () => {
        const act = runtime.action
        if (!act || act.gen !== gen) return
        if (nowMs() > act.until) {
          endAction(gen)
          return
        }
        // 空帧数组不取模（无片段又无帧的动作上面已经拦掉，这里兜底）
        if (!act.frames || !act.frames.length) {
          endAction(gen)
          return
        }
        act.i = (act.i + 1) % act.frames.length
        notify()
        actionTimer = later(advance, act.step)
      }
      actionTimer = later(advance, step)
      return true
    }

    /**
     * 结束当前动作；只有「当前这一代」有权结束它（旧链的回调到此为止）。
     *
     * 片段动作不再直接卸载：先标记 exiting，让 video 用 220ms 淡回立绘，再真正移除。
     * 旧写法是「until 到点 → 立刻 action=null」，画面从片段最后一帧硬切到静止立绘
     * （跳舞结尾切笑脸尤其明显）。
     */
    const CLIP_EXIT_MS = 220

    function endAction(gen) {
      const act = runtime.action
      if (!act || act.gen !== gen || act.exiting) return
      clearActionTimer()
      if (!act.clip) {
        runtime.action = null
        runtime.clipPlaying = ''
        notify()
        return
      }
      act.exiting = true
      runtime.clipPlaying = '' // 不再算「正在播」：静帧垫上来，video 淡出
      notify()
      later(() => {
        const cur = runtime.action
        if (cur && cur.gen === gen && cur.exiting) {
          runtime.action = null
          notify()
        }
      }, CLIP_EXIT_MS)
    }

    /** 主动收回动作（心情变化/隐藏/换人设），同时作废在途调度链。 */
    function clearAction() {
      actionGen++
      clearActionTimer()
      runtime.clipPlaying = ''
      if (runtime.action) {
        runtime.action = null
        notify()
      }
    }

    function persona() {
      const map = PERSONA_REG.map
      return map[runtime.settings.persona] || map[Object.keys(map)[0]]
    }

    /**
     * 运行期注册表替换（R-01）：宿主 /personas 成功返回非空表时整表换入。
     * 空表/坏表一律拒收（宿主扫描失败时保持内置表）；换表后当前 persona
     * 若不在新表里，回落到新表第一只，避免渲染一个查无此人的形象。
     *
     * P1-2（2026-10-29 审计）：逐条做形状过滤——宿主的 fail-closed 校验只保护
     * 「读盘扫描」这条路径，老宿主版本或中间层仍可能灌进缺字段的包。坏条目跳过
     * 并 warn，而不是让整表替换、然后在渲染期白屏。
     */
    function usablePersona(p) {
      if (!p || typeof p !== 'object' || !p.id) return false
      if (typeof p.name !== 'string' || !p.name.trim()) return false
      if (!p.clips || typeof p.clips !== 'object') return false
      if (p.image) return true
      const c = p.colors
      if (!c || typeof c !== 'object') return false
      for (const key of ['body', 'body2', 'belly', 'accent', 'eye']) {
        if (typeof c[key] !== 'string' || !c[key]) return false
      }
      return true
    }

    function setPersonas(list) {
      if (!Array.isArray(list) || !list.length) return false
      const map = {}
      const skipped = []
      for (const p of list) {
        if (!usablePersona(p)) {
          skipped.push(p && p.id ? String(p.id) : '(unknown)')
          continue
        }
        map[p.id] = typeof p.tag === 'string' ? p : { ...p, tag: '', tagEn: p.tagEn || '' }
      }
      if (!Object.keys(map).length) return false
      if (skipped.length) petLog('skipped unusable personas', skipped.join(','))
      PERSONA_REG.map = map
      if (!map[runtime.settings.persona]) {
        runtime.settings.persona = Object.keys(map)[0]
      }
      notify()
      return true
    }

    /**
     * 贴图地址：桌面壳里相对路径不通，用宿主注入的绝对 origin。
     * R-01：贴图不一定还在包内 assets/ —— 用户包走 /dsh-pet/pets/<id>/，
     * 由 pack 的 assetBase 指路；内置包没有该字段，回落默认路径。
     */
    function assetUrl(name, p) {
      let base = ''
      try {
        base = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
      } catch (e) {
        base = ''
      }
      const assetBase = (p && p.assetBase) || '/dsh-pet/assets'
      // P3-10：带版本查询串（见 10-util.js 的 PET_ASSET_QS），升级后不吃旧缓存
      return base + assetBase + '/' + name + PET_ASSET_QS
    }

    /* ================= 语音（TTS） ================= */

    let voiceCache = null

    function pickVoice() {
      try {
        const synth = window.speechSynthesis
        if (!synth) return null
        const voices = voiceCache || synth.getVoices() || []
        if (!voices.length) return null
        voiceCache = voices
        // P2-5（2026-10-29 审计）：按当前界面语言挑嗓子。旧写法硬编码中文关键字，
        // 英/西/葡/印界面走 SAPI 兜底时会挑到中文嗓（u.lang 与 voice.lang 不一致，
        // 读音全歪）。现在先按语言前缀筛，筛不到才退回第一个。
        const want = String(SAPI_LANG[PET_LANG] || 'zh-CN').toLowerCase()
        const byLang = voices.filter((v) => String(v.lang || '').toLowerCase().startsWith(want.slice(0, 2)))
        return byLang[0] || voices[0]
      } catch (e) {
        return null
      }
    }

    let currentAudio = null
    let currentAudioUrl = null
    /** 回收 blob URL（P3-4）：打断/替换/卸载都要调，否则长会话会一直累积 */
    function dropAudioUrl(url) {
      try {
        if (url) window.URL.revokeObjectURL(url)
      } catch (e) {
        /* ignore */
      }
      if (currentAudioUrl && currentAudioUrl === url) currentAudioUrl = null
    }

    function stopVoice() {
      try {
        if (window.speechSynthesis) window.speechSynthesis.cancel()
      } catch (e) {
        /* ignore */
      }
      try {
        if (currentAudio) {
          currentAudio.pause()
          currentAudio = null
        }
      } catch (e) {
        /* ignore */
      }
      // P3-4：旧写法只 pause 不 revoke，被打断的那句 blob 永远不回收到
      dropAudioUrl(currentAudioUrl)
      runtime.speaking = false
      runtime.speakUntil = 0
      if (runtime.mood === 'talk') runtime.mood = 'idle'
    }

    // 每说一句自增：异步拿到 blob 时用它判断这句是不是已经过期
    let speakSeq = 0

    /**
     * 这次失败是不是「一次性环境问题」：限流 / 自动播放被拦 / 网络抖动。
     *
     * P2-4（2026-10-29 审计）：旧实现把这些也计进「连续失败 3 次 → 本会话永久 SAPI」，
     * 一次限流或一次手势策略抖动就把整场语音降级成机器人，而且开关切回也不恢复。
     */
    const isTransientNeuralFail = (reason) =>
      /429|rate|too many|NotAllowed|play\(\)|AbortError|network|Failed to fetch|tts http 5\d\d/i.test(
        String(reason || ''),
      )

    /** 连续失败 3 次才降级成系统语音；成功一次就清零 */
    function noteNeuralFail(reason) {
      runtime.neuralReason = reason
      if (isTransientNeuralFail(reason)) {
        petLog('neural tts transient failure', { reason })
        return
      }
      runtime.neuralFails = (runtime.neuralFails || 0) + 1
      petLog('neural tts failed', { n: runtime.neuralFails, reason })
      if (runtime.neuralFails >= 3) runtime.neuralOk = false
    }

    function noteNeuralOk() {
      if (runtime.neuralFails) runtime.neuralFails = 0
      if (runtime.neuralOk === false && runtime.settings.neuralVoice !== false) runtime.neuralOk = undefined
    }

    /** 用户重新打开「神经」开关时恢复到「再试一次」——降级不该是永久的（P2-4） */
    function resetNeural() {
      runtime.neuralFails = 0
      runtime.neuralOk = undefined
      runtime.neuralReason = ''
      neuralChecked = false
    }

    /** 系统语音用的 locale 标签（神经音色由宿主按 lang 选） */
    const SAPI_LANG = { zh: 'zh-CN', en: 'en-US', es: 'es-ES', pt: 'pt-BR', hi: 'hi-IN' }

    /**
     * 演绎参数 = 形象基座（pack.voice.pitch / rate）× 这一句的心情方向（pack.voice.moods[mood]）。
     *
     * 「LLM 当导演、TTS 当演员」的落点就在这里：导演层不是每句话去调一次模型，而是把
     * 表演纲领（每个心情的升降调幅度、语速倍率、音量倍率）写进角色包，运行时只查表相乘。
     * 零延迟、零费用、可复现；想改演出只改 pack.json 那一行。
     *
     * 音色：用户手选了具体音色就用手选的；'auto' 时优先形象自带音色（voiced[语言]），
     * 五只角色因此各自一个嗓子，而不是同一个人变调。
     */
    function voiceParams(mood) {
      const p = persona()
      const s = runtime.settings
      // P1-2：渲染/设置面板都会读这里。缺 voice（用户自建 pack）不能让整块 UI 抛错，
      // 缺失时按「基座 1 / 1」处理——听感是普通音高语速，而不是崩掉面板。
      const voice = p && p.voice && typeof p.voice === 'object' ? p.voice : {}
      const dir = (voice.moods && voice.moods[mood || runtime.mood]) || null
      const pt = s.pitchTrim == null ? 1 : Number(s.pitchTrim)
      const rt = s.rateTrim == null ? 1 : Number(s.rateTrim)
      const basePitchNum = Number(voice.pitch)
      const baseRateNum = Number(voice.rate)
      const basePitch = (Number.isFinite(basePitchNum) ? basePitchNum : 1) * (isFinite(pt) ? pt : 1)
      const baseRate = (Number.isFinite(baseRateNum) ? baseRateNum : 1) * (isFinite(rt) ? rt : 1)
      // mood 导演表的数字也要兜底：宿主校验挡不住老宿主/中间层灌进来的 'abc'
      const dPitch = dir && Number.isFinite(Number(dir.pitch)) ? Number(dir.pitch) : 0
      const dRate = dir && Number.isFinite(Number(dir.rate)) ? Number(dir.rate) : 1
      const pitch = basePitch * (1 + dPitch / 100)
      const rate = baseRate * dRate
      const manual = s.ttsVoice && s.ttsVoice !== 'auto' ? s.ttsVoice : ''
      const own = (voice.voiced && voice.voiced[PET_LANG]) || ''
      return {
        pitch: clamp(pitch, 0.5, 2),
        rate: clamp(rate, 0.5, 2),
        volume: dir && dir.volume != null ? clamp(Number(dir.volume), 0, 2) : 1,
        voice: manual || own,
        lang: PET_LANG,
      }
    }

    /** 探测宿主有没有可用的神经语音；没有就静默用系统语音，不再每句白等 2 秒。 */
    let neuralChecked = false
    function checkNeural() {
      if (neuralChecked) return
      neuralChecked = true
      try {
        const base = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
        fetch(base + '/dsh-pet/tts/status')
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            if (!j) {
              // 端点异常（非 2xx / 空 body）：置「未知」并允许下次说话重试
              runtime.neuralOk = undefined
              neuralChecked = false
              return
            }
            // P2-3（2026-10-29 审计）：宿主明确说 available:false（没装 edge-tts）
            // 时直接降级成系统语音。旧写法把它写成 undefined（= 未知），于是每句
            // 都要先去 /tts 白付一次 503，连续三次才降级。
            runtime.neuralOk = j.available ? true : false
            runtime.neuralReason = j.reason || ''
            petLog('tts status', { ok: runtime.neuralOk, reason: runtime.neuralReason })
            notify()
          })
          .catch(() => {
            // 网络抖动 ≠ 不可用（R-08）：置「未知」并允许下次说话重试；
            // 只有上面 .then 里明确的 available:false 才直接降级
            runtime.neuralOk = undefined
            neuralChecked = false
          })
      } catch (e) {
        runtime.neuralOk = false
      }
    }

    /** POST 到 /dsh-pet/tts，拿回 mp3 的 objectURL（GET 端点已取消） */
    async function ttsBlobUrl(text, mood) {
      const v = voiceParams(mood)
      const base = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
      const pitch = ((v.pitch - 1) * 100).toFixed(0)
      const rate = ((v.rate - 1) * 100).toFixed(0)
      const vol = ((v.volume - 1) * 100).toFixed(0)
      const body = {
        text,
        lang: v.lang,
        voice: v.voice || undefined,
        pitch: (pitch >= 0 ? '+' : '') + pitch + 'Hz',
        rate: (rate >= 0 ? '+' : '') + rate + '%',
        volume: (vol >= 0 ? '+' : '') + vol + '%',
      }
      const res = await fetch(base + '/dsh-pet/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('tts http ' + res.status)
      const blob = await res.blob()
      try {
        runtime.lastBlobSize = blob.size
        runtime.lastBlobType = blob.type
      } catch (e) {
        /* ignore */
      }
      if (!blob || !blob.size) throw new Error('tts empty body')
      return window.URL.createObjectURL(blob)
    }

    /** 系统 SAPI 兜底（神经语音失败时用）。 */
    function saySapi(text, restore, mood) {
      runtime.lastTts = 'sapi'
      const synth = window.speechSynthesis
      if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') {
        restore()
        return
      }
      try {
        synth.cancel()
        const v = voiceParams(mood)
        const u = new window.SpeechSynthesisUtterance(text)
        u.lang = SAPI_LANG[PET_LANG] || 'zh-CN'
        u.pitch = clamp(v.pitch, 0, 2)
        u.rate = clamp(v.rate, 0.5, 2)
        u.volume = clamp(Number(runtime.settings.volume) * v.volume, 0, 1)
        const voice = pickVoice()
        if (voice) u.voice = voice
        u.onend = restore
        u.onerror = restore
        synth.speak(u)
      } catch (e) {
        restore()
      }
    }

    /**
     * 音画同步的唯一判据：人不在屏幕上就不发任何声。
     * 三种「不在」：藏起来（visible=false，整层不渲染）、被拖出视口（petOffscreen）、
     * 还没挂载（rootEl 为空）。判据只放在这一个函数里，其他分支一律调它。
     */
    function onScreen() {
      return !!(runtime.visible && !runtime.petOffscreen && runtime.rootEl)
    }

    function speak(text, mood) {
      if (!text || !runtime.settings.voiceOn) return
      // 人不在屏幕上就别出声（2026-10-25 用户报：人都藏起来了，她还在说话）
      if (!onScreen()) return
      // 安静态（1.26.0）：与 bubble 同一套判据，kind 由调用方透传（第三参）。
      // 单独再判一次是因为 speak 可以被绕过 bubble 直接调用，声音是最讨厌的那一种打扰。
      if (isQuiet() && !isAddressedKind(mood)) return
      // 跳舞时不要被「说话」这个心情抢走动作（否则中间那 6 秒全在点头）
      const staged = !!runtime.stage
      const prevMood = runtime.mood === 'talk' ? 'idle' : runtime.mood
      const restore = () => {
        runtime.speaking = false
        if (!staged && runtime.mood === 'talk') {
          runtime.mood = prevMood
          runtime.moodUntil = nowMs() + 1500
        }
        notify()
      }

      runtime.speaking = true
      if (!staged) {
        runtime.mood = 'talk'
        runtime.moodUntil = nowMs() + 2200
      }
      // 浏览器静默拦掉语音时 onend 不会来，用估算时长兜底解锁
      runtime.speakUntil = nowMs() + 1600 + text.length * 240

      if (runtime.settings.neuralVoice === false || runtime.neuralOk === false) {
        saySapi(text, restore, mood)
        return
      }
      checkNeural()

      try {
        // 上一句还没播完就先掐掉，避免两句叠在一起。（P3-4：同时回收它的 blob URL）
        if (currentAudio) {
          try {
            currentAudio.pause()
          } catch (e) {
            /* ignore */
          }
          currentAudio = null
          dropAudioUrl(currentAudioUrl)
        }
        const seq = ++speakSeq
        ttsBlobUrl(text, mood)
          .then((url) => {
            // 期间又说了新的一句：丢掉这条，别让两句抢着播
            if (seq !== speakSeq) {
              dropAudioUrl(url)
              return
            }
            // 合成是异步的（几百毫秒）：等它回来时人可能已经被藏起来了，
            // 这时候不能再出声，否则就是「人不见了声音还在」。
            if (!onScreen()) {
              dropAudioUrl(url)
              restore()
              return
            }
            const a = new Audio(url)
            runtime.lastTts = 'neural'
            a.volume = clamp(runtime.settings.volume, 0, 1)
            currentAudio = a
            currentAudioUrl = url
            const drop = () => {
              dropAudioUrl(url)
              if (currentAudio === a) currentAudio = null
            }
            a.onended = () => {
              drop()
              restore()
            }
            a.onerror = () => {
              drop()
              noteNeuralFail(
                'audio error ' +
                  ((a.error && a.error.code) || '?') +
                  ' size=' +
                  (runtime.lastBlobSize || 0) +
                  ' type=' +
                  (runtime.lastBlobType || '-'),
              )
              saySapi(text, restore, mood)
            }
            a.onplaying = () => noteNeuralOk()
            const pr = a.play()
            if (pr && typeof pr.catch === 'function') {
              pr.catch((err) => {
                drop()
                runtime.lastTts = 'neural-blocked:' + String((err && err.name) || err)
                // 自动播放被拦是一次性的手势策略问题，不算神经语音坏了（P2-4）
                noteNeuralFail('NotAllowed ' + String((err && err.name) || err))
                saySapi(text, restore, mood)
              })
            }
          })
          .catch((err) => {
            if (seq !== speakSeq) return
            noteNeuralFail(String((err && err.message) || err))
            saySapi(text, restore, mood)
          })
      } catch (e) {
        saySapi(text, restore)
      }
    }

    /**
     * 把当前形象常用的台词在后台合成好，之后播就是本地缓存，秒出。
     *
     * 有了「心情方向」之后，同一句话在 idle / dance 下的音高语速不同，所以按**类别分组**
     * 预热（每类一次请求、各带一套参数），而不是把全部台词用同一套参数烤一遍——
     * 那样只有一类能命中缓存。
     */
    function warmVoice() {
      try {
        if (runtime.settings.neuralVoice === false || runtime.neuralOk === false) return
        const p = persona()
        // P2-2（2026-10-29 审计）：必须烤**当前语言**的台词。
        // 旧写法只看 p.lines（中文原稿），英/西/葡/印用户预热全部无效。
        const langKey = 'lines' + PET_LANG.charAt(0).toUpperCase() + PET_LANG.slice(1)
        const pack =
          (PET_LANG !== 'zh' && p[langKey]) ||
          (PET_LANG === 'zh' || !p.linesEn ? p.lines : p.linesEn) ||
          p.lines ||
          {}
        const groups = []
        for (const k of Object.keys(pack)) {
          const lines = (pack[k] || []).map((x) => String(x)).filter(Boolean)
          if (lines.length) groups.push({ mood: k, lines })
        }
        if (!groups.length) return
        groups.sort((a, b) => b.lines.length - a.lines.length)
        const warmBase = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
        let budget = 18
        const sends = []
        for (const g of groups.slice(0, 3)) {
          if (budget <= 0) break
          const lines = Array.from(new Set(g.lines)).slice(0, Math.min(8, budget))
          budget -= lines.length
          if (!lines.length) continue
          const v = voiceParams(g.mood)
          const pitch = ((v.pitch - 1) * 100).toFixed(0)
          const rate = ((v.rate - 1) * 100).toFixed(0)
          const vol = ((v.volume - 1) * 100).toFixed(0)
          sends.push({
            mood: g.mood,
            n: lines.length,
            body: {
              lang: v.lang,
              voice: v.voice,
              pitch: (pitch >= 0 ? '+' : '') + pitch + 'Hz',
              rate: (rate >= 0 ? '+' : '') + rate + '%',
              volume: (vol >= 0 ? '+' : '') + vol + '%',
              lines,
            },
          })
        }
        // P2-2：服务端是单飞预热（同一时刻只允许一条），三条并发只会被 429 掉两条。
        // 客户端改为串行发送，并检查 res.ok —— 被限流/失败时不能记成 "queued"。
        ;(async () => {
          for (const item of sends) {
            try {
              const res = await fetch(warmBase + '/dsh-pet/tts/warm', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(item.body),
              })
              if (res && res.ok) {
                petLog('warm voice queued', { mood: item.mood, n: item.n, lang: PET_LANG })
              } else {
                petLog('warm voice skipped', { mood: item.mood, status: res && res.status })
              }
            } catch (e) {
              /* 预热是锦上添花：失败静默 */
            }
          }
        })()
      } catch (e) {
        /* ignore */
      }
    }

    /* ================= 失焦感知：安静态 ================= *
     *
     * 1.26.0 起，「人不在就别出声」从语音这一条闸门推广到整个组件：
     * 窗口失焦超过 QUIET_AFTER_MS（或用户手动开了勿扰），就进安静态——
     * 气泡静默、语音静音、停止自发动作。重新聚焦时「醒」过来。
     *
     * 为什么单独一个模块：判断「人在不在」只能靠 document 上的几个信号，
     * 而它们各有各的坑（见 isFocused）。集中在一处，改判定只改一处。
     *
     * 平台无关：只用 document.visibilityState / document.hasFocus()，
     * Windows / macOS / Linux / 各浏览器行为一致，不涉及任何平台分支。
     */

    /** 失焦多久算「人走了」：60s（用户 2026-10-28 拍板，考虑共享屏幕开会场景） */
    const QUIET_AFTER_MS = 60 * 1000
    /** 手动「勿扰」的时长 */
    const DONT_DISTURB_MS = 60 * 60 * 1000

    /**
     * 当前是否在前台。
     *
     * 两个信号都要看，因为**两个都会骗人**，方向还相反：
     *   - document.hasFocus() 在某些点按 / 子窗口场景下窗口明明在前台却报 false；
     *   - visibilityState 在窗口被别的应用完整遮住时仍然是 'visible'。
     * 取 AND 是最保守的组合：两个都说在，才算在。
     * 判错了的后果不对称——误判成「不在」只是她安静一会儿；
     * 误判成「在」就是开会共享屏幕时她突然开口。所以宁可偏向安静。
     */
    function isFocused() {
      try {
        if (typeof document === 'undefined') return true
        if (document.visibilityState && document.visibilityState !== 'visible') return false
        if (typeof document.hasFocus === 'function') return document.hasFocus()
      } catch (e) {
        /* 读不到就当在前台：不能因为探测失败让她永久失联 */
      }
      return true
    }

    /**
     * 安静态判定。返回 '' 表示不安静，否则返回原因（给 /ping 诊断与单测用）：
     *   'dnd'   —— 手动勿扰中
     *   'blur'  —— 失焦超过阈值
     */
    function quietReason() {
      const now = nowMs()
      if (runtime.dndUntil && now < runtime.dndUntil) return 'dnd'
      if (!runtime.blurredAt) return ''
      if (now - runtime.blurredAt < QUIET_AFTER_MS) return ''
      return 'blur'
    }

    /** 她此刻是否应该保持安静 */
    function isQuiet() {
      return quietReason() !== ''
    }

    /**
     * 这类气泡/台词是否属于「有事」，安静态下也要放行。
     *
     * 区分标准不是「谁触发的」，而是**用户是否在等这句话**：
     *   - announce：外部脚本让她说话（CI 挂了、git hook 提醒），属于有事；
     *   - chatAck / chatErr：用户刚跟她说话，在等她回，属于有事；
     *   - 其余（idle / dance / poked / drag / 心情台词）都是自发演绎，安静态一律不出。
     */
    function isAddressedKind(kind) {
      return kind === 'announce' || kind === 'chatAck' || kind === 'chatErr'
    }

    /** 手动「勿扰 1 小时」开关。开着就关，关着就开。 */
    function toggleDontDisturb() {
      if (runtime.dndUntil && nowMs() < runtime.dndUntil) runtime.dndUntil = 0
      else runtime.dndUntil = nowMs() + DONT_DISTURB_MS
      runtime.quietReason = quietReason()
      notify()
    }

    /** 勿扰还剩多少毫秒（菜单文案用；没开是 0） */
    function dndRemainingMs() {
      const left = (runtime.dndUntil || 0) - nowMs()
      return left > 0 ? left : 0
    }

    /**
     * 启动失焦监听。返回卸载函数，交给 ctx.effect。
     * 只在 window/document 上挂三个事件，所有清理都在返回值里（prelude 红线）。
     */
    function watchFocus() {
      const markBlurred = () => {
        if (!runtime.blurredAt) runtime.blurredAt = nowMs()
      }
      const markFocused = () => {
        runtime.blurredAt = 0
      }
      const onFocus = () => {
        markFocused()
        runtime.quietReason = quietReason()
        // 通知标题前缀（56-notify.js）在用户回来时撤掉——人已经在了，不用再在任务栏喊他
        if (typeof titlePrefix === 'function') titlePrefix(false)
        notify()
      }
      // 标签页切走 / 切回（比 hasFocus 更早反映 visibilityState）
      const onVisibility = () => {
        try {
          if (document.visibilityState === 'hidden') markBlurred()
          else markFocused()
        } catch (e) {
          /* ignore */
        }
        runtime.quietReason = quietReason()
        notify()
      }

      try {
        window.addEventListener('blur', markBlurred)
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onVisibility)
      } catch (e) {
        /* 装不上监听就退回「永不安静」，不能因为监听失败让功能整体挂掉 */
      }

      // 启动时如果本来就在后台（比如刷新于一个隐藏标签），立刻记一笔
      try {
        if (document.visibilityState === 'hidden') runtime.blurredAt = nowMs()
      } catch (e) {
        /* ignore */
      }

      return () => {
        try {
          window.removeEventListener('blur', markBlurred)
          window.removeEventListener('focus', onFocus)
          document.removeEventListener('visibilitychange', onVisibility)
        } catch (e) {
          /* ignore */
        }
      }
    }

    /**
     * 安静态的边界条件：进入/退出时要做的事。
     * 由 tick 每轮调用一次，自己比较前后两个状态，只在**跨越边界**时动作。
     */
    function syncQuiet() {
      const now = quietReason()
      const prev = runtime.quietReason || ''
      runtime.quietReason = now
      if (prev === now) return
      // 进入安静：记时间戳，外层据此播一次「打哈欠趴下」
      if (now && !prev) {
        runtime.quietSince = nowMs()
        runtime.wokeAt = 0
      }
      // 退出安静：记「刚醒」，外层据此播一次「抻懒腰」
      if (!now && prev) {
        runtime.quietSince = 0
        runtime.wokeAt = nowMs()
      }
      notify()
    }

    /* ================= 失焦通知：一轮跑完提醒 ================= *
     *
     * 1.26.0。把「一轮跑完了，回来验收」送到人眼前——哪怕他切去了别的应用。
     *
     * 纯 Web 标准，跨平台（Windows / macOS / Linux / 各浏览器），不依赖任何宿主能力。
     * 核心是**能力降级链**：每一层失败都静默下移，绝不抛错、绝不刷控制台噪音。
     *
     *   1. Web Notification（permission === 'granted'）
     *   2. 文档标题前缀 ●（永不失败的兜底，任务栏/标签页标题可见）
     *   3. 文档内角标（她头上一个红点）
     *
     * 为什么标题前缀是「永不失败的兜底」而不是冗余：浏览器里 notification.onclick
     * 多数不保证真的把标签页切到前台；标题是任务栏上唯一可靠的「回来吧」信号。
     */

    /** 短于这个时长的一轮不值得弹（4 秒的活弹窗是骚扰） */
    const TURN_NOTIFY_MIN_MS = 10000
    /** 两次通知的最小间隔（避免「连发」） */
    const TURN_NOTIFY_COOLDOWN_MS = 90000

    // —— 自证统计：跨平台方案里「通知到底发出去没有」不能靠猜（见方案 §2.3）——
    // Linux 无通知守护进程、macOS 系统级静音、浏览器权限被撤，这三种情况
    // Notification API 都不报错，只是通知不出现。只有 show / error 事件能说实话。
    const notifyStats = {
      supported: 'none', // 'web' | 'none'
      permission: 'unavailable', // granted | denied | default | unavailable
      sent: 0, // 实际弹出（Notification.show 或标题前缀生效）
      failed: 0, // 探测到 error / 2s 内未触发 show
      lastReason: '', // 最近一次被拦下的原因（诊断用）
      lastAt: 0,
    }

    /** 一次性探测：这个环境能不能用 Web 通知、权限现状如何。结果写 notifyStats。 */
    function probeNotify() {
      try {
        if (typeof window === 'undefined' || !('Notification' in window)) {
          notifyStats.supported = 'none'
          notifyStats.permission = 'unavailable'
          return
        }
        notifyStats.supported = 'web'
        notifyStats.permission = window.Notification.permission || 'default'
      } catch (e) {
        notifyStats.supported = 'none'
        notifyStats.permission = 'unavailable'
      }
    }

    /**
     * 请求通知权限。**只能在用户手势回调里调用**（浏览器会拒绝非手势触发的请求）。
     * 返回最终权限状态；拒绝时调用方要把设置项回弹为 off。
     */
    async function requestNotifyPermission() {
      probeNotify()
      if (notifyStats.supported !== 'web') return notifyStats.permission
      try {
        notifyStats.permission = await window.Notification.requestPermission()
      } catch (e) {
        // 隐私模式 / 沙箱里可能根本无法授予，静默记为 denied，交给降级链
        notifyStats.permission = 'denied'
      }
      return notifyStats.permission
    }

    /** 标题前缀兜底：记下原标题，聚焦时恢复 */
    function titlePrefix(on) {
      try {
        const tag = '● '
        const cur = document.title || ''
        if (on) {
          if (!runtime.notifyTaggedTitle) runtime.notifyTaggedTitle = cur
          if (!cur.startsWith(tag)) document.title = tag + cur
        } else {
          if (runtime.notifyTaggedTitle) {
            const base = runtime.notifyTaggedTitle
            const cur = document.title || ''
            // P3-16（2026-10-29 审计）：严格相等就还原的话，期间标题被宿主改过
            //（比如会话标题变了）那个 ● 会永久留在标签页上。规则改成：
            // 「● + 原标题」→ 还原原标题；只以 ● 开头 → 只剥掉我们加的前缀。
            if (cur === tag + base) document.title = base
            else if (cur.startsWith(tag)) document.title = cur.slice(tag.length)
            runtime.notifyTaggedTitle = ''
          }
        }
      } catch (e) {
        /* ignore */
      }
    }

    /** 通知内容的文案（title 用人设名，body 用耗时） */
    function turnNotifyText(dur) {
      const mm = Math.max(1, Math.round(dur / 60000))
      let pname = 'dsh-pet'
      try {
        const p = persona()
        if (p && p.name) pname = p.name
      } catch (e) {
        /* ignore */
      }
      const title = pname
      // P2-6（2026-10-29 审计）：文案语言要看**实际生效的界面语言** PET_LANG，
      // 不是设置项。settings.lang 默认 'auto'，旧写法于是永远落到英文分支——
      // 中文界面的默认通知是英文的。
      const body =
        (PET_LANG === 'zh' ? `跑完了，${mm} 分钟，回来验收吧` :
         PET_LANG === 'es' ? `Terminó, ${mm} min, vuelve a revisar.` :
         PET_LANG === 'pt' ? `Terminou, ${mm} min, volte para conferir.` :
         PET_LANG === 'hi' ? `${mm} मिनट में हो गया, वापस आकर देख लीजिए।` :
         `Done, ${mm} min. Come back and review.`)
      return { title, body }
    }

    /**
     * 发一条「跑完了」通知。带降级链与自证回执。
     * @param {number} dur 一轮耗时（毫秒）
     * @returns {string} 实际走到的层：'notification' | 'title' | 'badge' | 'skip:<reason>'
     */
    function sendTurnNotify(dur) {
      probeNotify()
      const now = nowMs()

      // —— 前置条件（全部满足才弹，任一不满足都记 lastReason 后静默跳过）——
      if (dur < TURN_NOTIFY_MIN_MS) return skipNotify('short')
      // 人正看着就别弹：通知的唯一目的就是「把人叫回来」，人已经在看就没必要。
      // 注意这里不看 isQuiet()——安静态管的是「她不主动打扰」，而 turnNotify 是
      // 用户明确授权过的提醒（开了开关），两者是独立的。
      if (isFocused()) return skipNotify('focused')
      if (now - (notifyStats.lastAt || 0) < TURN_NOTIFY_COOLDOWN_MS) return skipNotify('cooldown')

      const { title, body } = turnNotifyText(dur)

      // 第 1 层：Web Notification
      if (notifyStats.supported === 'web' && notifyStats.permission === 'granted') {
        let n = null
        try {
          n = new window.Notification(title, {
            body,
            tag: 'dsh-pet-turn-end', // 同 tag 自动替换，天然去重
            silent: true,
            requireInteraction: false,
            lang: runtime.settings.lang || 'en',
          })
        } catch (e) {
          // 移动端 / 某些环境构造即抛 TypeError，落到下一层
          n = null
        }
        if (n) {
          // 自证核心：只有 show 事件真的触发才算「发出去了」。
          // Linux 无通知守护进程 / macOS 系统静音 / 权限被中途撤掉，这三种情况
          // API 都不报错、不触发 show、也不触发 error——只是通知不出现。
          // 所以用「2s 内未 show 也未 error」判定静默失败，落到标题兜底。
          let settled = false
          const onShow = () => {
            if (settled) return
            settled = true
            notifyStats.sent++
            notifyStats.lastReason = ''
            notifyStats.lastAt = now
          }
          const onError = () => {
            if (settled) return
            settled = true
            notifyStats.failed++
            notifyStats.lastReason = 'error'
            titlePrefix(true) // 通知报错 → 标题兜底
          }
          try {
            n.addEventListener('show', onShow)
            n.addEventListener('error', onError)
          } catch (e) {
            /* ignore */
          }
          // 静默失败的自证窗口：2s 内没 show 也没 error → no-daemon
          later(() => {
            if (!settled) {
              settled = true
              notifyStats.failed++
              notifyStats.lastReason = 'no-daemon'
              titlePrefix(true)
            }
          }, 2000)
          if (typeof n.show === 'function') {
            try {
              n.show()
            } catch (e) {
              onError()
            }
          }
          // 通知路径上无论最终 show/error，标题都先打上——点击通知不保证切回
          // 标签页，标题是任务栏上唯一可靠的双保险。
          titlePrefix(true)
          notifyStats.lastAt = now
          return 'notification'
        }
      }

      // 第 2 层：标题前缀（永不失败）
      titlePrefix(true)
      notifyStats.sent++
      notifyStats.lastReason = 'title-fallback'
      notifyStats.lastAt = now
      return 'title'

      // 第 3 层（角标）留到 overlay 层有视觉载体时再挂，避免现在为一个红点开一条 UI 线
    }

    function skipNotify(reason) {
      notifyStats.lastReason = reason
      return 'skip:' + reason
    }

    /* ================= 说话气泡 ================= */

    /**
     * 阶段机：把「会话在跑 / 刚调过工具 / 刚出错 / 正在说话 / 刚结束」压成一个
     * 字符串，界面只按它换表情与动作。全部来自已有信号，不新增宿主要求：
     *   - running：客户端 useSession 拿到的布尔量
     *   - lastToolAt / lastErrorAt：宿主 tool/result 事件的时间戳，经 /ping 回传
     *   - speaking / doneUntil：本地状态
     */
    const TOOL_WINDOW = 5000 // 工具活动后保持「在调工具」的时长
    const ERROR_WINDOW = 8000 // 出错后保持「生气/乌云」的时长
    const DONE_WINDOW = 4000 // 一轮结束后「done」的时长

    function computePhase() {
      const now = nowMs()
      if (runtime.speaking) return 'speak'
      if (runtime.lastErrorAt && now - runtime.lastErrorAt < ERROR_WINDOW) return 'error'
      // —— 宿主直出（R-02，反哺报告 2026-10-27）：新鲜窗口内优先采用宿主投影 ——
      // thinking → working（模型推理中，她在屏幕上溜达等结果）
      // review → speak（回答文本在流，正好借说话的口型）
      // tool / working 原样；done 只认前 DONE_WINDOW 秒——一轮回答结束后不能
      // 在 15s 新鲜窗口里一直「庆祝」。过期或宿主没有 phase 就回落本地推导。
      const hp = runtime.hostPhase
      const hpAt = runtime.hostPhaseAt || 0
      if (hp && hp !== 'idle' && hpAt && now - hpAt < 15000) {
        if (hp === 'thinking' || hp === 'working') return 'working'
        if (hp === 'tool') return 'tool'
        if (hp === 'review') return 'speak'
        if (hp === 'done' && now - hpAt < DONE_WINDOW) return 'done'
      }
      if (runtime.lastToolAt && now - runtime.lastToolAt < TOOL_WINDOW) return 'tool'
      if (runtime.running) return 'working'
      if (runtime.doneUntil && now < runtime.doneUntil) return 'done'
      return 'idle'
    }

    /** 重算并落库；有变化时返回新阶段，否则返回 '' */
    function syncPhase() {
      const next = computePhase()
      if (next === runtime.phase) return ''
      runtime.phase = next
      return next
    }

    /**
     * 自动台词闸（R-03）：statusBubbles='off' 时关掉「自言自语」类的气泡
     * （心情台词 / 阶段台词 / 闲聊 / 出现问候）。点按、拖拽、announce 公告
     * 这类「有明确触发」的仍然走 bubble()，不受这个开关影响。
     */
    function statusBubble(text, ttl, mood) {
      if (runtime.settings.statusBubbles === 'off') return
      bubble(text, ttl, mood)
    }

    function bubble(text, ttl, mood) {
      if (!text) return
      // 人不在屏幕上（藏起来 / 被拖出视口）就不冒泡、不发声：
      // 用户 2026-10-25 报的「人物不在桌面了，可她还在说话」就是这条漏了闸。
      if (!runtime.visible || runtime.petOffscreen) return
      // 安静态（1.26.0）：失焦超过阈值或手动勿扰时，只放行「有事」的那几类
      // （announce / chatAck / chatErr），自发演绎一律不出。见 src/55-focus.js
      if (isQuiet() && !isAddressedKind(mood)) return
      const s = runtime.settings
      const t = String(text)
      // 第三参是该句所属的类别（appear/dance/poked/drag/chatAck…）：交给导演层查演绎方向，
      // 也决定读屏语义——只有「用户发起、等回复」的那几类（chatAck/chatErr/announce）
      // 才是 polite 实时区，闲聊台词对读屏是噪声（2026-10-28 审计④a）
      runtime.bubble = { text: t, at: nowMs(), ttl: ttl || clamp(2200 + t.length * 90, 2600, 9000), kind: mood || '' }
      // 第三参是该句所属的类别（appear/dance/poked/drag…），交给导演层查演绎方向
      if (s.voiceOn) speak(t, mood)
      maybeAside()
      notify()
    }

    /**
     * 心声（1.21.0）：只在自带 lines.aside 的形象上出现，灰色小字、不出声——
     * 借的是「人设包装层」的思维链写法：正式台词之外，偶尔漏一句没经过脑子的
     * 内心 OS，制造反差。低频（ASIDE_RATE）是关键，多了就腻。
     */
    const ASIDE_RATE = 0.07

    /** 精确取某一类台词（不回落 idle）：缺这类就返回 ''，让「没有这类台词的形象」保持安静 */
    function linesOf(mood) {
      const p = persona()
      const key = 'lines' + PET_LANG.charAt(0).toUpperCase() + PET_LANG.slice(1)
      const pack = (p[key] && PET_LANG !== 'zh' ? p[key] : null) || (PET_LANG === 'zh' || !p.linesEn ? p.lines : p.linesEn)
      return (pack && pack[mood]) || (p.lines && p.lines[mood]) || []
    }

    function asideLine() {
      const list = linesOf('aside')
      return list.length ? pick(list) : ''
    }

    /** 被拖动时说的一句；形象没写 drag 这类台词就不吭声（不回落到 idle，免得答非所问） */
    function dragLine() {
      const list = linesOf('drag')
      return list.length ? pick(list) : ''
    }

    function maybeAside(rate) {
      const text = asideLine()
      if (!text) return ''
      if (Math.random() >= (typeof rate === 'number' ? rate : ASIDE_RATE)) return ''
      runtime.aside = { text, at: nowMs(), ttl: clamp(1800 + text.length * 70, 2200, 6000) }
      return text
    }

    function clearAside() {
      if (!runtime.aside) return false
      runtime.aside = null
      return true
    }

    function randomLine(mood) {
      const p = persona()
      // 语言包优先：lines<Lang> → linesEn → lines（中文原稿）
      const key = 'lines' + PET_LANG.charAt(0).toUpperCase() + PET_LANG.slice(1)
      const pack = (p[key] && PET_LANG !== 'zh' ? p[key] : null) || (PET_LANG === 'zh' || !p.linesEn ? p.lines : p.linesEn)
      const list = (pack && pack[mood]) || (p.lines && p.lines[mood]) || (p.lines && p.lines.idle) || []
      return list.length ? pick(list) : ''
    }

    /* ================= 出现 / 消失 ================= */

    function showPet(kind) {
      const wasVisible = runtime.visible
      // 手动叫出来必须解除「藏 1 小时」，否则 5 秒后 tick 又把她藏回去
      runtime.snoozeUntil = 0
      runtime.visible = true
      runtime.visibleUntil = nowMs() + randInt(45, 150) * 1000
      runtime.mood = kind === 'dance' ? 'dance' : 'happy'
      runtime.moodUntil = nowMs() + randInt(3000, 5000)
      if (!wasVisible && runtime.settings.chatter) {
        const k = kind === 'dance' ? 'dance' : 'appear'
        // P2-1（2026-10-29 审计）：出现问候也是「自发台词」，statusBubbles:'off' 时必须闭嘴。
        // 旧写法直接 bubble()，只有 tick 里的 appear 走 statusBubble()，两条路不一致。
        statusBubble(randomLine(k), null, k)
      }
      notify()
    }

    /** 藏起来；传 snoozeMs 就是「藏这么久」（0 = 只藏到下次 tick） */
    function hidePet(snoozeMs) {
      if (snoozeMs) runtime.snoozeUntil = nowMs() + Number(snoozeMs)
      runtime.visible = false
      // 藏起来就把在播的动作收回：不留一条还在跑的调度链（R03/R08）
      clearAction()
      stopVoice()
      // P2-9（2026-10-29 审计）：这些运行态只在「看得见」时有意义，藏着不清就会
      // 在下次出现时带上来——跳舞藏起来 → 再出现带着位移/放大；菜单/设置面板还开着
      // → 再出现自己弹回来。
      runtime.stage = null
      // 还要作废在途的舞台相位排程（planStage 靠 stageGen 校验代际），
      // 否则隐藏期间那几条 later() 仍会把 stage/心情改回去。
      stageGen++
      runtime.menu = null
      runtime.panelOpen = false
      runtime.hovering = false
      runtime.inputPinned = false
      notify()
    }

    /**
     * 设置面板摆哪儿：默认贴右下角会把她整个人盖住，所以按她的实际位置算。
     * 上方空间够就放她上方（右对齐），不够就放她左侧（底对齐）。
     * 面板定宽 196px，与 CSS 里 .dsh-pet-panel 的 width 保持一致。
     *
     * 1.19.3（R11）：算出位置之后必须**四面夹取**。旧写法只夹了 right/bottom 的
     * 下界，宠物贴左边缘时会得到 right≈vw，面板整个跑到屏幕左侧（实测 left=-184px）。
     */
    const PANEL_W = 196
    const PANEL_GAP = 8
    const VIEW_MARGIN = 8

    /**
     * 顶栏（DSH 标题栏/工具栏）的安全区高度：面板与气泡都不许压到它上面。
     *
     * 起因（2026-10-27 用户反馈）：宠物被拖到屏幕上方时，面板贴到视口顶部，
     * 标题栏里右上角的 × 正好被顶栏盖住——看得见、点不到，关不掉面板。
     *
     * 为什么是探测而不是写死常量：DSH 顶栏高度随主题/密度/缩放变化，
     * 写死必然在下一个主题里失效。优先量覆盖层父容器的 top 偏移，
     * 测不到再依次尝试常见选择器，最后给保守默认值。
     */
    const DEFAULT_HEADER_SAFE = 44

    function headerSafeArea() {
      try {
        if (typeof document === 'undefined') return DEFAULT_HEADER_SAFE
        // ① overlay 的父容器：它是插件真正可用的那块区域
        const host = runtime.rootEl && runtime.rootEl.parentElement
        if (host && host.getBoundingClientRect) {
          const hr = host.getBoundingClientRect()
          // 父容器若被贴到 (0,0)，说明它铺满全屏（顶栏是浮在上面的兄弟节点），量不到信息
          if (hr.top > 0 && hr.top < 200) return Math.round(hr.top)
        }
        // ② 常见顶栏选择器
        const sel = [
          'header[role=banner]',
          '.dsh-titlebar',
          '.dsh-header',
          '.dsh-topbar',
          '[data-dsh-titlebar]',
        ].join(',')
        const nodes = document.querySelectorAll ? document.querySelectorAll(sel) : []
        for (const n of nodes) {
          const nr = n.getBoundingClientRect && n.getBoundingClientRect()
          if (nr && nr.height > 0 && nr.top <= 1 && nr.height < 200) return Math.round(nr.bottom)
        }
      } catch (e) {
        /* 量不到就走默认值 */
      }
      return DEFAULT_HEADER_SAFE
    }

    function placePanel() {
      try {
        const el = (typeof document !== 'undefined' && document.querySelector('.dsh-pet-actor-wrap')) || runtime.rootEl
        const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null
        const vw = window.innerWidth || 1280
        const vh = window.innerHeight || 800
        if (!r || !r.height) {
          runtime.panelPos = null
          return
        }
        // 可用区域的上下边界：顶部让出顶栏，底部留边距
        const safeTop = headerSafeArea() + VIEW_MARGIN
        const availH = Math.max(160, vh - safeTop - VIEW_MARGIN)
        const spaceAbove = r.top - safeTop
        let right
        let bottom
        let maxHeight
        if (spaceAbove >= 300) {
          // 上方放得下：右边缘对齐，底边贴着她头顶
          right = Math.max(VIEW_MARGIN, vw - r.right)
          bottom = Math.max(VIEW_MARGIN, vh - r.top + PANEL_GAP)
          maxHeight = Math.min(spaceAbove, 560)
        } else {
          // 上方不够：放她左边，底边与她脚底对齐
          right = Math.max(VIEW_MARGIN, vw - r.left + PANEL_GAP)
          bottom = Math.max(VIEW_MARGIN, vh - r.bottom)
          maxHeight = Math.min(Math.max(r.height + 60, 260), 520)
        }
        // 夹取：right ∈ [8, vw-W-8] 保证左右都在视口内；
        // bottom 的上界由 maxHeight 反推，且不得超过「顶栏安全区」，
        // 否则面板顶部（含右上角 ×）会钻到顶栏底下。
        const maxH = Math.max(160, Math.min(maxHeight, availH))
        const rightMax = Math.max(VIEW_MARGIN, vw - PANEL_W - VIEW_MARGIN)
        const bottomMax = Math.max(VIEW_MARGIN, vh - safeTop - maxH)
        runtime.panelPos = {
          right: clamp(right, VIEW_MARGIN, rightMax) + 'px',
          bottom: clamp(bottom, VIEW_MARGIN, bottomMax) + 'px',
          maxHeight: maxH + 'px',
          width: PANEL_W + 'px',
        }
      } catch (e) {
        runtime.panelPos = null
      }
    }

    /* ================= 输入框悬停展开（1.22.0） ================= */

    /**
     * 用户要求：输入框平时不可见，鼠标移到人物上才滑出。
     *
     * 移开时延迟收起——人物与输入框之间有几像素间隙，鼠标穿过去的那一瞬间会先触发
     * actor 的 pointerleave、再进入输入框；不延迟就会闪一下再弹回来。200ms 够穿过去，
     * 又不至于让「移开」显得迟钝。
     */
    const HOVER_HIDE_DELAY = 200

    function setHover(on) {
      if (runtime.hoverTimer) {
        clearTimeout(runtime.hoverTimer)
        runtime.hoverTimer = null
      }
      if (on) {
        if (!runtime.hovering) {
          runtime.hovering = true
          notify()
        }
        return
      }
      runtime.hoverTimer = setTimeout(() => {
        runtime.hoverTimer = null
        if (!runtime.hovering) return
        runtime.hovering = false
        notify()
      }, HOVER_HIDE_DELAY)
    }

    /* ================= 心情循环 ================= */

    let lastChatterAt = 0

    function scheduleMood() {
      const p = persona()
      const prev = runtime.mood
      const m = weighted(p.temper)
      runtime.mood = m
      runtime.moodUntil = nowMs() + randInt(4000, 9000)
      if (runtime.settings.chatter && m !== 'talk' && m !== 'idle') {
        const line = randomLine(m)
        if (line && Math.random() < 0.55) statusBubble(line, null, m)
      }
      // 心情没变就不用重渲染（bubble 自己会 notify）
      if (m !== prev) notify()
    }

    function tick() {
      const now = nowMs()
      const s = runtime.settings

      // 失焦感知（1.26.0）：先更新安静态，后面所有「要不要出声」的判定都读它。
      // P2-10（2026-10-29 审计）：安静态不只是静音——进入时要打哈欠趴下（sleep），
      // 醒来时伸个懒腰；所以这里必须消费 syncQuiet 记下的边界（quietSince/wokeAt）。
      syncQuiet()

      // §11.1（审计标注「未证实」的兜底）：宿主不传 props.useSession 时，`running`
      // 永远是 false，于是 done 庆祝与 turnNotify（1.26 的头号功能）会静默失效。
      // 用 /ping 的 hostPhase 边沿推导一轮的开始/结束——只在没有 session hook 时启用，
      // 有 hook 时保持原语义（phase 只驱动表情，不驱动通知）。
      if (!runtime.sessionHookSeen) {
        const busy =
          runtime.hostPhase === 'working' ||
          runtime.hostPhase === 'thinking' ||
          runtime.hostPhase === 'tool' ||
          runtime.hostPhase === 'review'
        if (busy && !runtime.running) {
          runtime.running = true
          runtime.turnStartedAt = now
        } else if (!busy && runtime.running) {
          const dur = now - (runtime.turnStartedAt || now)
          runtime.running = false
          runtime.turnStartedAt = 0
          runtime.doneUntil = now + 4000
          if (runtime.settings.turnNotify && dur >= TURN_NOTIFY_MIN_MS) sendTurnNotify(dur)
        }
      }
      const quiet = isQuiet()
      if (quiet) {
        // quietSince 由 syncQuiet 在「进入安静」那一刻写入并一直保留到退出。
        // 用它做「已经换成 sleep 了没有」的幂等判据：tick 每 5s 都会进来。
        if (runtime.quietSince && runtime.mood !== 'sleep') {
          runtime.mood = 'sleep'
          runtime.moodUntil = now + 5 * 60 * 1000 // 睡着就别被随机心情打断
        }
      } else if (runtime.wokeAt) {
        // wokeAt 由 syncQuiet 在「刚醒来」那一刻写入：伸个懒腰，只播一次。
        // 有 hair（撩头发）片段/帧的形象用它，没有的只换个心情。
        playAction('hair', { moodDriven: true })
        runtime.mood = 'happy'
        runtime.moodUntil = now + 4000
        runtime.wokeAt = 0
      }

      // 阶段机：先算阶段，再按阶段给一点情绪反馈
      const prevPhase = runtime.phase
      syncPhase()
      if (runtime.phase !== prevPhase) {
        if (runtime.phase === 'error') {
          runtime.mood = 'angry'
          runtime.moodUntil = now + 3000
        } else if (runtime.phase === 'done' && runtime.settings.celebrate !== false) {
          runtime.mood = 'happy'
          runtime.moodUntil = now + 3500
        } else if (
          (runtime.phase === 'tool' || runtime.phase === 'working') &&
          runtime.mood === 'idle' &&
          runtime.visible
        ) {
          // 在调工具 / 模型推理时轻轻踱两步，别一直僵着（working 来自 R-02 宿主 thinking 投影）
          runtime.mood = 'walk'
          runtime.moodUntil = now + 3000
        } else if (runtime.phase === 'speak' && runtime.hostPhase === 'review' && runtime.visible && !runtime.action && !runtime.speaking) {
          // 回答在流（宿主 review）：让她撩着头发等字出来（R-02）
          playAction('hair')
        }
      }

      // 出现逻辑
      if (s.mode === 'always') {
        if (now < runtime.snoozeUntil) {
          if (runtime.visible) hidePet()
        } else if (!runtime.visible) {
          runtime.visible = true
          runtime.visibleUntil = 0
          if (s.chatter) statusBubble(randomLine('appear'), null, 'appear')
          notify()
        }
      } else {
        const inWindow = inActiveWindow(new Date(), s.activeStart, s.activeEnd)
        if (runtime.visible) {
          if (!runtime.visibleUntil) runtime.visibleUntil = now + randInt(45, 150) * 1000
          if (!inWindow || now > runtime.visibleUntil) hidePet()
        } else if (inWindow) {
          // probability 是「每小时出现概率」，换算成每个 tick 的概率
          const perTick = (clamp(s.probability, 0, 100) / 100) * (TICK_MS / 3600000)
          if (Math.random() < perTick) showPet('dance')
        }
      }

      // 气泡过期
      if (runtime.bubble && now - runtime.bubble.at > runtime.bubble.ttl) {
        runtime.bubble = null
        notify()
      }

      // 心声过期（比主台词短，先消失，看起来才像「嘀咕完就收」）
      if (runtime.aside && now - runtime.aside.at > runtime.aside.ttl) {
        runtime.aside = null
        notify()
      }

      // 语音兜底解锁：自动播放被浏览器拦掉时 onend 不会来
      if (runtime.speaking && runtime.speakUntil && now > runtime.speakUntil) {
        runtime.speaking = false
        runtime.speakUntil = 0
        if (runtime.mood === 'talk') runtime.mood = 'idle'
        notify()
      }

      // 心情轮换（跳舞期间锁住，别被随机心情打断；安静态保持 sleep 心情）
      if (!quiet && !runtime.stage && now > runtime.moodUntil && !runtime.speaking) scheduleMood()

      // 闲聊
      if (runtime.visible && s.chatter && !runtime.speaking && now - lastChatterAt > randInt(150, 300) * 1000) {
        lastChatterAt = now
        const line = randomLine('idle')
        if (line) statusBubble(line, null, 'idle')
      }

      // 偶尔撩一下头发（白天的「活人感」主要靠这个）——安静态不发任何自发动作
      if (!quiet && runtime.visible && !runtime.action && Math.random() < 0.008) playAction('hair')  // 自动发起：不显式、时长取片长（R02）

      // 低频恶作剧：墨水/起雾 ~2 小时一次，炸弹 ~4 小时一次（安静态不恶作剧）
      if (!quiet && s.chaos !== false && runtime.visible && !runtime.fx.length) {
        const roll = Math.random()
        if (roll < 0.00035) playFx('boom', { ttl: 2600 })
        else if (roll < 0.0011) playFx(Math.random() < 0.55 ? 'ink' : 'fog', { ttl: 6500 })
      }
    }

    const TICK_MS = 5000

    /* ================= 跟宠物单聊（一次性模型调用，不进会话） ================= */

    function petLog(...args) {
      try {
        console.info('[dsh-pet]', ...args)
      } catch (e) {
        /* ignore */
      }
    }

    const HISTORY_KEY = 'dsh-pet.history.v1'

    /** 历史条目只认 {role, content}：字符串（旧版本被 String() 成 "[object Object]" 的那批）一律丢弃 */
    function normalizeHistoryList(list) {
      const out = []
      for (const m of Array.isArray(list) ? list.slice(-64) : []) {
        if (!m || typeof m !== 'object' || Array.isArray(m)) continue
        const content = typeof m.content === 'string' ? m.content : ''
        if (!content.trim()) continue
        out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content })
      }
      return out.slice(-8)
    }

    function persistHistory(at) {
      try {
        window.localStorage.setItem(HISTORY_KEY, JSON.stringify(runtime.history.slice(-8)))
        setLocalStateAt(at || nowMs())
      } catch (e) {
        /* 隐私模式/配额满，忽略 */
      }
    }

    function pushHistory(role, content) {
      try {
        runtime.history.push({ role, content: String(content).slice(0, 800) })
        if (runtime.history.length > 8) runtime.history.splice(0, runtime.history.length - 8)
        // 刷新页面也不失忆：只留最近 8 条；P0-1：同时回传宿主（跨浏览器/清缓存不丢）
        persistHistory()
        runtime.historyDirty = true
        scheduleStatePush()
      } catch (e) {
        /* ignore */
      }
    }

    function loadHistory() {
      try {
        const raw = window.localStorage.getItem(HISTORY_KEY)
        const arr = raw ? JSON.parse(raw) : []
        runtime.history = normalizeHistoryList(arr)
        // 本地有历史就先当「待回传」：换设备时把本地历史推上去（有宿主状态时会先采纳宿主）
        runtime.historyDirty = runtime.history.length > 0
        if (Array.isArray(arr) && arr.length && !runtime.history.length) {
          petLog('dropped corrupt local history', { n: arr.length })
        }
      } catch (e) {
        runtime.history = []
      }
    }

    /** 清空聊天记忆（面板入口）：本地与宿主一起清，避免下次启动又被宿主旧历史灌回来 */
    function clearHistory() {
      runtime.history = []
      persistHistory()
      runtime.historyDirty = true
      scheduleStatePush()
      notify()
    }

    /**
     * 采纳宿主状态（P0-1，2026-10-29 审计）：只在「宿主那份更新」或「本地没有状态」时调用。
     * 与旧 mergeHostState 的区别：
     *   - 不再无条件「宿主每个键覆盖本地」——是否采纳由 updatedAt 决定（见 99-entry.js）；
     *   - 采纳时只落 localStorage，不立刻回传（否则两台机器会来回顶）；
     *   - 宿主里的历史若是旧格式（"[object Object]" 字符串），丢弃并保留本地那份，
     *     再把本地推上去把宿主文件冲干净（迁移只发生一次）。
     */
    function adoptHostState(host) {
      try {
        if (!host || typeof host !== 'object') return
        const at = Number(host.updatedAt) || 0
        if (host.settings && typeof host.settings === 'object' && !Array.isArray(host.settings)) {
          runtime.settings = normalizeSettings({ ...runtime.settings, ...host.settings })
          persistSettings(at)
        }
        let corrupted = false
        if (Array.isArray(host.history)) {
          const cleaned = normalizeHistoryList(host.history)
          if (cleaned.length) {
            runtime.history = cleaned
            persistHistory(at)
            runtime.historyDirty = false
          } else if (host.history.length) {
            corrupted = true
            petLog('host history corrupted, keeping local', { n: host.history.length })
          }
        }
        notify()
        if (corrupted) scheduleStatePush(0)
      } catch (e) {
        /* ignore */
      }
    }

    async function chatWithPet(text) {
      const body = {
        text,
        history: runtime.history.slice(-8),
        // 只给 id：人设文本留在宿主，页面无法往 system prompt 里塞东西
        personaId: runtime.settings.persona,
        lang: PET_LANG,
      }

      // 宿主注入的绝对地址最可靠（网页版与 dsh-app:// 壳都适用），
      // 没有注入时才退回同源相对路径。
      const urls = []
      const injected = typeof window !== 'undefined' && window.__DSH_PET_API__
      if (typeof injected === 'string' && injected) urls.push(injected)
      if (urls.indexOf('/dsh-pet/chat') === -1) urls.push('/dsh-pet/chat')

      let lastErr = null
      for (const url of urls) {
        // 客户端超时（R-09）：服务端默认 30s（可配到 120s），挂起的 fetch 不能
        // 让「……」气泡和 busy 状态一直挂到浏览器自身超时（约 5 分钟）。
        // P3-8（2026-10-29 审计）：90s 与服务端默认 30s 差太多，改成 45s
        // （默认超时 + 15s 余量）；服务端调大超时的用户仍能看到 504 文案。
        let ctrl = null
        let guard = 0
        if (typeof AbortController === 'function') {
          ctrl = new AbortController()
          guard = setTimeout(() => {
            try {
              ctrl.abort()
            } catch (e) {
              /* ignore */
            }
          }, 45000)
        }
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
            signal: ctrl ? ctrl.signal : undefined,
          })
          const raw = await res.text()
          let data = null
          try {
            data = JSON.parse(raw)
          } catch (e) {
            throw new Error('HTTP ' + res.status + ' 非 JSON')
          }
          if (!res.ok || !data.reply) {
            const err = new Error((data && (data.error || data.code)) || 'HTTP ' + res.status)
            // P3-8：4xx 是「这次请求/这个地址本身不行」，换下一个地址也没用
            //（429 只会在换地址后再赔一次额度，400 更是必然再失败）
            err.retryable = !(res.status >= 400 && res.status < 500)
            throw err
          }
          petLog('chat ok', { via: url })
          return String(data.reply)
        } catch (e) {
          lastErr = e
          petLog('chat attempt failed', { via: url, msg: String((e && e.message) || e) })
          if (e && e.retryable === false) break
        } finally {
          if (guard) clearTimeout(guard)
        }
      }
      throw lastErr || new Error('没有可用的接口地址')
    }

    function sayToPet(text) {
      const p = persona()
      pushHistory('user', text)
      runtime.ai = 'busy'
      bubble('……', 60000, 'chatHold')
      notify()
      chatWithPet(text)
        .then((reply) => {
          runtime.ai = 'ok'
          pushHistory('assistant', reply)
          bubble(reply, Math.max(3200, Math.min(12000, 900 + reply.length * 120)), 'chatAck')
        })
        .catch((e) => {
          runtime.ai = 'fail'
          const msg = String((e && e.message) || e)
          let origin = '?'
          let api = 'none'
          try {
            origin = window.location.origin || 'null'
            api = window.__DSH_PET_API__ ? 'injected' : 'none'
          } catch (err) {
            /* ignore */
          }
          // P2-7（2026-10-29 审计）：origin/api/上游原文只进 console。
          // 用户要看的是「她没听懂/稍后再试」，不是调试信息。
          petLog('chat failed', { msg, origin, api })
          if (/SIGN_IN|ACCOUNT|auth/i.test(msg)) {
            bubble(t('chat.needSignIn'), 6000, 'chatErr')
          } else if (/429|rate-limited|rate_limited/i.test(msg)) {
            bubble(t('chat.rateLimited'), 8000, 'chatErr')
          } else {
            bubble(pick(p.lines.error) || t('chat.stuck'), 12000, 'chatErr')
          }
        })
        .finally(() => notify())
    }

    /* ================= 样式 ================= */

    const CSS = `
.dsh-pet-layer{position:absolute;inset:0;pointer-events:none;z-index:60;
  /* 主题映射层：宿主换 token 只改这里 */
  --pet-fg:var(--dsw-alias-label-primary,#e9ecf1);
  --pet-bg:var(--dsw-alias-bg-layer-2,rgba(32,35,42,.96));
  --pet-bg-hover:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.08));
  --pet-border:var(--dsw-alias-border-l2,rgba(255,255,255,.12));
  --pet-accent:var(--dsw-alias-brand-primary,#5b8def);
  --pet-btn-bg:var(--dsw-alias-button-primary-fill,#4a6cf7);
  --pet-btn-fg:var(--dsw-alias-label-primary-inverted,#fff)}
.dsh-pet-root{position:absolute;right:26px;bottom:186px;z-index:60;display:flex;flex-direction:column;align-items:flex-end;gap:6px;
  max-height:calc(100vh - 190px);
  font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:var(--pet-fg);
  pointer-events:none;user-select:none;-webkit-user-select:none;touch-action:none}
/* 1.22.0：人物 + 输入框的共同悬停区。
   必须自己接收指针事件，事件才会沿父子链传上来；子元素原来的 pointer-events
   保持不变（人物/输入框是 auto，行容器是 none），所以不会多挡任何东西。
   间隙由根容器的 gap:6px 提供，这一层只做包裹，不影响原有排版。 */
.dsh-pet-hoverzone{pointer-events:auto;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.dsh-pet-toggle{pointer-events:auto;cursor:pointer;border:none;background:transparent;color:inherit;font-size:13px;line-height:1;
  padding:4px 6px;border-radius:8px;opacity:.65}
.dsh-pet-toggle{display:inline-flex;align-items:center;justify-content:center;gap:2px}
.dsh-pet-toggle svg.dsh-pet-mark{display:block;width:18px;height:18px}
.dsh-pet-badge-dot{width:5px;height:5px;border-radius:50%;background:#e0477a;box-shadow:0 0 4px rgba(224,71,122,.8)}
.dsh-pet-toggle:hover{opacity:1;background:var(--pet-bg-hover)}
.dsh-pet-root *{box-sizing:border-box}
/* 1.26.1：气泡/心声的浮层容器。
   必须绝对定位**脱离文档流**：.dsh-pet-root 在「拖动过/有保存位置」时是 top 锚定
   （bottom:auto），此时气泡若作为流内元素，一出现就会把下面的角色往下顶
   ——用户 2026-10-28 报「切表情时人物会位移，其实是气泡把她挤下去了」。
   浮在 root 上方后，人物位置与气泡有无完全无关。 */
.dsh-pet-top{position:absolute;right:0;bottom:calc(100% + 6px);display:flex;flex-direction:column;
  align-items:flex-end;gap:6px;max-width:min(260px,58vw);pointer-events:none}
.dsh-pet-bubble{pointer-events:auto;max-width:min(260px,58vw);padding:8px 11px;border-radius:12px;font-size:12.5px;line-height:1.5;
  white-space:pre-wrap;word-break:break-word;
  background:var(--pet-bg);border:1px solid var(--pet-border);
  box-shadow:0 6px 22px rgba(0,0,0,.28);position:relative;animation:dsh-pet-pop .18s ease-out}
.dsh-pet-bubble:after{content:"";position:absolute;right:22px;bottom:-5px;width:9px;height:9px;transform:rotate(45deg);
  background:var(--pet-bg);border-right:1px solid var(--pet-border);
  border-bottom:1px solid var(--pet-border)}
.dsh-pet-aside{pointer-events:none;max-width:min(230px,52vw);padding:2px 7px;border-radius:9px;font-size:11px;line-height:1.45;font-style:italic;font-family:var(--pet-font,inherit);color:inherit;opacity:.72;background:var(--pet-bg);border:1px solid var(--pet-border);white-space:pre-wrap;word-break:break-word;animation:dsh-pet-pop .18s ease-out}
.dsh-pet-aside:before{content:"( ")}
.dsh-pet-aside:after{content:" )"}
.dsh-pet-row{display:flex;align-items:flex-end;gap:6px;pointer-events:none}
/* 1.22.0：输入框默认收起，鼠标移到人物上才滑出（用户要求「平时不可见」）。
   showInput=off 时整行不渲染；auto 模式下由 .is-hidden 收起。
   收起用「位移+透明+不占指针」而不是 display:none —— 保留过渡，滑出才有方向感，
   且键盘 Tab 聚焦时能通过 :focus-within 重新展开，不至于把键盘用户挡在外面。 */
.dsh-pet-row.is-collapsible{transition:transform .22s ease,opacity .18s ease;transform-origin:right bottom}
.dsh-pet-row.is-hidden{opacity:0;transform:translateY(8px) scale(.96);pointer-events:none}
.dsh-pet-row.is-hidden .dsh-pet-input,
.dsh-pet-row.is-hidden .dsh-pet-send,
.dsh-pet-row.is-hidden .dsh-pet-dot{pointer-events:none}
/* 键盘可达：焦点落进来或被 hover 时立刻展开 */
.dsh-pet-row.is-hidden:focus-within{opacity:1;transform:none;pointer-events:auto}
@media (prefers-reduced-motion:reduce){
  .dsh-pet-row.is-collapsible{transition:none}
  .dsh-pet-row.is-hidden{transform:none}
}
.dsh-pet-input{pointer-events:auto;width:186px;font-size:12px;padding:6px 9px;border-radius:999px;outline:none;
  background:var(--pet-bg);color:inherit;
  border:1px solid var(--pet-border)}
.dsh-pet-input:focus{border-color:var(--pet-accent)}
.dsh-pet-dot{width:6px;height:6px;border-radius:50%;flex:0 0 auto;margin-bottom:10px;
  background:#8a8f9a;box-shadow:0 0 0 1px rgba(0,0,0,.25)}
.dsh-pet-dot.on{background:#3ecf8e;box-shadow:0 0 6px rgba(62,207,142,.55)}
.dsh-pet-dot.busy{background:#f5b942;animation:dsh-pet-pulse 1s ease-in-out infinite}
.dsh-pet-dot.bad{background:#e05a5a;box-shadow:0 0 6px rgba(224,90,90,.5)}
@keyframes dsh-pet-pulse{0%,100%{opacity:.35}50%{opacity:1}}
.dsh-pet-send{pointer-events:auto;border:none;border-radius:999px;width:26px;height:26px;padding:0;cursor:pointer;font-size:13px;
  background:var(--pet-btn-bg);color:var(--pet-btn-fg);
  display:flex;align-items:center;justify-content:center;transition:opacity .15s}
.dsh-pet-send[disabled]{opacity:.45;cursor:default}
.dsh-pet-actor{pointer-events:auto;cursor:grab;width:104px;height:104px;position:relative;
  transform-origin:center center;transition:transform 1.25s cubic-bezier(.4,0,.2,1)}
.dsh-pet-actor:active{cursor:grabbing}
.dsh-pet-actor svg{width:100%;height:100%;display:block;overflow:visible}
/* 1.26.1：图片形象的动感只由动作视频提供，CSS 不再自造位移/缩放/呼吸。
   之前漏了一处（用户 2026-10-28 二次反馈「还是能看到立绘摇摆」）：
   图片形象的元素同时带 .dsh-pet-body 与 .dsh-pet-figure 两个类，而基础规则
   .dsh-pet-body 挂着 dsh-pet-breathe（上下浮 1.5px）、.mood-walk 还有
   dsh-pet-stroll（±18px 横移）。只删 .mood-idle 那层不够，基础层仍在动。
   !important 是刻意的：要压过所有 .mood-* 与基础 .dsh-pet-body 规则。
   ⚠ 选择器必须写成后代形式限定在 .dsh-pet-layer 内（审计 R-03 回归门）：
   裸选择器 .dsh-pet-figure 会命中 DSH 应用里任何同名元素，作用域大于声明 ——
   tests/browser.mjs 的 reduced-motion 探针会判「宠物元素移出 layer 后动画
   仍被关掉」而红。
   ⚠ imgwrap 也要覆盖：探针优先取 .dsh-pet-imgwrap（没有才取 figure），
   只关 figure 的话探针在 layer 内测到的会是 imgwrap 的动画名。 */
.dsh-pet-layer .dsh-pet-figure{transform-origin:50% 100%;display:flex;align-items:flex-end;justify-content:center;height:100%;
  animation:none!important}
.dsh-pet-layer .dsh-pet-imgwrap{animation:none!important}
.dsh-pet-figbox{position:relative;height:100%;display:flex;align-items:flex-end}
.dsh-pet-img{height:100%;width:auto;display:block;
  filter:drop-shadow(0 7px 14px rgba(0,0,0,.32));user-select:none;-webkit-user-drag:none;pointer-events:none}
/* 1.26.1：静立不再自抖。用户 2026-10-28 反馈「立绘不要摇动或跳动」——
   原先这里叠了两层常驻动画（本行的 dsh-pet-alive + .mood-idle 的 fig-idle），
   呼吸缩放 + ±0.5deg 摆 + ±1.1deg 转，看起来像人物自己在抖。
   现在只有真正的动作（走路/撩头发/跳舞/转身，即 .mood-* 与视频片段）才动，
   静态立绘一律稳住。keyframes 保留：smoke 测试断言它存在，且日后可能复用。 */
.dsh-pet-imgwrap{position:relative;height:100%;display:flex;align-items:flex-end;justify-content:center;
  transform-origin:50% 100%}
/* 静帧水平对齐（1.26.1）：--img-x 是「相对图片自身宽度」的位移比例，
   用来修正个别形象表情立绘相对 idle 的横向偏移（azure 实测 3.5%~5%，
   切表情时会横向跳）。没有该变量时按 0 处理，等价旧行为。 */
.dsh-pet-imgwrap .dsh-pet-img{position:absolute;bottom:0;left:50%;
  transform:translateX(calc(-50% + (var(--img-x, 0) * 100%)))}
/* 1.16：动作视频（VP9 + alpha）—— 真 24fps，比翻帧顺得多 */
/* 1.19.3（R01）：静帧画在下面，video 只在真的开始播放后淡入（onPlaying 加 is-ready） */
.dsh-pet-clipbox{position:relative;height:100%;display:flex;align-items:flex-end;justify-content:center}
.dsh-pet-clipbox>.dsh-pet-imgwrap{position:absolute;inset:auto 0 0 0;height:100%}
/* 1.26.1：人物占比补偿。动作视频导出时四周留了透明边（人物只占画布 73%~97%），
   而立绘几乎顶满（~99%）。若两边都用 height:100%，切换动作时人物视觉大小会突跳
   （用户 2026-10-28 报「撩头发突然变小」）。pack.json 的 clipFit 给出每个片段的
   s（放大倍数，让人物与立绘同高）、y（下移比例，让脚底落在同一基线）、
   x（横向位移比例，把人物中心拉回立绘中心——裁切框按全片并集取，手臂偏向一侧
   时人物会整体偏出画布中心，不补就会看到「切片段时人往旁边跳」）。
   三个变量由 ClipLayer 内联写入；没有 clipFit 的自定义形象回落 1 / 0 / 0，即原行为。 */
.dsh-pet-video{position:absolute;bottom:calc(var(--clip-y, 0) * -100%);left:50%;
  transform:translateX(calc(-50% + (var(--clip-x, 0) * 100%)));
  height:calc(100% * var(--clip-s, 1));width:auto;display:block;object-fit:contain;opacity:0;
  filter:drop-shadow(0 7px 14px rgba(0,0,0,.32));pointer-events:none;background:transparent}
/* 播放起来就立即不透明：静帧是 poster，不是背景板；alpha 视频下若还留着静帧，
   舞蹈姿态一动就会透出底图，看起来像两个人物重叠 */
.dsh-pet-video.is-ready{opacity:1}
/* 动作结束时淡回立绘（R02 后续）：硬切在跳舞结尾切笑脸时最明显 */
.dsh-pet-video.is-leaving{opacity:0;transition:opacity .22s ease-out}
/* 1.26.1：换表情只做纯透明度交叉淡化，不再带位移与缩放。
   原来这里用「±3px 横移 + 0.6% 缩放 + 1px 模糊」模仿运动模糊，但作用在
   超写实静帧上时，用户看到的是「一切表情人物就往旁边跳一下」（2026-10-28
   反馈「表情切换时人物的位置会变化」）。所以改成纯淡入淡出。
   注意：位移里必须带上 --img-x（静帧对齐补偿），否则动画期间会盖掉它。
   --pet-dx 保留在变量里，CrossImage 仍会写，只是不再参与变换。 */
.dsh-pet-img-cur{animation:dsh-pet-img-in .18s ease-out}
.dsh-pet-img-prev{animation:dsh-pet-img-out .18s ease-out forwards}
@keyframes dsh-pet-img-in{
  from{opacity:0;filter:blur(1px) drop-shadow(0 7px 14px rgba(0,0,0,.32));
    transform:translateX(calc(-50% + (var(--img-x, 0) * 100%)))}
  to{opacity:1;filter:blur(0) drop-shadow(0 7px 14px rgba(0,0,0,.32));
    transform:translateX(calc(-50% + (var(--img-x, 0) * 100%)))}
}
@keyframes dsh-pet-img-out{
  from{opacity:1;filter:blur(0) drop-shadow(0 7px 14px rgba(0,0,0,.32));
    transform:translateX(calc(-50% + (var(--img-x, 0) * 100%)))}
  to{opacity:0;filter:blur(1px) drop-shadow(0 7px 14px rgba(0,0,0,.32));
    transform:translateX(calc(-50% + (var(--img-x, 0) * 100%)))}
}
/* 1.26.1：dsh-pet-alive（呼吸+髋摆）keyframes 已删 —— 它挂在 .dsh-pet-imgwrap 上，
   只服务图片形象，而图片形象的动画已被 animation:none!important 全局禁用，
   属死代码。SVG 形象不用 imgwrap。 */
.dsh-pet-gear{position:absolute;right:-2px;top:-2px;pointer-events:auto;cursor:pointer;border:none;border-radius:999px;
  width:20px;height:20px;font-size:11px;line-height:1;opacity:0;transition:opacity .15s;
  background:var(--pet-bg);color:inherit;border:1px solid var(--pet-border)}
.dsh-pet-actor-wrap:hover .dsh-pet-gear{opacity:1}
/* —— 设置面板 —— */
/* 面板独立悬浮在宠物上方，不进 flex 流：否则会被压扁并在内部滚动 */
/* 设置面板：贴紧右边缘、更窄，并抬到宠物上方 —— 原先 right:24/bottom:170 会把她整个人盖住 */
.dsh-pet-panelwrap{position:fixed;right:10px;bottom:262px;z-index:80;
  pointer-events:auto;display:flex;flex-direction:column;align-items:flex-end;
  max-height:calc(100vh - 278px)}

.dsh-pet-panel{pointer-events:auto;width:196px;padding:8px 9px 9px;border-radius:11px;font-size:11px;line-height:1.32;
  background:var(--pet-bg);border:1px solid var(--pet-border);
  box-shadow:0 12px 34px rgba(0,0,0,.42);display:flex;flex-direction:column;gap:5px;
  max-height:100%;overflow-y:auto;overscroll-behavior:contain;
  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.dsh-pet-panel::-webkit-scrollbar{width:6px}
.dsh-pet-panel::-webkit-scrollbar-thumb{background:var(--pet-border);border-radius:3px}
.dsh-pet-panel h4{margin:0 0 1px;font-size:12px;font-weight:600;display:flex;justify-content:space-between;align-items:center;letter-spacing:.02em}
.dsh-pet-panel .x{cursor:pointer;opacity:.55;border:none;background:none;color:inherit;font-size:14px;line-height:1;padding:0 2px}
.dsh-pet-panel .x:hover{opacity:1}
.dsh-pet-sec{font-size:9.5px;letter-spacing:.14em;opacity:.42;margin:3px 0 0;text-transform:uppercase;flex:0 0 auto}
.dsh-pet-sep{height:1px;background:var(--pet-border);opacity:.65;margin:4px 0 2px}
.dsh-pet-field{display:flex;align-items:center;gap:6px;min-height:22px;flex:0 0 auto}
.dsh-pet-field.wide{display:block}
.dsh-pet-field .lb{flex:0 0 34px;opacity:.62}
.dsh-pet-field .val{flex:0 0 auto;min-width:34px;text-align:right;font-variant-numeric:tabular-nums;opacity:.72}
.dsh-pet-panel input[type=time]{font-size:10.5px;padding:1px 3px;border-radius:5px;
  background:transparent;color:inherit;border:1px solid var(--pet-border);color-scheme:dark}
.dsh-pet-panel input[type=range]{flex:1;min-width:0;height:14px;accent-color:var(--pet-accent)}
.dsh-pet-grid2{display:grid;grid-template-columns:1fr 1fr;gap:3px 8px;margin:1px 0;flex:0 0 auto}

/* 自定义开关。P2-11（2026-10-29 审计）：旧写法 input{display:none} 让 Tab 永远
   跳过这些开关（键盘完全无法操作）。改成「视觉隐藏但可聚焦」的写法，
   并给 :focus-visible 一个可见轮廓——鼠标用户的观感不变，键盘用户能用空格切换。 */
.dsh-pet-tg{display:flex;align-items:center;gap:5px;cursor:pointer;user-select:none;min-height:19px;position:relative}
.dsh-pet-tg input{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
  clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;opacity:0}
.dsh-pet-tg i{position:relative;flex:0 0 auto;width:22px;height:12px;border-radius:999px;
  background:var(--pet-border);transition:background .16s}
.dsh-pet-tg i:after{content:"";position:absolute;top:1.5px;left:1.5px;width:9px;height:9px;border-radius:50%;
  background:var(--pet-bg);transition:transform .16s}
.dsh-pet-tg input:checked + i{background:var(--pet-accent)}
.dsh-pet-tg input:checked + i:after{transform:translateX(10px)}
.dsh-pet-tg input:focus-visible + i{outline:2px solid var(--pet-accent);outline-offset:2px}
.dsh-pet-tg input:focus-visible ~ span{opacity:1;text-decoration:underline}
.dsh-pet-tg span{opacity:.78;font-size:11px}

/* 自定义下拉（不用原生 select：Windows 弹出层是白底，深色主题下看不清） */
.dsh-pet-sel{position:relative;flex:0 0 auto}
.dsh-pet-sel-btn{width:100%;display:flex;align-items:center;justify-content:space-between;gap:6px;
  font:inherit;font-size:11px;color:inherit;text-align:left;cursor:pointer;
  padding:3px 7px;border-radius:6px;background:transparent;border:1px solid var(--pet-border)}
.dsh-pet-sel-btn:hover{background:var(--pet-bg-hover)}
.dsh-pet-sel-btn .v{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pet-sel-btn .a{opacity:.5;font-size:9px}
.dsh-pet-sel.open .dsh-pet-sel-btn{border-color:var(--pet-accent)}
.dsh-pet-sel-list{display:flex;flex-direction:column;gap:1px;margin-top:3px;padding:2px;
  border:1px solid var(--pet-border);border-radius:7px;background:var(--pet-bg)}
.dsh-pet-sel-item{font:inherit;font-size:11px;text-align:left;color:inherit;cursor:pointer;
  padding:3px 6px;border-radius:5px;background:transparent;border:none}
.dsh-pet-sel-item:hover{background:var(--pet-bg-hover)}
.dsh-pet-sel-item.on{color:var(--pet-accent);font-weight:600}

.dsh-pet-seg{display:flex;gap:3px;flex:0 0 auto}
.dsh-pet-seg button{flex:1;font:inherit;font-size:10.5px;padding:3px 0;border-radius:5px;cursor:pointer;color:inherit;
  background:transparent;border:1px solid var(--pet-border);white-space:nowrap}
.dsh-pet-seg button:hover{background:var(--pet-bg-hover)}
.dsh-pet-seg button.on{background:var(--pet-accent);border-color:transparent;color:#fff}
.dsh-pet-seg button.danger:hover{color:#e05a5a;border-color:#e05a5a}

/* —— 动作 —— */
@keyframes dsh-pet-pop{from{transform:translateY(4px) scale(.96);opacity:0}to{transform:none;opacity:1}}
@keyframes dsh-pet-breathe{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}
@keyframes dsh-pet-hop{0%,100%{transform:translateY(0)}35%{transform:translateY(-9px)}60%{transform:translateY(0)}}
@keyframes dsh-pet-dance{0%{transform:rotate(-9deg) translateY(0)}25%{transform:rotate(0) translateY(-5px)}
  50%{transform:rotate(9deg) translateY(0)}75%{transform:rotate(0) translateY(-5px)}100%{transform:rotate(-9deg) translateY(0)}}
@keyframes dsh-pet-shy{0%,100%{transform:scale(1,1)}50%{transform:scale(1.06,.94)}}
@keyframes dsh-pet-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-3px)}40%{transform:translateX(3px)}
  60%{transform:translateX(-2px)}80%{transform:translateX(2px)}}
@keyframes dsh-pet-stroll{0%,100%{transform:translateX(0)}50%{transform:translateX(-26px)}}
@keyframes dsh-pet-blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.12)}}
@keyframes dsh-pet-talk{0%,100%{transform:scaleY(.5)}50%{transform:scaleY(1.25)}}
@keyframes dsh-pet-sway{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}

.dsh-pet-body{transform-origin:70px 112px;animation:dsh-pet-breathe 3.4s ease-in-out infinite}
.mood-walk .dsh-pet-body{animation:dsh-pet-stroll 3.6s ease-in-out infinite,dsh-pet-breathe 1.1s ease-in-out infinite}
.mood-dance .dsh-pet-body{animation:dsh-pet-dance .9s ease-in-out infinite}
.mood-shy .dsh-pet-body{animation:dsh-pet-shy 1.5s ease-in-out infinite}
.mood-angry .dsh-pet-body{animation:dsh-pet-shake .42s linear infinite}
.mood-happy .dsh-pet-body{animation:dsh-pet-hop .85s ease-in-out infinite}
.mood-talk .dsh-pet-body{animation:dsh-pet-breathe 2s ease-in-out infinite}
.dsh-pet-eye{transform-origin:center;animation:dsh-pet-blink 5.2s infinite}
.mood-sleep .dsh-pet-eye{animation:none}
.dsh-pet-mouth{transform-origin:center}
.mood-talk .dsh-pet-mouth{animation:dsh-pet-talk .22s ease-in-out infinite}
.dsh-pet-tail{transform-origin:96px 96px;animation:dsh-pet-sway 2.6s ease-in-out infinite}
.mood-angry .dsh-pet-tail{animation:dsh-pet-sway .5s ease-in-out infinite}
.dsh-pet-zzz{font-size:11px;opacity:.7}

/* 1.26.1：立绘的 CSS 动作（fig-* 系列）已整体移除。
   原因：.dsh-pet-figure 上的 animation:none!important（见上方）让这些规则永远赢不了，
   成了死代码；而它们描述的「走路步幅/跳舞摆动/呼吸」在 1.26.1 起由动作视频真实呈现，
   CSS 自造的位移正是用户报的「立绘摇摆」。README 里对应的步幅描述同步删除。
   SVG 形象（仅示例包）走的仍是 .dsh-pet-body 那套，不受影响。 */
.mood-poked .dsh-pet-body{animation:dsh-pet-hop .6s ease-out 2}

/* —— 立绘的表情贴纸（没有五官层时唯一的“表情”） —— */
.dsh-pet-marks{position:absolute;inset:0;pointer-events:none}
.dsh-pet-layer .fx-mark{position:absolute;font-style:normal;line-height:1}
.dsh-pet-layer .fx-mark.blush{width:18px;height:10px;border-radius:50%;
  background:radial-gradient(closest-side,rgba(255,120,150,.55),rgba(255,120,150,0) 72%);
  filter:blur(.6px);animation:dsh-pet-mark-in .5s ease-out both}
.dsh-pet-layer .fx-mark.sweat{width:5px;height:7px;border-radius:50% 50% 50% 50%/60% 60% 40% 40%;
  background:rgba(140,200,255,.85);box-shadow:0 0 3px rgba(140,200,255,.6);animation:dsh-pet-mark-in .55s .15s ease-out both}
.dsh-pet-layer .fx-mark.vein{font-size:13px;animation:dsh-pet-mark-pulse .6s ease-in-out infinite alternate}
.dsh-pet-layer .fx-mark.zzz{font-size:12px;opacity:.75;color:var(--pet-fg);
  animation:dsh-pet-mark-float 2.4s ease-in-out infinite}
.dsh-pet-layer .fx-mark.zzz.z2{font-size:9px;animation-delay:.6s}
.dsh-pet-layer .fx-mark.spark{font-size:12px;animation:dsh-pet-mark-pulse .9s ease-in-out infinite alternate}
@keyframes dsh-pet-mark-in{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:scale(1)}}
@keyframes dsh-pet-mark-pulse{from{opacity:.55;transform:scale(.9)}to{opacity:1;transform:scale(1.12)}}
@keyframes dsh-pet-mark-float{0%{opacity:0;transform:translateY(0) scale(.8)}
  30%{opacity:.85}100%{opacity:0;transform:translateY(-9px) scale(1.1)}}

/* —— 视线跟随 —— */
.dsh-pet-pupils{transform:translate(var(--gx,0px),var(--gy,0px));transition:transform .1s linear}

/* —— 特效层 —— */
.dsh-pet-fx{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:80}
.dsh-pet-fx-ink,.dsh-pet-fx-confetti,.dsh-pet-fx-boom{position:absolute;inset:0}
.dsh-pet-fx-ink i{position:absolute;opacity:0;animation:fx-ink-in 3.6s ease-out forwards;
  filter:drop-shadow(0 3px 4px rgba(0,0,0,.28))}
.dsh-pet-fx-ink i svg{width:100%;height:100%;display:block;overflow:visible}
@keyframes fx-ink-in{
  0%{transform:scale(.35);opacity:0}
  16%{transform:scale(1.06);opacity:.92}
  28%{transform:scale(1);opacity:.9}
  78%{opacity:.82}
  100%{opacity:0}
}
.dsh-pet-fx-confetti i{position:absolute;top:0;border-radius:1px;opacity:0;
  animation-name:fx-confetti-fall;animation-timing-function:linear;animation-fill-mode:forwards}
@keyframes fx-confetti-fall{
  0%{transform:translate3d(0,-10vh,0) rotate(0);opacity:0}
  8%{opacity:1}
  100%{transform:translate3d(var(--drift,0px),110vh,0) rotate(var(--rot,360deg));opacity:.85}
}
.dsh-pet-fx-cloud{position:absolute;right:96px;top:96px;width:120px;height:108px;opacity:0;
  animation:fx-cloud-in 4s ease-out forwards}
.dsh-pet-fx-cloud svg{width:100%;height:100%;overflow:visible}
@keyframes fx-cloud-in{
  0%{transform:translate(-30px,-8px) scale(.7);opacity:0}
  18%{transform:none;opacity:1}
  78%{opacity:1}
  100%{transform:translate(18px,-14px);opacity:0}
}
.dsh-pet-layer .fx-bolt{animation:fx-bolt-flash 4s linear infinite}
@keyframes fx-bolt-flash{0%,40%,44%,100%{opacity:.12}42%,46%{opacity:1}}
.dsh-pet-layer .fx-rain{opacity:.45;animation:fx-rain-drop 1.1s linear infinite}
@keyframes fx-rain-drop{0%{transform:translateY(-6px);opacity:0}30%{opacity:.6}100%{transform:translateY(9px);opacity:0}}
.dsh-pet-fx-fog{position:absolute;inset:0;width:100%;height:100%;pointer-events:auto;cursor:crosshair;
  animation:fx-fog-fade 7s ease-in-out forwards}
@keyframes fx-fog-fade{0%{opacity:0}10%{opacity:1}82%{opacity:1}100%{opacity:0}}
.dsh-pet-layer .fx-bomb{position:absolute;width:26px;height:26px;opacity:0;
  animation:fx-bomb-fly 1.5s cubic-bezier(.35,0,.9,.55) forwards}
.dsh-pet-layer .fx-bomb svg{width:100%;height:100%;display:block;overflow:visible}
.dsh-pet-layer .fx-spark{animation:fx-spark-pulse .28s ease-in-out infinite alternate}
@keyframes fx-spark-pulse{from{opacity:.4;transform:scale(.8)}to{opacity:1;transform:scale(1.25)}}
@keyframes fx-bomb-fly{
  0%{transform:translate(0,0) scale(.4) rotate(0deg);opacity:0}
  10%{transform:translate(0,0) scale(1) rotate(0deg);opacity:1}
  60%{transform:translate(var(--tx,0),calc(var(--ty,0) * .45)) scale(1.05) rotate(180deg);opacity:1}
  100%{transform:translate(var(--tx,0),var(--ty,0)) scale(.5) rotate(360deg);opacity:0}
}
.dsh-pet-layer .fx-shake{position:absolute;inset:0;animation:fx-shake-k 2.6s ease-out forwards}
@keyframes fx-shake-k{
  0%,44%{transform:translate(0,0)}
  46%{transform:translate(-5px,3px)}
  48%{transform:translate(5px,-4px)}
  50%{transform:translate(-4px,-3px)}
  52%{transform:translate(3px,4px)}
  54%{transform:translate(-2px,1px)}
  57%,100%{transform:translate(0,0)}
}
.dsh-pet-layer .fx-flash{position:absolute;inset:0;background:#fff;opacity:0;animation:fx-flash 2.4s ease-out forwards}
@keyframes fx-flash{0%,44%{opacity:0}46%{opacity:.75}49%{opacity:0}100%{opacity:0}}
.dsh-pet-layer .fx-crack{position:absolute;inset:0;width:100%;height:100%;opacity:0;animation:fx-crack-in 2.6s ease-out forwards;
  color:var(--pet-fg);filter:drop-shadow(0 1px 0 rgba(255,255,255,.5))}
@keyframes fx-crack-in{0%,45%{opacity:0}48%{opacity:1}78%{opacity:.8}100%{opacity:0}}
.dsh-pet-layer .fx-impact{transform-box:fill-box;transform-origin:50% 50%;opacity:0;animation:fx-impact 2.6s ease-out forwards}
@keyframes fx-impact{
  0%,45%{opacity:0;transform:scale(.3)}
  48%{opacity:.95;transform:scale(1)}
  58%{opacity:.45;transform:scale(1.7)}
  70%,100%{opacity:0;transform:scale(2.1)}
}
.dsh-pet-menu-mask{position:fixed;inset:0;z-index:80;pointer-events:auto}
.dsh-pet-menu{position:fixed;min-width:132px;padding:4px;border-radius:10px;background:var(--pet-bg);border:1px solid var(--pet-border);box-shadow:0 12px 32px rgba(0,0,0,.28);display:flex;flex-direction:column;gap:2px}
.dsh-pet-menu-item{appearance:none;border:0;background:transparent;color:var(--pet-fg);text-align:left;font:inherit;font-size:12.5px;padding:7px 10px;border-radius:7px;cursor:pointer}
.dsh-pet-menu-item:hover{background:rgba(127,127,127,.16)}
/* 阶段机（P3-15，2026-10-29 审计）：data-phase 此前没有任何 CSS 消费者（死属性）。
   这里只给三个「需要你注意」的阶段一个极轻的齿轮配色提示——不做位移/缩放，
   保持用户「不要摇摆」的约束。data-phase 同时挂在 actor 与 actor-wrap 上。 */
.dsh-pet-layer .dsh-pet-actor-wrap[data-phase="error"] .dsh-pet-gear{color:#ff6b7d}
.dsh-pet-layer .dsh-pet-actor-wrap[data-phase="working"] .dsh-pet-gear{color:var(--pet-accent)}
.dsh-pet-layer .dsh-pet-actor-wrap[data-phase="tool"] .dsh-pet-gear{animation:dsh-pet-pulse 1.4s ease-in-out infinite}

/* 渲染兜底（P1-2）：PetBoundary 捕获到渲染异常时显示的最小占位，样式不依赖任何 pack 数据 */
.dsh-pet-layer .dsh-pet-fallback{position:absolute;right:26px;bottom:186px;display:flex;align-items:center;gap:6px;
  max-width:220px;padding:8px 10px;border-radius:10px;font-size:12px;line-height:1.5;
  background:var(--pet-bg);border:1px solid var(--pet-border);color:var(--pet-fg)}
.dsh-pet-fallback-mark{font-size:14px;line-height:1}

/* ===== 减弱动效（1.19.3 R10）：统一策略，不再按类名逐条列举 =====
   旧写法只列了 ink/confetti/cloud/bomb/crack/flash 六个选择器，漏了 bolt（闪电频闪）、
   rain、spark、shake（整层震屏）、impact，以及所有表情贴纸的 mark-*。这里一次关断：
   动画全部取消、过渡时长归零、特效层不显示。视频的自动播放由 JS 侧
   （runtime.reduced + playAction 的 explicit 白名单）负责，CSS 管不到。
   ⚠ 必须带 .dsh-pet-layer 作用域（2026-10-28 审计 R-03）：这份 CSS 是 <style> 直接
   注进宿主文档的（没有 shadow DOM），裸 * 会把整个 DSH 应用的动画一并关掉。
   菜单/面板/特效层都是 .dsh-pet-layer 的 DOM 子孙；输入框旁 🐾 按钮在另一个
   slot，但它没有 animation 声明，不受影响。 */
@media (prefers-reduced-motion:reduce){
  .dsh-pet-layer *,.dsh-pet-layer *::before,.dsh-pet-layer *::after{animation:none!important;transition-duration:.001ms!important;transition-delay:0s!important}
  .dsh-pet-fx{display:none!important}
}
`

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

    /**
     * P1-2（2026-10-29 审计）：SVG 分支无条件读 p.colors.*，缺了就抛 TypeError
     * 把整个 overlay slot 打白。注册表已按渲染契约收口，这里再兜一层——
     * 旧客户端缓存的 pack、或 setPersonas 直接灌进来的数据也不至于让 UI 消失。
     */
    const SAFE_COLORS = {
      body: '#8a8f99',
      body2: '#6f747d',
      belly: '#d8dbe0',
      accent: '#f2a0b5',
      eye: '#2b2f36',
    }

    function PetArt({ persona: p, mood }) {
      const c = (p && p.colors) || SAFE_COLORS
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
        if (patch.persona && patch.persona !== prevPersona) {
          clearAction()
          // P3-14（2026-10-29 审计）：聊天记忆是全局的（不按形象分），换形象时提示一次，
          // 免得用户以为「换了人就换了记忆」；想清掉用下面的「清空聊天记忆」。
          if (runtime.history.length) bubble(t('hint.memoryShared'), 6000, 'chatAck')
        }
        // P2-4：用户重新打开「神经」开关 = 明确要求再试一次——把本会话的降级状态清掉，
        // 否则「切回开关也不恢复」。
        if (patch.neuralVoice === true) resetNeural()
        saveSettings()
        notify()
        if (patch.persona || patch.ttsVoice || patch.neuralVoice === true) {
          setTimeout(() => warmVoice(), 50)
        }
      }
      // R-01：下拉读运行期注册表（宿主 /personas 换表后这里跟着变），不再钉死内置四只
      const personaMap = PERSONA_REG.map
      const personaOpts = Object.keys(personaMap).map((k) => {
        const it = personaMap[k]
        // 自定义形象可能没写 tag：有才拼「名字 · 标签」，没有就只显示名字
        const tag = PET_LANG === 'zh' || !it.tagEn ? it.tag : it.tagEn
        return { value: k, label: it.name + (tag ? ' · ' + tag : '') }
      })
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
      const voiceLabel = s.ttsVoice && s.ttsVoice !== 'auto' ? s.ttsVoice : (p.voice && p.voice.voiced && p.voice.voiced[PET_LANG]) || 'auto'
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
          ? h(
              'div',
              { className: 'dsh-pet-hint' },
              // 2026-10-30：把宿主给的原因带出来。「不可用」三个字没有信息量——
              // 用户没法区分「没装依赖」「没网」「被限流」，只能来问作者。
              runtime.neuralReason
                ? t('hint.neuralOff') + '：' + runtime.neuralReason
                : t('hint.neuralOff'),
            )
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
          // 1.22.0：输入框平时收起、悬停才滑出（默认）；也可切成常显
          h(Toggle, {
            label: t('panel.inputHover'),
            checked: s.inputMode !== 'always',
            onChange: (v) => update({ inputMode: v ? 'hover' : 'always' }),
          }),
          h(Toggle, { label: t('panel.chatter'), checked: s.chatter, onChange: (v) => update({ chatter: v }) }),
          h(Toggle, { label: t('panel.celebrate'), checked: s.celebrate !== false, onChange: (v) => update({ celebrate: v }) }),
          // 1.26.0：跑完提醒。打开时申请浏览器通知权限——权限请求必须挂在
          // 用户手势回调里（浏览器会拒绝非手势触发的请求），这个 onClick 就是手势。
          // 被拒/不可用时回弹为 off，不能假装开着。
          h(Toggle, {
            label: t('panel.turnNotify'),
            checked: s.turnNotify !== false,
            onChange: async (v) => {
              if (!v) {
                update({ turnNotify: false })
                return
              }
              const perm = await requestNotifyPermission()
              if (perm === 'granted') update({ turnNotify: true })
              else {
                // 回弹：权限没给到，这个开关不能停留在开
                update({ turnNotify: false })
                if (typeof bubble === 'function') bubble(t('hint.notifyDenied'), 4000, 'chatErr')
              }
            },
          }),
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
          // P3-14：聊天记忆的显式出口（此前只能靠浏览器清缓存）
          h('button', { onClick: () => clearHistory() }, t('panel.clearMemory')),
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
                // 软复位（R-13，2026-10-28 审计）：不再 location.reload()——那会重载
                // 整个 DSH 应用，殃及宿主未保存的状态。聊天历史不清（reload 行为也不清它）。
                runtime.settings = loadSettings()
                runtime.dragPos = null
                runtime.autoPos = null
                clearAction()
                // P0-1：重置也要回传宿主，否则下次加载又被宿主旧快照覆盖回去（重置不生效）
                saveSettings()
                placePanel()
                notify()
              },
            },
            t('panel.resetAll'),
          ),
        ),
      )
    }

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
    // 「走到屏幕中间跳一段」的两种实现：
    //   ① 有 clips.stage（一条「走进来 → 中间跳 → 走回去」的单镜头片段）时，只播这一条，
    //      位移交给相位排程 —— 全片一个镜头，没有片段切换点，也就没有「抖一下」。
    //   ② 没有 stage 片段的老形象，仍走「walk 片段 + dance 片段 + 两次平移」。
    let stageGen = 0

    /** 舞台相位：按片长百分比收尾，避免再写死 5167/7100 这种数字。 */
    function planStage(gen, clip, delay) {
      const ms = clipMsOf(clip)
      const at = (frac, fn) => {
        const wait = Math.max(0, Math.round(ms * frac) - delay)
        later(() => {
          if (gen !== stageGen) return
          try {
            fn()
          } catch (e) {
            /* 单个相位失败不影响后续 */
          }
        }, wait)
      }
      // 30%~70% 是片段自己的舞蹈窗口：这时候撒花 + 台词，不要去动 stage（会打断表演）
      at(0.32, () => {
        playFx('confetti', { ttl: 4200 })
        bubble(randomLine('dance'), 3200, 'dance')
        notify()
      })
      at(0.7, () => {
        // 走回去：位置先回角落，片段里她本来就在迈步
        runtime.stage = { tx: 0, ty: 0, zoom: 1 }
        notify()
      })
      at(0.99, () => {
        runtime.stage = null
        runtime.mood = 'idle'
        runtime.moodUntil = nowMs() + 3000
        stageGen++
        notify()
      })
    }

    function runToCenterAndDance() {
      try {
        // 减弱动效（R10）：不搬到屏幕中间、不撒花，只在原地放一次舞。
        // 这是用户显式点播（面板「跳一段」/庆祝），所以动作本身仍然放行。
        if (runtime.reduced) {
          playAction('dance', { explicit: true })
          bubble(randomLine('dance'), 3200, 'dance')
          notify()
          return
        }
        const el = runtime.rootEl
        if (!el) return
        if (runtime.stage) return
        const actor = el.querySelector('.dsh-pet-actor')
        if (!actor) return
        const ar = actor.getBoundingClientRect()
        const host = (el.parentElement || document.body).getBoundingClientRect()
        const dx = host.width / 2 - (ar.left - host.left + ar.width / 2)
        const dy = Math.max(20, host.height / 2 - (ar.top - host.top + ar.height / 2) - 20)
        const p = persona()
        const stageClip = p.clips && p.clips.stage ? p.clips.stage : null
        if (stageClip) {
          // 一条连贯片段（1.20.0）：不切片段，位移按片长百分比排程
          const gen = ++stageGen
          runtime.stage = { tx: Math.round(dx), ty: Math.round(dy), zoom: 1.8 }
          runtime.mood = 'stage'
          runtime.moodUntil = nowMs() + clipMsOf(stageClip)
          bubble(randomLine('idle'), 2400, 'idle')
          notify()
          // 片长要等 media metadata（~200ms 内到）；先等一拍再按真实时长排相位
          later(() => {
            if (gen === stageGen) planStage(gen, stageClip, 200)
          }, 200)
          return
        }
        runtime.stage = { tx: Math.round(dx), ty: Math.round(dy), zoom: 1.8 }
        runtime.mood = 'walk'
        runtime.moodUntil = nowMs() + 1700
        bubble(randomLine('idle'), 2400, 'idle')
        notify()
        // 舞蹈窗口与片段对齐（R02）：6000ms 会让 5.167s 的片段在 loop 处跳回；
        // 后续两个收尾时点按「舞 stop 之后 250ms / 1950ms」平移。
        later(() => {
          runtime.mood = 'dance'
          runtime.moodUntil = nowMs() + 5167
          playFx('confetti', { ttl: 4200 })
          bubble(randomLine('dance'), 3200, 'dance')
          notify()
        }, 1650)
        // 裸 setTimeout 不受 clearLater 管辖（R08）：统一走 later，卸载时一起清
        later(() => {
          runtime.stage = { tx: 0, ty: 0, zoom: 1 }
          runtime.mood = 'walk'
          runtime.moodUntil = nowMs() + 1700
          notify()
        }, 7100)
        later(() => {
          runtime.stage = null
          runtime.mood = 'idle'
          runtime.moodUntil = nowMs() + 3000
          notify()
        }, 8800)
      } catch (e) {
        petLog('dance failed', String((e && e.message) || e))
      }
    }

    function PetOverlay() {
      useRuntime()
      if (!runtime.mountLogged) {
        runtime.mountLogged = true
        petLog('pet mounted', { slot: 'shell.overlay' })
      }
      const s = runtime.settings
      const p = persona()
      const [text, setText] = useState('')
      const rootRef = useRef(null)
      // 心情切到跳舞/走路时，自动播对应的动作序列
      useEffect(() => {
        const name =
          runtime.mood === 'dance' || runtime.mood === 'walk' || runtime.mood === 'stage'
            ? runtime.mood
            : null
        if (name) {
          const pid = persona().id
          if (!runtime.action || runtime.action.name !== name || runtime.action.persona !== pid) {
            // 时长交给片段本身（R02）：心情先变就由下面的 clearAction 收回
            playAction(name, { moodDriven: true })
          }
        } else if (runtime.action && runtime.action.moodDriven && runtime.action.name !== 'hair') {
          // 只收回「心情自己发起」的动作；用户点“跳一段”发起的要让它跳完
          // （否则一次工具报错把 mood 打成 angry，舞就断了）
          clearAction()
        }
      }, [runtime.mood])
      const mood = runtime.mood

      // 自愈：宿主的浮层参照系不一定是窗口（可能被滚动容器/transform 带偏）。
      // 只量「她本人」那块：气泡和设置面板本来就可能顶出视口上沿，
      // 拿整个 root 去判会误伤——点开设置就以为她跑丢了。
      useEffect(() => {
        if (!runtime.visible) return undefined
        const t = setTimeout(() => {
          try {
            const el = rootRef.current
            if (!el) return
            // 面板开着的时候不判：面板高度会把 root 撑出视口，属于正常
            if (runtime.panelOpen) return
            const actor = el.querySelector('.dsh-pet-actor') || el
            const r = actor.getBoundingClientRect()
            const vw = window.innerWidth
            const vh = window.innerHeight
            const host = (el.parentElement || document.body).getBoundingClientRect()
            // 只有「整个人都不在视口里」才算丢了；露出半个身子不动她
            const gone =
              r.width === 0 ||
              r.height === 0 ||
              r.right < 0 ||
              r.left > vw ||
              r.bottom < 0 ||
              r.top > vh
            if (!gone) {
              if (runtime.petOffscreen) {
                runtime.petOffscreen = false
                notify()
              }
              return
            }
            runtime.petOffscreen = true
            // 被拖出视口 = 看不见她 → 立刻闭嘴（音画同步，见 src/50-voice.js 的 onScreen）
            try {
              stopVoice()
            } catch (e) {
              /* ignore */
            }
            // 用户拖过的位置如果已经跑到视口外（换窗口大小/换显示器），
            // 手动的锚点会被保留，那就永远看不见了 —— 这里直接丢掉旧位置。
            if (runtime.settings.pos) {
              runtime.settings.pos = null
              runtime.autoPos = null
              saveSettings()
              petLog('dropped saved pos (off-screen)')
              notify()
              return
            }
            if (runtime.dragPos) return
            runtime.autoPos = {
              x: Math.max(0, Math.min(host.width - r.width, vw - host.left - r.width - 26)),
              y: Math.max(0, Math.min(host.height - r.height, vh - host.top - r.height - 186)),
            }
            petLog('repositioned', {
              rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
              host: { w: Math.round(host.width), h: Math.round(host.height) },
              to: runtime.autoPos,
            })
            notify()
          } catch (e) {
            /* ignore */
          }
        }, 60)
        return () => clearTimeout(t)
      }, [runtime.visible, runtime.panelOpen, s.pos, runtime.resizeTick])

      if (!runtime.visible) {
        // P1-1（2026-10-29 审计）：整份 CSS 就挂在这个组件里，而 🐾 按钮（另一个 slot）
        // 的全部样式也只存在于这份 CSS。旧写法藏着时直接 return null，样式表跟着消失，
        // 输入框旁唯一的「叫回来」按钮就变成裸 <button>——正是最需要它的时候。
        // 现在藏着也常驻一个只带 <style> 的轻壳：样式不消失，也不必反复解析 26KB CSS。
        return h('div', { className: 'dsh-pet-layer dsh-pet-layer-idle' }, h('style', null, CSS))
      }

      // 输入框的显示方式（1.22.0）：hover = 悬停才滑出（默认）；always = 常显。
      // 聊天框已经打开、或鼠标正停在人物上时，视为「应该展开」。
      const inputHoverMode = s.inputMode !== 'always'
      const inputShown = !inputHoverMode || runtime.hovering || runtime.inputPinned
      const rowClass = 'dsh-pet-row' + (inputHoverMode ? ' is-collapsible' : '') + (inputShown ? '' : ' is-hidden')

      const baseScale = clamp(s.scale, 0.6, 2)
      const style = { '--pet-scale': String(baseScale) }
      // 跳舞时只抬高层级；位移和放大都加在 actor 上，输入框不要跟着跑
      if (runtime.stage) style.zIndex = 90
      // 拖动 > 手动保存 > 自愈落点 > 默认右下角
      const pos = runtime.dragPos || s.pos || runtime.autoPos
      if (pos) {
        // 坐标可能来自旧版本/旧尺寸，落地前先夹到视口内，别让气泡被窗口切掉
        const vw = window.innerWidth || 1200
        const vh = window.innerHeight || 800
        style.left = Math.round(Math.max(8, Math.min(pos.x, vw - 160))) + 'px'
        style.top = Math.round(Math.max(8, Math.min(pos.y, vh - 140))) + 'px'
        style.right = 'auto'
        style.bottom = 'auto'
      }

      const onSend = () => {
        const v = text.trim()
        if (!v) return
        setText('')
        sayToPet(v)
      }

      const onPoke = () => {
        const roll = Math.random()
        const m = roll < 0.5 ? 'poked' : roll < 0.72 ? 'shy' : roll < 0.9 ? 'dance' : 'angry'
        runtime.mood = m
        runtime.moodUntil = nowMs() + 3500
        bubble(randomLine('poked'), 3600, 'poked')
        notify()
      }

      const onPointerDown = (e) => {
        if (e.button !== 0) return
        if (runtime.stage) return
        const el = rootRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const host = (el.parentElement || document.body).getBoundingClientRect()
        const originX = rect.left - host.left
        const originY = rect.top - host.top
        const startX = e.clientX
        const startY = e.clientY
        let moved = false
        const onMove = (ev) => {
          const dx = ev.clientX - startX
          const dy = ev.clientY - startY
          if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return
          moved = true
          runtime.dragPos = {
            x: clamp(originX + dx, 0, Math.max(0, host.width - rect.width)),
            y: clamp(originY + dy, 0, Math.max(0, host.height - rect.height)),
          }
          notify()
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          if (moved) {
            runtime.settings.pos = runtime.dragPos
            runtime.dragPos = null
            saveSettings()
            petLog('moved', runtime.settings.pos)
            // 被拖到新位置后说一句（1.21.0）：台词分类 drag，缺这类台词的形象保持安静
            const line = dragLine()
            if (line && Math.random() < 0.6) bubble(line, null, 'drag')
          } else {
            onPoke()
          }
          notify()
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
      }

      return h(
        'div',
        { className: 'dsh-pet-layer' },
        // 样式表放在 layer 的第一子节点：隐藏态渲染的是「layer > style」，
        // 可见态是「layer > style + root…」——同一个父节点、同一个下标，
        // React 会复用同一个 <style> 节点，show/hide 不再反复解析 26KB CSS。
        h('style', null, CSS),
        h(
          'div',
          {
            className: 'dsh-pet-root',
            style,
            ref: (el) => {
              rootRef.current = el
              runtime.rootEl = el
            },
          },
        runtime.panelOpen
          ? h('div', { className: 'dsh-pet-panelwrap', style: runtime.panelPos || undefined }, h(SettingsPanel))
          : null,
        // 1.26.1：气泡/心声必须绝对定位，不能参与 .dsh-pet-root 的 flex 流。
        // 原因：root 在「拖动过/有保存位置」时改成 top 锚定（见上面 style 里
        // bottom:'auto'），此时气泡作为流内元素一出现就会把下面的角色往下顶——
        // 用户 2026-10-28 报「切表情时人物往下位移，其实是气泡把她挤下去了」。
        // 现在气泡浮在 root 上方（bottom:100%），人物位置与气泡有无完全解耦。
        runtime.bubble || runtime.aside
          ? h(
              'div',
              { className: 'dsh-pet-top' },
              runtime.bubble
                // 读屏语义（2026-10-28 审计④a）：闲聊/心情台词是装饰，aria-hidden 别打断读屏；
                // 只有用户发起、在等回复的那几类（单聊回复/错误/外部播报）才是 polite 实时区
                ? h(
                    'div',
                    {
                      className: 'dsh-pet-bubble',
                      ...(runtime.bubble.kind === 'chatAck' || runtime.bubble.kind === 'chatErr' || runtime.bubble.kind === 'announce'
                        ? { role: 'status', 'aria-live': 'polite' }
                        : { 'aria-hidden': 'true' }),
                    },
                    runtime.bubble.text,
                  )
                : null,
              runtime.aside
                ? h('div', { className: 'dsh-pet-aside', 'aria-hidden': 'true' }, runtime.aside.text)
                : null,
            )
          : null,
        // 1.22.0（用户 2026-10-27 反馈）：悬停区域必须同时覆盖「人物」和「输入框」。
        // 首版只把事件挂在人物本体上 → 鼠标刚离开人物、还没到输入框，pointerleave 就
        // 触发了，200ms 宽限也只是延迟这一下，所以「很难命中，偶尔能进去」。
        // 现在把两者放同一个容器里，鼠标在「人物 ↔ 输入框」之间移动都不算离开。
        h(
          'div',
          {
            className: 'dsh-pet-hoverzone',
            onPointerEnter: () => setHover(true),
            onPointerLeave: () => setHover(false),
          },
        h(
          'div',
          // 1.22.0（用户要求）：输入框平时不可见，鼠标移到人物上才滑出。
          // inputMode='always' 或 showInput=false 时退回旧行为（后者整行不渲染内容）。
          { className: rowClass },
          s.showInput
            ? h('span', {
                className:
                  'dsh-pet-dot' +
                  (runtime.ai === 'ok' ? ' on' : '') +
                  (runtime.ai === 'fail' ? ' bad' : '') +
                  (runtime.ai === 'busy' ? ' busy' : ''),
                title:
                  runtime.ai === 'busy'
                    ? t('dot.thinking')
                    : runtime.ai === 'ok'
                      ? t('dot.ok')
                      : runtime.ai === 'fail'
                        ? t('dot.fail')
                        : t('dot.idle'),
              })
            : null,
          s.showInput
            ? h('input', {
                className: 'dsh-pet-input',
                value: text,
                placeholder: t('placeholder.chat', { name: p.name }),
                onChange: (e) => setText(e.target.value),
                onKeyDown: (e) => {
                  // 中文输入法选词时的回车不能当成发送
                  const composing = e.nativeEvent && (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)
                  if (e.key === 'Enter' && !e.shiftKey && !composing) {
                    e.preventDefault()
                    onSend()
                  }
                  if (e.key === 'Escape') e.currentTarget.blur()
                },
                // 1.22.0：聚焦即钉住——鼠标点进来的途中输入框不会先收起来；
                // 失焦再交还给 hover 逻辑。键盘 Tab 进来同样有效。
                onFocus: () => {
                  runtime.inputPinned = true
                  notify()
                },
                onBlur: () => {
                  runtime.inputPinned = false
                  notify()
                },
                'aria-label': t('a11y.talkTo', { name: p.name }),
              })
            : null,
          s.showInput
            ? h(
                'button',
                {
                  className: 'dsh-pet-send',
                  onClick: onSend,
                  disabled: !text.trim(),
                  title: t('a11y.send'),
                  'aria-label': t('a11y.send'),
                },
                '↑',
              )
            : null,
        ),
        h(
          'div',
          // P3-15（2026-10-29 审计）：data-phase 之前没有任何 CSS 消费者（死属性）。
          // 这里把阶段也挂到 wrap 上，样式表据此给齿轮一个极轻的状态提示。
          { className: 'dsh-pet-actor-wrap', 'data-phase': runtime.phase, style: { position: 'relative' } },
          h(
            'div',
            {
              className: 'dsh-pet-actor mood-' + mood,
              onPointerDown: onPointerDown,
              // 右键菜单（F3）：比齿轮面板快得多，竞品都是这么做的
              onContextMenu: (e) => {
                try {
                  e.preventDefault()
                  e.stopPropagation()
                } catch (err) {
                  /* ignore */
                }
                const cx = e && e.clientX ? e.clientX : 0
                const cy = e && e.clientY ? e.clientY : 0
                runtime.menu = { x: cx, y: cy }
                runtime.panelOpen = false
                notify()
              },
              'data-phase': runtime.phase,
              title: p.name + ' · ' + p.tag + t('actor.tip'),
              style: {
                // 用真实尺寸缩放而不是 transform：占位一起变大，
                // 输入框会被顶上去，不会被她的头顶住
                width: Math.round((p.image ? 124 : 104) * baseScale) + 'px',
                height: Math.round((p.image ? 200 : 104) * baseScale) + 'px',
                transform: runtime.stage
                  ? 'translate(' +
                    runtime.stage.tx +
                    'px,' +
                    runtime.stage.ty +
                    'px) scale(' +
                    (runtime.stage.zoom || 1) +
                    ')'
                  : 'none',
                transformOrigin: 'center center',
              },
            },
            h(PetArt, { persona: p, mood }),
          ),
          h(
            'button',
            {
              className: 'dsh-pet-gear',
              title: t('panel.settings'),
              'aria-label': t('panel.settings'),
              onClick: (e) => {
                e.stopPropagation()
                runtime.panelOpen = !runtime.panelOpen
                // 面板按她的当前位置摆，别把她盖住
                if (runtime.panelOpen) placePanel()
                notify()
              },
            },
            '⚙',
          ),
        ),
        ),
        ), // .dsh-pet-hoverzone
        h(FxLayer),
        h(PetMenu),
      )
    }

    /* ================= 渲染兜底（P1-2，2026-10-29 审计） ================= */

    /**
     * 最小安全占位：真实数据/组件出问题时回落到这一块，而不是让整个 slot 条目白屏。
     * 只画一个静态标记 + 一行诊断，不依赖 persona、不读任何运行时数据。
     */
    function PetFallback() {
      // 外面再包一层 .dsh-pet-layer：样式表里的兜底规则作用在这个作用域内
      return h(
        'div',
        { className: 'dsh-pet-layer' },
        h(
          'div',
          { className: 'dsh-pet-fallback', role: 'status' },
          h('span', { className: 'dsh-pet-fallback-mark', 'aria-hidden': 'true' }, '🐾'),
          h('span', null, t('hint.renderFailed')),
        ),
      )
    }

    // React 的错误边界只能是 class 组件。测试里的 React 桩没有 Component
    //（它们直接调用组件函数、不走 React 渲染），所以这里按能力挂载：
    // 真 React 下生效，桩环境退化成直通（数据层兜底由 PetArt / voiceParams / weighted 负责）。
    const ReactComponent = React && typeof React.Component === 'function' ? React.Component : null
    let PetBoundary = null
    if (ReactComponent) {
      PetBoundary = class PetBoundary extends ReactComponent {
        constructor(props) {
          super(props)
          this.state = { failed: false }
        }
        static getDerivedStateFromError() {
          return { failed: true }
        }
        componentDidCatch(err) {
          petLog('render crashed', String((err && err.message) || err))
        }
        render() {
          return this.state.failed ? h(PetFallback, null) : this.props.children
        }
      }
    }

    /** slot 入口：把 PetOverlay 包进 boundary（渲染期异常不再让整个 slot 条目白屏） */
    function PetRoot() {
      return PetBoundary ? h(PetBoundary, null, h(PetOverlay)) : h(PetOverlay)
    }

    /** 右键菜单：只做高频动作，设置还是走齿轮面板 */
    function PetMenu() {
      useRuntime()
      const menu = runtime.menu
      const boxRef = useRef(null)
      // 键盘可达（R16）：打开时把焦点移进菜单，Esc 关闭并把焦点还回去。
      // （全屏遮罩是模态菜单的常见做法，本身不算漏洞；缺的是键盘出口。）
      useEffect(() => {
        if (!menu) return undefined
        let prevFocus = null
        try {
          prevFocus = document.activeElement
        } catch (e) {
          prevFocus = null
        }
        const onKey = (e) => {
          if (!e || e.key !== 'Escape') return
          try {
            e.preventDefault()
            e.stopPropagation()
          } catch (err) {
            /* ignore */
          }
          runtime.menu = null
          notify()
        }
        try {
          document.addEventListener('keydown', onKey, true)
        } catch (e) {
          /* ignore */
        }
        try {
          const first = boxRef.current && boxRef.current.querySelector('button')
          if (first && first.focus) first.focus()
        } catch (e) {
          /* ignore */
        }
        return () => {
          try {
            document.removeEventListener('keydown', onKey, true)
          } catch (e) {
            /* ignore */
          }
          try {
            if (prevFocus && prevFocus.focus) prevFocus.focus()
          } catch (e) {
            /* ignore */
          }
        }
      }, [menu ? menu.x + ':' + menu.y : ''])
      if (!menu) return null
      const close = () => {
        runtime.menu = null
        notify()
      }
      const item = (label, onClick) =>
        h(
          'button',
          {
            className: 'dsh-pet-menu-item',
            role: 'menuitem',
            onClick: (e) => {
              try {
                e.stopPropagation()
              } catch (err) {
                /* ignore */
              }
              close()
              try {
                onClick()
              } catch (err) {
                /* ignore */
              }
            },
          },
          label,
        )
      // 跟随点击位置，但不许出界
      let x = menu.x
      let y = menu.y
      try {
        const vw = window.innerWidth || 1280
        const vh = window.innerHeight || 800
        x = Math.max(8, Math.min(x, vw - 150))
        y = Math.max(8, Math.min(y, vh - 210))
      } catch (e) {
        /* ignore */
      }
      return h(
        'div',
        {
          className: 'dsh-pet-menu-mask',
          onPointerDown: close,
          onContextMenu: (e) => { try { e.preventDefault() } catch (err) {} close() },
          // 键盘可达（R-08）：Escape 直接关掉，不用非得点一下遮罩
          onKeyDown: (e) => {
            if (e.key === 'Escape') {
              try { e.stopPropagation() } catch (err) {}
              close()
            }
          },
        },
        h(
          'div',
          {
            className: 'dsh-pet-menu',
            ref: boxRef,
            style: { left: x + 'px', top: y + 'px' },
            role: 'menu',
            'aria-label': t('panel.actions'),
            onPointerDown: (e) => {
              try {
                e.stopPropagation()
              } catch (err) {
                /* ignore */
              }
            },
          },
          item(t('panel.dance'), () => runToCenterAndDance()),
          item(t('panel.hair'), () => playAction('hair', { explicit: true })),
          // 勿扰（1.26.0）：与失焦自动安静共用同一个判定（src/55-focus.js）。
          // 开着的时候再点一次是「结束勿扰」，不用去设置里找开关。
          item(dndRemainingMs() ? t('panel.dontDisturbOn') : t('panel.dontDisturb'), () =>
            toggleDontDisturb(),
          ),
          // 不叫它「叫出来」：藏起来后她整个人不渲染（96-overlay.js:91 返回 null），
          // 这个菜单根本点不到。她看得见的时候，这一项的真实作用是「延长停留」。
          // 把她叫回来请用输入框旁的 🐾 按钮或 /dsh-pet 叫出来。
          item(t('panel.stay'), () => showPet()),
          item(t('panel.hide'), () => hidePet(3600 * 1000)),
          item(t('panel.settings'), () => {
            runtime.panelOpen = true
            placePanel()
            notify()
          }),
        ),
      )
    }

    /** 输入框右侧的 🐾 按钮：宠物不见了/被挡住了，用它把它叫回来。 */
    function PetToggle(props) {
      useRuntime()
      const useSession = props && props.useSession
      // P3-2（2026-10-29 审计）：不能在组件体里条件调用 hook——
      // `typeof useSession === 'function' ? useSession(...) : false` 一旦宿主某次不传
      // 该 prop，React 就报 "Rendered more hooks"。改成按需挂一个只负责观测的
      // 子组件：hook 在子组件里无条件调用，不传就整块不挂（返回 null，不改布局）。

      return h(
        'button',
        {
          className: 'dsh-pet-toggle' +
            (runtime.petOffscreen && runtime.visible ? ' ' + 'offscreen' : ''),
          // 她藏起来时（!visible）这颗按钮就是唯一的「叫出来」入口，
          // 所以悬停标题要跟着变成「叫出来」，而不是一直写「桌面伴侣」。
          title: !runtime.visible
            ? t('panel.summon')
            : runtime.petOffscreen
              ? t('pet.toggleOff')
              : t('pet.toggle'),
          'aria-label': !runtime.visible ? t('panel.summon') : t('pet.toggle'),
          onClick: () => {
            if (!runtime.visible || runtime.petOffscreen) {
              runtime.settings.pos = null
              runtime.dragPos = null
              runtime.autoPos = null
              runtime.petOffscreen = false
              saveSettings()
              showPet('appear')
            } else {
              runtime.panelOpen = !runtime.panelOpen
              // P2-12（2026-10-29 审计）：从 🐾 打开面板也要按她的位置摆
              //（齿轮与右键菜单都调了 placePanel，只有这里漏了）
              if (runtime.panelOpen) placePanel()
              notify()
            }
          },
        },
        h(SessionWatcher, { useSession }),
        h(PetMark),
        runtime.petOffscreen && runtime.visible ? h('i', { className: 'dsh-pet-badge-dot' }) : null,
      )
    }

    /**
     * 宿主会话状态观测（P3-2）。只渲染 null，副作用写进 runtime：
     * 一轮结束时触发庆祝与「跑完了」通知。
     *
     * 宿主没传 useSession 时用一个恒定返回 false 的兜底 hook——hook 仍**无条件**调用，
     * 调用顺序不变（这正是 P3-2 要避免的那个崩法）。此时「一轮在跑」由 tick 里的
     * hostPhase 边沿兜底推导（见 60-behavior.js 的 §11.1 注释）。
     */
    function useNoSession() {
      return false
    }

    function SessionWatcher({ useSession }) {
      const hook = typeof useSession === 'function' ? useSession : useNoSession
      if (typeof useSession === 'function') runtime.sessionHookSeen = true
      const running = !!hook((s) => s && s.running)
      // 事件联动：一轮跑完就庆祝。长活（>20s）她会跑到中间跳一段，
      // 短活只撒花；跳舞还要求窗口在前台 + 10 分钟冷却，免得打断你。
      useEffect(() => {
        const prev = runtime.lastRunning
        if (running && !prev) runtime.turnStartedAt = nowMs()
        if (!running && prev && runtime.turnStartedAt) {
          const dur = nowMs() - runtime.turnStartedAt
          // 阶段机：刚结束给一个 done 窗口（会换成开心/庆祝的表情）
          runtime.doneUntil = nowMs() + 4000
          if (syncPhase()) notify()
          // 失焦通知（1.26.0）：你不在时才弹。通知有独立的 turnNotify 开关，
          // 不挂在 celebrate 下——庆祝是「她在我面前高兴」，通知是「叫我回来验收」。
          if (runtime.settings.turnNotify) sendTurnNotify(dur)
          if (dur > 4000 && runtime.settings.celebrate !== false) {
            let focused = true
            try {
              focused = document.hasFocus()
            } catch (e) {
              focused = true
            }
            const canDance =
              !runtime.reduced && // 减弱动效时不搬到中间跳舞（R10）
              dur > 20000 &&
              focused &&
              runtime.visible &&
              !runtime.stage &&
              nowMs() - (runtime.lastDanceAt || 0) > 10 * 60000
            if (canDance) {
              runtime.lastDanceAt = nowMs()
              petLog('celebrate: dance', { dur })
              runToCenterAndDance()
            } else {
              playFx('confetti', { ttl: 4200 })
            }
          }
        }
        if (!running) runtime.turnStartedAt = 0
        runtime.lastRunning = running
        // 阶段机需要知道「会话是否在跑」；写在 render 里，tick/轮询共用
        runtime.running = running
        if (syncPhase()) notify()
      }, [running])
      return null
    }

    /** 输入框右侧的标记：跟插件 icon 同一个剪影。 */
    function PetMark() {
      return h(
        "svg",
        { viewBox: '0 0 1024 1024', width: 18, height: 18, 'aria-hidden': 'true', className: 'dsh-pet-mark' },
        h('path', { fill: '#e95573', d: "M811.008 770.048q-9.216 1.024-19.456 3.584t-18.432 5.632q-10.24 4.096-19.456 9.216-2.048-11.264 1.024-22.528 2.048-10.24 8.192-21.504t20.48-22.528q25.6-17.408 60.928-21.504t66.048 8.192 48.128 42.496 6.144 82.432q-9.216 41.984-37.888 76.288t-76.288 52.736-112.128 17.408-144.384-28.672q-55.296-19.456-87.04-48.64t-47.616-59.904-18.944-57.856-1.024-42.496 12.8-37.888 22.016-43.008q13.312-24.576 29.696-50.176 8.192-13.312 14.336-25.6 5.12-11.264 8.192-22.528t0-21.504q-10.24-26.624-25.6-40.96t-29.696-21.504q-17.408-7.168-35.84-8.192-25.6-1.024-47.104-6.144-18.432-5.12-36.352-13.312t-26.112-25.6q-9.216-17.408-7.68-35.84t7.168-36.352 11.776-34.304 6.144-28.672q0-32.768-34.816-46.08-45.056-11.264-67.584-9.216t-31.744 8.704-9.216 12.288 0 1.536q0 14.336 3.584 36.864t-3.584 43.008q-5.12 12.288-13.824 23.04t-14.848 19.968q-8.192 13.312-13.824 23.04t-4.608 12.8q2.048 4.096 9.728 5.632t11.776 3.584q5.12 3.072 6.656 9.728t7.68 11.776q10.24 10.24 12.288 17.408 1.024 4.096 0 7.168 0 8.192 1.024 19.456 1.024 9.216 2.56 20.992t4.608 23.04q6.144 26.624 14.336 37.376t19.968 13.312 28.16 0.512 39.936-2.048q17.408 1.024 35.84 1.024t32.768 8.192 22.528 22.528 13.312 28.672q4.096 17.408 6.144 35.84 3.072 23.552 3.072 47.104 0 20.48-2.048 44.544t-10.24 47.616q-17.408 48.128-51.2 71.68t-72.704 30.72q-40.96 8.192-77.824 2.048t-66.56-20.48-48.64-34.816-23.04-40.96q-3.072-16.384-0.512-32.256t7.68-30.72 12.288-28.16 12.288-25.6q9.216-19.456 11.264-34.304t0-25.088q-2.048-11.264-8.192-20.48-9.216-10.24-19.456-21.504-8.192-10.24-17.408-22.016t-15.36-26.112q-20.48-41.984-21.504-77.824 0-15.36 0.512-37.376t7.68-41.472q6.144-16.384 30.208-43.52t53.76-70.144q6.144-12.288 10.752-25.6t7.168-24.576 3.584-19.456 1.024-11.264q0-10.24-1.024-22.528t-2.048-25.6q0-6.144-1.024-20.48t2.56-31.744 12.8-35.328 28.672-32.256q15.36-11.264 36.352-15.872t39.424-5.632q21.504-1.024 45.056 1.024 19.456-7.168 40.96-11.264 18.432-4.096 43.008-7.168t51.2-3.072q89.088 2.048 149.504 27.136t99.328 61.44 59.392 78.848 29.696 78.848 10.752 61.44 1.536 26.112q1.024 17.408 12.288 31.744t26.112 29.184 30.72 30.208 27.136 33.792q21.504 38.912 23.552 69.632t-8.192 54.272-28.672 40.448-37.376 28.16-34.816 17.408-19.968 8.192q-33.792 15.36-51.712 33.792t-24.064 36.864-2.56 35.84 14.848 29.696q7.168 9.216 18.432 15.36t23.04 9.216 22.528 3.584 17.92-1.536q16.384-3.072 27.136-14.848t12.8-25.088-5.632-22.528-27.136-8.192z" }),
      )
    }

    /* ================= 开发期自检出口（不影响插件契约） ================= */
    try {
      if (typeof globalThis !== 'undefined') {
        // 自检出口默认不挂：生产环境别把 runtime / 台词 / 特效入口交给页面任意脚本。
        // 需要时在控制台执行 localStorage.setItem('dsh-pet.debug','1') 再刷新，
        // 或给页面 URL 加 ?petdebug=1。
        let petDebug = false
        try {
          petDebug =
            window.localStorage.getItem('dsh-pet.debug') === '1' ||
            /[?&]petdebug=1/.test(String(window.location.search || ''))
        } catch (e) {
          petDebug = false
        }
        if (petDebug) {
          globalThis.__dshPet = {
            runtime,
            // R-01：debug 出口也读运行期注册表（与下拉一致）。
            // 用 getter：/personas 整表替换后，旧引用会指向上一个对象（P1-2 回归测试踩到）。
            get PERSONAS() {
              return PERSONA_REG.map
            },
            setPersonas,
            inActiveWindow,
            toMinutes,
            weighted,
            pick,
            tick,
            showPet,
            hidePet,
            bubble,
            asideLine,
            dragLine,
            linesOf,
            maybeAside,
            clearAside,
            // 跨设备状态（P0-1）：台架直接驱动「采纳宿主状态 / 回传」，不用等轮询时序
            adoptHostState,
            pushStateNow,
            localStateAt,
            saveSettings,
            clearHistory,
            loadHistory,
            // 导演层（1.21.0）：心情 + 语言 → 音色 / 音高 / 语速 / 音量
            voiceParams,
            playFx,
            notify,
            runToCenterAndDance,
            // 失焦感知（1.26.0）：安静态判定要能被台架直接问到，
            // 否则只能靠肉眼观察「她是不是真的闭嘴了」。
            isQuiet,
            quietReason,
            isAddressedKind,
            isFocused,
            syncQuiet,
            toggleDontDisturb,
            dndRemainingMs,
            QUIET_AFTER_MS,
            DONT_DISTURB_MS,
            // 失焦通知（1.26.0）：降级链与自证统计，台架要能直接驱动与断言
            probeNotify,
            requestNotifyPermission,
            sendTurnNotify,
            titlePrefix,
            notifyStats,
            TURN_NOTIFY_MIN_MS,
            TURN_NOTIFY_COOLDOWN_MS,
            // 片段时长（1.20.0）：媒体 metadata 到手后写进 runtime.clipMs，
            // 收尾时间按真实片长重排；台架走同一个入口固定这条规则。
            noteClipDuration,
            PetArt,
            CSS,
            // 自检用：当前语言 + 任意心情会抽到的那句台词 / 当前生效的文案
            lang: () => PET_LANG,
            lineFor: (mood) => randomLine(mood || 'appear'),
            text: (key) => t(key),
            setLang,
            syncLangOverride,
            // 阶段机（1.11.0）：读当前阶段 / 立即重算
            phase: () => computePhase(),
            syncPhase,
            hidePet,
            showPet,
            playAction,
            placePanel,
            headerSafeArea,
            setHover,
          }
        }
      }
    } catch (e) {
      /* ignore */
    }

    /* ================= 插件入口 ================= */

    return {
      inject: ['slots'],
      apply(ctx) {
        // 减弱动效（R10）：读一次，随后跟随系统设置变化
        runtime.reduced = prefersReduced()
        ctx.effect(() => {
          let mq = null
          const onChange = () => {
            const next = prefersReduced()
            if (next === runtime.reduced) return
            runtime.reduced = next
            if (next) clearAction()
            notify()
          }
          // DSH 的 Electron/Chromium 版本都支持 MediaQueryList.addEventListener
          try {
            mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
            if (mq && mq.addEventListener) mq.addEventListener('change', onChange)
          } catch (e) {
            mq = null
          }
          return () => {
            try {
              if (mq) mq.removeEventListener('change', onChange)
            } catch (e) {
              /* ignore */
            }
          }
        })
        ctx.effect(() => {
          // 失焦感知（1.26.0）：安静态的事件源。与 tick 同生命周期，
          // 卸载函数由 watchFocus 返回，统一在这里清理。
          const stopFocus = watchFocus()
          runtime.timer = setInterval(() => {
            try {
              tick()
            } catch (e) {
              /* 引擎异常不能拖垮整页 */
            }
          }, TICK_MS)
          // 常驻模式立刻出现
          try {
            lastChatterAt = nowMs()
            // P0-1：老用户升级时给现有本地设置补一个时间戳，避免被宿主旧快照按 updatedAt 压回去
            ensureLocalStateAt()
            loadHistory()
            if (runtime.settings.mode === 'always') showPet('appear')
            setTimeout(() => warmVoice(), 2500)
          } catch (e) {
            /* ignore */
          }
          // 窗口尺寸变了要重新量一次（可能把她挤到视口外）
          let resizeTimer = 0
          const onResize = () => {
            clearTimeout(resizeTimer)
            resizeTimer = setTimeout(() => {
              runtime.resizeTick++
              // 面板是 fixed 定位的：窗口变了必须重新夹取，否则会留在视口外（R11）
              if (runtime.panelOpen) placePanel()
              notify()
            }, 250)
          }
          try {
            window.addEventListener('resize', onResize)
          } catch (e) {
            /* ignore */
          }
          return () => {
            try {
              window.removeEventListener('resize', onResize)
            } catch (e) {
              /* ignore */
            }
            clearTimeout(resizeTimer)
            if (runtime.timer) clearInterval(runtime.timer)
            runtime.timer = null
            try {
              stopFocus()
            } catch (e) {
              /* ignore */
            }
            clearLater()
            stopVoice()
          }
        })

        // 视线跟随：只写 CSS 变量，不触发 React 重渲染。
        // 照片形象（五只内置全是）没有瞳孔层 .dsh-pet-pupils——那是 SVG 形象专用的；
        // 对它们来说每次 mousemove 的 getBoundingClientRect 是纯开销，还是强制 reflow
        //（2026-10-28 审计④b）。先查形象再动手。
        ctx.effect(() => {
          const onMove = (e) => {
            try {
              if (persona().image) return
              const el = runtime.rootEl
              if (!el) return
              const r = el.getBoundingClientRect()
              const cx = r.left + r.width * 0.62
              const cy = r.top + r.height * 0.42
              el.style.setProperty('--gx', clamp((e.clientX - cx) / 55, -2.6, 2.6).toFixed(2) + 'px')
              el.style.setProperty('--gy', clamp((e.clientY - cy) / 55, -2.2, 2.2).toFixed(2) + 'px')
            } catch (err) {
              /* ignore */
            }
          }
          window.addEventListener('mousemove', onMove, { passive: true })
          return () => window.removeEventListener('mousemove', onMove)
        })

        // 事件联动 + 阶段机：轮询 /ping 拿宿主的工具活动与失败时间戳。
        // 可见时 8s 一轮；藏起来时退到 30s（不是「暂停」——斜杠命令/公告要靠它唤醒），
        // 省 CPU 与网络又不至于错过「叫出来」。
        ctx.effect(() => {
          let stop = false
          // 1.10.0 起 /api 前缀已删除，只剩这一个相对路径 + 注入的绝对地址
          const base = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
          // 去重（R-05）：base 为空（网页版无注入）时两个地址相同，
          // 不去重会让失败轮询白跑一遍 8s 预算（chatWithPet 同款写法）
          const urls = []
          for (const u of [base + '/dsh-pet/ping', '/dsh-pet/ping']) {
            if (u && urls.indexOf(u) < 0) urls.push(u)
          }
          // 一次轮询的预算（R08）：没有这个，一个永不返回的 fetch 会让整条链
          // 永远停在这里，而 showPet 的补拉还会再起一条同样会挂的链。
          const POLL_TIMEOUT = 8000
          // P2-8（2026-10-29 审计）：公告/命令的消费序号必须跨刷新持久化。
          // 只放内存里的话，刷新一次就把上一条公告再念一遍、把 /dsh-pet hide 再执行一次。
          const SEQ_KEY = 'dsh-pet.seq.v1'
          const loadSeq = () => {
            try {
              const o = JSON.parse(window.localStorage.getItem(SEQ_KEY) || '{}')
              return o && typeof o === 'object' ? o : {}
            } catch (e) {
              return {}
            }
          }
          const saveSeq = (patch) => {
            try {
              const o = loadSeq()
              Object.assign(o, patch)
              window.localStorage.setItem(SEQ_KEY, JSON.stringify(o))
            } catch (e) {
              /* 隐私模式：退化为内存去重 */
            }
          }
          if (!runtime.seqLoaded) {
            runtime.seqLoaded = true
            const seqs = loadSeq()
            runtime.lastAnnounceSeq = Number(seqs.announce) || 0
            runtime.lastCommandSeq = Number(seqs.command) || 0
          }
          let ctrl = null
          let failures = 0
          const doPoll = async () => {
            if (stop) return
            ctrl =
              typeof AbortController === 'function'
                ? new AbortController()
                : null
            const guard = setTimeout(() => {
              try {
                if (ctrl) ctrl.abort()
              } catch (e) {
                /* ignore */
              }
            }, POLL_TIMEOUT)
            try {
              for (const url of urls) {
                if (!url || stop) continue
                try {
                  const res = await fetch(url, { credentials: 'include', signal: ctrl ? ctrl.signal : undefined })
                  const j = await res.json()
                  // 卸载/超时后拿到的响应一律不写状态（R08b）
                  if (stop || !j || !j.ok) continue
                  if (j.lastErrorAt && j.lastErrorAt > (runtime.lastErrorAt || 0)) {
                    runtime.lastErrorAt = j.lastErrorAt
                    if (runtime.settings.chaos !== false) playFx('cloud', { ttl: 4200 })
                  }
                  if (j.lastToolAt) runtime.lastToolAt = j.lastToolAt
                  if (j.lastToolName) runtime.lastToolName = String(j.lastToolName).slice(0, 40)
                  if (j.toolEvents) runtime.toolEvents = j.toolEvents
                  // —— 宿主 phase 投影（R-02）：写进 runtime 供 computePhase 融合 ——
                  if (j.phase) runtime.hostPhase = String(j.phase)
                  if (j.phaseAt) runtime.hostPhaseAt = Number(j.phaseAt) || 0
                  // 宿主重启会把 seq 归零（P2-8 的持久化游标副作用）：检测到回退就把本地
                  // 游标清掉，否则重启后的新公告/新命令会被当成「重放」永久忽略。
                  if (typeof j.commandSeq === 'number' && j.commandSeq < (runtime.lastCommandSeq || 0)) {
                    runtime.lastCommandSeq = 0
                    saveSeq({ command: 0 })
                  }
                  if (
                    j.announce &&
                    typeof j.announce.seq === 'number' &&
                    j.announce.seq < (runtime.lastAnnounceSeq || 0)
                  ) {
                    runtime.lastAnnounceSeq = 0
                    saveSeq({ announce: 0 })
                  }
                  // —— 公告（R-03）：序号变大才播，轮询重复拿到同一条不重放 ——
                  if (
                    j.announce &&
                    j.announce.seq > (runtime.lastAnnounceSeq || 0) &&
                    typeof j.announce.text === 'string' &&
                    j.announce.text
                  ) {
                    runtime.lastAnnounceSeq = j.announce.seq
                    saveSeq({ announce: j.announce.seq })
                    // announce 是外部触发（脚本/其它插件点名要她说），不走 statusBubbles 闸
                    bubble(String(j.announce.text).slice(0, 300), null, 'announce')
                  }
                  // 斜杠命令：序号变大才执行，轮询重复拿到同一条不会重放
                  if (j.commandSeq && j.commandSeq > (runtime.lastCommandSeq || 0)) {
                    runtime.lastCommandSeq = j.commandSeq
                    saveSeq({ command: j.commandSeq })
                    if (j.command === 'hide') hidePet(60 * 60 * 1000)
                    else if (j.command === 'show') showPet()
                  }
                  if (syncPhase()) notify()
                  return true
                } catch (err) {
                  /* 换下一个地址（含超时中止） */
                }
              }
              return false
            } finally {
              clearTimeout(guard)
              ctrl = null
            }
          }
          const schedule = () => {
            if (stop) return
            // 正常状态按可见性轮询；连续失败指数退避，避免宿主不可用时打满请求。
            const baseGap = runtime.visible || runtime.panelOpen ? 8000 : 30000
            const gap = Math.min(120000, baseGap * Math.pow(2, Math.min(failures, 4)))
            timer = setTimeout(async () => {
              try {
                const ok = await doPoll()
                failures = ok ? 0 : Math.min(failures + 1, 4)
              } catch (e) {
                failures = Math.min(failures + 1, 4)
              }
              schedule()
            }, gap)
          }
          let timer = null
          doPoll().catch(() => {})
          schedule()
          return () => {
            stop = true
            if (timer) clearTimeout(timer)
            try {
              if (ctrl) ctrl.abort()
            } catch (e) {
              /* ignore */
            }
          }
        })

        // —— personas / 跨设备状态（R-01 / R-04，反哺报告 2026-10-27）：启动各拉一次 ——
        // personas：宿主扫描到的形象整表下发；失败/空表保持内置表（setPersonas 拒收空表）。
        // state：宿主有 → 宿主优先合并；宿主空 → 本地状态推上云（$DSH_HOME），换浏览器/设备不失忆。
        ctx.effect(() => {
          let stop = false
          const base = (typeof window !== 'undefined' && window.__DSH_PET_BASE__) || ''
          const withTimeout = (url, ms, init) => {
            if (typeof AbortController !== 'function') return fetch(url, init)
            const c = new AbortController()
            const t = setTimeout(() => {
              try {
                c.abort()
              } catch (e) {
                /* ignore */
              }
            }, ms)
            return fetch(url, { credentials: 'include', ...init, signal: c.signal }).finally(() => clearTimeout(t))
          }
          ;(async () => {
            try {
              const res = await withTimeout(base + '/dsh-pet/personas', 8000)
              if (!stop && res.ok) {
                const j = await res.json()
                if (j && j.ok && Array.isArray(j.personas)) setPersonas(j.personas)
              }
            } catch (e) {
              /* 老宿主没有这个端点：保持内置表 */
            }
            try {
              const res = await withTimeout(base + '/dsh-pet/state', 8000)
              if (!stop && res.ok) {
                const j = await res.json()
                const host = (j && j.state) || {}
                const hostAt = Number(host.updatedAt) || 0
                const localAt = localStateAt()
                const hasHost =
                  (host.settings && Object.keys(host.settings).length) || (host.history && host.history.length)
                // 新者胜（P0-1，2026-10-29 审计）：
                //   - 本地从没保存过（localAt=0）且宿主有状态 → 采纳宿主（换浏览器/换设备恢复）；
                //   - 宿主更新时间 >= 本地 → 采纳宿主（另一台机器刚改过）；
                //   - 否则本地更新 → 把本地推上去覆盖宿主。
                // 旧版本留下的宿主文件没有 updatedAt（hostAt=0），而本地升级时
                // ensureLocalStateAt() 已经给现有设置打了「刚刚保存」的时间戳，
                // 所以「旧快照打回新设置」这个 P0 场景自然落到最后一条。
                if (hasHost && hostAt >= localAt) adoptHostState(host)
                else pushStateNow()
              }
            } catch (e) {
              /* 老宿主没有这个端点：本地 localStorage 照旧 */
            }
          })()
          return () => {
            stop = true
          }
        })

        // 语言：settings.lang 手动锁定则写进 localStorage 覆盖，否则跟随 <html lang>
        try {
          const saved = runtime.settings && runtime.settings.lang
          if (saved && saved !== 'auto') window.localStorage.setItem(PET_LANG_KEY, saved)
          setLang(detectLang())
        } catch (e) {
          /* ignore */
        }
        ctx.effect(() => watchHostLang())

        /**
         * 挂 slot。宿主版本太旧时（slot 名在 0.2 世代才统一成现在这套），
         * 宁可打一行明确日志、什么都不挂，也不要把异常抛进 boot 把整个 bundle 打掉。
         */
        const mountSlot = (slot, spec, Component) => {
          try {
            ctx.slots.inject(slot, () => ctx.slots.register(spec, Component))
          } catch (e) {
            try {
              console.warn(
                '[dsh-pet] 这个宿主没有 "' +
                  slot +
                  '" 插槽，桌面伴侣无法挂载。需要 dsh >= 0.2.1-alpha.2（本插件实测版本）。',
              )
            } catch (e2) {
              /* ignore */
            }
          }
        }

        mountSlot(
          'shell.overlay',
          { name: 'shell.overlay', id: 'dsh-pet', order: 200, label: t('panel.title'), locale: 'pet' },
          // P1-2：PetRoot = PetBoundary(PetOverlay)，渲染期异常回落到安全占位而不是白屏
          PetRoot,
        )

        // 输入框右侧的常驻入口：宠物被挡住/藏起来时的唯一可靠入口
        mountSlot(
          'conversation.input.right',
          { name: 'conversation.input.right', id: 'dsh-pet-toggle', order: 50, label: t('pet.toggle'), locale: 'pet' },
          PetToggle,
        )
      },
    }
  },
})
