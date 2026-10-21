# dsh-pet

A little companion that lives in the bottom-right corner of the **DSH web UI**: it stays
around or drops in at random, talks (with voice), walks, dances, gets shy or annoyed, and
carries a tiny input box you can chat with. Four photo-realistic personas, each with its
own temper.

> Scope: the pet only lives inside the DSH window (it mounts into the framework's overlay
> slot). It **cannot float above other applications** — that would need a separate Electron
> shell rather than a plugin.

## At a glance

- **Languages**: UI chrome, persona taglines and the chat system prompt follow the browser
  interface language — shipped for `en / zh / es / pt / hi` (`locale/*.json`, namespace
  `pet`; slots register with `locale: 'pet'` per the DSH slot contract). Each persona also
  ships an English line pack, so a non-Chinese UI hears English lines.

- **Mount points**: `shell.overlay` (the pet itself, a click-through layer) and
  `conversation.input.right` (the entry button next to the composer).
- **Private chat**: what you type in the small box **never enters your session**. The host
  half exposes `POST /dsh-pet/chat` and answers with a one-shot `ctx.llm.stream()` call
  (no session, no session log). Defaults: `deepseek-account` / `deepseek-flash`; provider,
  model, maxTokens and temperature are plugin config.
- **Icon**: `icon.svg` (the rose silhouette) and the composer button share the same path.
- **Settings panel**: grouped (look / voice / display / actions / effects), custom dropdowns
  (native `<select>` popups are system-white and unreadable in dark themes) and custom
  switches; it is pinned to the viewport and does not follow the pet.
- **Four personas** (photo-realistic, same lighting, 5 expressions each: default / happy /
  shy / angry / sleepy): 薇 (violet), 绯 (crimson), 靛 (indigo), 雪 (silver).
  Expression changes cross-fade (240 ms) instead of hard-cutting.
- **Action sequences**: a persona may declare `actions: { dance: [...], hair: [...],
  walk: [...] }`; each set is 3 frames played as a 340 ms flip-book. All four have dance /
  hair-flip / walk, each stylised to the character.
- **Adding artwork**: drop transparent PNGs into `assets/` and reference them from
  `PERSONAS` (`image`, or `images: { mood: 'file.png' }`). Served by `/dsh-pet/assets/`
  (image extensions only, basename only). `tools/make-pet-image.py` removes a green-screen
  background (preferred) and falls back to a gradient key.

## Behavior

| Capability | How |
|---|---|
| Always-on / random | Toggle in the panel; random mode rolls a per-hour probability inside the active window |
| Active hours | Start/end time, supports crossing midnight (22:00 → 03:00) |
| Proactive lines | Per-mood line packs, bubble + speech |
| Voice | **Optional**: if the host has any python with `edge-tts`, `/dsh-pet/tts` synthesises (cached) and `/dsh-pet/tts/status` probes it; otherwise it falls back to the system `speechSynthesis`. The plugin itself has zero runtime dependencies |
| Small input box | Chat with the pet only; one-shot model call, nothing is written to any DSH session |
| Moods | idle / walk / dance / shy / angry / sleep / talk / happy |
| Gaze | Pupils follow the mouse (CSS variables only, no re-render) |
| Effects | Ink / confetti / cloud / fog (wipable) / bomb + cracked screen |
| Event hooks | Confetti after a turn longer than 4 s; a cloud appears after a failed tool call |
| Temper | Per-persona weight table decides what it does more of |
| Hide | "Hide for 1 h" in the panel |

## Install (local, no registry)

Published as `dsh-pet-plugin` on npm; it also installs straight from a folder.

```bash
# from the registry (after publish)
dsh plugin --profile desktop add dsh-pet-plugin
```

```powershell
# from a local checkout: quit DSH first, then
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1    # or double-click install.cmd
```

Quit DSH first (the profile's `package.json` is HMR-watched). The script adds
`"@local/dsh-pet": "file:<this dir>"` to the profile, registers the bundle, runs
`pnpm install`, then reads back all four facts. `update.cmd` only refreshes files and is
safe while DSH is running. For the sweeter neural voice:

```bash
pip install edge-tts                     # any python the host can find
export DSH_PET_PYTHON=/path/to/python    # only if auto-discovery misses it
```

## Verify

```bash
node --check client.js
node tests/smoke.mjs                     # fake window + React stub, renders every persona/mood
# host routes need the harness packages, so run them from the installed copy:
cd <profile>/node_modules/@local/dsh-pet && node --test tests/host.test.mjs
node <dsh-plugin-guide>/bin/dsh-plugin-dev.js check --cwd . --strict
node <dsh-plugin-guide>/bin/dsh-plugin-dev.js verify --cwd .
```

## Customize

- **The client bundle is generated**: edit `src/*.js` and run `node build.mjs`, which
  concatenates the parts into `client.js` (the only file DSH loads). Never edit
  `client.js` by hand — `npm test` rebuilds and then runs the smoke test.
- **Personas, lines and tempers**: `PERSONAS` in `src/30-personas.js` — `images` (five
  expressions), `actions` (dance / hair / walk, three frames each), `voice`, `temper`,
  and `lines` / `linesEn` line packs.
- **UI strings**: edit the `pet` namespace in `locale/*.json`, then `node build.mjs` — the
  dictionaries are injected at build time, so the locale files are the single source of
  truth. New language: run `node tools/gen-locales.cjs` for a skeleton, then translate.
- **Moods and animations**: add keyframes in `src/70-style.js` and map the class by `mood`
  in `src/96-overlay.js`.
- **Artwork**: drop transparent WebPs into `assets/` and reference them from `PERSONAS`;
  the `/dsh-pet/assets/` route only serves image extensions.

## Security model

- The host routes are gated three ways, none of them tied to a fixed port or domain:
  `Host` must be a loopback address, the host's own origin, or listed in the
  `allowedHosts` plugin config (for reverse-proxy / LAN deployments); a present
  `Origin` must be same-origin with that `Host` or the desktop shell
  (`dsh-app://app`, `dsh-app://shell`); and `Sec-Fetch-Site`, when present, must be
  `same-origin` or `none`. Non-browser clients that send none of these are allowed —
  that is the deliberate limit of a local HTTP endpoint, see below.
- Synthesised speech is cached in the OS temp dir with a size cap that is re-checked
  after every synthesis, and writes go through a random temp name + rename so a
  pre-planted symlink cannot redirect them.
- Anything the page sends (settings, chat history, persona id) is treated as data:
  validated, length-capped, and never interpolated as instructions or markup.
- Neural voice sends the spoken text to Microsoft's edge-tts endpoint. Turn it off
  (or never install `edge-tts`) to keep everything local; the panel says so.

## Known limits

- Neural voice needs a host python with `edge_tts`; otherwise the system SAPI voice is used.
- Browsers block autoplay before the first user gesture — click the page once.
- Settings live in `localStorage`. The debug handle (`globalThis.__dshPet`) stays off unless
  you set `dsh-pet.debug=1` in `localStorage` or append `?petdebug=1`.
- The pet cannot float above other applications (overlay slot only).
