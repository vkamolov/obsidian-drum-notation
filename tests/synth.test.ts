import { describe, expect, it } from "vitest";
import { getSlotDurationSeconds, getSlotVisualDurationSeconds } from "../src/music";
import { parseDrumBlock } from "../src/parser";
import {
  getBuzzRollEnvelopeTiming,
  getDiddleStrokeIntervalSeconds
} from "../src/synth";

describe("diddle playback timing", () => {
  it.each([
    ["quarter note", 0.5, 0.25],
    ["eighth note", 0.25, 0.125],
    ["sixteenth note", 0.125, 0.0625],
    ["Grid-32 note", 0.0625, 0.03125],
    ["tuplet position", 0.2, 0.1]
  ])("splits a %s evenly", (_label, noteDuration, expected) => {
    expect(getDiddleStrokeIntervalSeconds(0.125, noteDuration)).toBeCloseTo(expected);
  });

  it("uses the slot duration only when the inferred note duration is unavailable", () => {
    expect(getDiddleStrokeIntervalSeconds(0.2, 0)).toBeCloseTo(0.1);
    expect(getDiddleStrokeIntervalSeconds(0, 0)).toBeCloseTo(0.025);
  });

  it("keeps the second stroke inside very short notes", () => {
    const noteDuration = 0.02;
    const interval = getDiddleStrokeIntervalSeconds(noteDuration, noteDuration);

    expect(interval).toBeCloseTo(0.01);
    expect(interval).toBeLessThan(noteDuration);
  });

  it("keeps a 260 BPM Grid-32 diddle inside the note at 150 percent speed", () => {
    const block = parseDrumBlock(`Tempo: 260
Grid: 32
SD | dddddddddddddddddddddddddddddddd`);
    const slot = block.slots[0];
    const slotDuration = getSlotDurationSeconds(block, slot, 150);
    const noteDuration = getSlotVisualDurationSeconds(block, slot, 150);
    const interval = getDiddleStrokeIntervalSeconds(slotDuration, noteDuration);

    expect(noteDuration).toBeLessThan(0.05);
    expect(interval).toBeCloseTo(noteDuration / 2);
    expect(interval).toBeLessThan(noteDuration);
  });
});

describe("buzz-roll envelope timing", () => {
  it("starts the release at the written note boundary and overlaps the next stroke", () => {
    const timing = getBuzzRollEnvelopeTiming(0.4);

    expect(timing.releaseStartOffset).toBeCloseTo(0.4);
    expect(timing.sourceDuration).toBeGreaterThan(0.4);
    expect(timing.sourceDuration - timing.releaseStartOffset).toBeCloseTo(timing.tailDuration);
  });

  it("clamps the acoustic release tail between 12 and 50 milliseconds", () => {
    expect(getBuzzRollEnvelopeTiming(0.06).tailDuration).toBeCloseTo(0.012);
    expect(getBuzzRollEnvelopeTiming(0.2).tailDuration).toBeCloseTo(0.024);
    expect(getBuzzRollEnvelopeTiming(2).tailDuration).toBeCloseTo(0.05);
  });

  it("keeps an isolated buzz tail short", () => {
    const timing = getBuzzRollEnvelopeTiming(0.5);

    expect(timing.tailDuration).toBeLessThanOrEqual(0.05);
    expect(timing.sourceDuration).toBeLessThanOrEqual(0.55);
  });
});
