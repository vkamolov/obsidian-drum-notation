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
Grid: 32
SD | o-o-oo-oo-o-oo-oo-o-oo-oo-o-oo-o
BD | o-------------------------------`,

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
