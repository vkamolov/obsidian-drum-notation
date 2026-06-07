import { describe, expect, it } from "vitest";
import { getBarRange } from "../src/music";
import { getTitle, parseDrumBlock } from "../src/parser";

const TEMPLATE = `Title: Basic rock groove
Tempo: 100
Time: 4/4
Count: 1 e & a 2 e & a 3 e & a 4 e & a
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-o-----`;

describe("parseDrumBlock - defaults and basic structure", () => {
  const block = parseDrumBlock(TEMPLATE);

  it("reads the header settings", () => {
    expect(block.tempo).toBe(100);
    expect(block.timeSignature).toBe("4/4");
    expect(block.repeatCount).toBe(1);
    expect(block.gridResolution).toBe(16);
    expect(block.legendMode).toBe("off");
    expect(block.showCursor).toBe(false);
    expect(block.showHighlight).toBe(true);
  });

  it("builds one bar of sixteen slots from three rows", () => {
    expect(block.bars).toHaveLength(1);
    expect(block.rows).toHaveLength(3);
    expect(block.slots).toHaveLength(16);
  });

  it("collects the simultaneous hits per slot", () => {
    const firstSlotIds = block.slots[0].hits.map((hit) => hit.instrument.id);
    expect(firstSlotIds).toEqual(["closed-hat", "kick"]);

    const snareSlotIds = block.slots[4].hits.map((hit) => hit.instrument.id);
    expect(snareSlotIds).toEqual(["closed-hat", "snare"]);
  });

  it("keeps unrecognized setting lines as metadata for the title", () => {
    expect(getTitle(block)).toBe("Basic rock groove");
  });
});

describe("parseDrumBlock - setting parsing", () => {
  const block = parseDrumBlock(`Tempo: 300
Time: 6/8
Repeat: 4
Grid: 32
Legend: all
Cursor: off
Highlight: no
HH | x-x-x-x-x-x-x-x-`);

  it("clamps and normalizes settings", () => {
    expect(block.tempo).toBe(260);
    expect(block.timeSignature).toBe("6/8");
    expect(block.repeatCount).toBe(4);
    expect(block.gridResolution).toBe(32);
    expect(block.legendMode).toBe("all");
    expect(block.showCursor).toBe(false);
    expect(block.showHighlight).toBe(false);
  });
});

describe("parseDrumBlock - removed settings", () => {
  it("treats old Engraving lines as metadata instead of rendering options", () => {
    const block = parseDrumBlock(`Engraving: classic
HH | x---`);

    expect(block.metadata).toContain("Engraving: classic");
    expect(block.rows).toHaveLength(1);
  });
});

describe("parseDrumBlock - articulations", () => {
  const block = parseDrumBlock("SD | Ogfrdz-");

  it("records articulation and velocity per character", () => {
    const hits = block.slots.map((slot) => slot.hits[0]);
    expect(hits[0]).toMatchObject({ articulation: "accent", velocity: 1 });
    expect(hits[1]).toMatchObject({ articulation: "ghost", velocity: 0.4 });
    expect(hits[2]).toMatchObject({ articulation: "flam", velocity: 0.75 });
    expect(hits[3]).toMatchObject({ articulation: "drag", velocity: 0.75 });
    expect(hits[4]).toMatchObject({ articulation: "diddle", velocity: 0.75 });
    expect(hits[5]).toMatchObject({ articulation: "buzz", velocity: 0.68 });
    expect(block.slots[6].hits).toHaveLength(0);
  });
});

describe("parseDrumBlock - multiple bars", () => {
  it("splits a row into bars on the | segment separator", () => {
    const block = parseDrumBlock("HH | x-x- | x-x-");
    expect(block.bars).toHaveLength(2);
    expect(block.slots).toHaveLength(8);
    expect(block.bars[0].startSlot).toBe(0);
    expect(block.bars[1].startSlot).toBe(4);
  });

  it("splits into systems on an explicit Bar separator", () => {
    const block = parseDrumBlock(`HH | x-x-
Bar
HH | -x-x`);
    expect(block.systems).toHaveLength(2);
    expect(block.bars).toHaveLength(2);
    expect(block.slots).toHaveLength(8);
  });
});

describe("parseDrumBlock - measure repeats", () => {
  it("expands a one-bar repeat into playable slots and marks the bar", () => {
    const block = parseDrumBlock(`HH | x-x-
SD | --o-
%`);

    expect(block.bars).toHaveLength(2);
    expect(block.bars[1].measureRepeat).toBe(1);
    expect(block.bars[1].rows.map((row) => row.pattern)).toEqual(["x-x-", "--o-"]);
    expect(block.slots[4].hits.map((hit) => hit.instrument.id)).toEqual(["closed-hat"]);
    expect(block.slots[6].hits.map((hit) => hit.instrument.id)).toEqual(["closed-hat", "snare"]);
  });

  it("expands a counted one-bar repeat into multiple playable bars", () => {
    const block = parseDrumBlock(`HH | x---
%x3`);

    expect(block.bars).toHaveLength(4);
    expect(block.bars[1]).toMatchObject({ measureRepeat: 1, measureRepeatCount: 3 });
    expect(block.bars[2]).toMatchObject({ measureRepeat: 1 });
    expect(block.bars[2].measureRepeatCount).toBeUndefined();
    expect(block.bars[3]).toMatchObject({ measureRepeat: 1 });
    expect(block.slots).toHaveLength(16);
    expect([0, 4, 8, 12].map((slotIndex) => block.slots[slotIndex].hits[0]?.instrument.id)).toEqual([
      "closed-hat",
      "closed-hat",
      "closed-hat",
      "closed-hat"
    ]);
  });

  it("can repeat the previous bar across a system separator", () => {
    const block = parseDrumBlock(`HH | x---
Bar
%`);

    expect(block.systems).toHaveLength(2);
    expect(block.bars[1].measureRepeat).toBe(1);
    expect(block.bars[1].rows[0].pattern).toBe("x---");
  });
});

describe("parseDrumBlock - non-row lines", () => {
  it("ignores rows whose label is not a known instrument", () => {
    const block = parseDrumBlock(`Foo | x-x-
HH | x-x-`);
    expect(block.rows).toHaveLength(1);
    expect(block.rows[0].instrument.id).toBe("closed-hat");
  });
});

describe("getBarRange", () => {
  it("returns the declared bar containing a slot", () => {
    const block = parseDrumBlock(TEMPLATE);
    expect(getBarRange(block, 5)).toEqual({ startSlot: 0, endSlot: 16 });
  });

  it("returns the right bar for a multi-bar row", () => {
    const block = parseDrumBlock("HH | x-x- | x-x-");
    expect(getBarRange(block, 6)).toEqual({ startSlot: 4, endSlot: 8 });
  });
});
