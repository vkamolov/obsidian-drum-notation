# Obsidian Drum Notation

Render drum kit patterns as graphical SVG percussion staff notation in Obsidian, with playback.

## Basic Example

Create a fenced code block with the language `drums`:

````
```drums
Title: Basic rock groove
Tempo: 100
Time: 4/4
Count: 1 e & a 2 e & a 3 e & a 4 e & a
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-o-----
```
````

In reading view, the plugin renders the block as page-width percussion staff notation and adds **Play**, **Stop**, and **Loop Bar** controls. While playing, a blinking cursor follows the current note across the score. Click a rendered note to preview that hit or stacked chord.

## Settings

Put settings at the top of the block:

```drums
Title: Groove title
Author: Your name
Comment: Practice slowly, then loop it.
Tempo: 120
Time: 7/8
Repeat: 4
Cursor: on
Highlight: on
Legend: off
Engraving: tidy
Grid: 16
```

Supported settings:

| Setting | Example | Notes |
| --- | --- | --- |
| `Title:` | `Title: Linear fill` | Shown above the rendered score. |
| `Tempo:` or `BPM:` | `Tempo: 96` | Playback tempo, clamped between 30 and 260 BPM. |
| `Time:`, `Meter:`, or `Time Signature:` | `Time: 6/8` | Drawn on the staff. |
| `Repeat:` or `Repeats:` | `Repeat: 4` | Plays the whole block this many times when pressing **Play**. |
| `Cursor:` or `Playback Cursor:` | `Cursor: off` | Shows or hides the blinking playback cursor. Defaults to `on`. |
| `Highlight:`, `Note Highlight:`, or `Playback Highlight:` | `Highlight: off` | Highlights the note/chord that is currently sounding. Defaults to `on`. |
| `Legend:`, `Instrument Legend:`, or `Kit Legend:` | `Legend: all` | Shows a compact color key. Use `on`/`used` for instruments in the current block, `all` for the full supported kit, or `off` to hide it. Defaults to `off`. |
| `Engraving:`, `Style:`, or `Render Style:` | `Engraving: classic` | `tidy` is the default trial style. Use `classic` to roll back to the previous spacing for any block. |
| `Grid:`, `Subdivision:`, or `Resolution:` | `Grid: 32` | Sets one source character to a sixteenth note (`16`, default) or thirty-second note (`32`). |
| `Author:` | `Author: Test Author` | Stored as metadata. |
| `Comment:` | `Comment: Test Comment` | Stored as metadata. |
| `Count:` | `Count: 1 e & a 2 e & a` | Useful source-code guide while editing. |

## Instrument Rows

Each instrument row is:

```text
LABEL | pattern
```

The pattern is one character per grid slot. By default one character is a sixteenth note. Use `Grid: 32` when one character should be a thirty-second note. Put hits in the same column to stack them, such as kick plus hi-hat foot.

| Labels | Instrument |
| --- | --- |
| `BD`, `KD`, `Kick` | Kick |
| `HF`, `HHF`, `Foot Hat`, `Hi-hat Foot` | Hi-hat foot |
| `SD`, `SN`, `Snare` | Snare |
| `RS`, `Rim`, `Cross`, `Cross-stick` | Rim/cross-stick |
| `HH`, `CH`, `Close`, `Hat`, `Hi-hat` | Closed hi-hat |
| `OH`, `Open Hat` | Open hi-hat |
| `RD`, `Ride` | Ride |
| `RB`, `Ride Bell`, `Bell` | Ride bell |
| `CR`, `Crash` | Crash |
| `SP`, `Splash` | Splash cymbal |
| `China` | China cymbal |
| `Stack` | Stack cymbal |
| `HT`, `RT`, `T1`, `Rack Tom` | High rack tom |
| `MT`, `T2` | Mid rack tom |
| `LT`, `T3` | Low rack tom |
| `FT`, `Floor Tom` | Floor tom |
| `LFT`, `Low Floor Tom` | Low floor tom |
| `CB`, `Cowbell` | Cowbell |

`SD` uses a fuller synthesized snare sound. `RS` / cross-stick stays shorter and clickier. `OH` / open hi-hat renders with the standard open-circle mark above the note.

## Color Legend

