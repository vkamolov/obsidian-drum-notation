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
HH | x-x-x-x-x-x-x-x-
SD | g-O-f-d-z-g-O---
BD | o-------o-------`,

  "Open & half-open hats": `Title: Open & half-open hats
OH | x-------x-------
HO | ----x-------x---
HH | --x---x---x---x-
SD | ----o-------o---
BD | o-------o-------`,

  "32nd-note fill": `Title: 32nd-note fill
Grid: 32
SD | o-o-oo-oo-o-oo-oo-o-oo-oo-o-oo-o
BD | o-------------------------------`,

  "Full kit legend": `Title: Full kit
Legend: all
CR    | x--------------- | ----------------
RD    | ----x----------- | ----x-----------
HH    | --x---x---x---x- | --x---x---x---x-
SD    | ----o-------o--- | ----o---o---o---
HT    | ---------------- | --------o-------
MT    | ---------------- | ----------o-----
FT    | ---------------- | ------------o---
BD    | o-------o-o----- | o-------o-------`
};
