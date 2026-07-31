import { describe, expect, it } from "vitest";
import { setTimeSignature } from "../src/edit";
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

  it.each([
    [2, 2, "3@2(xxx)"],
    [4, 1, "3(xxx)"],
    [8, 0.5, "3@8(xxx)"],
    [16, 0.25, "3@16(xxx)"],
    [32, 0.125, "3@32(xxx)"]
  ] as const)(
    "supports three subdivisions across an explicit 1/%i duration",
    (denominator, durationQuarter, serializedToken) => {
      const block = parseDrumBlock(`HH | 3@${denominator}(xxx)`);

      expect(block.bars[0].durationQuarter).toBeCloseTo(durationQuarter);
      expect(block.slots).toHaveLength(3);
      expect(block.slots[0].durationQuarter).toBeCloseTo(durationQuarter / 3);
      expect(serializeDrumBlock(block)).toBe(`HH | ${serializedToken}`);
      expect(parseDrumBlock(serializeDrumBlock(block))).toEqual(block);
    }
  );

  it("allows explicit-duration tuplets after plain positions and other tuplets", () => {
    const block = parseDrumBlock("HH | x3@8(xxx)3@8(xxx)");

    expect(block.bars[0].rhythmRegions.map((region) => [
      region.kind,
      region.startQuarter,
      region.durationQuarter
    ])).toEqual([
      ["plain", 0, 0.25],
      ["tuplet", 0.25, 0.5],
      ["tuplet", 0.75, 0.5]
    ]);
  });

  it("keeps shorthand tuplets restricted to written-beat boundaries", () => {
    const parsed = parseDrumBlockWithWarnings("HH | x3(xxx)");

    expect(parsed.warnings).toEqual([
      expect.objectContaining({ code: "malformed-tuplet" })
    ]);
  });

  it("requires rows to match explicit tuplet durations", () => {
    const parsed = parseDrumBlockWithWarnings(`Time: 4/4
HH | 3@8(xxx)
SD | 3(xxx)`);

    expect(parsed.warnings).toEqual([
      expect.objectContaining({ code: "tuplet-mismatch", line: 3 })
    ]);
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
    ["HH | 3@7(xxx)", "unsupported-tuplet-duration"],
    ["HH | 8@32(xxxxxxxx)", "unsupported-tuplet-duration"],
    ["HH | xxxxxxxxxxxxxxx3@2(xxx)", "malformed-tuplet"],
    ["HH | 2/3(xxx)", "unsupported-tuplet-span"]
  ] as const)("warns safely for %s", (source, code) => {
    const parsed = parseDrumBlockWithWarnings(source);

    expect(parsed.warnings.some((warning) => warning.code === code)).toBe(true);
    expect(parsed.block.containsTupletSyntax).toBe(true);
    expect(serializeDrumBlock(parsed.block)).not.toMatch(/[()/@]/);
  });

  it("does not report the explicit-duration marker as an unsupported row character", () => {
    const parsed = parseDrumBlockWithWarnings("HH | 3@8(xxx)");

    expect(parsed.warnings).toEqual([]);
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

  it("preserves explicit-duration tuplets through compact repeats", () => {
    const source = `HH | 3@8(xxx)--3@8(xxx)--3@8(xxx)--3@8(xxx)--
%x2`;
    const block = parseDrumBlock(source);

    expect(block.bars).toHaveLength(3);
    expect(block.bars.every((bar) =>
      bar.rhythmRegions.filter((region) => region.kind === "tuplet")
        .every((region) => region.durationQuarter === 0.5)
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

  it("preserves absolute tuplet timing through model-level meter changes", () => {
    const block = parseDrumBlock(`Time: 4/4
HH | 3(xxx)`);
    const changed = setTimeSignature(block, 6, 8);
    const serialized = serializeDrumBlock(changed);
    const reparsed = parseDrumBlock(serialized);

    expect(changed.bars[0].rhythmRegions[0].spanWrittenBeats).toBeCloseTo(2);
    expect(serialized).toBe(`Time: 6/8
HH | 3@4(xxx)`);
    expect(reparsed.bars[0].durationQuarter).toBeCloseTo(1);
    expect(reparsed.bars[0].rhythmRegions[0].spanWrittenBeats).toBeCloseTo(2);
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

  it("keeps written-beat metronome pulses inside a multi-beat tuplet", () => {
    const block = parseDrumBlock(`Time: 4/4
HH | 3@2(xxx)`);

    expect(getMetronomePulses(block).map((pulse) => [
      pulse.slotIndex,
      pulse.quarterOffset
    ])).toEqual([
      [0, 0],
      [1, 1]
    ]);
  });
});
