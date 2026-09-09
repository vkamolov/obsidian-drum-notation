# Safe refitting and Focus view implementation

Implemented against `9ea4e3afe32a75b9d80fcb8bc4317dc767d28a23`.

## Behavior

- Ordinary pane resizing now redraws the committed score without reparsing pending
  editor text, normalizing practice configuration, clearing recovery warnings or
  touching transport ownership. The resize coordinator is cancellable, measures
  successful geometry separately from observed width, and compares block references.
- Focus changes refit immediately. Delayed duplicate redraws are suppressed. Bar
  and note keyboard focus is restored using musical identities; external controls
  and open dialogs remain intact. Layout remains class-only, with no pane-width
  animation or preview reparenting.
- Removed the duplicate Practice menu and Exit controls in both hosts. Loop,
  Tempo and Metronome retain their existing functions; status retains progress,
  Finish & summary and summary access. Obsidian no longer stores a per-block
  Practice-view flag. Existing saved logs are unaffected.
- The playground has one session-local Focus view toggle, disabled accessibly
  during editing/verification. It preserves playback and cached-navigation state,
  hides authoring panels, exposes the score title, and uses the whole actions row.
  Its ordinary visual size is unchanged; only its hit area expands to 44px.
  Focus primary controls are visibly at least 44px. The ordinary mobile grid stays.
- Tempo displays effective BPM in the playground; Obsidian adds the percentage
  in percentage mode. Obsidian controls are bounded so narrow blocks wrap rather
  than overflow. No container queries or new breakpoint mechanism were added.

## Layout evidence

Native DOM was captured from original and candidate plugins in disposable Obsidian
1.13.7 vaults. The original used a preserved pre-change build; workspace editing
had already begun before native capture succeeded. The current snapshot is checked
against a fresh native render, not synthesized from the playground. See
[fixture provenance and commands](../tests/fixtures/toolbar/README.md).

Same-run A/B/C comparisons in Chromium 151.0.7922.34 and WebKit 26.5, at a fixed
1280px viewport, produced identical thresholds in the captured light/dark fixtures:

| Percentage-mode labels | A: original | B: label only | C: final | Net change |
|---|---:|---:|---:|---:|
| `75%` → `90 BPM · 75%` | 609px | 667px | 634px | +25px |
| `150%` → `388.5 BPM · 150%` | 617px | 695px | 662px | +45px |

These are minimum outer block widths for title and controls to share one row.
The final toolbar satisfies `C ≤ max(A, B) + 1px`. The longer label does have a
height cost in the affected width band; Practice removal offsets part of it.
Internal button wrapping is measured separately and is not compared against the
old overflowing group. Full reports live in `.artifacts/toolbar/`; tracked initial
summaries are historical evidence, not future pixel expectations.

No reversal was detected at 32px sample spacing. This does not prove monotonicity:
narrower excursions can escape sampling. Transition brackets are bisected to 1px.
The captured host font stack resolves on each test machine; this is not evidence
for every platform font or third-party theme.

At 1280 × 900, original and candidate ordinary playground builds both measured
117.28125px for the actions row and 604.484375px for the preview pane. Both retain
three columns (509.594 / 214.016 / 509.594px). There is no permanent extra toolbar
row. Focus and mobile screenshots were inspected locally.

Native candidate Reading-view checks passed at 280, 390 and 625px block widths
without controls overflow; print media hid controls. The disposable vault's visual
editing setting was off, recorded in the snapshot rather than silently overridden.

## Verification

- 695 unit tests passed, including fixture integrity and adapter-drift checks.
- Plugin build, web build and web typecheck passed.
- Integrated Chromium/WebKit suite: 56 passed. Focus/refit coverage includes
  pending source edits, warnings, selection, note focus, paused ramps, immediate
  refitting, hit areas, unavailable states and responsive layouts.
- Four navigation tests passed. Chromium required the original page identity and
  `pageshow.persisted === true`; Focus was retained. The cached branch is also
  exercised deterministically, and reload resets Focus. WebKit took a fresh-page
  path on the real Back test (`sameInstance: false`, `persisted: false`); its cached
  branch passed deterministic coverage.
- Importer checks passed for 42 conformance fixtures; kit, notation-reference,
  third-party, sound-provenance and style-sink checks passed.
- Dependency audit: zero production vulnerabilities. Full audit reports two
  moderate development dependency entries (`vitest` / `@vitest/mocker`,
  GHSA-82fw-gwwq-j7x9). Remediation requires a reviewed Vitest major upgrade;
  no dependency changes were made as part of this UI work.
- After the final responsive layout adjustment, 16 targeted browser tests also passed.
- Vite retains its existing large-bundle advisory. Font packaging is unchanged.

## Outstanding publication gates

This is implementation evidence, not release approval. Native checks covered Reading view, Live Preview guidance, embeds, pop-outs and
multiple blocks in the isolated vault. Real PDF export remains a manual check:
Electron rejected the browser debugger’s `Page.printToPDF` command, although print
media correctly hid controls. Physical mobile coverage, real-audio soak, draft
release and Obsidian source checks remain publication work. Automated native
checks and browser fixtures do not establish every third-party theme or platform. Pilot thresholds and scope are unchanged.
