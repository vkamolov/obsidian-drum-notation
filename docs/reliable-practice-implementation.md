# Reliable playback and daily practice implementation

Approved scope: the seven-stage implementation plan from 2026-09-07. Pilot thresholds,
sample mix and advanced-notation gates are unchanged. Implementation branch:
`codex/reliable-practice`; original source revision: `4c65f4a781c8cb0a19310d0079d0da2c9f844116`.

## Delivery checklist

- [x] 1. Independent-clock tests and unchanged-synth audio references.
- [x] 2. Random-source seam, conditional noise caching, completed-voice cleanup.
- [x] 3. Advance pass preparation, reconciliation, lifecycle and audio-time restoration.
- [x] 4a. Explicit structural edit results and shared capabilities.
- [x] 4b. Native web dialogs with keyboard/focus behavior.
- [ ] 5. Shared practice coordination and guarded explicit summary persistence.
- [ ] 6. Discoverable Practice tools and session-local Practice view.
- [ ] 7. Conditional web-font experiment (retain inline packaging unless gates pass).
- [ ] Final automated verification and documented manual coverage.

## Validation records

Record commands, outcomes and actual coverage here as each stage is completed. Large raw sound
references and listening clips belong in ignored `test-results/`, not release bundles.
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
