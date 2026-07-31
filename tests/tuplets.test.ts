import { describe, expect, it } from "vitest";
import {
  getSlotBoundaryQuarter,
  getSlotDurationSeconds,
  getSlotIndexAtQuarter
} from "../src/music";
import {
  parseDrumBlock,
  parseDrumBlockWithWarnings
} from "../src/parser";
import { getMetronomePulses } from "../src/playback";
import { serializeDrumBlock } from "../src/serializer";

describe("explicit beat tuplets", () => {
  it.each(Array.from({ length: 10 }, (_, index) => index + 3))(
    "parses and serializes %i equal positions in one written beat",
    (count) => {
      const token = `${count}(${"x".repeat(count)})`;
      const block = parseDrumBlock(`HH | ${token}`);

      expect(block.containsTupletSyntax).toBe(true);
      expect(block.slots).toHaveLength(count);
      expect(block.bars[0].durationQuarter).toBeCloseTo(1);
      expect(block.bars[0].rhythmRegions).toEqual([
        expect.objectContaining({
          kind: "tuplet",
          positionCount: count,
          spanWrittenBeats: 1,
          subdivisionCount: count
        })
      ]);
      expect(serializeDrumBlock(block)).toBe(`HH | ${token}`);
      expect(parseDrumBlock(serializeDrumBlock(block))).toEqual(block);
    }
  );

  it("supports mixed plain, tuplet, sticking, and explicit power-of-two beats", () => {
    const source = `Time: 4/4
ST | R-L-3(RLR)4(LRLR)5(RLRLR)
HH | x-x-3(x-x)4(x-x-)5(x-x-x)
SD | ----3(o--)4(--o-)5(o-o-o)`;
    const block = parseDrumBlock(source);

    expect(block.bars[0].rhythmRegions.map((region) => [
      region.kind,
      region.subdivisionCount
    ])).toEqual([
      ["plain", 4],
      ["tuplet", 3],
      ["tuplet", 4],
      ["tuplet", 5]
    ]);
    expect(block.bars[0].durationQuarter).toBeCloseTo(4);
    expect(block.slots.map((slot) => slot.sticking).filter(Boolean)).toHaveLength(14);
    expect(serializeDrumBlock(block)).toBe(source.split("\n").slice(1).join("\n"));
  });

  it("warns and falls back for mismatched row structures", () => {
    const parsed = parseDrumBlockWithWarnings(`HH | x---3(xxx)
SD | o-------`);

    expect(parsed.warnings).toEqual([
      expect.objectContaining({
        code: "tuplet-mismatch",
        line: 2
      })
    ]);
    expect(parsed.block.containsTupletSyntax).toBe(true);
    expect(parsed.block.bars[0].rhythmRegions.every((region) => region.kind === "plain")).toBe(true);
    expect(serializeDrumBlock(parsed.block)).toBe(`HH | x---xxx
SD | o-------`);
  });

  it.each([
    ["HH | 2(xx)", "malformed-tuplet"],
    ["HH | x-3(xxx)", "malformed-tuplet"],
    ["HH | 3(xx)", "malformed-tuplet"],
    ["HH | 3(x3(x))", "malformed-tuplet"],
    ["HH | 2/3(xxx)", "unsupported-tuplet-span"]
  ] as const)("warns safely for %s", (source, code) => {
    const parsed = parseDrumBlockWithWarnings(source);

    expect(parsed.warnings.some((warning) => warning.code === code)).toBe(true);
    expect(parsed.block.containsTupletSyntax).toBe(true);
    expect(serializeDrumBlock(parsed.block)).not.toMatch(/[()/]/);
  });

  it("copies rhythmic regions through compact repeats", () => {
    const source = `HH | 3(xxx)3(---)3(---)3(---)
%x2`;
    const block = parseDrumBlock(source);

    expect(block.bars).toHaveLength(3);
    expect(block.bars.every((bar) =>
      bar.rhythmRegions.every((region) => region.kind === "tuplet")
    )).toBe(true);
    expect(block.bars.map((bar) => bar.durationQuarter)).toEqual([4, 4, 4]);
    expect(serializeDrumBlock(block)).toBe(source);
  });

  it("uses quarter-note timeline offsets and inverts them at boundaries", () => {
    const block = parseDrumBlock(`Tempo: 100
HH | 3(xxx)`);

    expect(block.slots.map((slot) => slot.startQuarter)).toEqual([
      0,
      1 / 3,
      2 / 3
    ]);
    expect(getSlotDurationSeconds(block, block.slots[0])).toBeCloseTo(0.2);
    expect(getSlotBoundaryQuarter(block, block.slots.length)).toBeCloseTo(1);
    expect(getSlotIndexAtQuarter(block, 0.34)).toBe(1);
    expect(getSlotIndexAtQuarter(block, 2 / 3)).toBe(2);
  });

  it("keeps metronome pulses on written beats rather than tuplet positions", () => {
    const block = parseDrumBlock(`Time: 4/4
HH | 3(xxx)3(xxx)3(xxx)3(xxx)`);

    expect(getMetronomePulses(block).map((pulse) => [
      pulse.slotIndex,
      pulse.quarterOffset
    ])).toEqual([
      [0, 0],
      [3, 1],
      [6, 2],
      [9, 3]
    ]);
  });
});
