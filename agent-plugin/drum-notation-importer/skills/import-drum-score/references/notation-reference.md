# Obsidian Drum Notation reference

This is a curated transcription guide. The repository parser and serializer are authoritative; the source-review checksum only proves that this guide was consciously reviewed after the canonical documentation changed.

## Block structure

- Write settings and preserved metadata as `Key: value` lines.
- Write instrument rows as `LABEL | pattern`.
- Separate multiple bar patterns on the same row with ` | `.
- Use `Bar` to begin a new rendered system.
- Use `Subtitle: text` to label the current system.
- Use `%` or `%xN` only for supported one-bar repeats. Never use `%2`.
- Use zero-width `[` and `]` bar separators for a clearly observed section
  repeat that plays exactly twice. They may span `Bar` systems, but must be
  paired, disjoint, and non-nested. Align explicit markers across rows.

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
- Use `-` for silent grid positions. The parser also accepts `.`, `_`, and spaces, but output should use `-`. Silence preserves timing and playback; it does not distinguish a printed rest from an ordinary gap or force a visible glyph.
- Treat `row-length-mismatch` as a prompt to re-observe the complete row, not as a request to pad it. Reconstruct every position against the source's beat/grid anchors. Append trailing `-` only after confirming genuine trailing silence; a clean validator result alone cannot prove that no mid-row hit was missed.
- Rows can cover only a contiguous prefix of bars in a system. Materialize rest patterns in earlier bars when an instrument begins later.
- Stack simultaneous instruments by placing hits at the same character position on separate rows.
- Add `ST | R-LB...` for sticking: `R`, `L`, `B`, and rest characters.

## Instrument identity and visible rests

- Before mapping, inventory distinct notehead positions and shapes, accents, grace notes, stem marks, rests, and rhythmic anchors at the highest available resolution. Request a focused crop when fine detail cannot be distinguished.
- For every `x` notehead, first locate the five staff lines and classify its visible relationship as ledger through the notehead, ledger immediately below it, or no ledger. Do not claim numeric measurements from the image. Group matching vertical positions before using rhythmic context; a recurring pattern cannot override a distinct position cluster.
- Treat a source legend or drum key as authoritative because publisher conventions vary. When no source legend is visible, use the generated x-notehead ladder in [kit-reference.md](kit-reference.md). If the full-score view cannot resolve the relationship, require a focused crop containing the notehead and surrounding staff. Ask rather than mapping a materially ambiguous cluster.
- With `Voicing: split`, hands and feet retain independent rhythms, but the engraver displays only rests inferred where the whole kit is silent. When one voice sounds, rests in the other voice are hidden alignment rests. `Rests: on` is already the default and does not force those voice-specific glyphs.

## Hit alphabet

- `x` or `o`: normal hit. The serializer chooses the canonical glyph for the instrument notehead.
- `X`: accent.
- `g`: ghost note.
- `f`: flam. Emit only when a separate grace notehead is visible before the primary note.
- `r`: drag or ruff.
- `d`: diddle. Emit for a slash through the primary note's stem under the source's notation convention. If the image cannot distinguish that slash from a grace note, ask before choosing `d` or `f`.
- `z`: buzz or press roll.
- `c`: choked cymbal.

## Tuplets

Preserve supported explicit tuplet syntax from the canonical format rather than forcing tuplets onto a straight grid. If the source's grouping or span cannot be represented confidently, ask the user. Validate every tuplet block because malformed syntax can otherwise resemble ordinary pattern text.

## Repeat navigation

- `%` and `%xN` repeat only the immediately preceding bar; section repeat
  barlines repeat every bar between `[` and `]` twice; `Repeat:` repeats the
  complete playback roadmap.
- Do not attach `[` or `]` directly to a standalone `%` line. Put boundaries
  on recognized instrument or sticking rows around the expanded section.
- Do not infer a section repeat from visual proximity alone. Confirm both
  repeat barlines and the complete enclosed span, especially across systems.
- Keep the complete span in one `drums` block. Use `Bar` and `Subtitle:` for
  printed system and rehearsal breaks inside it.
- `%` and `%xN` may occur inside a section. If a boundary would attach directly
  to a standalone measure-repeat line, expand only that boundary bar into
  explicit instrument rows and report the appearance loss.
- A clearly preserved native section repeat is neither a workaround nor a
  loss. Ask before output when a boundary or traversal count is ambiguous.
- First/second endings, combined adjacent repeat boundaries, nested repeats,
  D.S./D.C., Segno, and Coda remain unsupported; ask or flatten only with the
  user's approval when those structures affect musical order.

## Normalization contract

- Validation is model-level, not byte-for-byte source preservation.
- `parse -> serialize -> parse` must preserve the model.
- Serializer output is deterministic and idempotent.
- Default settings are omitted in minimal normalized output.
- Unknown metadata remains ordered.
- Accent aliases normalize to the canonical hit character.
