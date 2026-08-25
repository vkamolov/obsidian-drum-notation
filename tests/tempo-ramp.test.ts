import { describe, expect, it } from "vitest";
import { parseDrumBlock } from "../src/parser";
import {
  advanceTempoRampProgress,
  createDefaultTempoRampConfig,
  getTempoRampCompletionPasses,
  getTempoRampPassInStep,
  getTempoRampPreview,
  getTempoRampTempoBpm,
  isMaterialTempoRampSessionChange,
  normalizeTempoRampConfig,
  normalizeTempoRampConfigValues,
  normalizeTempoRampProgress
} from "../src/tempo-ramp";
import { TempoRampConfig } from "../src/types";

const config: TempoRampConfig = {
  target: { kind: "whole-notation" },
  startBpm: 70,
  stepBpm: 6,
  passesPerStep: 2,
  ceilingBpm: 85,
  endBehavior: "stop"
};

describe("tempo ramp", () => {
  it("creates selection-first defaults and a valid ladder near the maximum tempo", () => {
    const block = parseDrumBlock("HH | x---|x---");
    const selected = createDefaultTempoRampConfig(block, 100, { barIndexes: [1] }, 0);
    const nearMaximum = createDefaultTempoRampConfig(block, 260, { barIndexes: [] }, 1);

    expect(selected.target).toEqual({ kind: "selected-bars", barIndexes: [1] });
    expect(selected).toMatchObject({ startBpm: 100, ceilingBpm: 120, stepBpm: 5, passesPerStep: 4 });
    expect(nearMaximum).toMatchObject({
      target: { kind: "current-bar", barIndex: 1 },
      startBpm: 240,
      ceilingBpm: 260
    });
  });

  it("normalizes supported values and rejects descending or empty ladders", () => {
    expect(normalizeTempoRampConfigValues({
      ...config,
      startBpm: 20,
      stepBpm: 99,
      passesPerStep: 0,
      ceilingBpm: 999
    })).toMatchObject({ startBpm: 30, stepBpm: 50, passesPerStep: 1, ceilingBpm: 260 });
    expect(normalizeTempoRampConfigValues({ ...config, startBpm: 90, ceilingBpm: 90 })).toBeNull();
  });

  it("normalizes captured targets against the current bar structure", () => {
    const block = parseDrumBlock("HH | x---|x---");

    expect(normalizeTempoRampConfig({ ...config, target: { kind: "current-bar", barIndex: 2 } }, block)).toBeNull();
    expect(normalizeTempoRampConfig({ ...config, target: { kind: "selected-bars", barIndexes: [1, 1, 9] } }, block)?.target)
      .toEqual({ kind: "selected-bars", barIndexes: [1] });
  });

  it("clamps the final tempo step to the exact ceiling and counts ceiling passes", () => {
    expect(getTempoRampPreview(config)).toEqual([70, 76, 82, 85]);
    expect(getTempoRampCompletionPasses(config)).toBe(8);
    expect(Array.from({ length: 9 }, (_, pass) => getTempoRampTempoBpm(config, pass)))
      .toEqual([70, 70, 76, 76, 82, 82, 85, 85, 85]);
    expect(Array.from({ length: 8 }, (_, pass) => getTempoRampPassInStep(config, pass)))
      .toEqual([1, 2, 1, 2, 1, 2, 1, 2]);
  });

  it("caps progress and marks stop ladders complete only after the final ceiling pass", () => {
    expect(advanceTempoRampProgress(config, 6)).toEqual({ completedPasses: 7, completed: false });
    expect(advanceTempoRampProgress(config, 7)).toEqual({ completedPasses: 8, completed: true });
    expect(advanceTempoRampProgress(config, 20)).toEqual({ completedPasses: 8, completed: true });
    expect(normalizeTempoRampProgress(config, { completedPasses: 50, completed: true }))
      .toEqual({ completedPasses: 8, completed: true });
  });

  it("treats configuration, arming, and progress resets as material cross-render updates", () => {
    const base = { config, armed: true, progress: { completedPasses: 3, completed: false } };

    expect(isMaterialTempoRampSessionChange(base, {
      ...base,
      progress: { completedPasses: 4, completed: false }
    })).toBe(false);
    expect(isMaterialTempoRampSessionChange(base, {
      ...base,
      progress: { completedPasses: 0, completed: false }
    })).toBe(true);
    expect(isMaterialTempoRampSessionChange(base, { ...base, armed: false })).toBe(true);
  });
});
