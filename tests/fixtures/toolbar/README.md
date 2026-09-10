# Current native toolbar fixture

`native-current.json` was captured in a disposable Obsidian 1.13.7 vault after
Practice navigation was removed. It contains no user-note content. `host.css`
preserves matching host rules in light/dark modes. Font binaries are not copied;
the captured font stack resolves on the test machine. These test-only inputs
remain approximations of native behavior, not evidence for all platforms/themes.

The controls metadata describes a particular settings/content state: visual
editing is disabled, and Create bar is intentionally hidden because a bar exists.
Those labels are captured state, not universal product invariants. Tests match
all controls by order, class-token sets and labels, including hidden controls.
Speed text, accessible label and tooltip are deliberately substituted per case.
Only the 259-BPM case changes subtitle text and aria-label; its `. Time: 4/4`
suffix survives, and the tempo-independent `title` remains unchanged in both cases.
The stored native capture is never rewritten for these substitutions.

`provenance.json` protects current capture/host bytes and adapter construction and
speed-label source fingerprints. Review structural/state changes and recapture
when needed. Review formatting changes against substitutions and native output.
Refresh host evidence when Obsidian or relevant host styles change. Do not update
fingerprints simply to silence failures. Current plugin CSS is read directly;
captured font defaults are applied to an ancestor, not the candidate root.
`tests/toolbar-source.test.ts` remains an independent, unchanged source check.

## Commands

- Build with `npm run build`, then capture with
  `node tools/capture-native-toolbar.mjs` (current only).
- `--name` and `--replace-original` are retired and fail before native launch.
- `--plugin-dir /absolute/path/to/built/plugin` selects the reviewed build.
- `--app-package /absolute/path/to/obsidian-VERSION.asar` copies an updated app
  package into the disposable profile, never the application bundle.
- `--capture-host-css` refreshes host evidence only with explicit review.
- `--verify-contexts` checks Reading view, multiple blocks, Live Preview, embeds,
  pop-outs and PDF in a disposable vault and writes `.artifacts/native-toolbar/contexts.json`.
- Run `npx playwright test tests/browser/toolbar-layout.spec.ts` for current layout.

The capture command owns and closes its disposable process group, never the
user's vault. Temporary files remain for diagnosis. Review captures and integrity
metadata together; an Obsidian upgrade need not match a historical host version.

## Durable check and retired experiment

Each label/theme/engine sweep measures all 1,241 integer and half-integer widths
from 280–900px in a single in-page loop, at a 1280px viewport. Identity, visibility,
labels and positive geometry are required at every width before containment can
pass. A complete unique sequence is mandatory. Reports record runtime, requested
and measured widths, heights, fonts and browser environment in `.artifacts/toolbar/`.
A 1 CSS px allowance is measurement tolerance, not a configurable layout budget.
Half-pixel probes detect wrap changes causing overflow greater than 1px; they do
not establish zero subpixel overflow or cover arbitrary fractions, zoom or themes.

The completed A/B/C acceptance experiment is retired. Historical results and
provenance are in `docs/evidence/toolbar/`; original DOM/CSS bytes are recoverable
from commit `ade2907`. They are not active test inputs or future pixel expectations.
