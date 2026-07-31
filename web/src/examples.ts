// Starter patterns for the playground dropdown. Each is valid `drums` text.
export const EXAMPLES: Record<string, string> = {
  "Basic rock groove": `Title: Basic rock groove
Tempo: 100
Time: 4/4
Count: 1 e & a 2 e & a 3 e & a 4 e & a
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-o-----`,

  "Groove with fill": `Title: Groove with fill
Tempo: 110
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-o-----
Bar
HT | --------o-o-----
MT | ------------o-o-
SD | o-o-o-o---------
BD | o-------o-------`,

  "Syncopated funk": `Title: Syncopated funk
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
BD | o--o--o---------`,

  "Rests and off-beats": `Title: Rests and off-beats
Time: 4/4
Grid: 16
HH | x-x-x-x-x------- | ----x----------- | x-x-----x-x-----`,

  "6/8 ballad": `Title: 6/8 ballad
Tempo: 66
Time: 6/8
Count: 1 2 3 4 5 6
HH | x-x-x-x-x-x- | x-x-x-x-x-x-
SD | ------o----- | ------o-----
BD | o----------- | o---o-------`,

  "7/8 groove": `Title: 7/8 groove
Tempo: 104
Time: 7/8
Grouping: 2+2+3
Count: 1 2 3 4 5 6 7
Subtitle: Grouped 2 + 2 + 3
HH | x-x-x-x-x-x-x-
SD | ----o-------o-
BD | o---o---o-----`,

  "9/8 groove": `Title: 9/8 groove
Tempo: 92
Time: 9/8
Count: 1 2 3 4 5 6 7 8 9
HH | x-x-x-x-x-x-x-x-x-
SD | ------o-----------
BD | o-----------o-----`,

  "12/8 blues shuffle": `Title: 12/8 blues shuffle
Tempo: 90
Time: 12/8
Count: 1 & a 2 & a 3 & a 4 & a
RD | x-x-x-x-x-x-x-x-x-x-x-x-
SD | ------o-----------o-----
BD | o-----------o-----------`,

  "Triplet fill": `Title: Triplet fill
Tempo: 100
Time: 4/4
Grid: 16
Subtitle: Straight groove ending with one beat of triplets
HH | x-x-x-x-x-x-3(xxx)
SD | ----o-------3(ooo)
BD | o-------o---3(---)`,

  "Triplet shuffle": `Title: Triplet shuffle
Tempo: 92
Time: 4/4
Grid: 16
Subtitle: Each written quarter-note beat is divided into three
HH | 3(x-x)3(x-x)3(x-x)3(x-x)
SD | 3(---)3(o--)3(---)3(o--)
BD | 3(o--)3(---)3(o--)3(---)`,

  "Partial-beat tuplets": `Title: Partial-beat tuplets
Tempo: 92
Time: 4/4
Grid: 16
Subtitle: Three equal notes in the first eighth-note duration of each beat
HH | 3@8(xxx)--3@8(xxx)--3@8(xxx)--3@8(xxx)--
SD | 3@8(o--)--3@8(---)--3@8(o--)--3@8(---)--
BD | 3@8(---)o-3@8(---)o-3@8(---)o-3@8(---)o-`,

  "Mixed tuplets": `Title: Mixed tuplets
Tempo: 84
Time: 4/4
Grid: 16
Subtitle: Plain beat, triplet, explicit four, and quintuplet
ST | R-L-3(RLR)4(LRLR)5(RLRLR)
HH | x-x-3(x-x)4(x-x-)5(x-x-x)
SD | ----3(o--)4(--o-)5(o-o-o)
BD | o---3(---)4(o---)5(-----)
%x2`,

  "Sticking lane": `Title: Sticking lane
Tempo: 100
Time: 4/4
Grid: 16
ST | R-L-B-L-R-L-B-L-
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-------`,

  "System subtitles": `Title: System subtitles
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
BD | o-------o-------`,

  "One-bar repeat (%)": `Title: One-bar repeat
Tempo: 100
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-------
%`,

  "Counted repeat (%x3)": `Title: Counted repeat
Tempo: 100
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-------
%x3`,

  "Articulations": `Title: Articulations
CC | c---------------
HH | x-x-x-x-x-x-x-x-
SD | g-O-f-r-d-z-g-O-
BD | o-------o-------`,

  "Open & half-open hats": `Title: Open & half-open hats
OH | x-------x-------
HO | ----x-------x---
HH | --x---x---x---x-
SD | ----o-------o---
BD | o-------o-------`,

  "Cymbal synth test": `Title: Cymbal synth test
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
CB | ---------------- | ----------------`,

  "32nd-note fill": `Title: 32nd-note fill
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
BD | o---------------------------o---`,

  "Full kit legend": `Title: Full kit
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
};
