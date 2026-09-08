# Playback reliability remediation — implementation record

Date: 2026-09-08. Branch: `codex/reliable-practice`; reviewed starting revision:
`555b689`. The approved revised remediation plan replaces the earlier review plan.
Implementation is complete; final validation results and publication limits are
recorded below. Changes are not published.

This is corrective maintenance under the existing pre-pilot exception in
[the roadmap](roadmap.md). Pilot chart mix, thresholds, extension rule and the
independent cymbal-recognition gate are unchanged. No new synthesis optimization,
font packaging, advanced notation/editing or saved-log migration is included.

## Delivered changes

### 0. Frozen provenance and isolated evidence generation

- `tests/fixtures/sound/baseline.json` is unchanged. The tracked provenance sidecar
  records its checksum, original source revision/hash, capture-harness revision
  and file hashes, capture package/lock hashes, Playwright package integrity and
  browser-distribution metadata. Capture facts and retrospective connections are
  distinguished; original OS, architecture and executable identity stay unknown.
- `tools/audio/reference-runner/` has a private manifest and lock, pinned to
  Playwright 1.62.1 and esbuild 0.25.12. Dependencies resolve from its installation;
  absent private dependencies fail rather than falling back to the application.
  Static provenance verification also checks the frozen runner code hashes.
- Static verification needs no browser installation, private runtime installation
  or network. Node-only tests cover fixtures and stub launchers. Runtime preflight
  separately verifies installed packages, distribution and actual launched versions.
- Explicit browser installation uses `.artifacts/sound-runtime/browsers`. Evidence
  uses `.artifacts/sound-references/`, outside browser-test cleanup and release inputs.
  Root dependency updates leave this reference runtime unchanged.
- Original PCM and listening clips are lost. Surviving measurements are preserved;
  newly generated audio is labelled reconstructed and cannot substitute for original
  historical sample evidence. See the [sound tooling guide](../tests/fixtures/sound/README.md).

### 1. Shared synchronous shutdown

`PracticeSessionController` exposes active, draining and disposed lifecycle states.
The transport binding captures a player, audio-context identity and generation.
Pending-start invalidation is separate from the bound progress accepted during a
shutdown. Adapters disable starts and display an accessible “Stopping…” indication
while the synchronous drain runs; no delay was added.

The controller captures the player, drains reached boundaries through its existing
reconciler without preparing continuations, accepts final progress/pass/completion,
and settles unfinished metrics as paused. It uses the captured player's accounting
even if natural completion clears the adapter's active-player pointer. It then
publishes its synchronous checkpoint and releases the binding. Obsidian releases
playback ownership after that checkpoint. Passive renderer disposal does not stop
or settle the active owner.

Repeated disposal is inert. Normal reentrant disposal can upgrade a pause to
permanent disposal. A checkpoint failure freezes that destination and completes
cleanup through `finally`, retaining the last confirmed controller state. Both
state-write and checkpoint ports explicitly return `undefined`; every other runtime
return triggers a fixed synchronous contract error. The returned value is never
inspected, stringified, invoked, awaited or observed as a promise. The guard cannot
undo asynchronous work or make a faulty adapter safe. Rejected test promises are
observed only by their own test harness.

Regressions cover the delayed-completion reproduction (500 ms, one credited pass,
completed summary), several reached prepared passes, repeated/reentrant disposal,
passive disposal, synchronous publication, failed writes, invalid values/promises
and returned getters that must never execute. Existing independent-clock tests
continue to cover lifecycle races and 10/100/1,000-pass resource bounds.

### 2. Cached browser navigation

The playground uses `pagehide` and `pageshow`; the `beforeunload` listener is removed.
Departure synchronously drains and checkpoints in-memory metrics before returning.
Wake-lock release is independent asynchronous cleanup. Cached departure keeps the
controller, resume position, subscriptions and source-image URLs. Non-cached
teardown disposes the controller and releases source-image resources.

Cached return refreshes controls and remains paused until explicit Play/Resume.
It uses the existing guarded context recovery path. Time away is never credited.
Ordinary visibility changes still allow a running audio context to continue.

A separate navigation suite enables genuine Chromium back/forward caching and
requires both page identity preservation and `pageshow.persisted === true`; reload
cannot pass it. WebKit's actual navigation path is recorded separately, and both
browsers exercise repeated cached lifecycle events deterministically. These tests
reuse the existing application browser installation.

### 3. Grace-note deadlines

`src/grace.ts` supplies unclamped musical offsets: flam −35 ms; drag −55/−28 ms.
Only source submission clamps negative absolute timestamps. The player scans the
performed prefix up to 55 ms, including roadmap-entry boundaries, leading rests,
upcoming tempo, mute and metronome-only settings. No cache or rolling note scheduler
was introduced.

Continuation readiness is the earlier of its nominal start and its earliest actual
sound, incorporating actual inter-pass count-in duration. Fresh audio time is checked
before submission. The existing eager pass scheduler and 500 ms preparation lead
remain. Tests independently assert literal synth timestamps and source clamping;
the 10.57 s late wake cannot submit the drag at 10.55625 s.

