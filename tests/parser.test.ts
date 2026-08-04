import { describe, expect, it } from "vitest";
import { getBarRange } from "../src/music";
import { getTitle, parseDrumBlock, parseDrumBlockWithWarnings } from "../src/parser";
import { serializeDrumBlock } from "../src/serializer";

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
    expect(block.showRests).toBe(true);
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
Rests: hide
HH | x-x-x-x-x-x-x-x-`);

  it("clamps and normalizes settings", () => {
    expect(block.tempo).toBe(260);
    expect(block.timeSignature).toBe("6/8");
    expect(block.repeatCount).toBe(4);
    expect(block.gridResolution).toBe(32);
    expect(block.legendMode).toBe("all");
    expect(block.showCursor).toBe(false);
    expect(block.showHighlight).toBe(false);
    expect(block.showRests).toBe(false);
  });

  it.each(["on", "show", "true", "yes", "1"])("accepts Rests: %s as visible", (value) => {
    expect(parseDrumBlock(`Rests: ${value}\nHH | x---`).showRests).toBe(true);
  });

  it.each(["off", "hide", "false", "no", "0"])("accepts Rests: %s as hidden", (value) => {
    expect(parseDrumBlock(`Rests: ${value}\nHH | x---`).showRests).toBe(false);
  });

  it("warns and uses visible rests for an invalid value", () => {
    const parsed = parseDrumBlockWithWarnings(`Rests: maybe
HH | x---`);

    expect(parsed.block.showRests).toBe(true);
    expect(parsed.warnings).toContainEqual(
      expect.objectContaining({
        code: "invalid-setting",
        line: 1,
        message: expect.stringContaining("using on")
      })
    );
  });
});

describe("parseDrumBlock - explicit beam grouping", () => {
  it("parses grouping with flexible whitespace after the final Time value is known", () => {
    const block = parseDrumBlock(`Grouping: 2 + 2 + 3
Time: 7/8
HH | x-x-x-x-x-x-x-`);

    expect(block.beamGrouping).toEqual([2, 2, 3]);
    expect(block.metadata).not.toContain("Grouping: 2 + 2 + 3");
  });

  it.each([
    ["Grouping: two+two+three\nTime: 7/8", "positive whole numbers", 1],
    ["Grouping: 2+0+5\nTime: 7/8", "positive group sizes", 1],
    ["Grouping: 2+2\nTime: 7/8", "totals 4", 1],
    ["Time: 5/4\nGrouping: 3+2", "only for /8 and /16", 2]
  ])("warns and falls back for %s", (header, message, line) => {
    const parsed = parseDrumBlockWithWarnings(`${header}
HH | x---`);

    expect(parsed.block.beamGrouping).toBeUndefined();
    expect(parsed.warnings).toContainEqual(
      expect.objectContaining({
        code: "invalid-setting",
        line,
        message: expect.stringContaining(message)
      })
    );
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
    expect(hits[1]).toMatchObject({ articulation: "ghost", velocity: 0.2 });
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

describe("parseDrumBlock - system time signatures", () => {
  it("inherits Time and Grouping until a later system changes them", () => {
    const block = parseDrumBlock(`Time: 7/8
Grouping: 2+2+3
HH | x-x-x-x-x-x-x-

Bar
HH | x-x-x-x-x-x-x-

Bar
Time: 3/4
HH | x-x-x-x-x-x-

Bar
HH | x-x-x-x-x-x-`);

    expect(block.timeSignature).toBe("7/8");
    expect(block.systems.map((system) => system.timeSignature)).toEqual(["7/8", "7/8", "3/4", "3/4"]);
    expect(block.systems.map((system) => system.beamGrouping)).toEqual([[2, 2, 3], [2, 2, 3], undefined, undefined]);
    expect(block.bars.map((bar) => bar.timeSignature)).toEqual(["7/8", "7/8", "3/4", "3/4"]);
    expect(block.bars.map((bar) => bar.slots.length)).toEqual([14, 14, 12, 12]);
  });

  it("supports Grouping: auto and redundant effective declarations", () => {
    const block = parseDrumBlock(`Time: 7/8
Grouping: 2+2+3
HH | x-x-x-x-x-x-x-

Bar
Time: 7/8
HH | x-x-x-x-x-x-x-

Bar
Grouping: 3+2+2
HH | x-x-x-x-x-x-x-

Bar
Grouping: auto
HH | x-x-x-x-x-x-x-`);

    expect(block.systems.map((system) => system.beamGrouping)).toEqual([[2, 2, 3], undefined, [3, 2, 2], undefined]);
  });

  it("retains inherited meter and grouping after an invalid system Time", () => {
    const parsed = parseDrumBlockWithWarnings(`Time: 7/8
Grouping: 2+2+3
HH | x-x-x-x-x-x-x-

