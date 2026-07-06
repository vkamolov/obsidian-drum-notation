import { describe, expect, it } from "vitest";
import { getBarRange } from "../src/music";
import { getTitle, parseDrumBlock, parseDrumBlockWithWarnings } from "../src/parser";

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
  const block = parseDrumBlock("SD | Ogfrdzc-");

  it("records articulation and velocity per character", () => {
    const hits = block.slots.map((slot) => slot.hits[0]);
    expect(hits[0]).toMatchObject({ articulation: "accent", velocity: 1 });
    expect(hits[1]).toMatchObject({ articulation: "ghost", velocity: 0.4 });
    expect(hits[2]).toMatchObject({ articulation: "flam", velocity: 0.75 });
    expect(hits[3]).toMatchObject({ articulation: "drag", velocity: 0.75 });
    expect(hits[4]).toMatchObject({ articulation: "diddle", velocity: 0.75 });
    expect(hits[5]).toMatchObject({ articulation: "buzz", velocity: 0.68 });
    expect(hits[6]).toMatchObject({ articulation: "choke", velocity: 0.9 });
    expect(block.slots[7].hits).toHaveLength(0);
  });
});

describe("parseDrumBlock - hi-hat foot splash", () => {
  it("recognizes hi-hat foot splash as a separate foot-hat voice", () => {
    const block = parseDrumBlock(`HFS | x---
BD  | o---`);

    expect(block.rows[0].instrument.id).toBe("hi-hat-foot-splash");
    expect(block.rows[0].instrument.playback).toBe("hatFootSplash");
    expect(block.slots[0].hits.map((hit) => hit.instrument.id)).toEqual(["hi-hat-foot-splash", "kick"]);
  });
});

