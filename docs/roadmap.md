# Practitioner-first Roadmap

Drum Notation is an Obsidian-native drum **practice notebook**, not a DAW. The workflow it
optimises for: capture or find a groove, hear it, select the difficult passage, drill it while
raising the tempo, reuse it in lessons or setlists, and export it when needed.

Add notation syntax only when justified by the chart pilot, importer workarounds, or repeated user
feedback. Completeness is not a reason.

## State of play

| | |
|---|---|
| **Published** | `1.10.1` |
| **In development** | `1.11.0` — Practice Sessions and Logs; release candidate awaiting manual QA, draft checks and the publication gate |
| **Blocked on evidence** | `1.12.0` — scope undecidable until the chart pilot runs |
| **Chart pilot** | `agent-plugin/drum-notation-importer/pilot/` — `status: not-started`, `completed: 0` |

Shipped and therefore **removed from this roadmap**: phrase selection and looping, session
transport restoration, hands-free commands, one/two-bar count-in, screen wake lock, subdivision
and gap click, the exact-BPM tempo ramp trainer, and the current advanced notation foundation
(tuplets, mixed meters, split voicing, section repeats, visual editing, PDF export and
printed-score import).

## Planning principles

- **Practitioner value first.** Prefer a smaller workflow that improves daily practice, lessons,
  rehearsals or gigs over notation completeness for its own sake.
- **Evidence before syntax.** Use chart-pilot frequency and workaround severity to justify new
  navigation syntax. Do not infer demand from the availability of a VexFlow glyph.
- **Text first for advanced structures.** Ship a stable model, parser, serializer and playback
  meaning before attempting visual authoring. Preserve ordinary visual editing through local
  locking where possible.
- **Portable notation, session-local practice state.** Practice selections, click settings,
  trainers and summaries must not silently change serialized drum blocks or vault files. Vault
  writes remain explicit and narrowly scoped.
- **One roadmap, multiple consumers.** Playback, cursor/highlight, practice goals, future MIDI
  export and navigation must consume the same finite performed-bar roadmap rather than each
  inventing repeat semantics.

## The pilot gate — read this before planning 1.12.0

**The single most important open item.** A pre-registered 20-chart study exists and has never
run. Its protocol, record schema and aggregate are committed; only the data is missing.

It answers one question: **are you building a practice tool or a chart tool?** That decides
whether song navigation (endings, D.S./Coda, per-section tempo) comes before or after advanced
visual editing — a difference of several releases.

- Declared mix: **14 practice / 6 full-song-or-gig charts**, chosen *before* transcribing any.
- Threshold: `navigationBlocked ≥ 25%` → Track A. Below → Track B, unless recognition and
  correction costs are high, in which case improve the importer workflow first.
- Within one chart of the boundary → preselect ten more with the same mix, extend to 30, stop.
- A second, independent gate covers focused-crop recognition: 12 blind cymbal examples; three or
  more confident errors means stop prompt tuning and build browser-local staff guides.
- Effort is roughly **4–5 hours total**, 10–15 minutes per chart.
- Commit only the anonymous aggregate and a short decision record. Raw records stay gitignored.

Rules are in `agent-plugin/drum-notation-importer/pilot/protocol.md`. Do not amend the mix or
threshold after seeing results.

Use the repository-local `pilot:record`, `pilot:aggregate`, `pilot:status` and `pilot:check`
commands to collect and verify anonymous data. They enforce the protocol mechanically but never
select charts, classify outcomes or replace the human Track A/Track B decision. The
[helper guide](../agent-plugin/drum-notation-importer/pilot/README.md) provides the operational
walkthrough and examples.

> The gate has now been skipped through 1.8.0, 1.8.1, 1.9.0, 1.10.0 and 1.10.1 — the same
> release-order inertia it was written to prevent. 1.11.0 is already being written, and nothing in
> it depends on the pilot, so it should not be paused. Gate the **1.11.0 publish step** instead:
> development, testing, tagging and unpublished draft creation proceed unblocked, but the draft
> is not published until the decision record exists. That puts the pilot ahead of 1.12.0 scoping,
> which is the only place it actually decides anything.
> If twenty charts is the barrier, shrink the sample and amend the protocol *before* sampling —
> a directional read from eight real charts beats a precise threshold applied to zero.

Before publishing 1.11.0:

1. Complete the predeclared sample, including a precommitted extension when the result is within
   one chart of the threshold.
2. Update and validate `pilot/aggregate.json`; keep raw chart records gitignored.
3. Commit a short decision record and store its repository path in `decisionRecord`.
4. Record the observed `navigationBlocked` count/rate, the 25% comparison, selected track,
   blocking features and explicitly deferred findings.
5. Only then publish the already-tested 1.11.0 draft and freeze the smallest coherent 1.12.0
   scope from the selected track.

## 1.11.0 — Practice Sessions and Logs *(in development)*

Builds on the pass-tracking introduced by the tempo ramp trainer. The core lives in
`src/practice-session.ts`.

- Finite repetition goals for a bar, selected phrase, or whole notation.
- Count-in cadence: once at transport start, or before every pass.
- Exact-BPM tap tempo (30–260), entering an exact-BPM mode rather than rounding to a percentage.
- Resumable session progress and an **active session time** clock (includes count-in; excludes
  pauses; must never accrue during rerenders or scroll-away).
- Practice summary with explicit **Save to log** — never automatic — appending atomically via
  `vault.process()` under a `## YYYY-MM-DD` heading in a configurable note.
- Playground equivalent with Copy Markdown, no persistence.

Out of scope here: accuracy assessment, descending ramps, durable toolbar-state persistence.

