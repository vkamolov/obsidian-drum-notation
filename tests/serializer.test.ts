import { describe, expect, it } from "vitest";
import { parseDrumBlock } from "../src/parser";
import { serializeDrumBlock } from "../src/serializer";

// The serializer's contract is MODEL-level, not text-level. We assert that the
// parsed model survives a serialize round-trip and that serialization is
// idempotent. Byte equality with the input is explicitly NOT expected: the
// serializer normalizes characters, drops default settings, and regularizes
// whitespace.
const roundTrips = (source: string) => {
  const block = parseDrumBlock(source);
  const once = serializeDrumBlock(block);

  // Model survives serialize -> parse unchanged.
  expect(parseDrumBlock(once)).toEqual(block);

  // Output is stable: serializing the re-parsed text reproduces it exactly.
  expect(serializeDrumBlock(parseDrumBlock(once))).toBe(once);

  return once;
};

describe("serializeDrumBlock - round-trip and idempotence", () => {
  it("round-trips a basic groove with header settings and metadata", () => {
    roundTrips(`Title: Basic rock groove
Tempo: 120
Time: 4/4
Count: 1 e & a 2 e & a 3 e & a 4 e & a
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-o-----`);
  });

  it("round-trips and canonically serializes explicit beam grouping", () => {
    const out = roundTrips(`Grouping: 2 + 2 + 3
Time: 7/8
HH | x-x-x-x-x-x-x-`);

    expect(out).toContain("Time: 7/8");
    expect(out).toContain("Grouping: 2+2+3");
    expect(out).not.toContain("2 + 2 + 3");
  });

  it("preserves unknown metadata and removed settings verbatim", () => {
    const block = parseDrumBlock(`Engraving: classic
Author: Jane
HH | x---`);

    expect(serializeDrumBlock(block)).toContain("Engraving: classic");
    expect(serializeDrumBlock(block)).toContain("Author: Jane");
    roundTrips(`Engraving: classic
Author: Jane
HH | x---`);
  });

  it("normalizes accent/ghost/flam/drag/diddle/buzz/choke to canonical characters", () => {
    const out = roundTrips("SD | Ogfrdzc-");
    expect(out).toContain("SD | Ogfrdzc-");
  });

  it("normalizes hit characters to notehead convention without changing the model", () => {
    // ">" and "!" are accents; "X" on a drum row is also an accent. They all
    // collapse to the canonical accent glyph for the row's notehead.
    const out = serializeDrumBlock(parseDrumBlock("SD | >!Xo\nHH | XXxo"));
    expect(out).toContain("SD | OOOo");
    expect(out).toContain("HH | XXxx");
  });

  it("round-trips hi-hat foot splash rows as cross-notehead hits", () => {
    const out = roundTrips("HFS | xX--\nBD  | o---");

    expect(out).toContain("HFS | xX--");
  });

  it("round-trips ride bell rows as cymbal-style text despite diamond rendering", () => {
    const out = roundTrips("RB | xX--\nCB | x---");

    expect(out).toContain("RB | xX--");
    expect(out).toContain("CB | x---");
  });

  it("round-trips second kick rows as drum-notehead hits", () => {
    const out = roundTrips("BD  | o---\nBD2 | --O-");

    expect(out).toContain("BD2 | --O-");
  });

  it("round-trips choked cymbal hits with the choke character", () => {
    const out = roundTrips("CC | c---\nBD | o---");

    expect(out).toContain("CC | c---");
  });

  it("round-trips multiple bars within one system", () => {
    const out = roundTrips("HH | x-x- | x-x-\nSD | ----o--- | ----o---");
    expect(out).toContain("HH | x-x- | x-x-");
  });

  it("round-trips and canonicalizes sticking rows", () => {
    const out = roundTrips("Stick | rlb_\nHH    | x---");

    expect(out).toBe("ST | RLB-\nHH | x---");
  });

  it("serializes multi-bar and multi-system sticking rows", () => {
    const out = roundTrips(`ST | R-B- | L-R-
HH | x--- | --x-
Bar
Hands | L-B-
SD    | --o-`);

    expect(out).toBe(`ST | R-B- | L-R-
HH | x--- | --x-
Bar
ST | L-B-
SD | --o-`);
  });

  it("round-trips rows that span different numbers of bars", () => {
    roundTrips("HH | x-x-\nSD | ----o--- | ----o---");
  });

  it("round-trips multiple systems split by a Bar separator", () => {
    const out = roundTrips(`HH | x-x-
Bar
HH | -x-x`);
    expect(out.split("\n")).toContain("Bar");
  });

  it("round-trips system subtitles and places them before system rows", () => {
    const out = roundTrips(`HH | x--- | --x-
Subtitle: First line
Bar
SD | --o-
SUBTITLE: Second line`);

    expect(out).toBe(`Subtitle: First line
HH | x--- | --x-
Bar
Subtitle: Second line
SD | --o-`);
  });

  it("round-trips one-bar repeat symbols without expanding them", () => {
    const out = roundTrips(`HH | x-x-
SD | --o-
%`);

    expect(out).toBe(`HH | x-x-
SD | --o-
%`);
  });

  it("round-trips counted one-bar repeats without expanding them", () => {
    const out = roundTrips(`HH | x---
%x3`);

    expect(out).toBe(`HH | x---
%x3`);
  });

  it("keeps repeat notation compact when the source bar has sticking", () => {
    const out = roundTrips(`ST | R-B-
HH | x---
%`);

    expect(out).toBe(`ST | R-B-
HH | x---
%`);
  });

  it("preserves separate one-bar repeats as separate lines", () => {
    const out = roundTrips(`HH | x---
%
%
%`);

    expect(out).toBe(`HH | x---
%
%
%`);
  });

  it("round-trips a normal bar after a repeat on the same system", () => {
    const out = roundTrips(`ST | R---
HH | x---
%
ST | --L-
HH | --x-
SD | -o--`);

    expect(out).toBe(`ST | R---
HH | x---
SD | ----
%
ST | --L-
HH | --x-
SD | -o--`);
  });

  it("round-trips a cross-system one-bar repeat", () => {
    const out = roundTrips(`HH | x---
Bar
%`);

    expect(out).toBe(`HH | x---
Bar
%`);
  });

  it("round-trips 32nd-note grids", () => {
    roundTrips(`Grid: 32
HH | xxxxxxxxxxxxxxxx`);
  });

  it("canonically serializes hidden rests and omits the visible default", () => {
    const hidden = roundTrips(`Rests: hide
HH | x---`);
    const visible = serializeDrumBlock(parseDrumBlock(`Rests: on
HH | x---`));

    expect(hidden).toBe(`Rests: off
HH | x---`);
    expect(visible).toBe("HH | x---");
  });

  it("drops settings left at their defaults", () => {
    const out = serializeDrumBlock(parseDrumBlock(`Tempo: 100
Time: 4/4
Cursor: off
Rests: on
HH | x---`));

    expect(out).not.toContain("Tempo");
    expect(out).not.toContain("Cursor");
    expect(out).not.toContain("Rests");
    expect(out).toBe("HH | x---");
  });

  it("can serialize an authoring block with visible playground settings", () => {
    const out = serializeDrumBlock(
      parseDrumBlock(`Title: Basic rock groove
Tempo: 100
Time: 4/4
Grid: 16
Count: 1 e & a 2 e & a 3 e & a 4 e & a
HH | x-x-
SD | --o-`),
      { mode: "authoring" }
    );

    expect(out).toBe(`Title: Basic rock groove
Tempo: 100
Time: 4/4
Grid: 16
Count: 1 e & a 2 e & a 3 e & a 4 e & a
HH | x-x-
SD | --o-`);
  });

  it("includes explicit beam grouping once in authoring mode", () => {
    const out = serializeDrumBlock(
      parseDrumBlock(`Title: Odd groove
Time: 7/8
Grouping: 2 + 2 + 3
HH | x-x-x-x-x-x-x-`),
      { mode: "authoring" }
    );

    expect(out).toContain("Time: 7/8\nGrouping: 2+2+3\nGrid: 16");
    expect(out.match(/^Grouping:/gm)).toHaveLength(1);
  });

  it("preserves system subtitles in authoring mode", () => {
    const out = serializeDrumBlock(
      parseDrumBlock(`Title: Practice
Tempo: 90
Subtitle: Verse
HH | x---
Bar
Subtitle: Fill
SD | oooo`),
      { mode: "authoring" }
    );

    expect(out).toBe(`Title: Practice
Tempo: 90
Time: 4/4
Grid: 16
Subtitle: Verse
HH | x---
Bar
Subtitle: Fill
SD | oooo`);
  });

  it("keeps non-default authoring settings visible once", () => {
    const out = serializeDrumBlock(
      parseDrumBlock(`Title: Loud
Tempo: 120
Time: 7/8
Repeat: 2
Grid: 32
Legend: used
Cursor: on
Rests: off
HH | x---`),
      { mode: "authoring" }
    );

    expect(out).toBe(`Title: Loud
Tempo: 120
Time: 7/8
Grid: 32
Repeat: 2
Legend: used
Cursor: on
Rests: off
HH | x---`);
  });

  it("serializes an empty block to an empty string", () => {
    expect(serializeDrumBlock(parseDrumBlock(""))).toBe("");
  });
});
