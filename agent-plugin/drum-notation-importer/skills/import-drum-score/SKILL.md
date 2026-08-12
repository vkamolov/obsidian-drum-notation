---
name: import-drum-score
description: Transcribe clean printed drum-notation images or visually exposed PDF pages into validated Obsidian Drum Notation `drums` blocks. Use for grooves, fills, rudiments, and practice charts when the user supplies a score image and wants notation compatible with the obsidian-drum-notation plugin. Do not use for audio transcription, handwritten scores, or navigation-heavy charts that cannot be flattened unambiguously.
---

# Import Drum Score

Convert only what is visible. Ask before resolving a material ambiguity, and never invent a drum, onset, meter, repeat route, sticking, or articulation.

## Workflow

1. Confirm the source is a clean printed drum score image and inspect the highest available resolution. For PDF input, work only from pages the host exposes visually. Ask for a page screenshot or focused crop when the host cannot see the page or a staff position, grace note, or stem mark is too small to distinguish.
2. Read [notation-reference.md](references/notation-reference.md) before writing notation. Read [kit-reference.md](references/kit-reference.md) when mapping staff positions or labels, and [workarounds.md](references/workarounds.md) whenever the source contains ties, repeats, endings, navigation, meter changes, tempo changes, or dynamics.
3. Segment the source into independently usable blocks when tempo or chart structure cannot be represented in one block. Preserve visible titles and rehearsal context as metadata or subtitles.
4. Observe before mapping: inventory distinct notehead positions and shapes, accents, grace notes, stem marks, rests, and rhythmic anchors. For every `x` notehead, locate the five staff lines and classify the visible relationship as a ledger through the notehead, a ledger immediately below it, or no ledger. Do not invent numeric measurements. Compare repeated symbols across the complete visible source before assigning instruments or articulations.
5. Map and transcribe each segment. Use `-` for silent grid positions and explicit bars where the current format lacks compact structural notation. A silent position preserves timing but does not always force a visible rest glyph; consult [workarounds.md](references/workarounds.md) when the source shows a rest in only one split voice.
6. Map each `x` cluster through the source's printed legend or drum key when present; otherwise use the generated staff-position ladder in [kit-reference.md](references/kit-reference.md). Determine ledger-line evidence before using rhythmic context: a recurring hi-hat pattern cannot override a distinct vertical cluster. When the full-score view does not resolve the relationship, require a focused crop containing the notehead and surrounding staff. If the focused view remains materially ambiguous, ask the user and stop without notation.
7. Audit the draft against the source before validation: check meter and grid, every instrument identity and staff position, every onset and articulation, and every visible rest. Never silently default an uncertain cymbal cluster to another instrument.
8. Resolve every high-impact ambiguity with the user. When a material instrument or ornament cannot be distinguished, ask and stop before emitting provisional notation. Low-impact visual uncertainty may be recorded in the report, but do not silently guess.
9. Locate this skill's directory from the path of `SKILL.md`. Validate each block with `node <skill-directory>/scripts/validate-drum-notation.mjs`. Parse stdout JSON before considering the exit code. Treat exit `2` as syntactically valid with warnings, not as automatic acceptance.
10. On `row-length-mismatch`, re-observe the complete affected row against the source and its beat/grid anchors. Reconstruct the row from those observations. Append trailing `-` only after confirming that the source genuinely shows trailing silence; never pad merely to clear the warning. Record a successful reconstruction in the segment's `issues` as code `row-length-reobserved`, then revalidate.
11. Correct invalid output and avoidable warnings before responding. Retain and report warnings that reflect genuine source or format uncertainty. If the host cannot execute the validator or hides stdout, mark validation unavailable rather than treating the transcription as validated.
12. Return the `drums` blocks first. Then return one fenced `drum-import-report` JSON object conforming to [drum-import-report.schema.json](references/drum-import-report.schema.json).

## Output rules

- Emit each notation segment as a separate `drums` fence.
- Set `blockIndex` in the report to the zero-based order of its corresponding fence.
- Carry the validator's importer version, notation-core version, notation-core digest, build digest, status, warnings, and errors into the report.
- Base `validationStatus` on the final revalidated block. A `row-length-reobserved` audit note may accompany a clean final status.
- Record the mapping convention in an `issues` entry with code `cymbal-position-convention`, and record concise staff-position and ledger evidence for each distinct `x` cluster with code `cymbal-position-evidence`. Each entry contains only `code` and `message`; these are audit notes, not losses or parser warnings.
- Record unresolved low-impact position evidence in `ambiguities` with code `cymbal-position-unresolved`. A material unresolved cymbal identity still requires clarification before emitting notation.
- Set `humanReviewRequired` to `true`. Machine validation confirms syntax and normalization, not visual accuracy.
- Report every workaround and genuine loss. Distinguish appearance, structure, and meaning loss.
- Report a source-visible rest hidden by current split-voice engraving as an appearance loss; never claim that another voice's hit replaces that rest.
- If navigation cannot be flattened into a single unambiguous play order, stop and ask the user instead of emitting a misleading chart.

## Boundaries

- Do not transcribe audio in version 0.1.
- Do not claim support for handwriting or low-quality scans.
- Do not emit `%2`; it is reserved and unsupported.
- Do not write into an Obsidian vault or call a network service.
- Do not expose or request API keys.
