# Agent Instructions

## Project

This repository is the Obsidian Drum Notation plugin.

Local path:

```text
<local-workspace>/Projects/obsidian-drum-notation
```

GitHub remote:

```text
https://github.com/vkamolov/obsidian-drum-notation.git
```

## Build And Test

Use these commands after relevant changes:

```bash
npm test
npm run build
npm run web:build
npm run web:typecheck
```

`npm run build` is important after source edits because Obsidian loads the
generated local `main.js`. The generated `main.js` is gitignored and should not
be committed.

Use the web commands after playground/editor changes.

## Source Layout

- `main.ts` is the Obsidian adapter and UI entry point.
- `src/*.ts` contains the plugin source modules.
- `src/kit.ts`, `src/parser.ts`, `src/serializer.ts`, and `src/edit.ts` are
  DOM-free core logic.
- `src/engrave.ts`, `src/player.ts`, `src/synth.ts`, and `main.ts` are the
  renderer/playback/Obsidian adapter layer.
- `docs/notation-format.md` is the canonical notation-format reference.
- Tests live in `tests/*.test.ts`.

## Format Documentation

Update `docs/notation-format.md` for changes that affect:

- parser syntax
- serializer output
- notation characters
- supported settings or metadata behavior
- row/bar/system structure
- repeat notation
- edit-model behavior that changes serialized text

Update `README.md` too when the change affects everyday user-facing examples or
quick-start behavior.

## Model Invariants

`DrumBlock` is the central model and is intentionally redundant:

- rows carry pattern strings
- slots carry parsed hits
- `block.rows` and `block.slots` are flattened views of objects inside
  `systems -> bars`

Any edit must keep rows, slots, bars, and systems in sync. Prefer rebuilding via
`finalizeDrumBlock()` instead of patching only one side of the model.

Rows can only express a contiguous prefix of bars inside a system. Empty bar
segments are filtered out on parse. Adding a hit to a later bar may materialize
empty rest rows in earlier bars to preserve this invariant.

## Serialization Contract

The serializer is model-level, not byte-for-byte text preservation.

Expected contract:

- `parse -> serialize -> parse` preserves the model.
- serialization is idempotent.
- output is normalized and deterministic.
- default settings are omitted.
- unknown metadata is preserved in order.
- hit characters normalize to canonical notehead-aware glyphs.

Do not assume exact source-character round-trip. For example, `>`, `!`, `#`,
`X`, and `O` all parse as accent.

## Repeat Notation

Current repeat support:

- `%` repeats the previous one bar once and renders as one repeat bar.
- `%xN` repeats the previous one bar N times and renders as one compact repeat
  bar with an `xN` marker.
- Separate `%` lines remain separate visible repeat bars.
- `%2` is reserved for a future two-bar repeat feature and is not currently
  modeled.

Internally, repeat shorthand expands into playable slots so playback stays
simple. Rendering may collapse `%xN` visually, but cursor/highlight should map
repeat playback back to the repeated source bar's written notes.

Deferred repeat features:

- two-bar repeats
- section repeat signs
- first/second endings
- D.S., D.C., Segno, Coda, and other roadmap symbols

These need explicit span and playback-roadmap semantics.

## Playback Direction

Current playback uses synthesized Web Audio sounds. Future realistic playback
should remain optional:

- keep synth playback as the default fallback
- do not bundle a huge sound library
- prefer optional user-provided compressed samples
- lazy-load and cache samples only when playback is used
- missing samples should fall back to synth

Target optional sample-kit size should stay lightweight, roughly 8-25 MB for a
first useful kit.

## Git Notes

The project is now local, not in the old OneDrive working directory.

The working tree may contain user or external-tool changes. Do not revert
changes you did not make. Read current diffs before editing files that are
already modified.
