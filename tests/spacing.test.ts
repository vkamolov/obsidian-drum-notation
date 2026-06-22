import { describe, expect, it } from "vitest";
import { allocateBarWidths } from "../src/spacing";

describe("allocateBarWidths", () => {
  it("adds header width to the first of two equal rhythmic bars", () => {
    const widths = allocateBarWidths([16, 16], 400, 60, 84);

    expect(widths).toEqual([230, 170]);
    expect(widths[0] - 60).toBe(widths[1]);
  });

  it("keeps equal bars equal when there is no header", () => {
    expect(allocateBarWidths([16, 16], 400, 0, 84)).toEqual([200, 200]);
  });

  it("preserves duration-proportional rhythmic widths", () => {
    const widths = allocateBarWidths([16, 8], 360, 60, 84);

    expect(widths).toEqual([260, 100]);
    expect(widths[0] - 60).toBe(widths[1] * 2);
  });

  it("reflects clef-only and clef-plus-time-signature header widths", () => {
    const clefOnly = allocateBarWidths([16, 16], 400, 30, 84);
    const fullHeader = allocateBarWidths([16, 16], 400, 60, 84);

    expect(clefOnly).toEqual([215, 185]);
    expect(fullHeader).toEqual([230, 170]);
    expect(clefOnly[0] - 30).toBe(clefOnly[1]);
    expect(fullHeader[0] - 60).toBe(fullHeader[1]);
  });

  it("clamps a short bar and redistributes the remaining rhythmic width", () => {
    expect(allocateBarWidths([1, 3], 300, 40, 100)).toEqual([140, 160]);
  });

  it("compresses proportionally when minimum widths cannot fit", () => {
    expect(allocateBarWidths([1, 3], 180, 40, 100)).toEqual([75, 105]);
  });

  it("leaves a one-bar system at the full available width", () => {
    expect(allocateBarWidths([16], 320, 60, 84)).toEqual([320]);
  });

  it("preserves the exact total width with fractional allocations", () => {
    const widths = allocateBarWidths([3, 5, 7], 413, 47, 0);

    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(413);
  });
});
