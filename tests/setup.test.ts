import { describe, expect, it } from "vitest";
import { parseDrumBlock } from "../src/parser";
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
Repeat: 3
Legend: used
Cursor: on`);
    const block = createInitialDrumBlock(
      {
        title: "New title",
        tempo: 92,
        timeNumerator: 6,
        timeDenominator: 8,
        grid: 32
      },
      existing
    );

    expect(block.metadata).toEqual(["Title: New title", "Author: Sam", "Comment: Keep this"]);
    expect(block.repeatCount).toBe(3);
    expect(block.legendMode).toBe("used");
    expect(block.showCursor).toBe(true);
    expect(block.tempo).toBe(92);
    expect(block.timeSignature).toBe("6/8");
    expect(block.gridResolution).toBe(32);
  });

  it("prefills setup values from an existing empty block", () => {
    const existing = parseDrumBlock(`Title: Practice fill
Tempo: 88
Time: 5/8
Grid: 32`);

    expect(getDrumSetupValues(existing)).toEqual({
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
    expect(serializeInitialDrumBlock(getDrumSetupValues(parsed), parsed)).toBe(source);
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
