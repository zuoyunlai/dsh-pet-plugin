# Contributing to dsh-pet-plugin

A photo-real desk pet for the DSH window. Four personas, five languages,
24 fps alpha-video dance clips, neural TTS, and a settings panel that never
covers the pet. Zero runtime dependencies.

## Prerequisites

- Node.js ≥ 22 (or ≥ 24)
- DSH desktop or web (for live testing)
- Python 3 with Pillow + numpy (only for the asset pipeline; not a runtime dep)

## Project layout

```
index.js          Host half: routes, CORS, TTS worker, chat, /dsh-pet command
src/*.js          Client half source (15 files, ordered by name = load order)
client.js         Build product (generated — never edit by hand)
pets/<id>/pack.json       Persona data: the single source of truth
locale/*.json     UI text (5 languages × 46 keys)
assets/           Sprites (.webp) and action clips (.webm)
tools/            Build, test, and asset-pipeline scripts
tests/            Host tests + smoke + CDP probes
build.mjs         Concatenates src/ → client.js, injects locales
```

## Build & test

```bash
node build.mjs                      # regenerate client.js (byte-reproducible)
node tools/gen-personas.cjs --check # verify pets/ and src/30-personas.js in sync
node --test tests/host.test.mjs    # 30 host-side tests
node tests/smoke.mjs               # render check + video/panel/phase assertions
```

CI runs all of the above on every push and pull request (`.github/workflows/test.yml`).

## Adding a persona

1. Create `pets/<your-id>/pack.json` — copy an existing one as a template.
   Required fields: `id`, `name`, `tag`, `tagEn`, `image`, `voice`, `temper`,
   `images` (9 moods), `actions` (dance/hair/walk arrays), `lines` + `linesEn`
   + `linesEs` + `linesPt` + `linesHi` (five line packs).
   Optional: `clips: { dance: "pet-<id>-dance.webm" }` for a video clip.
2. Drop transparent `.webp` sprites into `assets/` (reference them by filename
   in the pack).
3. Run `node build.mjs` — it regenerates `src/30-personas.js` from `pets/`.
4. Verify: `node tools/gen-personas.cjs --check` and `node tests/smoke.mjs`.

## Asset pipeline (video clips)

```bash
# 1. Compose a green-screen first frame (80% height, centered, pure #00FF00)
# 2. Generate via MiniMax image-to-video (see tools/ for prompt templates)
# 3. Extract frames:  ffmpeg -i input.mp4 -vf fps=24 frames/frame-%03d.png
# 4. Batch key:       python tools/batch-key.py frames/ keyed/ 520
# 5. Encode alpha:    ffmpeg -framerate 24 -i keyed/frame-%03d.png \
#     -vf "unsharp=5:5:0.4:5:5:0" -c:v libvpx-vp9 -pix_fmt yuva420p \
#     -b:v 0 -crf 34 -row-mt 1 -deadline good -cpu-used 2 -an output.webm
```

The keying algorithm (v5) is documented in `tools/batch-key.py` — do not
remove the despill step (see the v3/v4 failure note in its docstring).

## Adding a UI language

1. Run `node tools/gen-locales.cjs <lang>` to generate a skeleton.
2. Fill in the translations (46 keys).
3. Add the language code to the ordered list in `build.mjs`.
4. Rebuild and verify parity: the smoke test checks key counts across all
   languages.

## Release process

```bash
# 1. Bump version in package.json
# 2. Add a CHANGELOG.md entry (include verification data)
# 3. Build + test
node build.mjs && node tests/smoke.mjs && node --test tests/host.test.mjs

# 4. Commit and push
# 5. Publish (with confirmation prompt):
node tools/release.cjs --publish
```

For CI-based publishing (with provenance), just push the tag and let GitHub
Actions handle it. Use `--publish` only when you need to publish from this
machine; it will ask for confirmation unless you pass `--yes`.

## Reporting issues

Please include:
- DSH version (`dsh --version` or check the app)
- Plugin version (Settings panel → title, or `npm ls dsh-pet-plugin`)
- Console output (F12 → Console, filter by `[dsh-pet]`)
- What you expected vs. what happened

## License

MIT — see [LICENSE](LICENSE).