The legend is hidden by default. Add `Legend: on` to show a color key for only the instruments used in the block, or `Legend: all` to show every supported instrument. When the legend is visible, noteheads are colored to match the legend while staff lines, stems, beams, and notation marks keep the selected engraving style.

````
```drums
Title: Full Supported Kit - Separate Sounds Test
Tempo: 80
Time: 4/4
Grid: 16
Legend: all

CR    | x--------------- | ----------------
SP    | -x-------------- | ----------------
China | --x------------- | ----------------
Stack | ---x------------ | ----------------
RD    | ----x----------- | ----------------
RB    | -----x---------- | ----------------
OH    | ------x--------- | ----------------
HH    | -------x-------- | ----------------
HF    | --------x------- | ----------------
SD    | ---------o------ | ----------------
RS    | ----------x----- | ----------------
HT    | -----------o---- | ----------------
MT    | ------------o--- | ----------------
LT    | -------------o-- | ----------------
FT    | --------------o- | ----------------
LFT   | ---------------o | ----------------
CB    | ---------------- | x---------------
BD    | ---------------- | -o--------------
```
````

## Starting A New Bar

Use `|` inside an instrument row to split measures. Inline measures stay on the same rendered staff line with a visual bar divider:

````
```drums
Title: Two-bar groove
Tempo: 104
Time: 4/4
HH | x-x-x-x-x-x-x-x- | x-x-x-x-x-x-x-x-
SD | ----o-------o--- | ----o---o---o---
BD | o-------o-o----- | o-o-----o-------
```
````

Use `Bar:` to force a new rendered staff line. This is useful when the next bar uses a different set of instruments.

````
```drums
Title: Groove then fill
Tempo: 104
Time: 4/4

Bar:
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-o-----

Bar:
RD | x-x-x-x---------
HT | --------o-o-----
MT | ------------o-o-
FT | --------------oo
BD | o---o---o---o---
```
````

`Bar:`, `Bar 2:`, `Measure:`, and `New Bar:` all work as separators. Normal **Play** runs through all bars in order. **Loop Bar** loops the declared bar containing the current cursor or last clicked note.

## Subdivisions And Beams

The notation groups hits by beat/count:

| Hits in one count | Rendered as |
| --- | --- |
| 1 | Quarter note, no beam |
| 2 | Eighth notes, one beam |
| 3 | Eighth-note triplet, one beam plus `3` |
| 4 | Sixteenth notes, two beams |
| 8 in `Grid: 32` | Thirty-second notes, three beams |

Use `Grid: 32` for written-out thirty-second-note fills. In `Grid: 32`, the renderer derives note values from the distance to the next hit inside each beat, so `x---x---` is drawn as beamed eighth notes while `xxxxxxxx` is drawn as thirty-second notes. Hidden rests keep spacing exact when a gap cannot be represented by one simple note value.

## Hit Characters

| Character | Meaning |
| --- | --- |
| `x`, `o` | Normal hit |
| `X`, `O`, `>`, `!`, `#` | Accent |
| `g` | Ghost note, drawn in parentheses with quieter playback |
| `f` | Flam, drawn as a small grace note with connector and played as a soft grace hit |
| `d` | Diddle, drawn as a mid-stem slash and played as two hits inside the current grid slot |
| `z`, `Z` | Buzz roll, drawn as a custom line-drawn `Z` through the note stem and played as a closed snare-roll texture |
| `-`, `.`, `_` | Rest |

## Buzz Rolls

Use `z` or `Z` on the snare row for a closed buzz roll / press roll. The rendered note shows a modern drumline-style custom line-drawn `Z` through the stem. During playback, snare buzz rolls use a continuous noise texture for the rendered note value, so a single buzz note on one beat sustains through that beat instead of sounding like one short tap.

````
```drums
Title: Buzz roll with release
Tempo: 84
Time: 4/4
SD | z-------z-----o-
BD | o-------o-------
```
````

For long rolls, write consecutive buzz notes and end with a normal snare release note:

````
```drums
Title: Two-beat buzz roll
Tempo: 76
Time: 4/4
SD | z---z---o-------
BD | o-------o-------
```
````

Buzz-roll combinations:

