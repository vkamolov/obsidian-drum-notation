# Conditional web-font packaging experiment

Run `npm run font:experiment` from the repository root after `npm run build`.
The default is 30 interleaved trials per build and scenario. `DRUM_FONT_TRIALS=1`
is a harness smoke test only, never acceptance evidence. Outputs are ignored under
`test-results/font-packaging/`; ordinary web and plugin builds retain embedded fonts.

The separate Vite config replaces only the web `vexflow/bravura` entry with
`vexflow/core`, explicitly loads Bravura, Academico and Academico Bold, and extracts
the exact WOFF2 bytes from the pinned dependency into content-hashed assets. It does
not modify the plugin's per-document embedded-font loader.

The browser uses a real HTTP server at a subpath, gzip compression, Chromium 4× CPU
slowdown, 4 Mbps throughput and 150 ms latency. No request routing is installed.
Each measured visit records the first animation-frame boundary after the score and
all three loaded font faces are present. This is a browser paint-opportunity proxy,
not a hardware display timestamp. Resource Timing records compressed JS/font transfer
including its standardized header allowance; encoded body sizes are also retained.
Cached resources can report their original encoded size with zero network transfer.

Scenarios cover cold load, a return to the same release, and a JavaScript-only update
with fresh and expired caches. Each scenario gets an isolated context; warm-up and
measurement preserve that context's real cache. Release B changes JavaScript content
and URL while retaining font content and URLs. A document query selects the new visit
without changing asset URLs, ensuring fresh HTML discovers the new release.

The server uses `max-age=600`, ETag and Last-Modified headers. GitHub Pages headers
observed on 2026-09-07 used timestamp/size-shaped ETags and deployment Last-Modified
values. The conservative update model changes those validators on deployment,
including for unchanged font assets. Expired entries are primed with `Age: 600` so
the real browser revalidates without a ten-minute wait. Fresh entries retain normal
cache behavior. This models a deployment that rewrites timestamps; it does not claim
that a candidate was deployed or that every GitHub Pages deployment behaves identically.

The candidate also undergoes real-server font-failure/reload recovery and packaging
checks. The full production browser suite can be run against it with:

```sh
npx vite build --config tools/font-experiment/vite.config.mjs
npx playwright test
npm run web:build
```

Retain the candidate only if cold or expired-cache post-update median improves by
at least 10% and 50 ms, and median and p95 regress by no more than 5% in every
scenario. A fresh-cache-only improvement cannot qualify. A failing candidate remains
an experiment; do not promote this config to the production build.
