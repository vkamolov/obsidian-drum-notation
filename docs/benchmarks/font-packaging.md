# Web font packaging decision — 2026-09-07

**Decision: retain inline fonts.** The external-font candidate fails both the
qualifying-improvement requirement and the maximum-regression requirement.

Measured on Apple M3 Pro, 12 logical CPUs, 18 GiB RAM, macOS Darwin 25.6.0 arm64,
Node 25.9.0 and Chromium 151.0.7922.34. Chromium used 4× CPU slowdown, 4 Mbps
throughput and 150 ms latency. There were 30 interleaved trials per build and
scenario (240 measured visits, plus warm-ups). Source revision: `b2f7ba9`.

| Visit scenario | Inline median / p95 | External median / p95 | Median change | Inline / external JS + font transfer |
|---|---:|---:|---:|---:|
| Cold | 1497.2 / 1514.2 ms | 1575.1 / 1589.4 ms | +5.2% | 465,903 / 462,034 bytes |
| Same release, repeat | 276.0 / 281.1 ms | 262.4 / 268.0 ms | −4.9% | 0 / 0 bytes |
| JS update, fresh cache | 1388.4 / 1398.0 ms | 770.9 / 777.8 ms | −44.5% | 465,948 / 167,777 bytes |
| JS update, expired cache | 1417.3 / 1426.7 ms | 1509.1 / 1519.9 ms | +6.5% | 465,948 / 462,077 bytes |

Neither cold nor expired-cache post-update loads improve by 10% and 50 ms.
Cold median regresses beyond 5%; expired-cache median and p95 both regress beyond
5%. The fresh-cache gain alone cannot justify shipping under the agreed gate.
The roughly 391 KB removed from JavaScript source produces only about 3.9 KB less
total cold network transfer here, once separate WOFF2 downloads are included.

## Method and limits

The separate experiment config emits unchanged font bytes from pinned VexFlow 5.0.0
as three hashed WOFF2 files and explicitly loads them through the core entry.
Normal production configuration and Obsidian's embedded, per-document loader are
unchanged. A gzip HTTP server serves the complete built playground at a subpath;
Playwright request routing is never enabled. A JavaScript-only revision changes
the script URL while preserving font URLs and browser cache. A document query
ensures the new visit discovers the current HTML revision.

GitHub Pages headers observed for the existing deployment use `max-age=600`, ETag
and Last-Modified; the observed ETag has a timestamp/size form. The local update
model conservatively changes validators for all deployment assets. Expiration is
modeled with `Age: 600` on warm-up responses. All 30 expired-cache candidate visits
made three font requests returning 200, while all fresh-cache and same-release
candidate visits reused fonts without server requests. This is a controlled hosting
model, not a deployed-candidate benchmark or proof of every future Pages deployment's
validator behavior. No immutable caching or guaranteed 304 reuse is assumed.

Timing records a browser paint opportunity after SVG notation and all three loaded
font faces are present, not a physical screen timestamp. Transfer totals use Resource
Timing's compressed transfer sizes, including its standardized header allowance.
Raw resource sizes, requests, environment, individual timings and gate calculations
are retained in [the measurement record](font-packaging-2026-09-07.json).

The candidate passed 40 Chromium/WebKit production workflow/CSP tests before the
benchmark. Real-server font failures followed by page reload recover all three
faces. Packaging checks confirm three hashed font files, unchanged font URLs across
the simulated update, no embedded candidate font payload, the license banner, and
embedded plugin fonts. Native Obsidian offline/pop-out/print and physical-mobile
checks remain release checks; this rejected candidate is not shipped.

Run `npm run font:experiment` to reproduce; see the
[harness documentation](../../tools/font-experiment/README.md). Thresholds were not
widened after measuring the candidate.
