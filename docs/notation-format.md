# Drum Notation Format

The canonical artifact of this plugin is the **text** inside a ` ```drums ` code
block. That text is the source of truth: it is what gets saved, diffed, shared,
and re-parsed. The parsed `DrumBlock` is an in-memory working model derived from
the text and serialized back to it.

This document specifies the format as implemented by `src/parser.ts`,
`src/kit.ts`, and (for the model → text direction) `src/serializer.ts`. It is the
reference for hand-authoring, for the future visual editor, and for importers
that emit `drums` text.

---

## 1. Document structure

A block is a sequence of lines. Each non-empty line is one of:

| Line kind        | Recognized by                                              | Effect |
|------------------|------------------------------------------------------------|--------|
| **Setting**      | `Key: value` where `Key` is a known setting                | Sets a header field |
| **Metadata**     | `Key: value` with an unknown key, or any other free line   | Preserved verbatim (e.g. `Title`, `Count`, comments) |
| **Bar separator**| A line matching `[new] bar|measure [N][:...]`               | Starts a new system (line of music) |
| **Measure repeat**| `%` or `Repeat bar`                                       | Repeats the previous bar |
| **Row**          | `LABEL \| pattern[ \| pattern…]`                            | One instrument voice |

Leading/trailing whitespace is ignored. Blank lines are ignored. Unknown lines
never break parsing — they are retained as metadata, so hand-written notes
survive a round-trip.

A minimal block:

```drums
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-o-----
```

---

## 2. Settings (header)

Settings may appear anywhere in the block (conventionally at the top). Keys are
case-insensitive and ignore spaces/hyphens (`Time Signature` == `timesignature`).

| Setting | Aliases | Value | Default | Notes |
|---------|---------|-------|---------|-------|
| `Tempo` | `BPM` | integer | `100` | Clamped to 30–260 |
| `Time` | `Time Signature`, `Meter` | `n/n` | `4/4` | 1–2 digits each |
| `Repeat` | `Repeats` | integer | `1` | Clamped to 1–64 |
| `Grid` | `Subdivision`, `Resolution` | `16` or `32` | `16` | One character = one grid slot |
| `Legend` | `Instrument Legend`, `Kit Legend`, `Color Legend` | `off` / `used` / `all` | `off` | Color key visibility |
| `Cursor` | `Playback Cursor` | boolean | `off` | Blinking playback cursor |
| `Highlight` | `Note Highlight`, `Playback Highlight` | boolean | `on` | Highlight the playing note |

**Boolean values** — true: `on`, `true`, `yes`, `y`, `1`, `show`, `visible`;
false: `off`, `false`, `no`, `n`, `0`, `hide`, `hidden`.

**Legend values** — `used` (instruments present in the block) also accepts
`on`/`true`/`yes`/`current`/`present`; `all` (full kit) also accepts
`full`/`kit`/`complete`/`supported`/`everything`; `off` also accepts
`none`/`hide`/`no`.

### Metadata-only keys

`Title`, `Author`, `Comment`, and `Count` are recognized as setting-shaped lines
but are **stored as metadata**, not interpreted (aside from `Title`, which names
the rendered block). `Count` is commonly used to annotate the beat grid:

```drums
Title: Basic rock groove
Count: 1 e & a 2 e & a 3 e & a 4 e & a
HH | x-x-x-x-x-x-x-x-
```

Any other `Key: value` line is preserved verbatim too. The removed `Engraving`
setting, for example, is now retained as plain metadata.

---

## 3. Rows and instruments

A row is `LABEL | pattern`. The label is matched (case-insensitively, ignoring
non-alphanumerics) against the instrument alias table below. **A label that does
not resolve to a known instrument causes the whole line to be treated as
metadata**, not a row — there are no unknown instruments.

One character maps to one grid slot. Align characters in the same column across
rows to stack simultaneous hits (e.g. kick + hi-hat foot).

### Instrument map

| Label (canonical) | Aliases | Notehead | MIDI |
|-------------------|---------|----------|------|
| Crash | `cr`, `cc`, `crash cymbal` | × | 49 |
| Splash | `sp`, `splash cymbal` | × | 55 |
| China | `chna`, `china cymbal` | × | 52 |
| Stack | `st`, `stack cymbal` | × | 52 |
| Ride | `rd`, `rc` | × | 51 |
| Ride bell | `rb`, `bell`, `ride bell` | × | 53 |
| Open hat | `oh`, `open hh`, `open-hat` | × | 46 |
| Half-open hat | `ho`, `hho`, `half-open hi-hat` | × | 46 |
| Hi-hat (closed) | `hh`, `ch`, `hat`, `hihat`, `closed` | × | 42 |
| Hi-hat foot | `hf`, `hhf`, `fh`, `hat foot` | × | 44 |
| Hi-hat foot splash | `hfs`, `hhfs`, `hi-hat splash`, `foot splash` | circled × | 44 |
| Snare | `sd`, `sn`, `snare` | ● | 38 |
| Rim / cross-stick | `rs`, `rim`, `rimshot`, `xstick`, `cross`, `cross-stick` | × | 37 |
| High rack tom | `ht`, `rt`, `t1`, `tom1`, `rack` | ● | 50 |
| Mid rack tom | `mt`, `t2`, `tom2` | ● | 47 |
| Low rack tom | `lt`, `t3`, `tom3` | ● | 45 |
| Floor tom | `ft`, `floor` | ● | 41 |
| Low floor tom | `lft`, `ft2`, `low floor` | ● | 43 |
| Kick | `bd`, `kd`, `kick`, `bass` | ● | 36 |
| Second kick | `bd2`, `kd2`, `kick2`, `bass drum 2` | ●, below kick | 36 |
| Cowbell | `cb`, `cowbell` | × | 56 |

> "Cross-stick" is **not** a separate instrument — it is the existing `rim`
> voice (aliases include `xstick`/`cross`). See `src/kit.ts` for the complete,
> authoritative alias lists.

---

## 4. Hit characters (the alphabet)

Every pattern character is either a **rest** or a **hit with an articulation**.

| Character(s) | Meaning | Playback velocity |
|--------------|---------|-------------------|
| `x`, `o` | Normal hit | 0.75 |
| `X`, `O`, `>`, `!`, `#` | Accent | 1.0 |
| `g` | Ghost note (parenthesized, quieter) | 0.4 |
| `f` | Flam (grace note + connector) | 0.75 |
| `r` | Drag / ruff (two beamed grace notes + connector) | 0.75 |
| `d` | Diddle (two hits inside the slot) | 0.75 |
| `z`, `Z` | Buzz / press roll | 0.68 |
| `c` | Choked cymbal (short cymbal hit with plus mark) | 0.9 |
| `-`, `.`, `_`, space | Rest (no hit) | — |