### 4. Reconstruction and honest acoustic reporting

The isolated runner bundles the original synth and capture harness from Git and
renders eight seeded plus 32 unseeded draws for each case. It saves full per-draw
measurements, seeded PCM, representative WAVs, environment/build identity and file
checksums. Atomic archive import verifies before publishing and rejects existing
destinations. Comparison modes distinguish frozen measurements, historical samples
and explicitly selected reconstructed samples. Original bytes are not required to
finish this maintenance.

The original seeded comparator and frozen acceptance limits are retained. Separate
reports give unseeded means and population SD, with every recoverable RMS window
listed by case/index. Floored bands provide only an SD bound; the report header
states the coverage split. Tests derive counts/identities independently from the
manifest, with separate synthetic arithmetic fixtures.

The approximate 12.7% single-estimate and 18% independent-ratio uncertainties appear
beside relevant results. They are not confidence intervals or significance
thresholds; zero spread has no meaningful relative uncertainty. Original platform
and executable uncertainty prevents unique attribution to engine, platform or
sampling. Historical instability remains unresolved even if a new draw is less
variable. Reconstructed values do not replace the baseline or compound tolerances.

## Actual evidence

- Full reconstruction completed: 164 cases × 40 draws = 6,560 renders, Chromium
  151.0.7922.34 and WebKit 26.5, at 44.1 and 48 kHz. New environment: macOS arm64;
  exact OS release, executable hashes and full browser-build file hashes are in
  the run inventory.
- Final reconstruction directory:
  `.artifacts/sound-references/reconstruct-2026-09-08T01-54-05.674Z-7fde6764`.
  It contains full reports, 1,312 seeded PCM files and 164 representative clips.
- Original coverage: 30,424 RMS windows, 30,043 floored, 381 recoverable SDs;
  6,392 audible windows, 6,207 floored, 185 recoverable SDs. These are observations
  derived from the manifest, not hardcoded acceptance constants.
- Reconstruction does **not** pass every frozen acoustic limit: the original-source
  `chromium-44100-stack-accent` ensemble peak exceeds the 1 dB increase limit, and
  `webkit-48000-buzz-0.06`, window 16, retains its unstable historical calibration.
  The stack peak difference is 1.187 dB. Neither limit was changed. Successful
  evidence generation does not imply sound acceptance or recovery of original PCM.
- Separate variability reporting observed a newly unstable audible window:
  `chromium-44100-buzz-0.06`/16, band 4.349 dB versus original 3.710 dB. This is an
  observed change, not a significance or engine-attribution claim. The historically
  unstable WebKit window remains unresolved despite its new 3.893 dB band.
- Current-synth frozen measurement comparison independently reported the same two
  acceptance failures. Explicit reconstructed-sample comparison completed with
  154 of 1,312 comparisons exceeding `1e-7`; no tolerance was relaxed and no
  historical sample-equality claim is made. Report directory:
  `.artifacts/sound-references/seam-2026-09-08T02-00-35.687Z-c0b1d617`.
- The complete 1,478-file reference inventory survived browser-test cleanup and an
  atomic archive export/import/checksum round trip. A local backup archive and
  restored copy are under `.artifacts/sound-references/`.
- Chromium Back retained the original page instance with `persisted: true`.
  WebKit Back created a new instance with `persisted: false` on this machine;
  its cached branch passed the separate deterministic repeated-cycle test.
- Exact synth buffer/scheduling comparison passed separately: 16 seed/sample-rate
  combinations × 144 voice/articulation combinations. No synthesis optimization
  was introduced.

## Integrated verification

| Check | Result |
|---|---|
| Unit tests | 692 passed across 39 files |
| Plugin build and web build/typecheck | Passed; existing large web-chunk advisory remains |
| Application Chromium/WebKit browser suite | 42 passed |
| Dedicated navigation suite | 4 passed |
| Importer conformance | 42 fixtures passed |
| Kit, notation, third-party and submission checks | Passed |
| Static sound provenance | Passed without requiring sound browser binaries |
| CSP and style-sink checks | Passed |
| Exact synth buffers/scheduling | Passed separately from acoustic comparisons |
| Sound reconstruction/archive | Complete, limitations reported above |
| Acoustic comparisons | Failures retained above; baseline unchanged |
| Security audit | Zero known vulnerabilities after compatible dependency fixes |
| Diff whitespace check | Passed |

No generated plugin, web bundle, browser binaries or audio files are tracked.
The security audit initially found three high-severity development dependency
advisories. Compatible lockfile updates to fast-uri 3.1.7, nanoid 3.3.18 and postcss
8.5.28 resolved them; the isolated historical runtime was not changed.

## Publication gates still required

This work does not publish a release. Retain the 30–60-minute real-audio soak,
native Obsidian Reading view/Live Preview/embeds/pop-outs, actual physical mobile
coverage, print/PDF checks, unpublished draft release and Obsidian automated source
check before publication. Browser layout/print emulation does not replace native
or physical-device evidence. Historical sample comparison remains unavailable
without recovered original PCM; the acoustic exceptions above remain explicit.
