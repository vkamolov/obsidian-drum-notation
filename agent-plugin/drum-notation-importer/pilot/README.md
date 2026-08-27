# Importer Pilot Helper Guide

This guide explains how to collect the chart-pilot evidence that selects the scope of Drum
Notation 1.12.0. The helper handles anonymous IDs, validation, arithmetic and gate reporting. It
does **not** select charts, judge a transcription or make the final roadmap decision.

Read [`protocol.md`](protocol.md) before starting. The protocol is authoritative if this guide
and the protocol ever disagree.

## Before the first chart

1. Privately select 20 user-owned charts:
   - 14 practice charts: grooves, fills, rudiments or exercises;
   - 6 full-song or gig charts.
2. Randomize their processing order before transcribing any chart.
3. Assign anonymous IDs `chart-01` through `chart-20` in that randomized order.
4. Keep the chart-to-ID mapping and source files outside the repository.

Do not replace a difficult in-scope chart. Replace only an out-of-scope chart with another chart
from the same stratum, and enter the reason when recording the replacement.

Check the empty pilot:

```bash
npm run pilot:status
```

Expected initial output:

```text
Pilot: 0/20 (not-started)
Mix: practice 0/14; full-song/gig 0/6
Navigation blocked: 0/0 (0%)
Next anonymous ID: chart-01.
```

## Record one reviewed chart

After importing, verifying and correcting a chart, run:

```bash
npm run pilot:record
```

You can prefill its stratum:

```bash
npm run pilot:record -- --stratum practice
npm run pilot:record -- --stratum full-song-gig
```

Example session:

```text
Creating chart-01. Remaining mix: practice 14; full-song/gig 6.
Features (comma-separated, blank for none): mixed-meter, section-repeat-native
Navigation blocked [yes/no]: no
Worst workaround severity [none/appearance/structure/meaning/blocked]: appearance
Notation event count [1+]: 48
Ambiguity count [0-48]: 2
First-pass status [clean/warnings/invalid/unavailable]: warnings
Correction effort [none/quick/moderate/slow]: quick
Outcome [usable/usable-after-correction/not-usable]: usable-after-correction
Replacement reason (blank unless this chart replaced an out-of-scope preselection):
Saved agent-plugin/drum-notation-importer/pilot/records/chart-01.json.
```

The helper calculates `ambiguityRate` and writes a local record like this:

```json
{
  "anonymousId": "chart-01",
  "stratum": "practice",
  "features": [
    "mixed-meter",
    "section-repeat-native"
  ],
  "navigationBlocked": false,
  "workaroundSeverity": "appearance",
  "notationEventCount": 48,
  "ambiguityCount": 2,
  "ambiguityRate": 0.041667,
  "firstPassStatus": "warnings",
  "correctionEffort": "quick",
  "outcome": "usable-after-correction"
}
```

The record is stored under `pilot/records/`, which is gitignored.

## How to answer the prompts

### Features

Enter stable, lowercase feature codes separated by commas. Use the same code every time the same
feature occurs so aggregate frequencies remain meaningful. Examples:

- `mixed-meter`
- `tuplet`
- `section-repeat-native`
- `first-second-ending`
- `ds-coda`
- `rehearsal-mark`

A supported paired, non-empty, two-pass section repeat is `section-repeat-native`; it does not
make `navigationBlocked` true by itself.

### Navigation blocked

Choose `yes` only when unsupported navigation prevents a usable result without manually
rebuilding the chart—for example an essential D.S./Coda route, ambiguous endings, nested or
adjacent repeats, or a non-two-pass repeat.

Do not mark a chart navigation-blocked merely because it needed ordinary correction or used a
supported section repeat.

### Workaround severity

- `none`: represented directly.
- `appearance`: meaning is preserved but engraving differs.
- `structure`: usable only after restructuring the notation.
- `meaning`: an important musical meaning is approximated or omitted.
- `blocked`: no usable result within the supported scope.

Record the worst severity used by that chart.

### Notation and ambiguity counts

Count the discrete notation events reviewed, then count events whose reading was materially
ambiguous. The helper enforces:

```text
0 ≤ ambiguityCount ≤ notationEventCount
```

It calculates the rate; do not calculate or type it manually.

### First-pass status

- `clean`: the first extracted block validates without warnings.
- `warnings`: it validates with warnings.
- `invalid`: notation was returned but did not validate.
- `unavailable`: no usable first-pass notation was produced.

### Correction effort

- `none`: no correction.
- `quick`: up to 5 minutes.
- `moderate`: 6–15 minutes.
- `slow`: more than 15 minutes.

