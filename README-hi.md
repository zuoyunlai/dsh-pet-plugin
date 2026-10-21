# dsh-pet

ek chhotaa-saa saathi jo **DSH web UI** ke neeche-daayein kone mein rehtaa hai: hameshaa
yaa kabhi-kabhi aataa hai, boltaa hai (aawaaz ke saath), chalataa hai, naachataa hai,
sharmaataa hai yaa naraz hotaa hai, aur ek chhotaa input box saath laataa hai. Chaar
photo-realistic characters, har ek kaa apanaa mizaaj.

> Scope: yeh sirf DSH window ke andar rehtaa hai (framework ke overlay slot mein mount hotaa
> hai). Doosare applications ke oopar nahi tair saktaa — uske liye alag Electron shell chahiye.

## At a glance

- **Mount points**: `shell.overlay` (khud pet, click-through layer) aur
  `conversation.input.right` (composer ke paas button).
- **Private chat**: chhote box mein likhaa text **kabhi aapke session mein nahi jaataa**.
  Host `POST /dsh-pet/chat` detaa hai aur ek baar `ctx.llm.stream()` se jawab detaa hai
  (koi session nahi, koi session log nahi).
- **Icon**: `icon.svg` aur composer button ek hi path use karte hain.
- **Settings panel**: groups ke saath (look / voice / display / actions / effects) aur
  apane custom dropdowns/switch, viewport par fixed.
- **Chaar characters**, photo-realistic, har ek ke 5 expressions: 薇, 绯, 靛, 雪.

## Behavior

| Cheez | Kaise |
|---|---|
| Hameshaa / random | Panel mein toggle; random mode ghante kaa probability |
| Active hours | Start/end, aadhi raat paar kar saktaa hai |
| Proactive lines | Mood-wise line packs, bubble + aawaaz |
| Voice | **Optional**: host ke python mein `edge-tts` ho to neural voice, warna system `speechSynthesis` |
| Chhotaa input box | Sirf pet se baat; ek baar model call, kuchh bhi save nahi hotaa |
| Moods | idle / walk / dance / shy / angry / sleep / talk / happy |
| Gaze | Pupils mouse follow karte hain (sirf CSS variables) |
| Effects | Ink / confetti / cloud / fog / bomb |

## Install (local, no registry)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

Install se pehle DSH band karein. Script profile mein `file:` dependency jodtaa hai, bundle
register kartaa hai, `pnpm install` chalaataa hai aur phir verify kartaa hai. `update.cmd`
sirf files copy kartaa hai, DSH chalte hue bhi safe hai.

```bash
pip install edge-tts    # optional: neural voice, host kaa koi bhi python
```

## Verify

```bash
node --check client.js
node tests/smoke.mjs
cd <profile>/node_modules/@local/dsh-pet && node --test tests/host.test.mjs
node <dsh-plugin-guide>/bin/dsh-plugin-dev.js check --cwd . --strict
node <dsh-plugin-guide>/bin/dsh-plugin-dev.js verify --cwd .
```

## Customize

- Characters, lines aur temper `client.js` ke `PERSONAS` mein hain.
- Naye moods: `CSS` block mein keyframes jodein aur class ko `Face`/`PetArt` mein map karein.
- `provider`, `model`, `maxTokens`, `temperature` plugin config hain.

## Known limits

- Neural voice ke liye host python mein `edge_tts` chahiye.
- Browser pehle user gesture tak autoplay roktaa hai.
- Settings `localStorage` mein; debug handle `__dshPet` default off hai
  (`dsh-pet.debug=1` yaa `?petdebug=1`).
- Doosare applications ke oopar nahi tair saktaa.
