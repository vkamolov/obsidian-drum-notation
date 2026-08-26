import { Barline, BarlineType, Beam, Dot, Stave, StaveNote, Stem, Tickable, Tuplet, Voice } from "vexflow/bravura";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applySectionRepeatBarlineTypes, buildGridVisualBarNotes, buildSplitVisualBarNotes, getScoreSystemHeights } from "../src/engrave";
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

function buildSplit(source: string) {
  const block = parseDrumBlock(`Voicing: split\n${source}`);
  const bar = block.bars[0];
  const visualBar = buildSplitVisualBarNotes(
    bar,
    bar.timeSignature,
    block.gridResolution,
    false,
    block.beamGrouping
  );

  return { block, bar, visualBar };
}

function voiceTicks(notes: readonly { getTicks: () => { value: () => number } }[]): number {
  return notes.reduce((total, note) => total + note.getTicks().value(), 0);
}

function expectCompleteVoices(timeSignature: string, voices: readonly (readonly Tickable[])[]): void {
  voices.forEach((notes) => {
    const voice = new Voice(timeSignature).setStrict(false);
    voice.addTickables([...notes]);
    expect(voice.getTicksUsed().value()).toBe(voice.getTotalTicks().value());
  });
}

describe("articulation engraving", () => {
  it("attaches a separate grace note to a flam but not to a diddle", () => {
    const block = parseDrumBlock("SD | fd--");
    const bar = block.bars[0];
    const visualBar = buildGridVisualBarNotes(
      bar.slots,
      block.timeSignature,
      block.gridResolution,
      false,
      block.beamGrouping
    );

    expect(visualBar.noteSlots.map((slot) => slot.hits[0]?.articulation)).toEqual(["flam", "diddle"]);
    expect(visualBar.hitNotes[0].getModifiersByType("GraceNoteGroup")).toHaveLength(1);
    expect(visualBar.hitNotes[1].getModifiersByType("GraceNoteGroup")).toHaveLength(0);
  });
});

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
    [7, 8],
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
    ["3@2(xxx)", "4", 3, 2],
    ["2/3(xxx)", "4", 3, 2],
    ["2/7(xxxxxxx)", "16", 7, 8],
    ["8@32(xxxxxxxx)", "128", 8, 4]
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
      expectCompleteVoices(timeSignature, visualBar.voices);
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

  it("gives dotted Grid 32 notes their complete intrinsic duration", () => {
    const { visualBar } = buildBeams("4/4", 32, "x-----x-------------------------");
    const first = visualBar.hitNotes[0];
    const second = visualBar.hitNotes[1];

    expect(first.getDuration()).toBe("8");
    expect(first.getModifiersByType("Dot")).toHaveLength(1);
    expect(first.getTicks().value()).toBe(second.getTicks().value() * 3);
  });
});