| Source | Result |
| --- | --- |
| `SD | z---` in `Grid: 16` | One buzz-roll note on the snare. If it is the only hit in that beat, it renders and plays for the beat value. |
| `SD | z-z-` in `Grid: 16` | Two beamed buzz-roll notes inside the beat. |
| `SD | zzzzzzzz` in `Grid: 32` | Written-out thirty-second buzz strokes, useful for very dense roll notation. |
| `z` stacked with another row in the same column | Snare plays a buzz texture while the other instrument plays its normal hit. |
| `z` followed by `o` | Buzz roll followed by a clean release note. |
| `z` with `d`, `g`, `f`, or accent in the same snare cell | Not supported because each instrument row uses one character per slot. Use adjacent slots or written-out `Grid: 32` notes when you need more detail. |

## Thirty-Second Notes And Diddles

Use `Grid: 32` when you want to write every thirty-second-note slot directly:

````
```drums
Title: Written 32nd fill
Tempo: 96
Time: 4/4
Grid: 32
SD | oooooooo------------------------
HT | --------oooooooo----------------
FT | ----------------oooooooo--------
BD | o---------------o---------------
```
````

Use `d` when you want compact drummer-style diddle notation:

````
```drums
Title: Diddle groove
Tempo: 100
Time: 4/4
Grid: 16
HH | x-x-x-x-x-x-x-x-
SD | d-------d-------
BD | o---o---o---o---
```
````

Combinations:

| Source | Result |
| --- | --- |
| `Grid: 16` + `d` | One visible diddled note, played as two thirty-second-note hits. |
| `Grid: 32` + `d` | One visible diddled thirty-second note, played as two faster hits inside that thirty-second slot. |
| `Grid: 32` + written hits like `oooo` | Four explicit thirty-second notes. |
| `d` stacked with another row in the same column | The diddled instrument plays twice; the other stacked instrument plays once. |
| `d` with `X`, `g`, or `f` in the same cell | Not supported because each instrument row uses one character per slot. Use written-out `Grid: 32` notes when you need an accented, ghosted, or flammed double. |

## Full Kit Example

This example is inspired by the reference image and includes every supported row: cymbals, hi-hats, ride bell, cowbell, snare, cross-stick, ghost/flam strokes, rack toms, floor toms, kick, foot hi-hat, and a stacked kick plus foot-hat hit.

````
```drums
Title: Full kit notation map
Author: Test Author
Comment: Test Comment
Tempo: 92
Time: 4/4
Count: 1 e & a 2 e & a 3 e & a 4 e & a 5 e & a 6 e & a 7 e & a 8 e & a
HH    | x-------------------------------
OH    | -o------------------------------
CR    | -->-----------------------------
SP    | ---x----------------------------
China | ----x---------------------------
Stack | -----x--------------------------
RD    | ------x-------------------------
RB    | -------x------------------------
CB    | --------x-----------------------
SD    | ---------g-----------f----------
RS    | ---------->---------------------
HT    | -----------o--------------------
MT    | ------------o-------------------
LT    | -------------o------------------
FT    | --------------o-----------------
LFT   | ---------------o----------------
BD    | ----------------o--------------X
HF    | -----------------x-------------X
```
````

Because rows share the same grid, the final `X` on `BD` and `HF` creates a kick plus hi-hat-foot stack.

## Odd Time Example

````
```drums
Title: Seven-eight groove
Tempo: 132
Time: 7/8
Count: 1 & 2 & 3 & 4 & 5 & 6 & 7 &
HH | x-x-x-x-x-x-x-
SD | ----o-----o---
BD | o-----o-o-----
```
````

The plugin currently treats each pattern character as a sixteenth-note slot for spacing and playback. The time signature controls the displayed meter.

Rest slots keep the rhythm spaced correctly, but rest symbols are hidden in the rendered score.

## Repetition And Looping

Use `Repeat:` to repeat the full block during normal playback:

````
```drums
Title: Repeated groove
Tempo: 108
Time: 4/4
Repeat: 4
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-o-----
```
````

Use **Loop Bar** in the rendered view to loop the bar containing the current cursor position. Click a note in another bar first, then press **Loop Bar** to loop that bar.

## Development

Install dependencies:

```bash
npm install
```

Build once:

```bash
npm run build
```

Watch during development:

```bash
npm run dev
```

To test in Obsidian, copy or symlink this folder into:

```text
<vault>/.obsidian/plugins/drum-notation
```

Then enable **Drum Notation** in Obsidian's community plugins settings.