### Outcome

- `usable`: usable without correction.
- `usable-after-correction`: usable after review and correction.
- `not-usable`: still unusable within the pilot scope.

## Refresh the aggregate

After every record, run:

```bash
npm run pilot:aggregate
```

This command:

- validates all local records against the schema;
- rejects duplicate or out-of-plan IDs;
- confirms every filename matches its `anonymousId`;
- checks ambiguity arithmetic and stratum quotas;
- recalculates the committed `aggregate.json` deterministically.

Then inspect progress:

```bash
npm run pilot:status
```

Example after several charts:

```text
Pilot: 6/20 (in-progress)
Mix: practice 4/14; full-song/gig 2/6
Navigation blocked: 1/6 (16.7%)
Ambiguity: 9/284 events (3.2%)
Correction effort: none 1; quick 3; moderate 2; slow 0
Outcomes: usable 1; corrected 5; not usable 0
Next anonymous ID: chart-07.
```

Verify that the aggregate matches the local raw records:

```bash
npm run pilot:check
```

`pilot:check` is meaningful only on the data-collection machine because raw records are
deliberately not committed. Other clones and CI validate the committed aggregate's schema through
`npm run check:agent-plugin` instead.

## Correct a record

If a prompt was answered incorrectly, edit the corresponding local JSON file, then run:

```bash
npm run pilot:aggregate
```

The command will reject invalid edits. To re-enter a record from scratch, delete only that local
record and run `pilot:record` again; the helper selects the first missing anonymous ID. Never
renumber completed records to hide a replacement or difficult chart.

## The possible 30-chart extension

At 20 charts, the 25% navigation boundary is five blocked charts. An extension is required when
the blocked count is within one chart of that boundary: 4, 5 or 6.

The helper will report:

```text
Next: preselect the 7-practice/3-full-song extension, then run npm run pilot:aggregate -- --preselect-extension.
```

Before recording chart 21:

1. Privately preselect seven additional practice charts and three additional full-song/gig
   charts.
2. Randomize those ten charts and assign IDs `chart-21` through `chart-30`.
3. Run once:

```bash
npm run pilot:aggregate -- --preselect-extension
```

The aggregate changes to a 30-chart plan with a 21-practice/9-full-song mix. The helper refuses
this command unless the initial 20 charts are complete and their result requires the extension.

## Finish the pilot and attach the decision

When the final sample is complete, `pilot:status` reports a default threshold result:

```text
Default threshold result: Track A. Human review of severity and intended-use mix is still required.
```

The threshold recommendation is not the decision by itself. Write a short repository document
that includes:

- completed sample and declared mix;
- `navigationBlocked` count and percentage;
- comparison with the 25% threshold;
- selected Track A or Track B;
- navigation or chart features responsible for meaningful blocking;
- correction effort, outcomes and recognition concerns that affected the judgment;
- explicitly deferred findings.

For example, save it as:

```text
agent-plugin/drum-notation-importer/pilot/decision.md
```

Then attach it:

```bash
npm run pilot:aggregate -- --decision agent-plugin/drum-notation-importer/pilot/decision.md
```

The helper verifies that the file exists, the sample is complete and no extension remains. The
aggregate status becomes `complete`.

## What to commit

Review changes:

```bash
git diff -- agent-plugin/drum-notation-importer/pilot/aggregate.json
git status --short
```

Commit only:

- the anonymized `aggregate.json` updates;
- the final decision record;
- a protocol amendment only when it was committed before affected sampling began.

Never commit:

- files under `pilot/records/`;
- source charts, screenshots or PDFs;
- the private chart-to-ID mapping;
- personal or identifying chart metadata.

The repository checker confirms that no raw record has accidentally become tracked:

```bash
npm run check:agent-plugin
```

## Troubleshooting

### `Pilot aggregate is stale`

Run:

```bash
npm run pilot:aggregate
```

Then inspect the aggregate diff.

### `Pilot mix exceeds the plan`

The selected stratum quota is full. Confirm the private preselection and correct the local record;
do not silently substitute a chart from the other stratum.

### `ambiguityRate must equal ambiguityCount / notationEventCount`

Do not edit `ambiguityRate` manually. Correct the two counts or delete and re-enter the record.

### `Unexpected pilot record filename`

Raw records must use `chart-NN.json`, and the filename must match the internal `anonymousId`.

### The helper recommends the wrong roadmap track

The output is only the predeclared threshold result. The final decision must also consider
severity, intended-use mix, recognition quality and correction cost, and document any justified
departure from the default.
