# Reliable playback and daily practice implementation

The original Practice-menu/view UI described below is superseded by the
[Focus view implementation](focus-view-implementation.md). Playback, session and pilot gates are unchanged.

Approved scope: the seven-stage implementation plan from 2026-09-07. Pilot thresholds,
sample mix and advanced-notation gates are unchanged. Implementation branch:
`codex/reliable-practice`; original source revision: `4c65f4a781c8cb0a19310d0079d0da2c9f844116`.

## Delivery checklist

- [x] 1. Independent-clock tests and unchanged-synth audio references.
- [x] 2. Random-source seam, conditional noise caching, completed-voice cleanup.
- [x] 3. Advance pass preparation, reconciliation, lifecycle and audio-time restoration.
- [x] 4a. Explicit structural edit results and shared capabilities.
- [x] 4b. Native web dialogs with keyboard/focus behavior.
- [x] 5. Shared practice coordination and guarded explicit summary persistence.
- [x] 6. Discoverable Practice tools and session-local Practice view.
- [x] 7. Conditional web-font experiment (candidate rejected; inline packaging retained).
- [x] Final automated verification and documented manual coverage.
- [ ] Pre-publication hands-on and draft-release/source-check gates (see below).

## Validation records

Record commands, outcomes and actual coverage here as each stage is completed. Large raw sound
references and listening clips now belong in ignored `.artifacts/sound-references/`, not release bundles.
See the remediation record below for the loss of the original raw audio.
Do not regenerate sound baselines after production synthesis changes.

## Release boundary

This work does not publish a release. Before publication, complete a 30–60 minute real-audio
practice session, native Obsidian and mobile checks, and the draft-release/source-check workflow.
Do not represent browser emulation as physical-device coverage.

### Stage 1 reference checkpoint

- Original unit suite: 626/626 passed. Independent-clock characterization: 3/3 passed.
- Sound references: 164 cases × 40 renders = 6,560 offline renders; Chromium and WebKit,
  44.1/48 kHz. Source hash and browser versions are frozen in the reference manifest.
- Raw seeded audio: 100 MB in ignored test results; tracked references contain measurements.
- Production synthesis remains unchanged at this checkpoint. Adapter lifecycle/persistence
  regression coverage is extended alongside the corresponding fixes before controller extraction.

### Stage 2 sound decision and resource cleanup

- The injected random source preserves **every generated Float32 buffer and every Web Audio
  node parameter/connection/scheduling call exactly** across 16 seed/rate combinations and
  144 instrument/articulation combinations each (`node tools/audio/compare-seam.mjs`).
- The proposed `1e-7` final-mix threshold is not reproducible in these browsers: both the
  seam run and an independent original-versus-original run have 54 failures, typically
  `1.04e-7`–`1.79e-7`. Original code is loaded from the recorded revision without editing it.
  These are final-mix roundoff differences; the exact buffer/graph comparison passes.
  The threshold and original references were not widened or regenerated.
- One original WebKit/48 kHz/60 ms buzz window exceeds the fixed 4 dB variability ceiling.
  **Noise caching is not shipped:** its automatic sound-acceptance prerequisites fail.
  Original noise generation and modulation are retained as required by the fallback.
- Completed sources now release their own chains. Shared cymbal filters/gains survive until
  all six oscillators finish. Stop cancels prepared sources and removes ended listeners;
  a pending asynchronous start cannot recreate resources after Stop.
- Synth lifecycle regressions: 4/4 passed; plugin build passed. Raw comparison reports and
  WAV clips remain in ignored test results. No claim of a listening audition is made.

### Stage 3 scheduling and practice-time checkpoint

- Future passes are prepared with a 500 ms audio-time lead while pass start/completion remains
  tied to reached audio boundaries. One reconciler handles timers, visibility and context state.
- Early timer delivery re-arms from the remaining audio delta; late delivery reconciles reached
  events in order. A missed preparation deadline produces a resumable pause without overdue notes.
- Hidden pages keep audio and practice accounting active while suppressing cursor work. Suspended,
  interrupted and closed contexts preserve reached progress and require an explicit resume.
- Practice duration now uses context/generation-owned cumulative audio progress. Missing or stale
  anchors restore paused and never borrow wall or monotonic time from another clock.
- Prepared notifications, occurrences and active intervals remain bounded after 10, 100 and 1,000
  passes. Start/stop races and passive-renderer publication are guarded.
- Verification: 649/649 unit tests, plugin build, web build/typecheck, and 38/38 Chromium/WebKit
  production workflow/CSP tests passed.

### Stage 4a structural editing checkpoint

- Structural mutators now return discriminated results with the original block and a stable reason
  code on failure. Successful no-ops report `changed: false` and do not create undo or write work.
- One shared capability check protects tuplets and system-level rhythm declarations in the core,
  the Obsidian adapter and the playground. Bar clipboard capture and paste use the same boundary.
- Time-signature edits retain their tuplet-aware relative/absolute span behavior and reject written-
  beat overflow. Advanced source structure remains available through text editing.
- Verification: 652/652 unit tests, plugin build and web build/typecheck passed.

### Stage 4b web dialog checkpoint

