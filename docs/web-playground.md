# Web Playground — Change Summary & Verification

A one-page browser "playground" for authoring and testing `drums` notation
outside Obsidian. It **reuses the existing core and renderer from `src/`** (no
code duplication, no monorepo split) and must not affect the Obsidian plugin
build or output.

## Commits

On `main` (repo: `github.com/vkamolov/obsidian-drum-notation`, public):

| Commit | Title |
|--------|-------|
| `8322a60` | Add web notation playground (Vite) |
| `677bc36` | Add grid edit mode to playground; build web in CI |

Earlier related commits: `fb5ef38` (CI workflow / README badge / spec examples),
`17c6901` + `10719ae` (one-bar repeat notation), `bcb9e6c` (agent handoff doc).

## Files added / modified (web-related)

**New**

```
vite.config.ts            Vite config, root = web
web/index.html            page markup
web/src/app.ts            app wiring: editor -> render -> diagnostics, playback, edit-mode glue
web/src/examples.ts       example notation for the dropdown
web/src/obsidian-dom.ts   Obsidian DOM-helper shim (the browser port surface)
web/src/playground.css    workbench styles and theme variables
src/editor-grid.ts        shared grid edit mode (consumes src/edit.ts)
web/tsconfig.json         web-only TS config (editor support + CI typecheck)
.claude/launch.json       local preview/dev-server config (Claude Code only)
```

**Modified**

```
package.json              + scripts (web, web:build, web:preview, web:typecheck); vite@^6 added to devDependencies
package-lock.json         vite + transitive deps
.gitignore                + web/dist/
.github/workflows/ci.yml  + web build/typecheck steps
```

## Folder structure (web concerns)

```
obsidian-drum-notation/
├─ src/                      # SHARED core + renderer + audio (UNCHANGED by web work)
│   ├─ parser.ts  serializer.ts  edit.ts  kit.ts  music.ts  types.ts  util.ts
│   ├─ editor-grid.ts         # shared selected-bar visual editor
│   ├─ engrave.ts            # VexFlow/SVG renderer (uses Obsidian DOM sugar — see shim)
│   ├─ player.ts  synth.ts   # WebAudio (standard AudioContext, already portable)
├─ main.ts                   # Obsidian plugin adapter (only file importing "obsidian")
├─ vite.config.ts            # web build config (root: "web")
├─ web/                      # the playground
│   ├─ index.html
│   ├─ tsconfig.json
│   ├─ dist/                 # build output (gitignored)
│   └─ src/
│       ├─ app.ts
│       ├─ examples.ts
│       ├─ obsidian-dom.ts
│       └─ playground.css
├─ .github/workflows/ci.yml  # now also runs web:build + web:typecheck
└─ package.json              # web scripts + vite devDep
```

## How it imports the core

`web/src/*.ts` import shared code with relative paths, e.g.
`import { parseDrumBlock } from "../../src/parser"`. There is one source of
truth; the web app is a second adapter alongside `main.ts`. Vite's
`server.fs.allow: [".."]` permits importing from the repo root while rooted in
`web/`.

## The only "port" code: `web/src/obsidian-dom.ts`

`src/engrave.ts` calls Obsidian-injected `HTMLElement` helpers (`createEl`,
`createDiv`, `createSpan`, `empty`, `setAttr`, `setText`, `addClass`,
`removeClass`, `toggleClass`). Obsidian monkey-patches these onto the prototype;
a plain browser does not. The shim polyfills exactly that subset onto
`HTMLElement.prototype` (guarded by a `__drumDomShim` flag for HMR) plus a
matching `declare global` type augmentation. It is imported for side effects as
the **first** import in `app.ts`. `engrave.ts` itself was **not** changed.

## Tooling / build config

- **Vite 6.4.3** (devDependency only). `vite.config.ts`: `root: "web"`,
  `base: "./"` (relative asset paths for a future subpath deploy),
  `build.outDir: "dist"` → `web/dist`.
