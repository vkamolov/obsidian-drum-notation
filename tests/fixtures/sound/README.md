# Original synthesis references

Captured before synthesis edits from revision `4c65f4a781c8cb0a19310d0079d0da2c9f844116`.
`baseline.json` contains 164 fixture/browser/sample-rate combinations, each with eight seeded
and 32 unseeded draws (6,560 renders), per-draw summary measurements and frozen per-window
RMS calibration. Engine versions and the synth source hash are recorded in the manifest.

`npm run sound:capture` refuses to overwrite this baseline. Raw seeded Float32 samples and
representative WAV clips are generated in ignored `test-results/sound-baseline` and
`test-results/sound-capture`. The full raw measurement report is also retained there.
`npm run sound:seam` compares every seeded sample; `npm run sound:compare` evaluates the
optimization against the fixed original calibration. Neither changes the baseline.

To reconstruct missing raw references on another machine, use the original source revision
in an isolated checkout with the captured browser versions and these harness files. Do not
capture the modified production synth as a replacement baseline. Audio fixtures are not
included in either the plugin or the web release.
