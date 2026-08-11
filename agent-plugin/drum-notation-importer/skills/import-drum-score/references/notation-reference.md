# Obsidian Drum Notation reference

This is a curated transcription guide. The repository parser and serializer are authoritative; the source-review checksum only proves that this guide was consciously reviewed after the canonical documentation changed.

## Block structure

- Write settings and preserved metadata as `Key: value` lines.
- Write instrument rows as `LABEL | pattern`.
- Separate multiple bar patterns on the same row with ` | `.
- Use `Bar` to begin a new rendered system.
- Use `Subtitle: text` to label the current system.
- Use `%` or `%xN` only for supported one-bar repeats. Never use `%2`.

## Settings

- `Tempo: 30..260`; default `100`.
- `Time: n/n`; default `4/4`.
- `Grouping: 2+2+3` or `auto` for compatible odd meters.
- `Voicing: single|split`; default `single`.
- `Repeat: 1..64`; default `1`.
- `Grid: 16|32`; default `16`.
- `Legend: off|used|all`; default `off`.
- `Cursor`, `Highlight`, and `Rests` accept boolean forms.
- Unknown metadata is preserved in order. Use `Title:`, `Author:`, and `Comment:` freely.

System-level `Time:` and `Grouping:` may appear immediately after `Bar`. A late system setting is preserved but warns and does not change already-read rows.

## Rows and timing

- One pattern character is one grid position. In 4/4, Grid 16 uses 16 positions per bar and Grid 32 uses 32.
- Use `-` for explicit rests. The parser also accepts `.`, `_`, and spaces, but output should use `-`.
- Rows can cover only a contiguous prefix of bars in a system. Materialize rest patterns in earlier bars when an instrument begins later.
- Stack simultaneous instruments by placing hits at the same character position on separate rows.
- Add `ST | R-LB...` for sticking: `R`, `L`, `B`, and rest characters.

## Hit alphabet

- `x` or `o`: normal hit. The serializer chooses the canonical glyph for the instrument notehead.
- `X`: accent.
- `g`: ghost note.
- `f`: flam.
- `r`: drag or ruff.
- `d`: diddle.
- `z`: buzz or press roll.
- `c`: choked cymbal.

## Tuplets

Preserve supported explicit tuplet syntax from the canonical format rather than forcing tuplets onto a straight grid. If the source's grouping or span cannot be represented confidently, ask the user. Validate every tuplet block because malformed syntax can otherwise resemble ordinary pattern text.

## Normalization contract

- Validation is model-level, not byte-for-byte source preservation.
- `parse -> serialize -> parse` must preserve the model.
- Serializer output is deterministic and idempotent.
- Default settings are omitted in minimal normalized output.
- Unknown metadata remains ordered.
- Accent aliases normalize to the canonical hit character.