Bar
Time: nope
HH | x-x-x-x-x-x-x-`);

    expect(parsed.block.systems.map((system) => system.timeSignature)).toEqual(["7/8", "7/8"]);
    expect(parsed.block.systems.map((system) => system.beamGrouping)).toEqual([[2, 2, 3], [2, 2, 3]]);
    expect(parsed.warnings).toEqual([
      expect.objectContaining({ code: "invalid-setting", line: 6, message: expect.stringContaining("keeping 7/8") })
    ]);
  });

  it("uses each system meter for row-length warnings", () => {
    const parsed = parseDrumBlockWithWarnings(`Time: 4/4
HH | x-x-x-x-x-x-x-x-

Bar
Time: 3/4
HH | x-x-x-x-x-x-x-x-`);

    expect(parsed.warnings).toEqual([
      expect.objectContaining({
        code: "row-length-mismatch",
        line: 6,
        message: expect.stringContaining("Time 3/4 + Grid 16 expects 12")
      })
    ]);
  });

  it("interprets meter-relative tuplets using each system's meter", () => {
    const block = parseDrumBlock(`Time: 4/4
HH | 3(xxx)
Bar
Time: 6/8
HH | 3(xxx)`);

    expect(block.systems[0].bars[0].rhythmRegions[0].durationQuarter).toBe(1);
    expect(block.systems[1].bars[0].rhythmRegions[0].durationQuarter).toBe(0.5);
  });

  it("warns for late system settings but applies them to the whole system", () => {
    const parsed = parseDrumBlockWithWarnings(`HH | x-x-x-x-x-x-
Time: 3/4`);

    expect(parsed.block.timeSignature).toBe("3/4");
    expect(parsed.block.systems[0].timeSignature).toBe("3/4");
    expect(parsed.warnings).toEqual([
      expect.objectContaining({ code: "late-system-setting", line: 2 })
    ]);
  });

  it("rejects a repeat across different effective meters", () => {
    const parsed = parseDrumBlockWithWarnings(`Time: 4/4
HH | x-x-x-x-x-x-x-x-

Bar
Time: 3/4
%`);

    expect(parsed.block.bars).toHaveLength(1);
    expect(parsed.warnings).toEqual([
      expect.objectContaining({ code: "repeat-meter-mismatch", line: 6 })
    ]);
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

  it("supports counted one-bar repeats through 99", () => {
    const block = parseDrumBlock("HH | x---\n%x99");

    expect(block.bars).toHaveLength(100);
    expect(block.bars[1]).toMatchObject({ measureRepeat: 1, measureRepeatCount: 99 });
    expect(serializeDrumBlock(block)).toBe("HH | x---\n%x99");
  });

  it("can repeat the previous bar across a system separator", () => {
    const block = parseDrumBlock(`HH | x---
Bar
%`);

    expect(block.systems).toHaveLength(2);
    expect(block.bars[1].measureRepeat).toBe(1);
    expect(block.bars[1].rows[0].pattern).toBe("x---");
  });

  it("keeps a normal bar after a cross-system repeat visible and separately playable", () => {
    const block = parseDrumBlock(`HH | x---
Bar
%
HH | --x-
SD | -o--`);

    expect(block.systems.map((system) => system.bars.length)).toEqual([1, 2]);
    expect(block.systems[1].bars.map((bar) => bar.measureRepeat)).toEqual([1, undefined]);
    expect(block.slots[5].hits).toEqual([]);
    expect(block.slots[9].hits.map((hit) => hit.instrument.id)).toEqual(["snare"]);
    expect(block.slots[10].hits.map((hit) => hit.instrument.id)).toEqual(["closed-hat"]);
  });

  it("copies sticking into repeated bars for playback/model consistency", () => {
    const block = parseDrumBlock(`ST | R-B-
HH | x---
%`);

    expect(block.bars[1]).toMatchObject({ measureRepeat: 1, stickingPattern: "R-B-" });
    expect(block.slots.slice(4, 8).map((slot) => slot.sticking)).toEqual(["right", undefined, "both", undefined]);
  });

  it("keeps normal bars after a repeat separate on the same system", () => {
    const block = parseDrumBlock(`ST | R---
HH | x---
%
ST | --L-
HH | --x-
SD | -o--`);

    expect(block.systems).toHaveLength(1);
    expect(block.systems[0].bars).toHaveLength(3);
    expect(block.bars.map((bar) => bar.measureRepeat)).toEqual([undefined, 1, undefined]);
    expect(block.bars[2].rows.map((row) => [row.instrument.id, row.pattern])).toEqual([
      ["closed-hat", "--x-"],
      ["snare", "-o--"]
    ]);
    expect(block.slots[4].hits.map((hit) => hit.instrument.id)).toEqual(["closed-hat"]);
    expect(block.slots[5].hits).toEqual([]);
    expect(block.slots[9].hits.map((hit) => hit.instrument.id)).toEqual(["snare"]);
    expect(block.slots[10]).toMatchObject({
      sticking: "left",
      hits: [{ instrument: expect.objectContaining({ id: "closed-hat" }) }]
    });
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

  it("warns for a 17-slot row in 4/4 Grid 16", () => {
    const source = `Time: 4/4