Implementation checkpoint as of 2026-08-27: the code and documentation are complete and the
release candidate is versioned as 1.11.0. Remaining work is full release verification, manual
Obsidian QA, draft source checks and the publication-only pilot gate above.

## Reusable foundations already earned

- The absolute-quarter timeline and per-occurrence `secondsPerQuarter` support piecewise timing;
  reuse them for inherited per-system `Tempo:` rather than adding a second timing engine.
- Performed-bar roadmaps already flatten section repeats, compact repeats, selections and trainer
  targets. Endings should filter occurrences; D.S./D.C. requires a separately validated finite
  navigation graph with cycle detection.
- `PracticeTarget`, pass callbacks and the session-local LRU store are shared foundations for
  future drills. New trainers should extend these instead of adding independent transport state.
- Atomic `vault.process()` log writes establish the rule for future generated artifacts: explicit
  user action, one declared target and failure without losing the in-memory result.

## Post-pilot — release numbers are nominal, the gate overrides them

`1.12.0` is the smallest independently useful slice from the selected track, not the whole track
bundled into one release. Re-evaluate after every slice; release numbering must not override pilot
evidence or prerequisite order.

### Track A — navigation gate triggered (`navigationBlocked ≥ 25%`)

1. `%2` two-bar repeat, clearly distinguished from `%xN`. *(Only `%` and `%2` are real drum
   notation; the two-bar symbol spans a barline, so `%3`/`%n` do not exist and should not be
   invented.)*
2. First/second endings, using the existing two-traversal section-repeat roadmap —
   `PlaybackRoadmapEntry.sectionTraversal` already exists, so an ending is a filter on the
   roadmap, not a new playback concept. **Cheapest structural feature by a wide margin.**
3. Per-system inherited `Tempo:`, following the 1.4.0 per-system meter pattern. The trainer
   already built the piecewise elapsed-time infrastructure this needs.
4. Configurable section-repeat counts, if charts demonstrate demand.
5. Pilot-approved rehearsal marks, cue text, page breaks.

D.S., D.C., Segno, Coda and Fine only when the pilot shows those specific symbols caused
blocking. They are a navigation **graph**, not a filter: resolve to a finite flattened roadmap
with cycle detection rather than adding jumps to the scheduler. VexFlow already provides the
glyphs (`staverepetition`, `stavevolta`), so the cost is entirely model and playback.

### Track B — navigation gate not triggered

1. **Region-preserving edit round-trip — a hard prerequisite.** Editing a hit inside a tuplet and
   re-serialising currently destroys it (`x-x-3(x-x)x-x-` → `x-x-xxxx-x-`). That is why
   `main.ts` refuses visual editing on tuplet blocks. No grid work is safe until this holds.
2. Replace whole-block refusal with **bar-level locking** — visible lock indicator, reason,
   accessible description, no misleading enabled actions. Keep ordinary bars editable inside
   advanced blocks.
3. Edit hits, rests, sticking and articulations inside existing tuplets, structure fixed.
4. Make the grid use each system's effective meter and grouping.
5. `Edit this drum block visually` command, moving users from Live Preview to the supported
   Reading-view workflow.

Defer visual tuplet *creation* until fixed-structure editing is proven.

### Convergence

Complete whichever track did not receive priority, unless pilot evidence removes the need.

## Later practitioner work

**Chart utilities.** Bar numbers · `Tacet: N` multi-measure rests · laissez-vibrer instead of full
cross-note ties (audibly identical on drums, a tenth of the cost) · display-only dynamics before
playback-affecting ones · single-score SVG/PNG export into the vault. Do not add another
system-break construct — `Bar` already serves that purpose.

**Local MIDI exchange.** Deterministic import in the plugin and playground — *not* in the
vision-based importer agent, which exists only to borrow a model's eyes. GM drum mapping, tempo
and meter meta-events, Grid 16/32 quantisation with tolerance controls, and velocity mapped to
ghost/normal/accent. Export the **expanded audible roadmap** (repeats and tuplets realised) beside
the source note, and document that exported bar count will not match written bar count.

**Electronic-kit capture.** Reuse MIDI import for desktop-first Web MIDI recording — exact notes
and velocities, so no classification problem at all. Verify Electron and Android support before
advertising; iOS does not support Web MIDI.

**Live Preview editing.** The largest remaining audience expansion, and the hardest. Route edits
through CodeMirror transactions rather than `vault.process()`. The nastiest problem is not the
write path: Live Preview swaps the widget for raw text when the cursor enters the block, so design
for the editor vanishing mid-edit. Cheap 80% first: the Reading-view command above.

## 2.0 — Optional realistic playback

Synthesised playback stays the default. Optional user-supplied samples from a configurable
vault folder; no bundled library; decode only what the current block needs; per-instrument
fallback to synth; opt-in on mobile; roughly 8–25 MB for a useful kit, never required.

## Deliberately deferred

Hosted or automatic audio transcription · handwriting recognition · automatic practice scoring ·
backing-track mixing or DAW-style sequencing · full cross-note ties · nested or cross-bar tuplets ·
descending or curved tempo ramps · mandatory cloud accounts, telemetry, or bundled samples.

## Cross-release quality gates

Every milestone verifies: parser/serializer idempotence and backward compatibility · mixed meters,
tuplets, rests, repeats, split voicing and playback mapping · practice selection, advanced click,
count-in, wake lock and trainer interoperability · touch, narrow-screen, keyboard, screen-reader
and music-stand usability · Reading view, Live Preview, embeds, pop-outs, themes and print/PDF ·
atomic and intentional vault writes only · full tests, builds, typecheck, browser/CSP, security,
audit and clean diff · an unpublished draft plus Obsidian source checks before publication.
