# Frozen sound evidence

`baseline.json` remains byte-for-byte unchanged. It contains 164 cases, eight seeded
and 32 unseeded draws per case, captured from synth revision `4c65f4a` using the
harness at `d858041`. Only the original summary measurements and RMS calibration
survive. Original PCM, listening clips and full per-draw RMS windows were lost when
Playwright cleaned `test-results/`. Reconstructed audio is not recovered original audio.

`provenance.json` connects the baseline checksum, source and harness hashes,
capture manifest/lockfile, package integrity, browser distribution and coverage.
It distinguishes capture facts from retrospective Git/package evidence. Original
OS, architecture and executable identity remain unknown.

## Installation and verification

```sh
npm run check:sound-provenance
npm run sound:runner:install
npm run sound:browsers:install
npm run sound:preflight
npm run sound:reconstruct
```

The static check requires Git history, but no installed private packages, browser
binaries or network. CI runs it and Node-only fixture/stub tests. The ordinary
application browser suite still installs its own browsers. CI does not install
sound browsers or run the full reconstruction.

The private installation lives at `tools/audio/reference-runner/` and resolves
Playwright and esbuild by absolute paths from its own `node_modules`. Browser
binaries live in `.artifacts/sound-runtime/browsers`. The runner verifies the locked
packages, distribution and launched browser versions. Root application upgrades
cannot change its package selection. Changes to the frozen runner require explicit
review; never edit historical provenance just to match a root package upgrade.

Reconstruction verifies and bundles the original source and capture harness from
Git, runs all 6,560 renders, and records the new OS/architecture, executable and
browser-build hashes. It preserves all per-draw RMS/spectral measurements, seeded
Float32 PCM and representative WAV files in a uniquely named directory under
`.artifacts/sound-references/`. This directory is ignored, excluded from release
inputs, and independent of disposable browser-test output. Back it up explicitly.

## Comparison modes

- `npm run sound:compare`: compare the current synth directly with frozen original
  measurements. No original PCM is required. Frozen limits are unchanged.
- `npm run sound:seam -- --mode historical --reference DIRECTORY`: requires a
  verified inventory of recovered original captured PCM. Currently unavailable.
- `npm run sound:seam -- --mode reconstructed --reference DIRECTORY`: explicitly
  compare current output with labelled reconstructed PCM. This does not prove
  equality with the missing original PCM.
- `node tools/audio/compare-seam.mjs`: separate exact synthesis-buffer and scheduling
  comparison against the original source, using the isolated bundler and a Node
  backend. This is not an acoustic comparison.

Both sample modes reject missing files, checksum/length errors and nonfinite PCM
before launching browsers. Sample differences use the original `1e-7` ceiling.
`npm run sound:capture` refuses to overwrite the existing baseline.

## Reports and archives

Each completed run contains an inventory with hashes, `report.json`, and, for
reconstruction, `variability.md`. Partial runs are not published as complete
inventories. The report separates seeded mean-limit agreement, unseeded means,
spread, historical instability and provenance limitations. Reconstruction exits
successfully when evidence generation completes; that is not acoustic acceptance.
Comparison commands exit unsuccessfully when frozen limits fail.

Coverage is computed from the selected manifest. Every recoverable-SD RMS window
is listed separately, with audible and instability markers. Floored bands yield
only an original observed-SD bound of 2/3 dB. Normal-theory uncertainty figures
(12.7% for one 32-draw estimate; approximately 18% for an independent ratio) are
explanatory, not significance tests. Original platform uncertainty appears beside
the results. Correlated windows are not independent evidence. A less variable
reconstruction does not resolve historical instability or recalibrate any limit.

Use explicit modes for atomic local archive operations:

```sh
npm run sound:archive -- export --mode reconstructed --reference .artifacts/sound-references/RUN --archive .artifacts/sound-references/backup.json.gz
npm run sound:archive -- import --mode reconstructed --reference .artifacts/sound-references/RESTORED --archive .artifacts/sound-references/backup.json.gz
```

Archives include the inventory and all listed files. Imports validate before
publishing, reject path traversal and refuse existing destinations. Exports also
refuse existing archive paths. Inventories establish integrity, not independent
proof of historical capture: do not relabel reconstructed audio as historical.
Future candidates always compare directly with the frozen original measurements;
reconstructed measurements never replace or widen them.
