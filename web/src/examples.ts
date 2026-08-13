// Starter patterns for the playground dropdown. Each source is valid `drums` text.
export const PLAYGROUND_EXAMPLE_CATEGORIES = [
  { id: "getting-started", label: "Getting started" },
  { id: "meters-and-feels", label: "Meters and feels" },
  { id: "tuplets", label: "Tuplets" },
  { id: "rudiments", label: "Rudiments" },
  { id: "notation-features", label: "Notation features" },
  { id: "sounds-and-advanced", label: "Sounds and advanced examples" }
] as const;

export type PlaygroundExampleCategoryId = (typeof PLAYGROUND_EXAMPLE_CATEGORIES)[number]["id"];

export interface PlaygroundExample {
  id: string;
  name: string;
  category: PlaygroundExampleCategoryId;
  source: string;
}

export const DEFAULT_PLAYGROUND_EXAMPLE_ID = "basic-rock-groove";

export const PLAYGROUND_EXAMPLES = [
  {
    id: "basic-rock-groove",
    name: "Basic rock groove",
    category: "getting-started",
    source: `Title: Basic rock groove
Tempo: 100
Time: 4/4
Count: 1 e & a 2 e & a 3 e & a 4 e & a
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-o-----`
  },

  {
    id: "groove-with-fill",
    name: "Groove with fill",
    category: "getting-started",
    source: `Title: Groove with fill
Tempo: 110
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-o-----
Bar
HT | --------o-o-----
MT | ------------o-o-
SD | o-o-o-o---------
BD | o-------o-------`
  },

  {
    id: "syncopated-funk",
    name: "Syncopated funk",
    category: "getting-started",
    source: `Title: Syncopated funk
Tempo: 96
Time: 4/4
Count: 1 e & a 2 e & a 3 e & a 4 e & a
Subtitle: Groove
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o--o------o-----
Bar
Subtitle: Break: dotted kicks and off-beat snares
SD | ----------o-o---
BD | o--o--o---------`
  },

  {
    id: "rests-and-off-beats",
    name: "Rests and off-beats",
    category: "getting-started",
    source: `Title: Rests and off-beats
Time: 4/4
Grid: 16
HH | x-x-x-x-x------- | ----x----------- | x-x-----x-x-----`
  },

  {
    id: "6-8-ballad",
    name: "6/8 ballad",
    category: "meters-and-feels",
    source: `Title: 6/8 ballad
Tempo: 66
Time: 6/8
Count: 1 2 3 4 5 6
HH | x-x-x-x-x-x- | x-x-x-x-x-x-
SD | ------o----- | ------o-----
BD | o----------- | o---o-------`
  },

  {
    id: "7-8-groove",
    name: "7/8 groove",
    category: "meters-and-feels",
    source: `Title: 7/8 groove
Tempo: 104
Time: 7/8
Grouping: 2+2+3
Count: 1 2 3 4 5 6 7
Subtitle: Grouped 2 + 2 + 3
HH | x-x-x-x-x-x-x-
SD | ----o-------o-
BD | o---o---o-----`
  },

  {
    id: "9-8-groove",
    name: "9/8 groove",
    category: "meters-and-feels",
    source: `Title: 9/8 groove
Tempo: 92
Time: 9/8
Count: 1 2 3 4 5 6 7 8 9
HH | x-x-x-x-x-x-x-x-x-
SD | ------o-----------
BD | o-----------o-----`
  },

  {
    id: "12-8-blues-shuffle",
    name: "12/8 blues shuffle",
    category: "meters-and-feels",
    source: `Title: 12/8 blues shuffle
Tempo: 90
Time: 12/8
Count: 1 & a 2 & a 3 & a 4 & a
RD | x-x-x-x-x-x-x-x-x-x-x-x-
SD | ------o-----------o-----
BD | o-----------o-----------`
  },

  {
    id: "mixed-meter-phrase",
    name: "Mixed meter phrase",
    category: "meters-and-feels",
    source: `Title: Mixed meter phrase
Tempo: 96
Time: 4/4
Subtitle: Main groove in 4/4
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-------
Bar
Time: 3/4
Subtitle: Change to 3/4
HH | x-x-x-x-x-x-
SD | ----o-------
BD | o-------o---
Bar
Subtitle: Inherits 3/4
HT | o-o-o-o-----
MT | --------o-o-
SD | ------------
Bar
Time: 7/8
Grouping: 2+2+3
Subtitle: Finish in grouped 7/8
HH | x-x-x-x-x-x-x-
SD | ----o-------o-
BD | o---o---o-----`
  },

  {
    id: "triplet-fill",
    name: "Triplet fill",
    category: "tuplets",
    source: `Title: Triplet fill
Tempo: 100
Time: 4/4
Grid: 16
Subtitle: Straight groove ending with one beat of triplets
HH | x-x-x-x-x-x-3(xxx)
SD | ----o-------3(ooo)
BD | o-------o---3(---)`
  },

  {
    id: "triplet-shuffle",
    name: "Triplet shuffle",
    category: "tuplets",
    source: `Title: Triplet shuffle
Tempo: 92
Time: 4/4
Grid: 16
Subtitle: Each written quarter-note beat is divided into three
HH | 3(x-x)3(x-x)3(x-x)3(x-x)
SD | 3(---)3(o--)3(---)3(o--)
BD | 3(o--)3(---)3(o--)3(---)`
  },

  {
    id: "partial-beat-tuplets",
    name: "Partial-beat tuplets",
    category: "tuplets",
    source: `Title: Partial-beat tuplets
Tempo: 92
Time: 4/4
Grid: 16
Subtitle: Three equal notes in the first eighth-note duration of each beat
HH | 3@8(xxx)--3@8(xxx)--3@8(xxx)--3@8(xxx)--
SD | 3@8(o--)--3@8(---)--3@8(o--)--3@8(---)--
BD | 3@8(---)o-3@8(---)o-3@8(---)o-3@8(---)o-`
  },

  {
    id: "mixed-tuplets",
    name: "Mixed tuplets",
    category: "tuplets",
    source: `Title: Mixed tuplets
Tempo: 84
Time: 4/4
Grid: 16
Subtitle: Plain beat, triplet, explicit four, and quintuplet
ST | R-L-3(RLR)4(LRLR)5(RLRLR)
HH | x-x-3(x-x)4(x-x-)5(x-x-x)
SD | ----3(o--)4(--o-)5(o-o-o)
BD | o---3(---)4(o---)5(-----)
%x2`
  },

  {
    id: "multi-beat-tuplets",
    name: "Multi-beat tuplets",
    category: "tuplets",
    source: `Title: Multi-beat tuplets
Tempo: 84
Time: 4/4
Grid: 16
Subtitle: Quarter-note triplets spanning two written beats
ST | 2/3(RLR)2/3(LRL)
HH | 2/3(xxx)2/3(xxx)
SD | 2/3(o--)2/3(o--)
BD | 2/3(-o-)2/3(-o-)`
  },

  {
    id: "rudiment-single-stroke-roll",
    name: "Single-stroke roll",
    category: "rudiments",
    source: `Title: Single-stroke roll
Tempo: 80
Time: 4/4
Grid: 16
Subtitle: Alternating singles with accents on each beat
ST | RLRLRLRLRLRLRLRL
SD | OoooOoooOoooOooo`
  },

  {
    id: "rudiment-double-stroke-roll",
    name: "Double-stroke roll",
    category: "rudiments",
    source: `Title: Double-stroke roll
Tempo: 72
Time: 4/4
Grid: 16
Subtitle: Even doubles; ST marks the hand leading each pair
ST | R-L-R-L-R-L-R-L-
SD | d-d-d-d-d-d-d-d-`
  },

  {
    id: "rudiment-single-paradiddle",
    name: "Single paradiddle",
    category: "rudiments",
    source: `Title: Single paradiddle
Tempo: 80
Time: 4/4
Grid: 16
Subtitle: R L R R · L R L L
ST | RLRRLRLLRLRRLRLL
SD | OoooOoooOoooOooo`
  },

  {
    id: "rudiment-double-paradiddle",
    name: "Double paradiddle",
    category: "rudiments",
    source: `Title: Double paradiddle
Tempo: 72
Time: 4/4
Grid: 16
Subtitle: R L R L R R · L R L R L L
ST | 3(RLR)3(LRR)3(LRL)3(RLL)
SD | 3(Ooo)3(ooo)3(Ooo)3(ooo)`
  },

  {
    id: "rudiment-paradiddle-diddle",
    name: "Paradiddle-diddle",
    category: "rudiments",
    source: `Title: Paradiddle-diddle
Tempo: 72
Time: 4/4
Grid: 16
Subtitle: R L R R L L · L R L L R R
ST | 3(RLR)3(RLL)3(LRL)3(LRR)
SD | 3(Ooo)3(ooo)3(Ooo)3(ooo)`
  },

  {
    id: "rudiment-five-stroke-roll",
    name: "Five-stroke roll",
    category: "rudiments",
    source: `Title: Five-stroke roll
Tempo: 72
Time: 4/4
Grid: 16
Subtitle: Two diddles followed by an accented release
ST | R-L-R---L-R-L---
SD | d-d-O---d-d-O---`
  },

  {
    id: "rudiment-flam-accent",
    name: "Flam accent",
    category: "rudiments",
    source: `Title: Flam accent
Tempo: 72
Time: 4/4
Grid: 16
Subtitle: Alternating flam accents in triplets
ST | 3(RLR)3(LRL)3(RLR)3(LRL)
SD | 3(foo)3(foo)3(foo)3(foo)`
  },

  {
    id: "rudiment-flam-tap",
    name: "Flam tap",
    category: "rudiments",
    source: `Title: Flam tap
Tempo: 72
Time: 4/4
Grid: 16
Subtitle: Alternating flam and same-hand tap pairs
ST | R-R-L-L-R-R-L-L-
SD | f-o-f-o-f-o-f-o-`
  },

  {
    id: "rudiment-drag",
    name: "Drag",
    category: "rudiments",
    source: `Title: Drag
Tempo: 68
Time: 4/4
Grid: 16
Subtitle: Alternating drags and taps
ST | R-L-R-L-R-L-R-L-
SD | r-o-r-o-r-o-r-o-`
  },

  {
    id: "rudiment-buzz-roll",
    name: "Buzz roll",
    category: "rudiments",
    source: `Title: Buzz roll
Tempo: 68
Time: 4/4
Grid: 16
Subtitle: Overlapping buzz strokes ending with a clean release
ST | R-L-R-L-R-L-R-L-
SD | z-z-z-z-z-z-z-o-`
  },

  {
    id: "sticking-lane",
    name: "Sticking lane",
    category: "notation-features",
    source: `Title: Sticking lane
Tempo: 100
Time: 4/4
Grid: 16
ST | R-L-B-L-R-L-B-L-
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-------`
  },

  {
    id: "system-subtitles",
    name: "System subtitles",
    category: "notation-features",
    source: `Title: System subtitles
Tempo: 100
Time: 4/4
Grid: 16
Subtitle: Main groove
ST | L-R-L-R-L-R-L-R- | R-L-B-L-R-L-B-L-
HH | x-x-x-x-x-x-x-x- | x-x-x-x-x-x-x-x-
SD | ----o-------o--- | ----o-------o---
BD | o-------o------- | o-------o-------
Bar
Subtitle: Descending tom fill from the high tom to the floor tom, finishing on the snare
ST | RLRLRLRLRLRLRLRL
HT | oooo------------
MT | ----oooo--------
FT | --------oooo----
SD | ------------oooo
BD | o-------o-------`
  },

  {
    id: "one-bar-repeat",
    name: "One-bar repeat",
    category: "notation-features",
    source: `Title: One-bar repeat
Tempo: 100
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-------
%`
  },

  {
    id: "counted-repeat",
    name: "Counted repeat",
    category: "notation-features",
    source: `Title: Counted repeat
Tempo: 100
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-------
%x3`
  },

  {
    id: "basic-section-repeat",
    name: "Basic section repeat",
    category: "notation-features",
    source: `Title: Basic section repeat
Tempo: 100
Time: 4/4
Grid: 16
HH [ x-x-x-x-x-x-x-x- | x-x-x-x-x-x-x-x- ]
SD [ ----o-------o--- | ----o-------o--- ]
BD [ o-------o-o----- | o-----o-o------- ]`
  },

  {
    id: "cross-system-section-repeat",
    name: "Cross-system section repeat",
    category: "notation-features",
    source: `Title: Cross-system section repeat
Tempo: 96
Time: 4/4
Grid: 16
Subtitle: Intro and repeat start
HH | x-x-x-x-x-x-x-x- [ x-x-x-x-x-x-x-x-
SD | ----o-------o--- [ ----o-------o---
BD | o-------o------- [ o-----o-o-------

Bar
Subtitle: Repeat end and outro
HH | x-x-x-x-x-x-x-x- ] x-x-x-x-x-x-x-x-
SD | ----o-------o--- ] ----o-o-----o---
BD | o-------o-o----- ] o---------o-----`
  },

  {
    id: "section-repeat-with-compact-repeats",
    name: "Section repeat with compact repeats",
    category: "notation-features",
    source: `Title: Section repeat with compact repeats
Tempo: 90
Time: 4/4
Grid: 16
HH [ x-x-x-x-x-x-x-x-
SD [ ----o-------o---
BD [ o-------o-o-----
%x3
HH | x-x-x-x-x-x-x-x- ]
SD | ----o-o-----o--- ]
BD | o---------o----- ]`
  },

  {
    id: "articulations",
    name: "Articulations",
    category: "notation-features",
    source: `Title: Articulations
CC | c---------------
HH | x-x-x-x-x-x-x-x-
SD | g-O-f-r-d-z-g-O-
BD | o-------o-------`
  },

  {
    id: "open-and-half-open-hats",
    name: "Open and half-open hats",
    category: "notation-features",
    source: `Title: Open & half-open hats
OH | x-------x-------
HO | ----x-------x---
HH | --x---x---x---x-
SD | ----o-------o---
BD | o-------o-------`
  },

  {
    id: "split-drum-voicing",
    name: "Split drum voicing",
    category: "notation-features",
    source: `Title: Split drum voicing
Tempo: 96
Time: 4/4
Grid: 16
Voicing: split
Subtitle: Hands stem up; feet stem down
ST  | R-L-R-L-R-L-R-L-
HH  | x-x-x-x-x-x-x-x-
SD  | ----o-------o---
BD  | o-----o-o-------
BD2 | ----------o-----
HF  | ------------x---`
  },

  {
    id: "split-voicing-with-rests",
    name: "Split voicing with rests",
    category: "notation-features",
    source: `Title: Split voicing with rests
Tempo: 80
Time: 4/4
Grid: 16
Voicing: split
Rests: on
Subtitle: Shared rests appear once across both voices
HH | x-x-x-x--------- | ----x-----------
SD | ----o----------- | ------------o---
BD | o--------------- | --------o-------
HF | ---------------- | --------------x-`
  },

  {
    id: "cymbal-synth-test",
    name: "Cymbal synth test",
    category: "sounds-and-advanced",
    source: `Title: Cymbal synth test
Tempo: 90
Time: 4/4
Grid: 16
Cursor: on
Subtitle: Single hits: compare normal and accented Ride, Ride bell, Crash, and Cowbell
RD | x--------------- | X---------------
RB | ----x----------- | ----X-----------
CR | --------x------- | --------X-------
CB | ------------x--- | ------------X---

Bar
Subtitle: Repeated ride pattern, ride bell pings, crash wash, and choked crash
RD | --x---x-x-x---x- | --x---x-X-x---x-
RB | ----x-------x--- | ----X-------x---
CR | x--------------- | c---------------
CB | ---------------- | ----------------`
  },

  {
    id: "32nd-note-fill",
    name: "32nd-note fill",
    category: "sounds-and-advanced",
    source: `Title: 32nd-note fill
Tempo: 90
Time: 4/4
Grid: 32
Subtitle: Groove
HH | x---x---x---x---x---x---x---x---
SD | --------o---------------o-------
BD | o---------------o---o-----------
Bar
Subtitle: Fill: 32nd bursts down the toms
CR | ----------------------------x---
SD | o-o-o-o-oooo--------------------
HT | ------------oooo----------------
MT | ----------------oooo------------
LT | --------------------oooo--------
FT | ------------------------oooo----
BD | o---------------------------o---`
  },

  {
    id: "full-kit-legend",
    name: "Full kit legend",
    category: "sounds-and-advanced",
    source: `Title: Full kit
Legend: all
CR    | x-------c------- | ----------------
RD    | ----x----------- | ----x-----------
HH    | --x---x---x---x- | --x---x---x---x-
HFS   | ---------------- | ----x-----------
SD    | ----o-------o--- | ----o---o---o---
HT    | ---------------- | --------o-------
MT    | ---------------- | ----------o-----
FT    | ---------------- | ------------o---
BD    | o-------o-o----- | o-------o-------
BD2   | ---------------- | ----o-----------`
  }
] satisfies readonly PlaygroundExample[];

export function getPlaygroundExample(id: string): PlaygroundExample | undefined {
  return PLAYGROUND_EXAMPLES.find((example) => example.id === id);
}
