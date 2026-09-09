# Native toolbar evidence

`native-original.json` was captured from the preserved build of source revision
`9ea4e3afe32a75b9d80fcb8bc4317dc767d28a23`, using Obsidian 1.13.7 in an isolated
vault. The original plugin ran before the candidate was loaded in that vault.
Workspace implementation had already started; this is not a claim of a capture
made before the first source edit. The original source remains recoverable from Git.
`native-current.json` is a fresh native capture of the candidate, not hand-authored
markup. Neither contains a user's note content.

`original.css` preserves the old plugin rules. `host.css` preserves the matching
Obsidian app.css rules for toolbar elements, html and body, including light/dark
variants. These are test-only snapshots, outside both release entry points.
Obsidian's font binaries are not copied. The recorded CSS font stack resolves
against fonts on the test machine; browser fixtures cannot establish fidelity on
another platform or a third-party Obsidian theme.

`provenance.json` records checksums and the adapter construction/label-source
fingerprints. A change to either requires reviewing and recapturing the current
fixture; do not simply update the expected hashes to silence the test. Layout CSS
is intentionally read from the candidate on each comparison run.

## Commands

- Build the plugin with `npm run build`.
- Capture the candidate with `node tools/capture-native-toolbar.mjs --name current`.
  The command creates a disposable vault and profile and closes its own process
  group afterwards. It does not open or modify the user's vault. Temporary files
  remain available for diagnosis.
- For an app update installed separately from the Electron launcher, pass
  `--app-package /absolute/path/to/obsidian-VERSION.asar`. Capture A and C with
  the same app version; the integrity test rejects a mismatch. The package is
  copied only into the disposable profile, never into the application bundle.
- Pass `--plugin-dir /absolute/path/to/built/plugin` to capture a historical build.
  Replacing the original requires explicit `--replace-original` and review.
- Use `--capture-host-css` only when explicitly reviewing replacement host evidence.
- Verify Reading view, multiple blocks, Live Preview, embeds, pop-outs and PDF
  in a disposable vault with `node tools/capture-native-toolbar.mjs --verify-contexts`.
  This writes `.artifacts/native-toolbar/contexts.json` without replacing captures.
- Compare with `npx playwright test tests/browser/toolbar-layout.spec.ts`.

Every comparison re-renders A (old DOM/CSS), B (A with only tempo label changed)
and C (captured current DOM/current CSS) in separate documents, in the same browser
and font environment. `initial-measurements.json` is historical evidence only;
tests never compare current results against its pixel numbers. Reports and full
per-width measurements go to `.artifacts/toolbar/` and Playwright attachments.

The 32px coarse checks plus 1px bisection do **not** prove monotonicity. A narrow
excursion can escape sampling. Reports state this next to the results. Internal
button wrapping is reported separately from title/controls separation: the old
unbounded group can overflow instead of wrapping.
