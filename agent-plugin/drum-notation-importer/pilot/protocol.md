# Importer pilot protocol

Preselect all charts before the first transcription. The default initial sample is 20 user-owned charts: 14 grooves, fills, rudiments, or practice materials and 6 full-song or gig charts. Record only anonymous chart IDs in pilot data. If intended real-world use changes before sampling, revise and commit this protocol first. Never alter the mix after seeing transcription results.

Randomize processing order. Replace a chart only when it falls outside the declared 0.2 scope; use the same stratum and record the reason. Do not replace difficult in-scope charts.

Store individual JSON records in `records/`. They are deliberately gitignored. Count the discrete notation events reviewed so each record's ambiguity rate is `ambiguityCount / notationEventCount`. Record feature frequency, workaround severity, ambiguity count and rate, first-pass validity, outcome, and ordinal correction effort. Commit only an anonymized aggregate and the eventual roadmap decision record.

Record a paired, non-empty, disjoint two-pass section repeat with feature string `section-repeat-native` and keep `navigationBlocked` false when no other unsupported structure blocks the chart. Classify `navigationBlocked` as true when unsupported D.S./D.C., Segno/Coda, ambiguous endings, nested or adjacent repeats, non-two-pass repeats, or another roadmap structure prevents a usable result without manual rebuilding. This prospective rule changes what the gate measures because simple section repeats are now supported; the pilot has no completed records to rescore. At 20 charts, extend to 30 when the blocked count is within one chart of the 25% boundary. Preselect the ten additions with the same declared mix before processing them. After the extension—or immediately when clearly outside that boundary—write a decision record considering blocked rate, severity, intended-use mix, and whether failures cluster in a low-priority stratum. Do not extend automatically beyond 30.

Correction effort is ordinal: `none`, `quick` (up to 5 minutes), `moderate` (6–15 minutes), or `slow` (over 15 minutes). Do not average these values.

Default to navigation semantics before MIDI/audio when the evidence is materially above 25%, or when full-song/gig charts become the majority intended use. Retain importer-first sequencing when it is materially below 25%. The default roadmap is image import, paste-back verification, deterministic MIDI import, local worker-based audio transcription, then hosted inference only if evidence justifies its security and operating costs.

## Local helper workflow

The repository helper applies this protocol; it does not choose charts, classify outcomes, or make the final Track A/Track B decision.
See the [Importer Pilot Helper Guide](README.md) for a complete walkthrough and examples.

1. Preselect the complete 14-practice/6-full-song sample outside the repository, randomize its processing order, and assign anonymous IDs in that order. Do this before importing the first chart.
2. After reviewing each chart, run `npm run pilot:record`. The interactive prompts calculate `ambiguityRate`, validate the completed record against `pilot-record.schema.json`, and write it under the gitignored `records/` directory. Use `-- --stratum practice` or `-- --stratum full-song-gig` to prefill the stratum.
3. Run `npm run pilot:aggregate` to validate every record and recalculate `aggregate.json`. The command refuses duplicate IDs, filename/ID mismatches, invalid rates, out-of-plan IDs, and excess stratum counts.
4. Run `npm run pilot:status` at any time for progress, mix, rates, correction effort, outcomes, and the next gate action. `npm run pilot:check` verifies that the committed aggregate matches local records.
5. If the 20-chart result is within one chart of the 25% boundary, preselect and randomize seven additional practice charts and three additional full-song/gig charts before processing any of them. Then run `npm run pilot:aggregate -- --preselect-extension` once to change the declared sample to 30.
6. When the final sample is complete, write the human decision record described above. Attach it with `npm run pilot:aggregate -- --decision <repo-relative-path>`; the helper verifies that the file exists and that no required extension remains.

Raw records and any private chart-to-ID mapping remain local. Review the aggregate diff before committing it. The helper's threshold result is a default recommendation only; severity, intended-use mix, recognition quality, and correction cost remain part of the documented human decision.

## Focused crop recognition gate

Evaluate the focused-crop workflow with 12 blind temporary examples before deciding whether it needs more recognition support: crash, hi-hat, ride, splash, China, and stack, each at two source scales. Preselect the examples and expected readings before running them. Record each outcome as `correct`, `unresolved`, or `confident-wrong`; do not commit source images or expected answers. The successful real crash test is supporting evidence, not one of the blind 12 cases.

With zero to two confident errors, investigate only those cases and retain the focused-crop workflow. With at least three confident errors out of 12, stop prompt tuning and plan browser-local annotated staff guides. More than four unresolved outcomes also triggers the annotated-guide review. This gate does not authorize automatic staff detection, OMR, or remote inference.