- Scripts: `npm run web` (dev server, HMR), `npm run web:build` (production
  build), `npm run web:preview`, and `npm run web:typecheck`.
- The root `tsconfig.json` includes only `main.ts` and `src/**/*.ts`, so `web/`
  is excluded from the plugin's `tsc` typecheck. The plugin esbuild entry
  remains `main.ts`. The plugin build/output is therefore unaffected.
- Runtime dependencies unchanged: still only `vexflow`.

## Feature inventory

- Live editor (`<textarea>`) -> `parseDrumBlock` -> `renderVexflowScore`
  preview; debounced 250ms; localStorage autosave.
- Playback: Play / Stop / Loop Bar plus a Loop menu for the whole notation or
  a selected multi-bar practice phrase, via `DrumPlayer` + lazy `AudioContext`;
  cursor + note highlight ported from `main.ts`; click-a-note preview via
  `DrumSynth`.
- Practice selection: choose **Select bars** from the Loop menu, then click,
  tap, or keyboard-activate rendered bars/notes. **Play** runs the selected
  phrase once and **Loop selected bars** repeats it. Selection follows score
  order, treats compact `%xN` regions atomically, and intentionally ignores
  section navigation and the authored `Repeat:` count.
- Practice controls and selection are page-session state. They survive score
  rerenders but are cleared by a reload and are never written to
  `localStorage`.
- The metronome menu offers one- and two-bar count-ins. Count-in sounds even
  with the metronome off, runs once at transport start, and does not repeat
  between loop passes or control-triggered restarts.
- Click subdivision adds 2, 3, or 4 clicks inside each existing metronome
  pulse. Menu labels identify familiar note values when possible: three per
  beat is eighth-note triplets in 4/4 and eighths in 6/8. Downbeats, main
  beats, and subdivisions use strong, medium, and light click levels.
- Gap click provides 1-on/1-off, 2-on/2-off, and 4-on/4-off practice cycles.
  The cycle follows performed bars continuously across loops and repeats;
  amber cues mark the current and next silent bars. Metronome-only gap bars
  are intentionally silent, while count-in always remains beat-only and
  gap-free.
- Subdivision choices above 16 clicks per second are disabled. Increasing the
  tempo or playback speed automatically selects the fastest safe subdivision.
- The speed menu shows fixed choices as percentage plus effective BPM and opens
  a Tempo Ramp Trainer for exact 30–260 BPM ladders. A ramp can target the
  captured current bar, selected bars, or the complete notation; its setup
  controls BPM step, passes per tempo, ceiling, and Hold/Stop behavior.
- Tempo-ramp progress is page-session state. Manual Stop preserves completed
  passes, Resume begins the current target again at its current ladder BPM, and
  Reset returns to the configured starting BPM. Count-in uses the current ramp
  BPM only at transport start or manual resume. Gap-click phase continues across
  tempo steps, while unsafe click subdivisions step down and stay at the safer
  choice.
- **Keep screen awake** is enabled for the page session when the browser and
  secure context support Screen Wake Lock. It is marked unavailable otherwise.
  Continuous loops intentionally retain the lock until Stop, so users should
  disable it when they want to conserve battery.
- Authoring toolbar: example picker, title, tempo, time signature, grid, repeat,
  and legend controls. Toolbar edits rewrite the notation textarea in an
  Obsidian-ready authoring form that keeps `Title`, `Tempo`, `Time`, and `Grid`
  visible even when they are default values.
- Two-row command toolbar: playback, edit, export, and theme controls are
  grouped separately from notation setup.
- Advanced diagnostics: parsed-model summary and live `serializeDrumBlock`
  normalized output are still available behind a collapsed details panel. Parser
  or render warnings remain visible only when there is something to fix.
- Agent verification includes a keyboard-accessible horizontal splitter between
  its intake controls and the source/notation/preview workspace. Drag it upward
  to enlarge the comparison area, double-click to restore its default size, or
  use **Full screen** and **Restore** (Escape also restores) for focused review.