describe("parseDrumBlock - second kick", () => {
  it("recognizes a second bass drum row for double-pedal notation", () => {
    const block = parseDrumBlock(`BD  | o---
BD2 | --o-`);

    expect(block.rows[1].instrument.id).toBe("second-kick");
    expect(block.rows[1].instrument.playback).toBe("kick");
    expect(block.rows[1].instrument.vexKey).toBe("d/4");
    expect(block.slots[2].hits.map((hit) => hit.instrument.id)).toEqual(["second-kick"]);
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

describe("parseDrumBlock - system subtitles", () => {
  it("assigns one trimmed subtitle to each rendered system", () => {
    const block = parseDrumBlock(`Title: Sticking lane
Subtitle:   First line
HH | x--- | --x-
SD | --o- | ----
Bar
sUbTiTlE: Second line
HH | x---
SD | --o-`);

    expect(block.systems).toHaveLength(2);
    expect(block.systems[0]).toMatchObject({ subtitle: "First line" });
    expect(block.systems[0].bars).toHaveLength(2);
    expect(block.systems[1]).toMatchObject({ subtitle: "Second line" });
    expect(block.metadata).not.toContain("Subtitle: First line");
  });

  it("uses the last non-empty subtitle and omits empty subtitles", () => {
    const block = parseDrumBlock(`Subtitle: First
HH | x---
Subtitle:
Subtitle: Final
Bar
Subtitle:
SD | --o-`);

    expect(block.systems[0].subtitle).toBe("Final");
    expect(block.systems[1].subtitle).toBeUndefined();
  });
});

describe("parseDrumBlock - sticking rows", () => {
  it("recognizes sticking row aliases before instrument rows", () => {
    ["ST", "Stick", "Sticking", "Hands"].forEach((label) => {
      const block = parseDrumBlock(`${label} | Rl-b\nHH | x---`);

      expect(block.rows).toHaveLength(1);
      expect(block.slots.map((slot) => slot.sticking)).toEqual(["right", "left", undefined, "both"]);
    });
  });

  it("keeps sticking display-only without adding hits", () => {
    const block = parseDrumBlock(`ST | R-B-
SD | --o-`);

    expect(block.bars[0].stickingPattern).toBe("R-B-");
    expect(block.slots[0]).toMatchObject({ sticking: "right", hits: [] });
    expect(block.slots[2]).toMatchObject({ sticking: "both" });
    expect(block.slots[2].hits.map((hit) => hit.instrument.id)).toEqual(["snare"]);
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

  it("copies sticking into repeated bars for playback/model consistency", () => {
    const block = parseDrumBlock(`ST | R-B-
HH | x---
%`);

    expect(block.bars[1]).toMatchObject({ measureRepeat: 1, stickingPattern: "R-B-" });
    expect(block.slots.slice(4, 8).map((slot) => slot.sticking)).toEqual(["right", undefined, "both", undefined]);
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

describe("parseDrumBlockWithWarnings", () => {
  it("returns the same parsed block plus advisory warnings", () => {
    const source = `Foo | x-x-
HH | x-x-`;
    const parsed = parseDrumBlockWithWarnings(source);

    expect(parsed.block).toEqual(parseDrumBlock(source));
    expect(Object.prototype.hasOwnProperty.call(parseDrumBlock(source), "warnings")).toBe(false);
    expect(parsed.warnings).toEqual([
      expect.objectContaining({
        code: "unknown-row-label",
        line: 1,
        message: expect.stringContaining("Foo")
      })
    ]);
  });

  it("warns for empty known rows without changing parseDrumBlock behavior", () => {
    const source = `HH |
ST |
SD | --o-`;
    const parsed = parseDrumBlockWithWarnings(source);

    expect(parsed.block).toEqual(parseDrumBlock(source));
    expect(parsed.warnings.map((warning) => warning.code)).toEqual(["empty-row", "empty-row"]);
    expect(parsed.warnings.map((warning) => warning.line)).toEqual([1, 2]);
  });

  it("warns when repeat notation has no previous bar", () => {
    const parsed = parseDrumBlockWithWarnings(`%
HH | x---`);

    expect(parsed.block.metadata).toContain("%");
    expect(parsed.warnings).toEqual([
      expect.objectContaining({
        code: "repeat-without-previous-bar",
        line: 1
      })
    ]);
  });

  it("warns for invalid or clamped parser-affecting settings", () => {
    const parsed = parseDrumBlockWithWarnings(`Tempo: 999
Time: four/four
Repeat: none
Cursor: maybe
Highlight: maybe
Legend: maybe
Grid: 24
HH | x---`);

    expect(parsed.block).toEqual(parseDrumBlock(`Tempo: 999
Time: four/four
Repeat: none
Cursor: maybe
Highlight: maybe
Legend: maybe
Grid: 24
HH | x---`));
    expect(parsed.warnings.map((warning) => warning.code)).toEqual([
      "clamped-setting",
      "invalid-setting",
      "invalid-setting",
      "invalid-setting",
      "invalid-setting",
      "invalid-setting",
      "invalid-setting"
    ]);
    expect(parsed.warnings.map((warning) => warning.line)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("warns for unsupported drum and sticking characters with original line numbers", () => {
    const parsed = parseDrumBlockWithWarnings(`

SD | --?-
ST | R?B-
HH | x---`);

    expect(parsed.block.slots[2].hits[0]).toMatchObject({ instrument: expect.objectContaining({ id: "snare" }), articulation: "normal" });
    expect(parsed.block.bars[0].stickingPattern).toBe("R-B-");
    expect(parsed.warnings).toEqual([
      expect.objectContaining({
        code: "unsupported-pattern-character",
        line: 3,
        column: 8
      }),
      expect.objectContaining({
        code: "unsupported-sticking-character",
        line: 4,
        column: 7
      })
    ]);
  });

  it("warns for removed settings but preserves them as metadata", () => {
    const parsed = parseDrumBlockWithWarnings(`Engraving: classic
HH | x---`);

    expect(parsed.block.metadata).toContain("Engraving: classic");
    expect(parsed.warnings).toEqual([
      expect.objectContaining({
        code: "removed-setting",
        line: 1
      })
    ]);
  });

  it("does not warn for unknown metadata without row syntax", () => {
    const parsed = parseDrumBlockWithWarnings(`Title:
Comment: free text
HH | x---`);

    expect(parsed.warnings).toEqual([]);
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