describe("split drum voicing", () => {
  it("keeps dotted lower-voice hits aligned to their written sixteenth slots", () => {
    const { visualBar } = buildSplit(`HH | -x-----x-x-----x
RB | --x--x--x--x--x-
SN | ----o-------o---
KD | o--o--o---o--o--`);
    const entries = visualBar.noteSlots.map((slot, index) => ({
      slotIndex: slot.index,
      instrument: slot.hits[0]?.instrument.id,
      note: visualBar.hitNotes[index]
    }));
    const kicks = entries.filter((entry) => entry.instrument === "kick");
    const firstKick = kicks.find((entry) => entry.slotIndex === 0)?.note;
    const secondKick = kicks.find((entry) => entry.slotIndex === 3)?.note;
    const finalKick = kicks.find((entry) => entry.slotIndex === 13)?.note;

    expect(kicks.map((entry) => entry.slotIndex)).toEqual([0, 3, 6, 10, 13]);
    expect(firstKick?.getModifiersByType("Dot")).toHaveLength(1);
    expect(finalKick?.getModifiersByType("Dot")).toHaveLength(1);
    expect(firstKick?.getTicks().value()).toBe((secondKick?.getTicks().value() ?? 0) * 3);
    expect(finalKick?.getTicks().value()).toBe((secondKick?.getTicks().value() ?? 0) * 3);
    expect(new Set(visualBar.voices.map(voiceTicks)).size).toBe(1);
    expectCompleteVoices("4/4", visualBar.voices);
  });

  it("uses independent up-stem and down-stem voices for simultaneous hands and feet", () => {
    const { visualBar } = buildSplit(`HH | x-x-
BD | o---`);
    const directions = visualBar.noteSlots.map((slot, index) => ({
      instrument: slot.hits[0]?.instrument.id,
      direction: visualBar.hitNotes[index]?.getStemDirection()
    }));

    expect(visualBar.voices).toHaveLength(3);
    expect(directions).toEqual([
      { instrument: "closed-hat", direction: Stem.UP },
      { instrument: "closed-hat", direction: Stem.UP },
      { instrument: "kick", direction: Stem.DOWN }
    ]);
    expect(visualBar.hitNotes.slice(0, 2).map((note) => note.getDuration())).toEqual(["8", "8"]);
    expect(visualBar.hitNotes[2]?.getDuration()).toBe("4");
    expect(new Set(visualBar.voices.map(voiceTicks)).size).toBe(1);
  });

  it("draws combined-rhythm rests once while keeping alignment rests hidden", () => {
    const { visualBar } = buildSplit(`HH | x-----x-
BD | o-------`);
    const rests = restSignatures(visualBar.notes);

    expect(rests.filter((rest) => rest.visible)).toEqual([
      { duration: "8", dots: 0, visible: true }
    ]);
    expect(rests.some((rest) => !rest.visible)).toBe(true);
    expect(new Set(visualBar.voices.map(voiceTicks)).size).toBe(1);
  });

  it("places the single displayed tuplet above mixed regions and below lower-only regions", () => {
    const mixed = buildSplit(`HH | 3(xxx)3(xxx)3(xxx)3(xxx)
BD | 3(o--)3(o--)3(o--)3(o--)`).visualBar;
    const lower = buildSplit("BD | 3(ooo)3(ooo)3(ooo)3(ooo)").visualBar;

    expect(mixed.tuplets).toHaveLength(4);
    expect(lower.tuplets).toHaveLength(4);
    expect(Reflect.get(Reflect.get(mixed.tuplets[0], "options"), "location")).toBe(Tuplet.LOCATION_TOP);
    expect(Reflect.get(Reflect.get(lower.tuplets[0], "options"), "location")).toBe(Tuplet.LOCATION_BOTTOM);
  });

  it("uses normal geometry for single voicing and split systems without lower hits", () => {
    const splitUpperOnly = parseDrumBlock(`Voicing: split
HH | x---`);
    const singleLower = parseDrumBlock("BD | o---");

    expect(getScoreSystemHeights(splitUpperOnly)).toEqual([122]);
    expect(getScoreSystemHeights(singleLower)).toEqual([122]);
  });

  it.each([
    ["quarter-note kick", "BD | o---o---o---o---"],
    ["second kick", "BD2 | o---o---o---o---"],
    ["hi-hat foot", "HF | x---x---x---x---"],
    ["foot splash", "HFS | x---x---x---x---"],
    ["beamed Grid-16 subdivisions", "BD | oooo------------"],
    ["beamed Grid-32 subdivisions", `Grid: 32
BD2 | oooooooo------------------------`]
  ])("uses compact split geometry for %s", (_label, source) => {
    const block = parseDrumBlock(`Voicing: split
${source}`);

    expect(getScoreSystemHeights(block)).toEqual([180]);
  });

  it.each([
    ["an isolated lower flag", "BD | --o-------------"],
    ["a lower articulation", "BD | O---o---o---o---"],
    ["a lower tuplet", "BD | 3(ooo)3(ooo)3(ooo)3(ooo)"],
    ["sticking", `ST | R---L---R---L---
BD | o---o---o---o---`]
  ])("uses expanded split geometry for %s", (_label, source) => {
    const block = parseDrumBlock(`Voicing: split
${source}`);

    expect(getScoreSystemHeights(block)).toEqual([220]);
  });

  it("expands the whole system when one contained bar needs extra clearance", () => {
    const block = parseDrumBlock(`Voicing: split
BD | o---o---o---o--- | --o-------------`);

    expect(getScoreSystemHeights(block)).toEqual([220]);
  });

  it("sums alternating normal, compact, and expanded system profiles", () => {
    const block = parseDrumBlock(`Voicing: split
HH | x---x---x---x---
Bar
BD | o---o---o---o---
Bar
BD | --o-------------`);
    const heights = getScoreSystemHeights(block);

    expect(heights).toEqual([122, 180, 220]);
    expect(heights.reduce((sum, height) => sum + height, 0)).toBe(522);
  });
});

describe("section repeat barlines", () => {
  it("converts a mid-system NONE beginning modifier into REPEAT_BEGIN", () => {
    const stave = new Stave(0, 0, 240, { leftBar: false, rightBar: true });

    applySectionRepeatBarlineTypes(stave, 1, new Set([1]), new Set());

    const types = stave.getModifiers()
      .filter((modifier): modifier is Barline => modifier instanceof Barline)
      .map((barline) => barline.getType());
    expect(types).toContain(BarlineType.REPEAT_BEGIN);
  });

  it("applies beginning and ending repeat types to the affected staves", () => {
    const beginning = new Stave(0, 0, 240, { leftBar: true, rightBar: true });
    const ending = new Stave(0, 0, 240, { leftBar: false, rightBar: true });
    const starts = new Set([2]);
    const ends = new Set([4]);

    applySectionRepeatBarlineTypes(beginning, 2, starts, ends);
    applySectionRepeatBarlineTypes(ending, 4, starts, ends);

    const beginningTypes = beginning.getModifiers()
      .filter((modifier): modifier is Barline => modifier instanceof Barline)
      .map((barline) => barline.getType());
    const endingTypes = ending.getModifiers()
      .filter((modifier): modifier is Barline => modifier instanceof Barline)
      .map((barline) => barline.getType());
    expect(beginningTypes).toContain(BarlineType.REPEAT_BEGIN);
    expect(endingTypes).toContain(BarlineType.REPEAT_END);
  });
});
