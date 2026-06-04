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

  it("normalizes accent/ghost/flam/diddle/buzz to canonical characters", () => {
    const out = roundTrips("SD | Ogfdz-");
    expect(out).toContain("SD | Ogfdz-");
  });

  it("normalizes hit characters to notehead convention without changing the model", () => {
    // ">" and "!" are accents; "X" on a drum row is also an accent. They all
    // collapse to the canonical accent glyph for the row's notehead.
    const out = serializeDrumBlock(parseDrumBlock("SD | >!Xo\nHH | XXxo"));
    expect(out).toContain("SD | OOOo");
    expect(out).toContain("HH | XXxx");
  });

  it("round-trips multiple bars within one system", () => {
    const out = roundTrips("HH | x-x- | x-x-\nSD | ----o--- | ----o---");
    expect(out).toContain("HH | x-x- | x-x-");
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

  it("round-trips 32nd-note grids", () => {
    roundTrips(`Grid: 32
HH | xxxxxxxxxxxxxxxx`);
  });

  it("drops settings left at their defaults", () => {
    const out = serializeDrumBlock(parseDrumBlock(`Tempo: 100
Time: 4/4
Cursor: off
HH | x---`));

    expect(out).not.toContain("Tempo");
    expect(out).not.toContain("Cursor");
    expect(out).toBe("HH | x---");
  });

  it("serializes an empty block to an empty string", () => {
    expect(serializeDrumBlock(parseDrumBlock(""))).toBe("");
  });
});
