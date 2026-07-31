import { Beam, Dot, StaveNote } from "vexflow/bravura";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildGridVisualBarNotes } from "../src/engrave";
import { parseDrumBlock } from "../src/parser";
import { GridResolution } from "../src/types";

let vexFlowWarning: ReturnType<typeof vi.spyOn>;
let dotSetFont: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  vexFlowWarning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  dotSetFont = vi.spyOn(Dot.prototype, "setFont").mockImplementation(function () {
    return this;
  });
});

afterAll(() => {
  vexFlowWarning.mockRestore();
  dotSetFont.mockRestore();
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

function restSignatures(notes: readonly unknown[]): Array<{ duration: string; dots: number; visible: boolean }> {
  return notes
    .filter((note): note is StaveNote => note instanceof StaveNote && note.isRest())
    .map((note) => ({
      duration: note.getDuration(),
      dots: note.getModifiersByType("Dot").length,
      visible: note.renderOptions.draw !== false
    }));
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

describe("explicit tuplet engraving", () => {
  it.each([
    [3, 2],
    [5, 4],
    [6, 4],
    [7, 4],
    [9, 8],
    [12, 8]
  ] as const)("engraves %i positions in the space of %i", (count, occupied) => {
    const block = parseDrumBlock(`HH | ${count}(${"x".repeat(count)})`);
    const bar = block.bars[0];
    const visualBar = buildGridVisualBarNotes(
      bar.slots,
      block.timeSignature,
      block.gridResolution,
      false,
      block.beamGrouping,
      bar.rhythmRegions
    );

    expect(visualBar.tuplets).toHaveLength(1);
    expect(visualBar.tuplets[0].getNoteCount()).toBe(count);
    expect(visualBar.tuplets[0].getNotesOccupied()).toBe(occupied);
    expect(visualBar.noteSlots.map((slot) => slot.index)).toEqual(
      Array.from({ length: count }, (_, index) => index)
    );
  });

  it.each([4, 8] as const)(
    "renders explicit %i-position subdivisions without a redundant tuplet",
    (count) => {
      const block = parseDrumBlock(`HH | ${count}(${"x".repeat(count)})`);
      const bar = block.bars[0];
      const visualBar = buildGridVisualBarNotes(
        bar.slots,
        block.timeSignature,
        block.gridResolution,
        false,
        block.beamGrouping,
        bar.rhythmRegions
      );

      expect(visualBar.tuplets).toEqual([]);
      expect(visualBar.noteSlots).toHaveLength(count);
    }
  );

  it("keeps explicit tuplet rests and breaks beams around them", () => {
    const block = parseDrumBlock("HH | 3(x-x)");
    const bar = block.bars[0];
    const visualBar = buildGridVisualBarNotes(
      bar.slots,
      block.timeSignature,
      block.gridResolution,
      false,
      block.beamGrouping,
      bar.rhythmRegions
    );

    expect(visualBar.notes).toHaveLength(3);
    expect(restSignatures(visualBar.notes)).toEqual([
      { duration: "8", dots: 0, visible: true }
    ]);
    expect(visualBar.beams).toEqual([]);
    expect(visualBar.tuplets).toHaveLength(1);
  });

  it.each([
    ["3@8(xxx)", "16", 3, 2],
    ["5@4(xxxxx)", "16", 5, 4],
    ["7@32(xxxxxxx)", "128", 7, 4],
    ["3@2(xxx)", "4", 3, 2]
  ] as const)(
    "engraves %s with %s-note tickables",
    (token, duration, count, occupied) => {
      const block = parseDrumBlock(`HH | ${token}`);
      const bar = block.bars[0];
      const visualBar = buildGridVisualBarNotes(
        bar.slots,
        block.timeSignature,
        block.gridResolution,
        false,
        block.beamGrouping,
        bar.rhythmRegions
      );
      const staveNotes = visualBar.notes.filter(
        (note): note is StaveNote => note instanceof StaveNote
      );

      expect(staveNotes.map((note) => note.getDuration())).toEqual(
        Array.from({ length: count }, () => duration)
      );
      expect(visualBar.tuplets).toHaveLength(1);
      expect(visualBar.tuplets[0].getNotesOccupied()).toBe(occupied);
    }
  );

  it("supports visible rests at the 128th-note tickable limit", () => {
    const block = parseDrumBlock("HH | 7@32(x-x-x-x)");
    const bar = block.bars[0];
    const visualBar = buildGridVisualBarNotes(
      bar.slots,
      block.timeSignature,
      block.gridResolution,
      false,
      block.beamGrouping,
      bar.rhythmRegions
    );

    expect(restSignatures(visualBar.notes)).toEqual([
      { duration: "128", dots: 0, visible: true },
      { duration: "128", dots: 0, visible: true },
      { duration: "128", dots: 0, visible: true }
    ]);
    expect(visualBar.tuplets).toHaveLength(1);
  });

  it("keeps adjacent explicit tuplets in separate beam groups", () => {
    const block = parseDrumBlock("HH | 3@8(xxx)3@8(xxx)");
    const bar = block.bars[0];
    const visualBar = buildGridVisualBarNotes(
      bar.slots,
      block.timeSignature,
      block.gridResolution,
      false,
      block.beamGrouping,
      bar.rhythmRegions
    );

    expect(beamNoteCounts(visualBar.beams)).toEqual([3, 3]);
    expect(visualBar.tuplets).toHaveLength(2);
  });
});

describe("rest engraving", () => {
  it("emits visible rests for silent beats and leading gaps", () => {
    const firstBar = buildBeams("4/4", 16, "x-x-x-x-x-------").visualBar;
    const secondBar = buildBeams("4/4", 16, "----x-----------").visualBar;

    expect(restSignatures(firstBar.notes)).toEqual([
      { duration: "4", dots: 0, visible: true }
    ]);
    expect(restSignatures(secondBar.notes)).toEqual([
      { duration: "4", dots: 0, visible: true },
      { duration: "4", dots: 0, visible: true },
      { duration: "4", dots: 0, visible: true }
    ]);
  });

  it("renders an off-beat eighth rest without adding a trailing rest after a sustained hit", () => {
    const offBeat = buildBeams("4/4", 16, "--x-xxxxxxxxxxxx").visualBar;
    const sustained = buildBeams("4/4", 16, "x---xxxxxxxxxxxx").visualBar;

    expect(restSignatures(offBeat.notes)).toEqual([
      { duration: "8", dots: 0, visible: true }
    ]);
    expect(offBeat.hitNotes[0].getDuration()).toBe("8");
    expect(restSignatures(sustained.notes)).toEqual([]);
    expect(sustained.hitNotes[0].getDuration()).toBe("4");
  });

  it.each([
    ["4/4", 16, undefined, "----------------", [
      { duration: "4", dots: 0, visible: true },
      { duration: "4", dots: 0, visible: true },
      { duration: "4", dots: 0, visible: true },
      { duration: "4", dots: 0, visible: true }
    ]],
    ["6/8", 16, undefined, "------------", [
      { duration: "4", dots: 1, visible: true },
      { duration: "4", dots: 1, visible: true }
    ]],
    ["9/8", 16, undefined, "------------------", [
      { duration: "4", dots: 1, visible: true },
      { duration: "4", dots: 1, visible: true },
      { duration: "4", dots: 1, visible: true }
    ]],
    ["12/8", 16, undefined, "------------------------", [
      { duration: "4", dots: 1, visible: true },
      { duration: "4", dots: 1, visible: true },
      { duration: "4", dots: 1, visible: true },
      { duration: "4", dots: 1, visible: true }
    ]],
    ["7/8", 16, "2+2+3", "--------------", [
      { duration: "4", dots: 0, visible: true },
      { duration: "4", dots: 0, visible: true },
      { duration: "4", dots: 1, visible: true }
    ]]
  ] as const)(
    "groups a fully silent %s bar by its engraving meter",
    (timeSignature, grid, grouping, pattern, expected) => {
      const { visualBar } = buildBeams(timeSignature, grid, pattern, grouping);

      expect(restSignatures(visualBar.notes)).toEqual(expected);
      expect(visualBar.hitNotes).toEqual([]);
      expect(visualBar.noteSlots).toEqual([]);
      expect(visualBar.cursorSlots).toEqual([]);
      expect(visualBar.beams).toEqual([]);
    }
  );

  it("keeps Grid 32 rest decomposition and written hit mappings stable", () => {
    const { visualBar } = buildBeams("4/4", 32, "----x---x-----------------------");

    expect(restSignatures(visualBar.notes)[0]).toEqual({
      duration: "8",
      dots: 0,
      visible: true
    });
    expect(visualBar.noteSlots.map((slot) => slot.index)).toEqual([4, 8]);
    expect(visualBar.cursorSlots.map((slot) => slot.index)).toEqual([4, 8]);
  });
});