- Repetition goals, tempo ramps, tap tempo, summaries, repeat counts and confirmations now use
  modal native `dialog` elements through one helper. The page is inert while each modal is open.
- Keyboard focus stays within the active dialog. Escape closes or cancels it, then focus returns to
  the opener when possible and to Play when the opener has disappeared.
- Replacement confirmations stack over setup dialogs. Cancelling returns to the preserved setup
  inputs instead of discarding them. Obsidian continues to use its native modal classes.
- Chromium and WebKit browser coverage exercises initial focus, Tab wrapping, Escape, nested
  confirmation cancellation and missing-trigger restoration.

### Stage 5 shared coordination checkpoint

- A DOM-free `PracticeSessionController` now owns run start/resume, audio checkpoints, pass
  accounting, settlement, summary completion and summary handling through typed commands.
  Read-only cloned snapshots, subscriptions, transport/lifecycle ports and disposal are explicit.
- The playground migrated first, followed by Obsidian. DOM rendering, clipboard formatting and
  vault access remain adapter concerns. A shared cancellation-generation primitive guards both
  hosts' asynchronous transport starts.
- Summary actions capture identity and revision. An older completion cannot handle a replacement
  summary; failures leave the summary available. Same-summary saves coalesce per controller and
  across Obsidian renderers through one plugin-wide coordinator.
- Obsidian log creation retains race recovery and existing-file writes remain atomic through
  `vault.process`. Score writeback and its expected-source conflict check remain separate.
- Verification: 658/658 unit tests, plugin build and web typecheck passed; the focused Chromium/
  WebKit practice workflows passed after the playground migration.

### Stage 6 daily-practice interface checkpoint

- Both hosts now provide a visible Practice entry for phrase selection, repetition goals, tempo
  ramps, tap tempo, click/count-in setup, session control and summaries. Existing Loop, Speed and
  keyboard entry points remain available.
- Practice view is session-local. The playground collapses setup, source, editor and export panels;
  Obsidian applies the focused layout only to the selected rendered drums block. Transport, tempo,
  progress, Finish & summary and Exit remain available.
- Practice-view primary controls meet a 44 px minimum target. Keyboard focus and Escape restoration
  remain visible and deterministic, and unavailable visual editing explains the Reading-view path.
- Verification: 659/659 unit tests, plugin build, web build/typecheck and all 40 Chromium/WebKit
  production workflow/CSP tests passed. The Practice-view browser check covers light/dark state,
  widths of 390, 650 and 1,280 px, and 200% page zoom.

### Stage 7 font-packaging decision

- Completed 240 measured visits: 30 interleaved trials per build for cold, repeat,
  fresh-cache post-update and expired-cache post-update scenarios.
- External fonts fail acceptance: cold median +5.2%; expired-cache median +6.5%.
  Fresh-cache updates improve by 44.5%, which does not independently qualify.
- Normal web builds retain inline fonts. The isolated experiment and full measurement
  record remain available; see [method, results and limitations](benchmarks/font-packaging.md).
- The candidate passed the 40-test Chromium/WebKit suite and real-server font failure/
  reload recovery checks. No deployed-candidate or native-device validation is claimed.

### Final verification — 2026-09-07

- `npm test`: 659/659 passing across 37 files.
- `npm run build`, `npm run web:build`, `npm run web:typecheck`: passing; local
  `main.js` rebuilt and normal inline-font web output restored.
- `npx playwright test`: 42/42 Chromium/WebKit tests passing, including new coverage
  for Practice label width, block-scoped controls and hiding Exit outside Practice view.
- `check:agent-plugin`: 42 conformance fixtures passing. `check:openai-submission`,
  `check:kit-reference`, `check:notation-reference`, `check:third-party` and
  `security:style-sinks`: passing. `npm audit --omit=dev`: zero vulnerabilities.
- `pilot:check`: aggregate valid, pilot still not started (0/20). Sample mix,
  thresholds, extension rule and independent cymbal gate remain unchanged.
- `git diff --check`: clean. Vite still reports the known large-chunk warning;
  the measured font experiment does not justify changing packaging to silence it.

### Actual manual coverage and remaining publication gates

This implementation run completed automated desktop-browser coverage. It did not
complete a listening audition, a 30–60 minute hands-on playback session, physical
mobile testing, or native Obsidian checks. Before publication, record:

- [ ] 30–60 minute real-audio practice run with background/foreground transitions.
- [ ] Native Obsidian Reading view, Live Preview, embeds, pop-outs and print/PDF.
- [ ] Actual mobile device/OS coverage and audio-interruption recovery.
- [ ] Draft release and Obsidian automated source check, resolving new findings.

No release was published, and browser viewport emulation is not claimed as mobile
hardware coverage. These are publication gates, separate from the completed code
implementation and the unchanged chart-pilot requirements.

## Playback reliability remediation — September 2026

The follow-up correction is implemented in the working branch. See
[the remediation completion record](technical-review-remediation-plan.md) for the
shutdown, cached-navigation, grace-deadline and sound-provenance changes, actual
verification results and remaining publication gates. Earlier raw-audio claims
above describe the original capture, not files still available today.
