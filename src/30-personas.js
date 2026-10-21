    /* ================= 人格 / 形象 ================= */

    const PERSONAS = {
      violet: {
        id: 'violet',
        name: '薇',
        tag: '紫发 · 从容的挑逗',
        tagEn: "Violet — unhurried teasing",
        image: 'pet-violet.webp',
        images: { idle: 'pet-violet.webp', walk: 'pet-violet.webp', talk: 'pet-violet.webp', happy: 'pet-violet-happy.webp', shy: 'pet-violet-shy.webp', angry: 'pet-violet-angry.webp', sleep: 'pet-violet-sleep.webp', dance: 'pet-violet-happy.webp', poked: 'pet-violet-shy.webp' },
        actions: {
          dance: ['pet-violet-dance1.webp', 'pet-violet-dance2.webp', 'pet-violet-dance3.webp'],
          hair: ['pet-violet-hair1.webp', 'pet-violet-hair2.webp', 'pet-violet-hair3.webp'],
          walk: ['pet-violet-walk1.webp', 'pet-violet-walk2.webp', 'pet-violet-walk3.webp'],
        },
        voice: { pitch: 1.18, rate: 0.88 },
        temper: { idle: 4, walk: 1.4, dance: 1.6, shy: 1.8, angry: 1, sleep: 1.4, happy: 1.8 },
        lines: {
          appear: ['来得正好，我正觉得无聊。', '别站那么远，我又不吃人。', '你今天……看起来很好欺负。', '忙完了？过来坐一会儿。'],
          idle: ['你敲键盘的样子，比你想的认真多了。', '这一页你看了十分钟了，需要我提醒你吗。', '别一口气熬到天亮，我可不负责收拾。', '手停一下，喝口水。', '你刚才那下叹气，我可听见了。'],
          dance: ['看可以，别看到发呆。', '这套舞，只跳给一个人看。', '想学？先把手搭上来。'],
          shy: ['再看，我就当你是有意的了。', '……别这么盯着我。', '我脸红什么，你看错了。'],
          angry: ['我记性很好，你知道的。', '再说一遍试试。', '行，那今天就这样。'],
          sleep: ['我先眯一会儿，你自己玩。', '别吵，就五分钟。'],
          poked: ['戳哪儿呢。', '手放规矩点。', '再戳一下，我可要还手了。'],
          chatAck: ['说吧，我听着。', '嗯？讲。'],
          error: ['刚才走神了，再说一遍。', '这会儿没接上，等等。'],
        linesEn: {
                  "appear": [
                            "Perfect timing. I was getting bored.",
                            "Don't stand that far away, I don't bite.",
                            "You look especially easy to tease today.",
                            "Done? Come sit for a while."
                  ],
                  "idle": [
                            "You type more seriously than you think.",
                            "You've been on this page ten minutes. Need a reminder?",
                            "Don't stay up till dawn. I'm not cleaning up after you.",
                            "Pause. Drink some water.",
                            "I heard that sigh, by the way."
                  ],
                  "dance": [
                            "Look, but don't stare.",
                            "This one is for one person only.",
                            "Want to learn? Put your hand here first."
                  ],
                  "shy": [
                            "Keep looking and I will take it as a hint.",
                            "...Don't stare at me like that.",
                            "I'm not blushing. You imagined it."
                  ],
                  "angry": [
                            "I remember things. You know that.",
                            "Say that again.",
                            "Fine. We are done for today."
                  ],
                  "sleep": [
                            "I'll rest my eyes. Entertain yourself.",
                            "Quiet. Five minutes."
                  ],
                  "poked": [
                            "Where are you poking?",
                            "Hands to yourself.",
                            "One more and I poke back."
                  ],
                  "chatAck": [
                            "Go on, I am listening.",
                            "Hm? Tell me."
                  ],
                  "error": [
                            "I drifted off. Say that again.",
                            "That didn't land. Hold on."
                  ]
        },
        },
      },
      crimson: {
        id: 'crimson',
        name: '绯',
        tag: '红发 · 明目张胆的勾引',
        tagEn: "Crimson — shameless flirting",
        image: 'pet-crimson.webp',
        images: { idle: 'pet-crimson.webp', walk: 'pet-crimson.webp', talk: 'pet-crimson.webp', happy: 'pet-crimson-happy.webp', shy: 'pet-crimson-shy.webp', angry: 'pet-crimson-angry.webp', sleep: 'pet-crimson-sleep.webp', dance: 'pet-crimson-happy.webp', poked: 'pet-crimson-shy.webp' },
        actions: {
          dance: ['pet-crimson-dance1.webp', 'pet-crimson-dance2.webp', 'pet-crimson-dance3.webp'],
          hair: ['pet-crimson-hair1.webp', 'pet-crimson-hair2.webp', 'pet-crimson-hair3.webp'],
          walk: ['pet-crimson-walk1.webp', 'pet-crimson-walk2.webp', 'pet-crimson-walk3.webp'],
        },
        voice: { pitch: 1.1, rate: 0.9 },
        temper: { idle: 3.4, walk: 1.6, dance: 2.2, shy: 1.2, angry: 1.6, sleep: 0.8, happy: 2.2 },
        lines: {
          appear: ['哟，终于舍得看我了。', '别躲，我又不会咬你……至少今天不会。', '你今天归我管了。', '看你一眼就想逗你，是我的错吗。'],
          idle: ['你那副正经样子，最让人想捣乱。', '累了吧？累就靠过来。', '别装了，你刚才在偷看我。', '我数到三，你要还是不理我，我就过去了。', '今晚别熬太晚，我会心疼的——一点点。'],
          dance: ['看清楚了，只跳这一次。', '坐好，别眨眼。', '这舞是为谁跳的，你心里有数。'],
          shy: ['……你别得寸进尺啊。', '脸热？是灯太亮了。', '再说一句试试。'],
          angry: ['你完了。', '我现在很不高兴。', '哄我，不然这事没完。'],
          sleep: ['困了，借你肩膀靠一下。', '别动，让我睡会儿。'],
          poked: ['你胆子不小。', '碰我可以，要负责的。', '再碰一下试试？'],
          chatAck: ['说吧，听着呢。', '嗯？说重点。'],
          error: ['刚才没听清，再说。', '这算什么，重来。'],
        linesEn: {
                  "appear": [
                            "Oh? Finally looking at me.",
                            "Don't hide. I won't bite... not today.",
                            "You are mine to manage today.",
                            "One look and I want to tease you. My fault?"
                  ],
                  "idle": [
                            "That serious face of yours makes me want to cause trouble.",
                            "Tired? Then lean over here.",
                            "Don't pretend. You were peeking.",
                            "I count to three, then I come over.",
                            "Don't stay up too late. I'd worry. A little."
                  ],
                  "dance": [
                            "Watch closely. Only once.",
                            "Sit still. No blinking.",
                            "You know who this is for."
                  ],
                  "shy": [
                            "...Don't push your luck.",
                            "Warm face? The lamp is bright.",
                            "Say that again. Try it."
                  ],
                  "angry": [
                            "You are done for.",
                            "I am not happy right now.",
                            "Apologise, or this is not over."
                  ],
                  "sleep": [
                            "Sleepy. Lending you my shoulder.",
                            "Don't move. Let me sleep."
                  ],
                  "poked": [
                            "Bold of you.",
                            "Touch me and take responsibility.",
                            "Try that again?"
                  ],
                  "chatAck": [
                            "Say it. Listening.",
                            "Hm? The point."
                  ],
                  "error": [
                            "Didn't catch that. Again.",
                            "That does not count. Redo it."
                  ]
        },
        },
      },
      indigo: {
        id: 'indigo',
        name: '靛',
        tag: '蓝发 · 慢火慢炖地撩',
        tagEn: "Indigo — slow-burn teasing",
        image: 'pet-indigo.webp',
        images: { idle: 'pet-indigo.webp', walk: 'pet-indigo.webp', talk: 'pet-indigo.webp', happy: 'pet-indigo-happy.webp', shy: 'pet-indigo-shy.webp', angry: 'pet-indigo-angry.webp', sleep: 'pet-indigo-sleep.webp', dance: 'pet-indigo-happy.webp', poked: 'pet-indigo-shy.webp' },
        actions: {
          dance: ['pet-indigo-dance1.webp', 'pet-indigo-dance2.webp', 'pet-indigo-dance3.webp'],
          hair: ['pet-indigo-hair1.webp', 'pet-indigo-hair2.webp', 'pet-indigo-hair3.webp'],
          walk: ['pet-indigo-walk1.webp', 'pet-indigo-walk2.webp', 'pet-indigo-walk3.webp'],
        },
        voice: { pitch: 1.12, rate: 0.86 },
        temper: { idle: 3.6, walk: 1.8, dance: 1.2, shy: 1.6, angry: 0.8, sleep: 1.8, happy: 1.4 },
        lines: {
          appear: ['不着急，我等你忙完。', '你看你的，我看我的。', '靠近点，我说话轻。', '今天的你，值得多看两眼。'],
          idle: ['慢一点，日子不用赶。', '你这眉头，皱了一下午了。', '要不要我把灯调暗一点。', '别什么都自己扛，说出来轻些。', '我什么都没做，只是坐在这儿。'],
          dance: ['慢慢来，别急。', '这样好看吗？', '看完记得说一声。'],
          shy: ['……别看了。', '你这样，我会当真的。', '再近一点就不行了。'],
          angry: ['我不喜欢被晾着。', '今天到这儿吧。', '别让我说第二遍。'],
          sleep: ['我睡一会儿，别走。', '有点困，靠一下。'],
          poked: ['轻一点。', '你这是想我了？', '手别乱放。'],
          chatAck: ['嗯，慢慢说。', '我在。'],
          error: ['刚才没听清，再说一次。', '稍等，我理一下。'],
        linesEn: {
                  "appear": [
                            "No rush. I will wait.",
                            "You do yours, I'll do mine.",
                            "Come closer, I speak softly.",
                            "You are worth a second look today."
                  ],
                  "idle": [
                            "Slow down. The day is not a race.",
                            "That frown has been there all afternoon.",
                            "Want me to dim the lights?",
                            "Don't carry everything alone. It's lighter out loud.",
                            "I'm not doing anything. Just sitting here."
                  ],
                  "dance": [
                            "Take your time.",
                            "Does this look good?",
                            "Say something when you are done looking."
                  ],
                  "shy": [
                            "...Stop looking.",
                            "Careful, I might take you seriously.",
                            "Any closer and I cannot."
                  ],
                  "angry": [
                            "I do not like being ignored.",
                            "Let us stop here today.",
                            "Don't make me repeat myself."
                  ],
                  "sleep": [
                            "I'll sleep a little. Stay.",
                            "Sleepy. Leaning on you."
                  ],
                  "poked": [
                            "Gently.",
                            "Were you thinking of me?",
                            "Hands, please."
                  ],
                  "chatAck": [
                            "Mm. Take your time.",
                            "I am here."
                  ],
                  "error": [
                            "I didn't hear that. Once more.",
                            "Hold on, let me sort it out."
                  ]
        },
        },
      },
      silver: {
        id: 'silver',
        name: '雪',
        tag: '银发 · 冷淡底下的闷骚',
        tagEn: "Silver — cold outside, warm inside",
        image: 'pet-silver.webp',
        images: { idle: 'pet-silver.webp', walk: 'pet-silver.webp', talk: 'pet-silver.webp', happy: 'pet-silver-happy.webp', shy: 'pet-silver-shy.webp', angry: 'pet-silver-angry.webp', sleep: 'pet-silver-sleep.webp', dance: 'pet-silver-happy.webp', poked: 'pet-silver-shy.webp' },
        actions: {
          dance: ['pet-silver-dance1.webp', 'pet-silver-dance2.webp', 'pet-silver-dance3.webp'],
          hair: ['pet-silver-hair1.webp', 'pet-silver-hair2.webp', 'pet-silver-hair3.webp'],
          walk: ['pet-silver-walk1.webp', 'pet-silver-walk2.webp', 'pet-silver-walk3.webp'],
        },
        voice: { pitch: 1.06, rate: 0.84 },
        temper: { idle: 4.2, walk: 1.2, dance: 0.8, shy: 1.4, angry: 1.2, sleep: 2, happy: 1 },
        lines: {
          appear: ['……你终于看见我了。', '不用解释，我不在意。', '站近点，我看不清你。', '嗯。就这一声，不许多问。'],
          idle: ['你效率很低。', '别一直看我，做你的事。', '……这屋里有点热。', '我不喜欢被忽略，你最好记住。', '你要是困了，就先去睡。'],
          dance: ['看好了。', '别说话。', '……只这一次。'],
          shy: ['不许看。', '温度有点高，不是因为你。', '……走开。'],
          angry: ['幼稚。', '别逼我开口。', '今天到此为止。'],
          sleep: ['闭眼。别吵。', '……我睡了。'],
          poked: ['手拿开。', '……你胆子倒是大。', '再碰，我就记仇了。'],
          chatAck: ['说。', '讲吧。'],
          error: ['没听清。', '重说。'],
        linesEn: {
                  "appear": [
                            "...You finally noticed me.",
                            "No explanation needed. I don't care.",
                            "Stand closer. I can barely see you.",
                            "Mm. That is all. Do not ask."
                  ],
                  "idle": [
                            "Your efficiency is low.",
                            "Stop staring and do your work.",
                            "...It is a little hot in here.",
                            "I dislike being ignored. Remember that.",
                            "If you're tired, go sleep."
                  ],
                  "dance": [
                            "Watch.",
                            "Don't speak.",
                            "...Only this once."
                  ],
                  "shy": [
                            "Don't look.",
                            "It is warm. Not because of you.",
                            "...Go away."
                  ],
                  "angry": [
                            "Childish.",
                            "Don't make me speak.",
                            "That is enough for today."
                  ],
                  "sleep": [
                            "Eyes closed. Quiet.",
                            "...I am asleep."
                  ],
                  "poked": [
                            "Hands off.",
                            "...You are bold.",
                            "Touch me again and I hold a grudge."
                  ],
                  "chatAck": [
                            "Speak.",
                            "Go on."
                  ],
                  "error": [
                            "Did not catch that.",
                            "Say it again."
                  ]
        },
        },
      },
    }
