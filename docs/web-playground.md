# Web Playground — Change Summary & Verification

A one-page browser "playground" for authoring and testing `drums` notation
outside Obsidian. It **reuses the existing core and renderer from `src/`** (no
code duplication, no monorepo split) and must not affect the Obsidian plugin
build or output.

## Commits

On `main` (repo: `github.com/vkamolov/obsidian-drum-notation`, private):

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
web/src/editor-grid.ts    grid edit mode (consumes src/edit.ts)
web/src/examples.ts       example notation for the dropdown
web/src/obsidian-dom.ts   Obsidian DOM-helper shim (the browser port surface)
web/src/playground.css    workbench + grid-editor styles, theme variables
web/tsconfig.json         web-only TS config (editor / optional typecheck; NOT in CI)
.claude/launch.json       local preview/dev-server config (Claude Code only)
```

**Modified**

```
package.json              + scripts (web, web:build, web:preview); vite@^6 added to devDependencies
package-lock.json         vite + transitive deps
.gitignore                + web/dist/
.github/workflows/ci.yml  + "Build web playground" step (npm run web:build)
```

## Folder structure (web concerns)

```
obsidian-drum-notation/
├─ src/                      # SHARED core + renderer + audio (UNCHANGED by web work)
│   ├─ parser.ts  serializer.ts  edit.ts  kit.ts  music.ts  types.ts  util.ts
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
│       ├─ editor-grid.ts
│       ├─ examples.ts
│       ├─ obsidian-dom.ts
│       └─ playground.css
├─ .github/workflows/ci.yml  # now also runs web:build
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
  build), `npm run web:preview`.
- The root `tsconfig.json` includes only `main.ts` and `src/**/*.ts`, so `web/`
  is excluded from the plugin's `tsc` typecheck. The plugin esbuild entry
  remains `main.ts`. The plugin build/output is therefore unaffected.
- Runtime dependencies unchanged: still only `vexflow`.

## Feature inventory

- Live editor (`<textarea>`) -> `parseDrumBlock` -> `renderVexflowScore`
  preview; debounced 250ms; localStorage autosave.
- Playback: Play / Stop / Loop Bar via `DrumPlayer` + lazy `AudioContext`;
  cursor + note highlight ported from `main.ts`; click-a-note preview via
  `DrumSynth`.
- Diagnostics panel: parsed-model summary; live `serializeDrumBlock` output with
  a "normalized = input / ≠ input" flag; warnings for unrecognized instrument
  rows.
- Tempo / Grid controls route through `setTempo` / `setGrid` (`src/edit.ts`)
  then `serializeDrumBlock` -> rewrite editor (exercises the model -> text loop).
- Example picker (`examples.ts`), Copy block / Copy normalized, light/dark theme
  toggle (persisted).
- **Edit mode** (`editor-grid.ts`): fixed HTML grid, rows = instruments,
  columns = slots. Cell click cycles empty → normal → accent → ghost via
  `toggleHit` / `applyArticulation` / `removeHit`. Instrument palette adds rows.
  Save serializes the working block back to the editor text; Cancel discards.
  First interactive consumer of `src/edit.ts`.

## Verification steps

```bash
npm ci
npm test            # expect: 61 passed
npm run build       # plugin build: tsc + esbuild, no errors; emits main.js
npm run web:build   # vite build, no errors; emits web/dist/ (JS ~1.17MB — VexFlow; size warning is advisory only)
npm run web         # dev server at http://localhost:5173
```

In the browser at `localhost:5173`:

1. Default "Basic rock groove" renders a VexFlow staff; diagnostics show
   "normalized ≠ input" (it drops default `Tempo: 100` / `Time: 4/4`).
2. Click **Play** → audio + moving cursor/highlight.
3. Click **Edit** → preview swaps to a grid (3 rows × 16 cells for the default).
   Click an empty HH cell → fills (normal); click again → accent. Click **Save**
   → editor text becomes `HH | xXx-x-x-x-x-x-x-`; re-render shows
   "normalized = input".
4. Toggle theme (◐), change Tempo/Grid (rewrites editor via edit helpers), switch
   examples.

Console should be free of errors/warnings.

## Known limitations / things to scrutinize

- **Edit-mode contiguous-prefix rule:** adding a hit to a *later* bar where an
  instrument is absent materializes empty rest-rows in earlier bars (preserves
  the format's contiguous-bar invariant; harmless for round-trip but visible as
  empty rows).
- **`%` measure-repeat bars:** edit mode operates on `block.slots`; behavior on
  `%` / `%x3` repeat bars is untested/edge-case.
- The click cycle covers normal / accent / ghost only; flam / drag / diddle / buzz are
  not reachable from the grid yet (they survive untouched if already present).
- `web/tsconfig.json` exists for editor support but is **not** run in CI — Vite
  transpiles without type-checking, so a pure type error in `web/` would not
  fail CI (only the plugin's `tsc` runs).
- Bundle-size warning on `web:build` is expected (VexFlow) and non-blocking.
- The serializer normalizes characters, so non-canonical input (e.g. `o` on a
  cross-notehead row) round-trips to a *semantically* equal model but a
  different `row.pattern` string — by design (see `notation-format.md` §8).

## Explicitly NOT done

- **GitHub Pages deploy** — deferred. The current plan blocks Pages on a private
  repo (API returns `422`). No deploy workflow was added (it would fail on every
  push). Revisit when the repo is made public.