- Grouped native example picker (`examples.ts`) organized by purpose, including
  ten core rudiment exercises. Copy for Obsidian, Copy normalized in diagnostics,
  and light/dark theme toggle (persisted). If the browser blocks
  programmatic clipboard writes, Copy for Obsidian opens a selected fallback
  textarea containing the fenced block.
- **Edit mode** (`src/editor-grid.ts`): fixed HTML grid, rows = instruments,
  columns = slots, and the grid edits one selected bar at a time. Bar chips page
  between bars, and clicking/tapping a rendered notation bar selects the matching
  edit bar. Empty-cell click adds a normal hit; filled-cell click selects and
  previews the hit. The selected cell highlights the matching rendered SVG note
  while edit mode is open. The selected-cell tool strip uses compact notation
  glyph buttons while grid cells keep text notation characters. Tool buttons and
  keyboard shortcuts choose only instrument-valid articulations, with
  Delete/Backspace for erase. Instrument labels stay visible while horizontally
  scrolling the grid, and a count ruler above the cells marks beats/subdivisions.
  Instrument palette adds rows.
  Edits live-apply to the editor text and notation preview immediately; Undo/Redo
  replaces the old Save/Cancel flow. The selected-bar editor also exposes compact
  bar actions arranged as **Add · Duplicate · Repeat · New line | Copy · Paste
  | Delete**. Add inserts an empty bar; Duplicate inserts an immediate editable
  copy; Repeat inserts a repeat bar after the selection or converts a selected
  repeat into editable notation; New line splits after the selected bar (or
  creates an empty next line after a final bar); Copy stores content without
  mutating notation; Paste replaces the selected bar. The typed
  bar clipboard is shared across editors for the current page session and
  rejects incompatible Time/Grid or bar-length combinations. First interactive
  consumer of `src/edit.ts`.

## Verification steps

```bash
npm ci
npm test            # expect the full unit suite to pass
npm run build       # plugin build: tsc + esbuild, no errors; emits main.js
npm run web:build   # vite build, no errors; emits web/dist/ (JS ~1.17MB — VexFlow; size warning is advisory only)
npm run web:typecheck
npm run web         # dev server at http://localhost:5173
```

In the browser at `localhost:5173`:

1. Default "Basic rock groove" renders a VexFlow staff; the notation editor
   contains an Obsidian-ready block with `Title`, `Tempo`, `Time`, and `Grid`.
   The advanced diagnostics panel can be opened to compare normalized output
   with the current authoring text.
2. Click **Play** → audio + moving cursor/highlight. Open **Loop**, choose
   **Select bars**, select two rendered bars, and finish selection. Confirm
   **Play** runs the phrase once, **Loop selected bars (2)** repeats it, and
   Stop retains the green practice outlines. Changing the selection stops
   playback; changing speed, mute, metronome, subdivision, gap mode, or
   count-in restarts at the same musical occurrence and gap-cycle position
   without another count-in.
   Open the metronome menu, choose **2 bars**, and confirm two accented
   count-in downbeats before the phrase. With metronome Off, the count-in must
   remain audible. When supported, confirm **Keep screen awake** is checked,
   remains active through looping, and releases on Stop.
   Choose **3 per beat** in 4/4 and confirm the menu says **eighth-note
   triplets**; switch to a 6/8 example and confirm it says **eighths**. Enable
   **1 on / 1 off**, then verify the amber next-gap cue, the silent second bar,
   and continuous alternation through Loop Bar and Loop Selected. At a high
   tempo/speed combination, confirm unsafe subdivision choices are disabled
   and an active choice steps down with a concise message.
