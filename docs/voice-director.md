# 一人一声 + 导演层：落地记录（1.20.0 未发版）

## 设计

「LLM 当导演，TTS 当演员」——导演层**不在每句台词前调模型**，而是把表演纲领事先写进每个角色的 `pack.json`，运行时查表相乘。零延迟、零费用、可复现。

- `voice.voiced`：每只角色在每个语言下的**专属嗓子**（`auto` 时生效）
- `voice.moods`：每个心情的**表演方向**——`pitch`（百分比，±）、`rate`（倍率）、可选 `volume`（倍率）
- 最终参数 = 基座(`voice.pitch`/`voice.rate`) × 方向：pitch 按百分比缩放、rate 相乘、volume 相乘
- 音色优先级：面板手选 > 角色自带（auto） > 空（宿主按语言兜底）

## 五只角色的分配（中文）

| 角色 | 音色 key | 实际声音 | 基座 pitch/rate | 跳舞方向 | 入睡方向 |
| --- | --- | --- | --- | --- | --- |
| 薇 | xiaoyi | zh-CN-XiaoyiNeural（温柔成熟） | 1.18 / 0.88 | +2% / ×1.04 / vol 1.05 | −3% / ×0.84 / vol 0.72 |
| 绯 | xiaoxiao | zh-CN-XiaoxiaoNeural（明亮甜美） | 1.10 / 0.90 | +4% / ×1.10 / vol 1.10 | −2% / ×0.86 / vol 0.74 |
| 蓝 | hsiaochen | zh-TW-HsiaoChenNeural（软糯） | 1.12 / 0.86 | +3% / ×1.06 / vol 1.08 | −2% / ×0.82 / vol 0.70 |
| 雪 | xiaoyi | zh-CN-XiaoyiNeural（同嗓靠语气拉开） | 1.06 / 0.84 | +1% / ×1.02 / vol 1.02 | −4% / ×0.78 / vol 0.66 |
| 鲸鱼娘 | xiaoxiao | zh-CN-XiaoxiaoNeural（同嗓靠语气拉开） | 1.14 / 0.90 | +4% / ×1.08 / vol 1.08 | −1% / ×0.88 / vol 0.76 |

其余语言：英文 aria / emma / jenny / michelle / ava，西语 elvira / lucia / dalia，葡语 thalita / francisca，印地 ananya / swara。

**已知局限**：edge-tts 的中文女声只有 5 个（xiaoxiao、xiaoyi、hsiaochen、xiaobei 东北腔、xiaoni 陕西腔），所以五只角色只能做到 **3 种不同嗓色**；薇/雪 与 绯/鲸鱼娘 两对靠音高+语速+音量区分。若想 5 只全不同，需要换成能自造音色的语音模型（MiniMax 音色设计 / 火山 Seed-Audio）。

## 音量必须真的生效（实测）

`ffmpeg volumedetect`，voice=zh-CN-XiaoyiNeural、pitch +14Hz、rate −10%：

| volume | mean_volume | max_volume |
| --- | --- | --- |
| −40% | −29.9 dB | −12.6 dB |
| −100% | −91 dB（静音） | −91 dB |
| +0% | −25.4 dB | −8.3 dB |
| +25% | −23.5 dB | −6.4 dB |

**坑**：MP3 体积恒为 16992 B，只看体积会误判「没生效」，必须量电平。

## 改动清单

宿主侧（要重启 DSH）：
- `tools/tts_worker.py`：`edge_tts.Communicate(..., volume=req.get('volume') or '+0%')`
- `lib/tts.js`：`synthAtomic(text, voice, file, pitch, rate, volume)` 全链路透传；`TTS_VOICES` 8 → 18 个 key
- `index.js`：`volumeOf(v)` 白名单（`RATE_RE`），`ttsKey(voice, pitch, rate, text, volume)`（volume 参与缓存键，否则轻/重读互相命中），主处理器与 warm 处理器都解析透传

客户端（Ctrl+R 即可）：
- `src/50-voice.js`：`voiceParams(mood)`、`ttsBlobUrl(text, mood)`、`speak/saySapi/bubble` 全链路带 mood；`warmVoice()` 改按类别分组预热
- `src/60-behavior.js` / `src/96-overlay.js` / `src/94-move.js`：所有说话点补上类别（appear/idle/dance/shy/angry/sleep/error/drag/poked/chatAck）
- `src/90-components.js`：音色下拉增 hsiaochen/xiaobei/aria/jenny，默认值改回 `auto`
- 五语 locale：`voice.hsiaochen` / `voice.xiaobei` 新增，`voice.auto` 改写为「跟随角色（默认）」；键数 51 → 54

## 门禁

- 85 项单测全绿（新增 4 条：五只不同嗓色、心情演绎不越界、无方向表回落基座、volume 白名单与缓存键）
- smoke 全过（i18n 5 × 54 keys）
- `dsh-plugin-dev.js check --strict`：13 passed / 0 failed / 0 warned / 3 skipped
- `assets-manifest.json` 83 文件

## 试听

- `voice-samples.mp3`：五只 × idle/dance/sleep，各一句，共 15 段
- `voice-samples-alt.mp3`：鲸鱼娘同一句在「小北（东北腔）」「小妮（陕西腔）」两个方言嗓下的两种音高
