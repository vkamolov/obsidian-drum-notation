import { describe, expect, it } from "vitest";
import {
  compareVexKeys,
  durationForDenominator,
  durationForGridSpan,
  getBeatValue,
  getGridSpanToNextHit,
  getSecondsPerSlot,
  getSlotVisualDurationSeconds,
  getSlotsPerBar,
  getSlotsPerBeat,
  isPowerOfTwo,
  largestPowerOfTwoAtMost,
  vexKeyRank
} from "../src/music";
import { parseDrumBlock } from "../src/parser";
import { DrumBlock } from "../src/types";

describe("getSlotsPerBar", () => {
  it("scales with the grid resolution", () => {
    expect(getSlotsPerBar("4/4", 16)).toBe(16);
    expect(getSlotsPerBar("4/4", 32)).toBe(32);
  });

  it("handles compound and odd meters", () => {
    expect(getSlotsPerBar("6/8", 16)).toBe(12);
    expect(getSlotsPerBar("3/4", 16)).toBe(12);
    expect(getSlotsPerBar("7/8", 16)).toBe(14);
  });

  it("falls back to 16 for malformed signatures", () => {
    expect(getSlotsPerBar("nonsense", 16)).toBe(16);
  });
});

describe("getSlotsPerBeat / getBeatValue", () => {
  it("derives slots per beat from the beat value", () => {
    expect(getSlotsPerBeat("4/4", 16)).toBe(4);
    expect(getSlotsPerBeat("4/4", 32)).toBe(8);
    expect(getSlotsPerBeat("6/8", 16)).toBe(2);
  });

  it("reads the beat value, defaulting to 4", () => {
    expect(getBeatValue("4/4")).toBe(4);
    expect(getBeatValue("6/8")).toBe(8);
    expect(getBeatValue("garbage")).toBe(4);
  });
});

describe("getSecondsPerSlot", () => {
  it("converts tempo and grid into seconds per slot", () => {
    const block = { tempo: 100, gridResolution: 16 } as DrumBlock;
    expect(getSecondsPerSlot(block)).toBeCloseTo(0.15, 10);

    const fast = { tempo: 120, gridResolution: 32 } as DrumBlock;
    expect(getSecondsPerSlot(fast)).toBeCloseTo(0.0625, 10);
  });

  it("applies playback speed without changing the block tempo", () => {
    const block = { tempo: 100, gridResolution: 16 } as DrumBlock;

    expect(getSecondsPerSlot(block, 25)).toBeCloseTo(0.6, 10);
    expect(getSecondsPerSlot(block, 50)).toBeCloseTo(0.3, 10);
    expect(getSecondsPerSlot(block, 100)).toBeCloseTo(0.15, 10);
    expect(block.tempo).toBe(100);
  });
});

describe("duration helpers", () => {
  it("quantizes denominators to note durations", () => {
    expect(durationForDenominator(1)).toBe("1");
    expect(durationForDenominator(2)).toBe("2");
    expect(durationForDenominator(3)).toBe("4");
    expect(durationForDenominator(4)).toBe("4");
    expect(durationForDenominator(8)).toBe("8");
    expect(durationForDenominator(16)).toBe("16");
    expect(durationForDenominator(64)).toBe("32");
  });

  it("maps grid spans to durations", () => {
    expect(durationForGridSpan(16, 1)).toBe("16");
    expect(durationForGridSpan(16, 2)).toBe("8");
    expect(durationForGridSpan(16, 4)).toBe("4");
  });
});

describe("getGridSpanToNextHit", () => {
  it("keeps simple power-of-two spans", () => {
    expect(getGridSpanToNextHit(0, 2, 4)).toEqual({
      duration: "8",
      dots: 0,
      supportedSpan: 2
    });
  });

  it("supports common dotted spans", () => {
    expect(getGridSpanToNextHit(0, 3, 4)).toEqual({
      duration: "8",
      dots: 1,
      supportedSpan: 3
    });
    expect(getGridSpanToNextHit(0, 6, 8)).toEqual({
      duration: "8",
      dots: 1,
      supportedSpan: 6
    });
  });

  it("falls back safely for unsupported spans", () => {
    expect(getGridSpanToNextHit(0, 5, 8)).toEqual({
      duration: "32",
      dots: 0,
      supportedSpan: 1
    });
  });
});

describe("getSlotVisualDurationSeconds", () => {
  it("uses distance to the next hit for Grid 16 syncopation", () => {
    const block = parseDrumBlock(`Tempo: 100
SD | o--o`);

    expect(getSecondsPerSlot(block)).toBeCloseTo(0.15, 10);
    expect(getSlotVisualDurationSeconds(block, block.slots[0])).toBeCloseTo(0.45, 10);
    expect(getSlotVisualDurationSeconds(block, block.slots[3])).toBeCloseTo(0.15, 10);
  });

  it("does not treat three Grid 16 hits as an implicit triplet", () => {
    const block = parseDrumBlock(`Tempo: 100
HH | x-xx`);

    expect(getSlotVisualDurationSeconds(block, block.slots[0])).toBeCloseTo(0.3, 10);
    expect(getSlotVisualDurationSeconds(block, block.slots[2])).toBeCloseTo(0.15, 10);
    expect(getSlotVisualDurationSeconds(block, block.slots[3])).toBeCloseTo(0.15, 10);
  });

  it("preserves Grid 32 distance-based durations", () => {
    const block = parseDrumBlock(`Tempo: 120
Grid: 32
HH | x---x---`);

    expect(getSecondsPerSlot(block)).toBeCloseTo(0.0625, 10);
    expect(getSlotVisualDurationSeconds(block, block.slots[0])).toBeCloseTo(0.25, 10);
    expect(getSlotVisualDurationSeconds(block, block.slots[4])).toBeCloseTo(0.25, 10);
  });
});

describe("power-of-two helpers", () => {
  it("detects powers of two", () => {
    expect(isPowerOfTwo(1)).toBe(true);
    expect(isPowerOfTwo(2)).toBe(true);
    expect(isPowerOfTwo(4)).toBe(true);
    expect(isPowerOfTwo(3)).toBe(false);
    expect(isPowerOfTwo(0)).toBe(false);
    expect(isPowerOfTwo(6)).toBe(false);
  });

  it("finds the largest power of two at most a value", () => {
    expect(largestPowerOfTwoAtMost(1)).toBe(1);
    expect(largestPowerOfTwoAtMost(5)).toBe(4);
    expect(largestPowerOfTwoAtMost(7)).toBe(4);
    expect(largestPowerOfTwoAtMost(8)).toBe(8);
  });
});

describe("vex key ordering", () => {
  it("ranks pitches by octave then letter, ignoring notehead suffix", () => {
    expect(vexKeyRank("c/5")).toBe(35);
    expect(vexKeyRank("c/5/X")).toBe(35);
    expect(vexKeyRank("g/5/X")).toBe(39);
    expect(compareVexKeys("g/5/X", "c/5")).toBeGreaterThan(0);
    expect(compareVexKeys("f/4", "c/5")).toBeLessThan(0);
  });
});
