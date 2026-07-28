import { Beam } from "vexflow/bravura";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildGridVisualBarNotes } from "../src/engrave";
import { parseDrumBlock } from "../src/parser";
import { GridResolution } from "../src/types";

let vexFlowWarning: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  vexFlowWarning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterAll(() => {
  vexFlowWarning.mockRestore();
});

function repeatedEighthPattern(count: number, grid: GridResolution): string {
  return Array.from({ length: count }, () => (grid === 16 ? "x-" : "x---")).join("");
}

function buildBeams(
  timeSignature: string,
  grid: GridResolution,
  pattern: string,
  grouping?: string
) {
  const block = parseDrumBlock(`Time: ${timeSignature}
Grid: ${grid}
${grouping ? `Grouping: ${grouping}\n` : ""}HH | ${pattern}`);
  const visualBar = buildGridVisualBarNotes(
    block.bars[0].slots,
    block.timeSignature,
    block.gridResolution,
    false,
    block.beamGrouping
  );

  return { block, visualBar };
}

function beamNoteCounts(beams: Beam[]): number[] {
  return beams.map((beam) => beam.getNotes().length);
}

function secondaryBeamBreakIndexes(beam: Beam): number[] {
  const value: unknown = Reflect.get(beam, "breakOnIndexes");

  return Array.isArray(value)
    ? value.filter((index): index is number => typeof index === "number")
    : [];
}

describe("compound-meter beaming", () => {
  it.each([
    ["6/8", 16, 6, [3, 3]],
    ["9/8", 16, 9, [3, 3, 3]],
    ["12/8", 16, 12, [3, 3, 3, 3]],
    ["6/8", 32, 6, [3, 3]],
    ["9/8", 32, 9, [3, 3, 3]],
    ["12/8", 32, 12, [3, 3, 3, 3]]
  ] as const)(
    "beams %s eighth notes in groups of three at Grid %i",
    (timeSignature, grid, eighthCount, expected) => {
      const { visualBar } = buildBeams(
        timeSignature,
        grid,
        repeatedEighthPattern(eighthCount, grid)
      );

      expect(beamNoteCounts(visualBar.beams)).toEqual(expected);
    }
  );

  it("keeps simple-meter eighth-note grouping unchanged", () => {
    const { visualBar } = buildBeams("4/4", 16, repeatedEighthPattern(8, 16));

    expect(beamNoteCounts(visualBar.beams)).toEqual([2, 2, 2, 2]);
  });

  it.each([
    [16, [2, 2, 3]],
    [32, [2, 2, 3]]
  ] as const)("beams 7/8 as 2+2+3 at Grid %i", (grid, expected) => {
    const { visualBar } = buildBeams(
      "7/8",
      grid,
      repeatedEighthPattern(7, grid),
      "2+2+3"
    );

    expect(beamNoteCounts(visualBar.beams)).toEqual(expected);
  });

  it("supports explicit grouping in other /8 and /16 meters", () => {
    expect(
      beamNoteCounts(
        buildBeams("5/8", 16, repeatedEighthPattern(5, 16), "3+2").visualBar.beams
      )
    ).toEqual([3, 2]);
    expect(
      beamNoteCounts(buildBeams("7/16", 16, "xxxxxxx", "2+2+3").visualBar.beams)
    ).toEqual([2, 2, 3]);
  });

  it("lets explicit grouping override automatic compound grouping", () => {
    const { visualBar } = buildBeams(
      "9/8",
      16,
      repeatedEighthPattern(9, 16),
      "2+2+2+3"
    );

    expect(beamNoteCounts(visualBar.beams)).toEqual([2, 2, 2, 3]);
  });

  it("keeps 7/8 ungrouped when Grouping is absent", () => {
    const { visualBar } = buildBeams("7/8", 16, repeatedEighthPattern(7, 16));

    expect(visualBar.beams).toEqual([]);
  });

  it("breaks compound beams at rests", () => {
    const { visualBar } = buildBeams("6/8", 16, "x---x-x-x-x-");

    expect(beamNoteCounts(visualBar.beams)).toEqual([3]);
  });

  it.each([
    [16, "xxxxxx------"],
    [32, "x-x-x-x-x-x-------------"]
  ] as const)("keeps a primary group while breaking secondary beams at written beats in Grid %i", (grid, pattern) => {
    const { visualBar } = buildBeams("6/8", grid, pattern);

    expect(beamNoteCounts(visualBar.beams)).toEqual([6]);
    expect(secondaryBeamBreakIndexes(visualBar.beams[0])).toEqual([1, 3]);
  });

  it("preserves written hit and cursor slot mappings", () => {
    const { visualBar } = buildBeams("6/8", 16, repeatedEighthPattern(6, 16));
    const expectedSlots = [0, 2, 4, 6, 8, 10];

    expect(visualBar.noteSlots.map((slot) => slot.index)).toEqual(expectedSlots);
    expect(visualBar.cursorSlots.map((slot) => slot.index)).toEqual(expectedSlots);
  });
});
