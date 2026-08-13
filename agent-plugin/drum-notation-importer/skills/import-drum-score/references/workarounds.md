# Import workarounds

Apply these rules consistently and record each use in the import report.

| Source feature | Output action | Expected loss |
| --- | --- | --- |
| Two-bar repeat | Expand both bars explicitly; never emit `%2` | Appearance |
| Section-repeat boundary on a standalone `%` or `%xN` line | Expand only the boundary measure repeat into explicit instrument rows; keep other supported compact repeats | Appearance |
| Unpaired, nested, adjacent, overlapping, or non-two-pass section repeat | Ask; flatten only after explicit user approval | Structure or blocking ambiguity |
| Multi-bar rest | Emit explicit empty/rest bars | Appearance |
| Tie | Keep the initial onset and omit the tied reattack | Appearance for ordinary unsustained drums |
| Explicit rest in one split voice while another voice sounds | Preserve the complete silent span with `-` in the corresponding instrument row; do not add an onset or alter the sounding voice; explain that the glyph cannot currently be forced | Appearance |
| First/second ending | Flatten only when the complete route is unambiguous | Structure |
| Meter change within a source line | Begin a new system with `Bar`, then `Time:` | Appearance/layout |
| Per-system tempo | Split into separate `drums` blocks | Structure |
| Dynamics | Preserve in `Comment:` and the report; keep supported accents | Meaning may be softened |
| D.S., D.C., Segno, Coda | Flatten only when the complete play order is unambiguous; otherwise ask | Structure or blocking ambiguity |

A paired, non-empty, disjoint section repeat that plays exactly twice is native notation, not a workaround. Do not flatten a navigation-heavy chart merely to produce output. If manual structural rebuilding would be required before the chart is usable, ask the user and classify the chart as navigation-blocked during the pilot.
