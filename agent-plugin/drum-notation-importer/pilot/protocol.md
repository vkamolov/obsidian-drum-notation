# Importer pilot protocol

Preselect all charts before the first transcription. The default initial sample is 20 user-owned charts: 14 grooves, fills, rudiments, or practice materials and 6 full-song or gig charts. Record only anonymous chart IDs in pilot data. If intended real-world use changes before sampling, revise and commit this protocol first. Never alter the mix after seeing transcription results.

Randomize processing order. Replace a chart only when it falls outside the declared 0.1 scope; use the same stratum and record the reason. Do not replace difficult in-scope charts.

Store individual JSON records in `records/`. They are deliberately gitignored. Count the discrete notation events reviewed so each record's ambiguity rate is `ambiguityCount / notationEventCount`. Record feature frequency, workaround severity, ambiguity count and rate, first-pass validity, outcome, and ordinal correction effort. Commit only an anonymized aggregate and the eventual roadmap decision record.

Classify `navigationBlocked` as true when unsupported D.S./D.C., Segno/Coda, ambiguous endings, or other roadmap structure prevents a usable result without manual rebuilding. At 20 charts, extend to 30 when the blocked count is within one chart of the 25% boundary. Preselect the ten additions with the same declared mix before processing them. After the extension—or immediately when clearly outside that boundary—write a decision record considering blocked rate, severity, intended-use mix, and whether failures cluster in a low-priority stratum. Do not extend automatically beyond 30.

Correction effort is ordinal: `none`, `quick` (up to 5 minutes), `moderate` (6–15 minutes), or `slow` (over 15 minutes). Do not average these values.

Default to navigation semantics before MIDI/audio when the evidence is materially above 25%, or when full-song/gig charts become the majority intended use. Retain importer-first sequencing when it is materially below 25%. The default roadmap is image import, paste-back verification, deterministic MIDI import, local worker-based audio transcription, then hosted inference only if evidence justifies its security and operating costs.

## Focused crop recognition gate

Evaluate the focused-crop workflow with 12 blind temporary examples before deciding whether it needs more recognition support: crash, hi-hat, ride, splash, China, and stack, each at two source scales. Preselect the examples and expected readings before running them. Record each outcome as `correct`, `unresolved`, or `confident-wrong`; do not commit source images or expected answers. The successful real crash test is supporting evidence, not one of the blind 12 cases.

With zero to two confident errors, investigate only those cases and retain the focused-crop workflow. With at least three confident errors out of 12, stop prompt tuning and plan browser-local annotated staff guides. More than four unresolved outcomes also triggers the annotated-guide review. This gate does not authorize automatic staff detection, OMR, or remote inference.