**The model stores the articulation, not the exact character.** `>`, `!`, `#`,
`X`, and `O` all parse to `accent`; `x` and `o` both parse to a normal hit. This
is intentional and is why round-tripping is defined at the model level, not as
byte equality (see §7).

By convention, cross-notehead voices (cymbals, hats, cross-stick) are written
with `x`/`X` and drum voices with `o`/`O`. The parser does not enforce this, but
the serializer emits the convention-correct character per voice.

---

## 5. Bars and systems

Two independent groupings exist:

1. **Bars within a row** — split a single row's pattern with ` | `:

   ```drums
   HH | x-x-x-x-x-x-x-x- | x-x-x-x-x-x-x-x-
   SD | ----o-------o--- | ----o---o---o---
   ```

   Each segment is one bar. Empty segments are discarded, so a row's bars are
   always a contiguous run starting from the first. Rows in the same system may
   span different numbers of bars.

2. **Systems (new staff lines)** — separate row groups with a bar-separator
   line. `Bar`, `Measure`, `Bar 2:`, `New bar` all work:

   ```drums
   HH | x-x-x-x-x-x-x-x-
   SD | ----o-------o---
   Bar
   HH | x-x-x-x-x-x-x-x-
   SD | o---o---o---o---
   ```

Bar/measure numbering and trailing text on the separator line are not modeled;
the serializer normalizes the separator to a bare `Bar`.

### One-bar measure repeats

