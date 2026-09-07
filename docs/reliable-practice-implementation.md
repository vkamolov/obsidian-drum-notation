# Reliable playback and daily practice implementation

Approved scope: the seven-stage implementation plan from 2026-09-07. Pilot thresholds,
sample mix and advanced-notation gates are unchanged. Implementation branch:
`codex/reliable-practice`; original source revision: `4c65f4a781c8cb0a19310d0079d0da2c9f844116`.

## Delivery checklist

- [ ] 1. Independent-clock tests and unchanged-synth audio references.
- [ ] 2. Random-source seam, conditional noise caching, completed-voice cleanup.
- [ ] 3. Advance pass preparation, reconciliation, lifecycle and audio-time restoration.
- [ ] 4a. Explicit structural edit results and shared capabilities.
- [ ] 4b. Native web dialogs with keyboard/focus behavior.
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
