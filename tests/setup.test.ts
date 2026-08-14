import { describe, expect, it } from "vitest";
import { parseDrumBlock } from "../src/parser";
import {
  DEFAULT_DRUM_AUTHORING_DEFAULTS,
  getExplicitAuthoringHeaderKeys
} from "../src/authoring-defaults";
import {
  createInitialDrumBlock,
  DEFAULT_DRUM_SETUP_VALUES,
  formatDrumsFenceInsertion,
  getDrumSetupSlotCount,
  getDrumSetupValues,
  serializeInitialDrumBlock,
  wrapDrumsFence
} from "../src/setup";

describe("initial drum notation setup", () => {
  it("creates a default 16-slot 4/4 bar with empty starter rows", () => {
    const block = createInitialDrumBlock(DEFAULT_DRUM_SETUP_VALUES);

    expect(block.bars).toHaveLength(1);
    expect(block.slots).toHaveLength(16);
    expect(block.rows.map((row) => row.label)).toEqual(["HH", "SD", "BD"]);
    expect(block.rows.map((row) => row.pattern)).toEqual([
      "----------------",
      "----------------",
      "----------------"
    ]);
    expect(block.slots.every((slot) => slot.hits.length === 0)).toBe(true);
  });

  it("uses the selected meter and grid to size the first bar", () => {
    expect(
      getDrumSetupSlotCount({
        ...DEFAULT_DRUM_SETUP_VALUES,
        timeNumerator: 7,
        timeDenominator: 8
      })
    ).toBe(14);

    const block = createInitialDrumBlock({
      ...DEFAULT_DRUM_SETUP_VALUES,
      timeNumerator: 3,
      timeDenominator: 4,
      grid: 32
    });

    expect(block.slots).toHaveLength(24);
    expect(block.rows.every((row) => row.pattern === "-".repeat(24))).toBe(true);
  });

  it("preserves existing metadata and non-setup settings", () => {
    const existing = parseDrumBlock(`Title: Old title
Author: Sam
Comment: Keep this
Time: 6/8
Grouping: 3+3
Repeat: 3
Legend: used
Cursor: on
Rests: off`);
    const block = createInitialDrumBlock(
      {
        title: "New title",
        tempo: 92,
        timeNumerator: 6,
        timeDenominator: 8,
        grid: 32
      },
      {
        existing,
        explicitHeaderKeys: getExplicitAuthoringHeaderKeys(`Title: Old title
Author: Sam
Comment: Keep this
Time: 6/8
Grouping: 3+3
Repeat: 3
Legend: used
Cursor: on
Rests: off`)
      }
    );

    expect(block.metadata).toEqual(["Title: New title", "Author: Sam", "Comment: Keep this"]);
    expect(block.repeatCount).toBe(3);
    expect(block.beamGrouping).toEqual([3, 3]);
    expect(block.legendMode).toBe("used");
    expect(block.showCursor).toBe(true);
    expect(block.showRests).toBe(false);
    expect(block.tempo).toBe(92);
    expect(block.timeSignature).toBe("6/8");
    expect(block.gridResolution).toBe(32);
  });

  it("preserves split voicing while rebuilding the initial bar", () => {
    const existing = parseDrumBlock(`Voicing: split
HH | ----
BD | ----`);
    const block = createInitialDrumBlock(DEFAULT_DRUM_SETUP_VALUES, {
      existing,
      explicitHeaderKeys: getExplicitAuthoringHeaderKeys(`Voicing: split
HH | ----
BD | ----`)
    });

    expect(block.voicing).toBe("split");
  });

  it("prefills setup values from an existing empty block", () => {
    const existing = parseDrumBlock(`Title: Practice fill
Tempo: 88
Time: 5/8
Grid: 32`);

    expect(getDrumSetupValues({
      existing,
      explicitHeaderKeys: getExplicitAuthoringHeaderKeys(`Title: Practice fill
Tempo: 88
Time: 5/8
Grid: 32`)
    })).toEqual({
      title: "Practice fill",
      tempo: 88,
      timeNumerator: 5,
      timeDenominator: 8,
      grid: 32
    });
  });

  it("serializes deterministically and round-trips", () => {
    const source = serializeInitialDrumBlock({
      title: "  ",
      tempo: 100,
      timeNumerator: 4,
      timeDenominator: 4,
      grid: 16
    });
    const parsed = parseDrumBlock(source);

    expect(source).toBe(`Title: New groove
Tempo: 100
Time: 4/4
Grid: 16
HH | ----------------
SD | ----------------
BD | ----------------`);
    const context = {
      existing: parsed,
      explicitHeaderKeys: getExplicitAuthoringHeaderKeys(source)
    };
    expect(serializeInitialDrumBlock(getDrumSetupValues(context), context)).toBe(source);
  });

  it("uses authoring defaults for a new scaffold and serializes non-format defaults", () => {
    const authoringDefaults = {
      ...DEFAULT_DRUM_AUTHORING_DEFAULTS,
      title: "Practice",
      tempo: 84,
      timeSignature: "7/8",
      beamGrouping: [2, 2, 3],
      gridResolution: 32 as const,
      voicing: "split" as const,
      repeatCount: 2,
      showCursor: true,
      showHighlight: false,
      showRests: false,
      legendMode: "used" as const
    };
    const context = { authoringDefaults };
    const source = serializeInitialDrumBlock(getDrumSetupValues(context), context);
    const parsed = parseDrumBlock(source);

    expect(parsed.timeSignature).toBe("7/8");
    expect(parsed.beamGrouping).toEqual([2, 2, 3]);
    expect(parsed.voicing).toBe("split");
    expect(parsed.repeatCount).toBe(2);
    expect(parsed.showCursor).toBe(true);
    expect(parsed.showHighlight).toBe(false);
    expect(parsed.showRests).toBe(false);
    expect(parsed.legendMode).toBe("used");
    expect(source).toContain("Grouping: 2+2+3");
    expect(source).toContain("Voicing: split");
  });

  it("overlays only explicit scaffold headers on vault authoring defaults", () => {
    const source = `Title: Explicit title
Cursor: off
Grouping: auto
Author: Sam`;
    const existing = parseDrumBlock(source);
    const authoringDefaults = {
      ...DEFAULT_DRUM_AUTHORING_DEFAULTS,
      title: "Vault title",
      tempo: 72,
      timeSignature: "7/8",
      beamGrouping: [2, 2, 3],
      gridResolution: 32 as const,
      voicing: "split" as const,
      showCursor: true,
      legendMode: "all" as const
    };
    const context = {
      existing,
      authoringDefaults,
      explicitHeaderKeys: getExplicitAuthoringHeaderKeys(source)
    };
    const block = createInitialDrumBlock(getDrumSetupValues(context), context);

    expect(block.metadata).toEqual(["Title: Explicit title", "Author: Sam"]);
    expect(block.tempo).toBe(72);
    expect(block.timeSignature).toBe("7/8");
    expect(block.gridResolution).toBe(32);
    expect(block.beamGrouping).toBeUndefined();
    expect(block.voicing).toBe("split");
    expect(block.showCursor).toBe(false);
    expect(block.legendMode).toBe("all");
  });

  it("uses parser fallback for invalid explicit settings instead of vault defaults", () => {
    const source = `Tempo: too-fast
Voicing: sideways`;
    const existing = parseDrumBlock(source);
    const authoringDefaults = {
      ...DEFAULT_DRUM_AUTHORING_DEFAULTS,
      tempo: 72,
      voicing: "split" as const
    };
    const context = {
      existing,
      authoringDefaults,
      explicitHeaderKeys: getExplicitAuthoringHeaderKeys(source)
    };
    const block = createInitialDrumBlock(getDrumSetupValues(context), context);

    expect(block.tempo).toBe(100);
    expect(block.voicing).toBe("single");
  });

  it("wraps a complete drums fence and keeps adjacent text on separate lines", () => {
    const body = serializeInitialDrumBlock(DEFAULT_DRUM_SETUP_VALUES);
    const fence = wrapDrumsFence(body);

    expect(fence.startsWith("```drums\nTitle: New groove")).toBe(true);
    expect(fence.endsWith("\n```")).toBe(true);
    expect(formatDrumsFenceInsertion(body, "before", "after")).toBe(`\n${fence}\n`);
    expect(formatDrumsFenceInsertion(body, "", "")).toBe(fence);
  });
});