A standalone `%` line means "repeat the previous bar once." Add `xN` to repeat
that previous one-bar pattern several times, e.g. `%x3` repeats the previous bar
three times. The parser expands repeat shorthand into normal playable slots
while marking those bars as repeats, so playback follows the repeated rhythm and
the serializer/renderer keep the compact repeat symbols:

```drums
Title: Two bars, second repeated
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-o-----
%
```

```drums
Title: Repeat previous bar three times
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-o-----
%x3
```

The repeat may also appear at the start of a new system, as long as a previous
bar exists:

```drums
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
Bar
%
```

Accepted text forms are `%`, `Repeat`, `Repeat bar`, `Repeat measure`,
`Repeat previous bar`, `Repeat 1 bar`, and `Repeat one bar`; each may include
an `xN` suffix such as `%x3` or `Repeat bar x3`. Counts are clamped to 1–64.
The serializer emits `%` for a single repeat and `%xN` for counted one-bar
repeats. Separate `%` lines remain separate repeat bars; only explicit `%xN`
syntax renders as one compact repeat bar with an `xN` mark.

`%2` is reserved for a future two-bar repeat symbol and is not modeled yet.
Section repeat signs, first/second endings, D.S./D.C., Segno, and Coda roadmaps
are not modeled yet either. They need span and playback-roadmap semantics beyond
the current local one-bar repeat.

---

## 6. Grid resolution

`Grid: 16` (default) means one character is a sixteenth note. `Grid: 32` means
one character is a thirty-second note. In `Grid: 32`, note values are derived
from the distance to the next hit within each beat, so `x---x---` renders as
beamed eighths while `xxxxxxxx` renders as thirty-seconds. Slots-per-bar is
`beats × (grid ÷ beat-value)`; e.g. 4/4 at grid 16 = 16 slots per bar.

```drums
Grid: 32
HH | xxxxxxxxxxxxxxxx
SD | ----------------
BD | o-------o-------
```

---

## 7. Worked examples

Each example is a complete block. The articulation characters come from §4 and
the structure rules from §3 and §5.

### Accents and ghost notes

Accent the backbeat snares and tuck quiet ghost notes between them. Accents use
the upper-case glyph (`O` on a drum row), ghosts use `g`:

```drums
Title: Ghosted backbeat
HH | x-x-x-x-x-x-x-x-
SD | --g-O-g---g-O-g-
BD | o-------o-------
```

### Flam

A flam (`f`) renders as a small grace note before the main hit:

```drums
Title: Flam accents
SD | f---f---f---f---
BD | o-------o-------
```

### Drag / ruff

A drag (`r`) renders as two beamed grace notes before the main hit:

```drums
Title: Drag accents
SD | r---r---r---r---
BD | o-------o-------
```

### Diddle

A diddle (`d`) is two hits inside one slot — the basis of double-stroke rolls.
Here the snare plays paradiddle stickings against a steady hi-hat:

```drums
Title: Diddle groove
HH | x-x-x-x-x-x-x-x-
SD | o-d-o-d-o-d-o-d-
BD | o-------o-------
```

### Buzz / press roll

A buzz roll (`z`) sustains as a closed snare-roll texture. End a long roll with a
normal release note:

```drums
Title: Two-beat buzz roll
SD | z---z---o-------
BD | o-------o-------
```

### Choked cymbal

A choked cymbal (`c`) renders as a cymbal notehead with a small plus mark above
it and plays with a short muted decay:

```drums
Title: Choked crash
CC | c---------------
BD | o---------------
```

### Stacking hits

Characters in the same column sound together. Here the kick stacks with the
hi-hat foot on beats 2 and 4 while the hands keep time:

```drums
Title: Stacked voices
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
HF | x---x---x---x---
BD | o-------o-o-----
```

Use `HFS` for a hi-hat foot splash. It is written on the same staff position as
`HF`, but renders as a circled x notehead:

```drums
HFS | x-------x-------
BD  | o-------o-------
```

### Multiple bars in one system

Split a row with ` | ` to write several bars on one staff line:

```drums
Title: Two-bar phrase
HH | x-x-x-x-x-x-x-x- | x-x-x-x-x-x-x-x-
SD | ----o-------o--- | ----o---o---o---
BD | o-------o-o----- | o-o-----o-------
```

