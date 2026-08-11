---
name: import-drum-score
description: Transcribe clean printed drum-notation images or visually exposed PDF pages into validated Obsidian Drum Notation `drums` blocks. Use for grooves, fills, rudiments, and practice charts when the user supplies a score image and wants notation compatible with the obsidian-drum-notation plugin. Do not use for audio transcription, handwritten scores, or navigation-heavy charts that cannot be flattened unambiguously.
---

# Import Drum Score

Convert only what is visible. Ask before resolving a material ambiguity, and never invent a drum, onset, meter, repeat route, sticking, or articulation.

## Workflow

1. Confirm the source is a clean printed drum score image. For PDF input, work only from pages the host exposes visually. Ask for page screenshots when the host cannot see the PDF pages.
2. Read [notation-reference.md](references/notation-reference.md) before writing notation. Read [kit-reference.md](references/kit-reference.md) when mapping staff positions or labels, and [workarounds.md](references/workarounds.md) whenever the source contains ties, repeats, endings, navigation, meter changes, tempo changes, or dynamics.
3. Segment the source into independently usable blocks when tempo or chart structure cannot be represented in one block. Preserve visible titles and rehearsal context as metadata or subtitles.
4. Transcribe each segment. Use explicit rests and bars where the current format lacks compact structural notation.
5. Resolve every high-impact ambiguity with the user. Low-impact visual uncertainty may be recorded in the report, but do not silently guess.
6. Locate the plugin root two directories above this `SKILL.md`. Validate each block with `node <plugin-root>/scripts/validate-drum-notation.mjs`. Parse stdout JSON before considering the exit code. Treat exit `2` as valid with warnings.
7. Correct invalid output before responding. If the host cannot execute the validator or hides stdout, mark validation unavailable rather than treating the transcription as validated.
8. Return the `drums` blocks first. Then return one fenced `drum-import-report` JSON object conforming to [drum-import-report.schema.json](references/drum-import-report.schema.json).

## Output rules

- Emit each notation segment as a separate `drums` fence.
- Set `blockIndex` in the report to the zero-based order of its corresponding fence.
- Carry the validator's importer version, notation-core version, notation-core digest, build digest, status, warnings, and errors into the report.
- Set `humanReviewRequired` to `true`. Machine validation confirms syntax and normalization, not visual accuracy.
- Report every workaround and genuine loss. Distinguish appearance, structure, and meaning loss.
- If navigation cannot be flattened into a single unambiguous play order, stop and ask the user instead of emitting a misleading chart.

## Boundaries

- Do not transcribe audio in version 0.1.
- Do not claim support for handwriting or low-quality scans.
- Do not emit `%2`; it is reserved and unsupported.
- Do not write into an Obsidian vault or call a network service.
- Do not expose or request API keys.
