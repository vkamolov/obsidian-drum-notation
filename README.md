# Obsidian Drum Notation

[![CI](https://github.com/vkamolov/obsidian-drum-notation/actions/workflows/ci.yml/badge.svg)](https://github.com/vkamolov/obsidian-drum-notation/actions/workflows/ci.yml)

Render drum kit patterns as graphical SVG percussion staff notation in Obsidian, with playback.

See [docs/notation-format.md](docs/notation-format.md) for the full notation format reference.

## Create A Notation

You can start without writing drum rows manually:

- In an open Markdown editor, run **Drum Notation: Create drum notation** from
  the Command palette. Choose the title, tempo, time signature, and grid, then
  the plugin inserts a complete fenced `drums` block with one empty HH/SD/BD
  bar at the cursor.
- If you already created an empty top-level `drums` block, switch to Reading
  view and press **Create first bar** in the rendered block. Existing Title,
  Tempo, Time, and Grid values prefill the setup window.

The setup window shows the calculated bar length before creating it, such as
`7/8 · Grid 16 · 14 slots`. When visual edit mode is enabled, creating the
first bar opens it immediately for editing.

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

In reading view, the plugin renders the block as page-width percussion staff notation and adds **Play**, **Stop**, **Loop Bar**, **Loop All**, playback-speed, metronome, instrument-mute, and **Edit** controls. For training, playback speed offers 25%, 50%, 75%, and 100% of the written tempo. The metronome menu offers **Off**, **With drums**, and **Metronome only**; the first pulse of each bar is accented. Compound meters use grouped pulses, such as two clicks per bar in 6/8 and four in 12/8. The mute menu lists only instruments used in the current notation and mutes each canonical voice independently.

Speed, metronome, and mute choices are playback-only: they do not change the fenced notation text. Obsidian resets them when the rendered block is recreated; the playground keeps them for the current page session. Changing any of these controls during playback restarts from the current slot while preserving the active Play/Loop mode. Instrument mutes do not silence the metronome. Muting affects transport playback only, so clicking a rendered note or previewing an editor cell remains audible.

Add `Cursor: on` if you want a blinking cursor to follow playback. Click a rendered note to preview that hit or stacked chord.

## Visual Edit Mode

Visual edit mode is opt-in because it writes changes back to your notes. Enable **Drum Notation → Enable visual edit mode** in the plugin settings first. Then, in Obsidian reading view, press **Edit** to open a selected-bar grid below the rendered score. Click or tap a rendered bar to choose which bar the grid edits. Empty cells add a normal hit; filled cells select the hit and show the articulation tool strip. Edits apply immediately to the rendered notation and are saved back into the fenced `drums` block when you close visual edit mode or when Obsidian unloads the rendered block.

Visual edit mode is intentionally limited in v1:

- It is available in reading view only. Live Preview/source-mode blocks remain read-only because writing to the file underneath the active text editor can conflict with Obsidian's editor state.
- It edits only top-level `drums` fences. Blocks nested inside callouts, lists, or indented Markdown are rendered and playable, but visual editing is disabled.
- The first visual edit serializes the whole block in the plugin's canonical authoring form. This keeps the model safe and deterministic, but it may normalize spacing, labels, header order, and equivalent hit characters.
- One-bar repeat bars are selectable and can be marked/unmarked with the grid controls, but the repeated bar body itself remains read-only.

## Settings

Put settings at the top of the block:

```drums
Title: Groove title
Author: Your name
Comment: Practice slowly, then loop it.
Tempo: 120
Time: 7/8
Subtitle: Verse
Repeat: 4
Cursor: on
Highlight: on
Legend: off
Grid: 16
```

Supported settings:

| Setting | Example | Notes |
| --- | --- | --- |
| `Title:` | `Title: Linear fill` | Shown above the rendered score. |
| `Subtitle:` | `Subtitle: Verse` | Labels the current rendered staff line and all inline bars on it. |
| `Tempo:` or `BPM:` | `Tempo: 96` | Playback tempo, clamped between 30 and 260 BPM. |
| `Time:`, `Meter:`, or `Time Signature:` | `Time: 6/8` | Drawn on the staff. |
| `Repeat:` or `Repeats:` | `Repeat: 4` | Plays the whole block this many times when pressing **Play**. |
| `Cursor:` or `Playback Cursor:` | `Cursor: on` | Shows or hides the blinking playback cursor. Defaults to `off`. |
| `Highlight:`, `Note Highlight:`, or `Playback Highlight:` | `Highlight: off` | Highlights the note/chord that is currently sounding. Defaults to `on`. |
| `Legend:`, `Instrument Legend:`, or `Kit Legend:` | `Legend: all` | Shows a compact color key. Use `on`/`used` for instruments in the current block, `all` for the full supported kit, or `off` to hide it. Defaults to `off`. |
| `Grid:`, `Subdivision:`, or `Resolution:` | `Grid: 32` | Sets one source character to a sixteenth note (`16`, default) or thirty-second note (`32`). |
| `Author:` | `Author: Test Author` | Stored as metadata. |
| `Comment:` | `Comment: Test Comment` | Stored as metadata. |
| `Count:` | `Count: 1 e & a 2 e & a` | Useful source-code guide while editing. |

`Title:` names the complete notation block. `Subtitle:` is optional and belongs
to one rendered staff line. Put another `Subtitle:` after a `Bar` separator to
label the next line. Long subtitles wrap above the staff on narrow screens.

## Instrument Rows

Each instrument row is:

```text
LABEL | pattern
```

The pattern is one character per grid slot. By default one character is a sixteenth note. Use `Grid: 32` when one character should be a thirty-second note. Put hits in the same column to stack them, such as kick plus hi-hat foot.

| Labels | Instrument |
| --- | --- |
| `BD`, `KD`, `Kick` | Kick |
| `BD2`, `KD2`, `Kick2`, `Bass Drum 2` | Second kick / second bass drum |
| `HF`, `HHF`, `Foot Hat`, `Hi-hat Foot` | Hi-hat foot |
| `HFS`, `HHFS`, `Foot Splash`, `Hi-hat Splash` | Hi-hat foot splash |
| `SD`, `SN`, `Snare` | Snare |
| `RS`, `Rim`, `Cross`, `Cross-stick` | Rim/cross-stick |
| `HH`, `CH`, `Close`, `Hat`, `Hi-hat` | Closed hi-hat |
| `OH`, `Open Hat` | Open hi-hat |
| `HO`, `HHO`, `Half-open Hat`, `Half-open Hi-hat` | Half-open hi-hat |
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

`SD` uses a fuller synthesized snare sound. `RS` / cross-stick stays shorter and clickier. `BD2` / second kick is for double-bass-pedal notation and renders below the main kick while using the same synthesized kick voice. `CR`, `SP`, `China`, and `Stack` use separate synthesized cymbal voices so their playback is distinguishable. `OH` / open hi-hat renders with the standard open-circle mark above the note. `HO` / half-open hi-hat renders the open circle with a vertical line through it. `HFS` / hi-hat foot splash renders as a circled x on the foot-hat line.

## Sticking

Add a global right/left/both-hands sticking lane with `ST`, `Stick`, `Sticking`,
or `Hands`. It is slot-aligned with the drum rows and display-only, so it does
not affect playback.

````
```drums
Title: Sticking example
ST | R-L-B-L-R-L-B-L-
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-------
```
````

## Color Legend

The legend is hidden by default. Add `Legend: on` to show a color key for only the instruments used in the block, or `Legend: all` to show every supported instrument. When the legend is visible, noteheads are colored to match the legend while staff lines, stems, beams, and notation marks keep the notation color scheme.

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
HO    | -------x-------- | ----------------
HH    | --------x------- | ----------------
HF    | ---------x------ | ----------------
SD    | ----------o----- | ----------------
RS    | -----------x---- | ----------------
HT    | ------------o--- | ----------------
MT    | -------------o-- | ----------------
LT    | --------------o- | ----------------
FT    | ---------------o | ----------------
LFT   | ---------------- | x---------------
CB    | ---------------- | -x--------------
BD    | ---------------- | --o-------------
BD2   | ---------------- | ----o-----------
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

Subtitle: Main groove
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-o-----

Bar:
Subtitle: Fill
RD | x-x-x-x---------
HT | --------o-o-----
MT | ------------o-o-
FT | --------------oo
BD | o---o---o---o---
```
````

`Bar:`, `Bar 2:`, `Measure:`, and `New Bar:` all work as separators. A
`Subtitle:` before or among a system's rows labels that complete rendered line,
including multiple inline bars. Normal **Play** runs through all bars in order.
**Loop Bar** loops the declared bar containing the current cursor or last
clicked note.

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
| `r` | Drag / ruff, drawn as two beamed grace notes with connector and played as two soft grace hits |
| `d` | Diddle, drawn as a mid-stem slash and played as two hits inside the current grid slot |
| `z`, `Z` | Buzz roll, drawn as a custom line-drawn `Z` through the note stem and played as a closed snare-roll texture |
| `c` | Choked cymbal, drawn with a small plus mark and played with a short muted decay |
| `-`, `.`, `_` | Rest |

Use `c` on a cymbal row for a choked cymbal:

````
```drums
Title: Choked crash
CC | c---------------
BD | o---------------
```
````

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
| `z` with `d`, `r`, `g`, `f`, `c`, or accent in the same snare cell | Not supported because each instrument row uses one character per slot. Use adjacent slots or written-out `Grid: 32` notes when you need more detail. |

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
| `d` with `X`, `g`, `f`, `r`, or `c` in the same cell | Not supported because each instrument row uses one character per slot. Use written-out `Grid: 32` notes when you need an accented, ghosted, flammed, dragged, or choked double. |

## Full Kit Example

This example is inspired by the reference image and includes every supported row: cymbals, hi-hats, ride bell, cowbell, snare, cross-stick, ghost/flam/drag/choke strokes, rack toms, floor toms, kick, second kick, foot hi-hat, foot splash, and a stacked kick plus foot-hat hit.

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
HO    | --x-----------------------------
CR    | --->----c-----------------------
SP    | ----x---------------------------
China | -----x--------------------------
Stack | ------x-------------------------
RD    | -------x------------------------
RB    | --------x-----------------------
CB    | ---------x----------------------
SD    | ----------g-----------f---------
RS    | ----------->--------------------
HT    | ------------o-------------------
MT    | -------------o------------------
LT    | --------------o-----------------
FT    | ---------------o----------------
LFT   | ----------------o---------------
BD    | -----------------o-------------X
BD2   | --------------------o-----------
HF    | ------------------x------------X
HFS   | -------------------x------------
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

Use `%` on its own line for a one-bar measure repeat. Add a count suffix such
as `%x3` to repeat the previous bar three times:

````
```drums
Title: Repeated bar
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-o-----
%x3
```
````

During **Play** and **Loop All**, the compact `x3` marker shows repeat progress
as `1/3`, `2/3`, and `3/3`, then returns to `x3` outside playback. **Loop Bar**
keeps the static count because it loops only one expanded bar.

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

## Installation And Beta Testing

After Community directory approval, install **Drum Notation** from Obsidian's
Community plugins browser.

Before approval, beta testers can install GitHub releases with
[BRAT](https://github.com/TfTHacker/obsidian42-brat), or install manually:

1. Download `main.js`, `manifest.json`, and `styles.css` from a release.
2. Create this folder in your vault:
   ```text
   <vault>/.obsidian/plugins/drum-notation
   ```
3. Copy those three files into that folder.
4. Reload Obsidian and enable **Drum Notation**.

## Privacy

The Obsidian plugin makes no network requests and includes no telemetry. Notes,
settings, and generated notation stay in your vault.

The web playground runs entirely in the browser. It uses `localStorage` to keep
the current playground notation and light/dark preference for the current
browser profile. It does not send notation to a server.

## License And Third-Party Notices

Drum Notation is released under the MIT License. Production builds include
[VexFlow](https://www.vexflow.com/) 5.0.0 for music engraving, also under the
MIT License. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the full
VexFlow notice.