### Multiple systems and repeats

A bar-separator line starts a new staff line; `Repeat:` loops the whole block
during playback. This is distinct from the `%` measure-repeat symbol in §5,
which repeats only the previous bar:

```drums
Title: Verse then fill
Repeat: 2
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-------
Bar
HT | --------o-o-----
MT | ------------o-o-
SD | o-o-o-o---------
BD | o-------o-------
```

### Thirty-second-note fill

In `Grid: 32` each character is a thirty-second note; note values are derived
from the gap to the next hit within the beat:

```drums
Title: Linear 32nd fill
Grid: 32
SD | o-o-oo-oo-o-oo-oo-o-oo-oo-o-oo-o
BD | o-------------------------------
```

---

## 8. Round-trip and serialization contract

The serializer (`serializeDrumBlock`) is the model → text inverse of the parser.
Its contract is **semantic**, not textual:

- **Semantic round-trip.** Settings, structure (systems/bars/rows), instruments,
  and per-hit articulations survive `parse → serialize → parse` unchanged.
- **Idempotence.** `serialize` is stable: `serialize(parse(x))` equals
  `serialize(parse(serialize(parse(x))))`. Once a block has been serialized, it
  re-serializes identically.
- **Canonical fixpoint.** A block whose text already uses canonical characters
  (what the serializer emits) round-trips to a deep-equal model. Non-canonical
  input does not: the parser stores raw characters in `row.pattern`, and
  normalization rewrites them — so the *semantics* match but that one cached
  string differs. The hits, articulations, and structure are unaffected.
- **Byte-for-byte fidelity with the input is not a goal.**

`serializeDrumBlock(block)` defaults to minimal normalized output. The optional
`serializeDrumBlock(block, { mode: "authoring" })` form emits Obsidian-ready
authoring text with visible `Title`, `Tempo`, `Time`, and `Grid` lines even when
those settings are defaults.

To stay deterministic and diff-friendly, serialization **normalizes**:

- Hit characters collapse to the canonical glyph for their articulation and
  notehead (`x`/`X` for cross voices, `o`/`O` for drums; `g`, `f`, `d`, `z`,
  `c`).
- Rests collapse to `-`.
- Settings left at their default are **omitted** (they re-parse to the default).
- Unknown/metadata lines are preserved verbatim and in order.
- Bar separators normalize to `Bar`; row patterns are joined with ` | `.
- One-bar measure repeats normalize to `%` and are not expanded back into row
  text.
- Model-level bar edits serialize through the same row/bar invariants as parsed
  text: inserted empty bars are represented as rest patterns for the selected
  bar's instruments and are sized from the block's current `Time` and `Grid`,
  duplicated bars copy the selected bar's exact row patterns, and deleted bars
  remove empty systems when no rows remain. A model-level repeat toggle marks a
  normal bar as `%` by copying the previous bar's playable pattern, and clearing
  that marker leaves the copied bar as normal editable row text.

This means a hand-authored block that uses `>` for accents or `.` for rests will
come back from a serialize pass using `X`/`O` and `-`. That is expected. (A
future minimal-diff serializer for the Obsidian hand-edit case may preserve more
of the original formatting; it is not implemented yet.)

---

## 9. Forward compatibility

The format has no explicit version field today. Guidelines for evolving it:

- **Adding instruments / aliases** is backward compatible: old blocks keep
  parsing, new aliases simply resolve.
- **Adding settings** is backward compatible as long as the default preserves
  prior behavior; unknown settings already degrade to metadata.
- **Adding articulation characters** must not reuse an existing character's
  meaning, and should round-trip to a stable canonical glyph.
- **Adding roadmap symbols** such as two-bar repeats, section repeats, voltas,
  Segno, or Coda should define both text syntax and playback expansion rules.
- A `Version:` setting may be introduced once a second producer exists (web app,
  visual editor, or importer), at which point the format becomes a shared
  contract and needs explicit schema-evolution rules. Until then a single
  producer (the plugin) keeps churn low.

See also: the architecture direction recorded in the project memory, and the
pure model/edit/serialize modules in `src/parser.ts`, `src/serializer.ts`, and
`src/edit.ts`.
