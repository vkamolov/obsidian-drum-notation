import { describe, expect, it } from "vitest";
import { parseDrumBlockWithWarnings } from "../src/parser";
import { validateDrumNotation } from "../src/validation";

const REGRESSION_SOURCE = `Time: 3/4
Voicing: split
CR | x-----------
HH | --x-x-x-x-x-
SD | ----Og-g---d
BD | o-------o-o-`;

describe("importer cymbal-position regression", () => {
  it("keeps the confirmed transcription clean and minimally normalized", () => {
    const result = validateDrumNotation(REGRESSION_SOURCE);

    expect(result.status).toBe("clean");
    expect(result.normalized).toBe(REGRESSION_SOURCE);
    expect(result.normalized).not.toMatch(/^(?:Title|Tempo|Grid):/m);
    expect(validateDrumNotation(result.normalized).normalized).toBe(result.normalized);
  });

  it("preserves exact instruments, onsets, and articulations", () => {
    const parsed = parseDrumBlockWithWarnings(REGRESSION_SOURCE);
    const hitsAt = (slot: number) => parsed.block.slots[slot].hits
      .map((hit) => `${hit.instrument.id}:${hit.articulation}`)
      .sort();

    expect(parsed.warnings).toEqual([]);
    expect(parsed.block.slots).toHaveLength(12);
    expect(hitsAt(0)).toEqual(["crash:normal", "kick:normal"]);
    expect(hitsAt(1)).toEqual([]);
    expect(hitsAt(2)).toEqual(["closed-hat:normal"]);
    expect(hitsAt(3)).toEqual([]);
    expect(hitsAt(4)).toEqual(["closed-hat:normal", "snare:accent"]);
    expect(hitsAt(5)).toEqual(["snare:ghost"]);
    expect(hitsAt(6)).toEqual(["closed-hat:normal"]);
    expect(hitsAt(7)).toEqual(["snare:ghost"]);
    expect(hitsAt(8)).toEqual(["closed-hat:normal", "kick:normal"]);
    expect(hitsAt(9)).toEqual([]);
    expect(hitsAt(10)).toEqual(["closed-hat:normal", "kick:normal"]);
    expect(hitsAt(11)).toEqual(["snare:diddle"]);
  });
});