3. Click **Edit** → a selected-bar grid opens below the live preview. Use the
   Bar chips, or click a rendered notation bar, to switch which bar is shown.
   Click an empty HH cell → fills (normal) and immediately updates the editor
   text/preview. Click a filled SD cell → selects/previews it and highlights the
   matching rendered note while showing snare-valid tools such as flam, drag,
   diddle, and buzz. Horizontally scroll the grid → instrument labels remain
   pinned while count markers and cells scroll. Confirm the action order is
   **Add · Duplicate · Repeat · New line | Copy · Paste | Delete**. Add inserts
   a Time/Grid-sized empty bar; Duplicate inserts an immediate editable copy;
   Repeat opens the count dialog and inserts `%` or `%xN`. Unrepeat opens the
   edit dialog for either form, allowing resizing or making one copy editable.
   New line moves trailing bars to a new system or
   creates an empty system after a final bar. Copy must
   not mutate notation. Paste replaces the selected bar and asks before
   overwriting existing musical content. Delete removes a normal or single `%`
   bar, while deleting any member of `%xN` removes the complete compact group.
   The selected bar follows the changed bar.
   If playback is running, visual edits and debounced text-code edits restart the
   active play/loop mode against the updated notation so new hits are heard
   without a manual stop/start. Click **Undo** → the previous text/preview
   returns.
4. Toggle theme, change Title/Tempo/Time/Grid/Repeat/Legend, switch examples,
   and copy the block for Obsidian.

Console should be free of errors/warnings.

## Known limitations / things to scrutinize

- **Practice state:** playback controls and selected bars are memory-only for
  the current page. Reloading clears them; the notation and theme remain the
  only normal playground values saved to `localStorage`.
- **Agent verification privacy:** source PNG/JPEG/WebP images, pasted agent
  responses, reports, and review state remain ephemeral. Only an explicit Save
  writes normalized notation to the existing playground `localStorage` key.
- **Agent verification limits:** responses are capped at 1 MiB, with at most 16
  `drums` blocks and 128 KiB per block. Source images are checked before decode
  at 15 MiB and after decode at 10,000 pixels per side / 40 megapixels. SVG is
  rejected. PDF comparison currently uses page screenshots.
- **Production CSP:** GitHub Pages receives a strict meta CSP from the Vite
  production build. Meta CSP cannot enforce `frame-ancestors` or emit violation
  reports. `style-src-attr` is a CSP Level 3 directive, so older browsers may
  fall back to `style-src`; the source-sink check remains the standing control.
  CSP is not claimed to block CSSOM property writes. `worker-src 'none'` must
  become `'self'` if local audio transcription later adds a same-origin module
  worker; add `blob:` only if testing proves it necessary.

- **Edit-mode contiguous-prefix rule:** adding a hit to a *later* bar where an
  instrument is absent materializes empty rest-rows in earlier bars (preserves
  the format's contiguous-bar invariant; harmless for round-trip but visible as
  empty rows).
- **`%` measure-repeat bars:** repeat bars are read-only for cell edits, but the
  bar action row can convert a selected repeat back into a normal copied bar.
  The Repeat action accepts a count from 1–99 and creates `%` or compact `%xN`
  notation. Unrepeat opens a dialog for `%` and `%xN` that can resize the
  repeat/group or replace it with one editable copy.
- The notation textarea uses `serializeDrumBlock(..., { mode: "authoring" })`;
  advanced diagnostics still show the default normalized form.
- Edit mode uses a selected-cell tool strip; direct SVG/grid overlay editing is
  still deferred to the visual-edit roadmap.
- `web/tsconfig.json` is checked in CI with `npm run web:typecheck`; Vite still
  owns the browser bundle build.
- Bundle-size warning on `web:build` is expected (VexFlow) and non-blocking.
- The serializer normalizes characters, so non-canonical input (e.g. `o` on a
  cross-notehead row) round-trips to a *semantically* equal model but a
  different `row.pattern` string — by design (see `notation-format.md` §8).

## GitHub Pages deployment

The playground is live at
[vkamolov.github.io/obsidian-drum-notation](https://vkamolov.github.io/obsidian-drum-notation/).

GitHub Pages is enabled with **GitHub Actions** as its source. The Pages
workflow deploys automatically after pushes to `main` and can also be started
manually with `workflow_dispatch` when a redeployment is needed.