Grid: 16
SD | ooooooooooooooooo`;
    const parsed = parseDrumBlockWithWarnings(source);

    expect(parsed.block).toEqual(parseDrumBlock(source));
    expect(parsed.warnings).toEqual([
      expect.objectContaining({
        code: "row-length-mismatch",
        line: 3,
        message: "SD row bar 1 has 17 slots; Time 4/4 + Grid 16 expects 16. Extra slots extend the bar and can change playback feel."
      })
    ]);
  });

  it("warns for a short row when another row in the same bar has the expected length", () => {
    const parsed = parseDrumBlockWithWarnings(`HH | x-x-x-x-x-x-x-x-
BD | o-------o------`);

    expect(parsed.warnings).toEqual([
      expect.objectContaining({
        code: "row-length-mismatch",
        line: 2,
        message: "BD row bar 1 has 15 slots; Time 4/4 + Grid 16 expects 16. Missing slots are treated as rests when another row sets the bar length."
      })
    ]);
  });

  it("warns for near-full Grid 32 row-length mismatches", () => {
    const parsed = parseDrumBlockWithWarnings(`Grid: 32
SD | ooooooooooooooooooooooooooooooo
BD | ooooooooooooooooooooooooooooooooo`);

    expect(parsed.warnings).toEqual([
      expect.objectContaining({
        code: "row-length-mismatch",
        line: 2,
        message: expect.stringContaining("has 31 slots; Time 4/4 + Grid 32 expects 32")
      }),
      expect.objectContaining({
        code: "row-length-mismatch",
        line: 3,
        message: expect.stringContaining("has 33 slots; Time 4/4 + Grid 32 expects 32")
      })
    ]);
  });

  it("uses Time and Grid to calculate expected row lengths", () => {
    const parsedSixEight = parseDrumBlockWithWarnings(`Time: 6/8
Grid: 16
HH | xxxxxxxxxxxxx`);
    const parsedTwelveEight = parseDrumBlockWithWarnings(`Time: 12/8
Grid: 16
HH | xxxxxxxxxxxxxxxxxxxxxxxxx`);

    expect(parsedSixEight.warnings).toEqual([
      expect.objectContaining({
        code: "row-length-mismatch",
        line: 3,
        message: expect.stringContaining("has 13 slots; Time 6/8 + Grid 16 expects 12")
      })
    ]);
    expect(parsedTwelveEight.warnings).toEqual([
      expect.objectContaining({
        code: "row-length-mismatch",
        line: 3,
        message: expect.stringContaining("has 25 slots; Time 12/8 + Grid 16 expects 24")
      })
    ]);
  });

  it("warns for sticking row length mismatches", () => {
    const parsed = parseDrumBlockWithWarnings(`ST | R-L-R-L-R-L-R-L-R
HH | x-x-x-x-x-x-x-x-`);

    expect(parsed.warnings).toEqual([
      expect.objectContaining({
        code: "row-length-mismatch",
        line: 1,
        message: expect.stringContaining("Sticking row bar 1 has 17 slots; Time 4/4 + Grid 16 expects 16")
      })
    ]);
  });

  it("reports the inline bar number for row-length mismatches", () => {
    const parsed = parseDrumBlockWithWarnings(`HH | x-x-x-x-x-x-x-x- | x-x-x-x-x-x-x-x-
SD | ----o-------o--- | ----o-------o----`);

    expect(parsed.warnings).toEqual([
      expect.objectContaining({
        code: "row-length-mismatch",
        line: 2,
        message: expect.stringContaining("SD row bar 2 has 17 slots")
      })
    ]);
  });

  it("does not warn for short shorthand bars", () => {
    const parsedSingle = parseDrumBlockWithWarnings("HH | x---");
    const parsedMatchedRows = parseDrumBlockWithWarnings(`HH | x---
SD | --o-`);

    expect(parsedSingle.warnings).toEqual([]);
    expect(parsedMatchedRows.warnings).toEqual([]);
  });

  it("does not duplicate row-length warnings for generated repeat bars", () => {
    const parsed = parseDrumBlockWithWarnings(`HH | xxxxxxxxxxxxxxxxx
%x3`);

    expect(parsed.warnings).toEqual([
      expect.objectContaining({
        code: "row-length-mismatch",
        line: 1
      })
    ]);
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
