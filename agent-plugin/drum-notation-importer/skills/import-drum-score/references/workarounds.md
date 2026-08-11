# Import workarounds

Apply these rules consistently and record each use in the import report.

| Source feature | Output action | Expected loss |
| --- | --- | --- |
| Two-bar repeat | Expand both bars explicitly; never emit `%2` | Appearance |
| Multi-bar rest | Emit explicit empty/rest bars | Appearance |
| Tie | Keep the initial onset and omit the tied reattack | Appearance for ordinary unsustained drums |
| First/second ending | Flatten only when the complete route is unambiguous | Structure |
| Meter change within a source line | Begin a new system with `Bar`, then `Time:` | Appearance/layout |
| Per-system tempo | Split into separate `drums` blocks | Structure |
| Dynamics | Preserve in `Comment:` and the report; keep supported accents | Meaning may be softened |
| D.S., D.C., Segno, Coda | Flatten only when the complete play order is unambiguous; otherwise ask | Structure or blocking ambiguity |

Do not flatten a navigation-heavy chart merely to produce output. If manual structural rebuilding would be required before the chart is usable, ask the user and classify the chart as navigation-blocked during the pilot.
