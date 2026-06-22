import { describe, expect, it, vi } from "vitest";
import { updateMeasureRepeatProgress } from "../src/engrave";
import { parseDrumBlock } from "../src/parser";
import { getMeasureRepeatProgress } from "../src/repeat-progress";

describe("getMeasureRepeatProgress", () => {
  it("maps only the repeated copies in an explicit counted repeat", () => {
    const block = parseDrumBlock(`HH | x---
%x3
Bar
HH | x---`);

    expect(getMeasureRepeatProgress(block, 0)).toBeNull();
    expect(getMeasureRepeatProgress(block, 1)).toEqual({
      groupStartBarIndex: 1,
      currentRepeat: 1,
      totalRepeats: 3
    });
    expect(getMeasureRepeatProgress(block, 2)).toEqual({
      groupStartBarIndex: 1,
      currentRepeat: 2,
      totalRepeats: 3
    });
    expect(getMeasureRepeatProgress(block, 3)).toEqual({
      groupStartBarIndex: 1,
      currentRepeat: 3,
      totalRepeats: 3
    });
    expect(getMeasureRepeatProgress(block, 4)).toBeNull();
  });

  it("does not combine separate one-bar repeat lines", () => {
    const block = parseDrumBlock(`HH | x---
%
%`);

    expect(getMeasureRepeatProgress(block, 1)).toBeNull();
    expect(getMeasureRepeatProgress(block, 2)).toBeNull();
  });

  it("tracks multiple counted-repeat groups across systems", () => {
    const block = parseDrumBlock(`HH | x---
%x2
Bar
SD | o---
%x3`);

    expect(getMeasureRepeatProgress(block, 2)).toEqual({
      groupStartBarIndex: 1,
      currentRepeat: 2,
      totalRepeats: 2
    });
    expect(getMeasureRepeatProgress(block, 4)).toEqual({
      groupStartBarIndex: 4,
      currentRepeat: 1,
      totalRepeats: 3
    });
    expect(getMeasureRepeatProgress(block, 6)).toEqual({
      groupStartBarIndex: 4,
      currentRepeat: 3,
      totalRepeats: 3
    });
  });

  it("updates and restores the compact rendered label in place", () => {
    const toggle = vi.fn();
    const setAttribute = vi.fn();
    const label = {
      dataset: {
        repeatStartBarIndex: "1",
        repeatTotal: "3"
      },
      textContent: "x3",
      classList: { toggle },
      setAttribute
    };
    const container = {
      querySelectorAll: vi.fn(() => [label])
    } as unknown as HTMLElement;

    updateMeasureRepeatProgress(container, {
      groupStartBarIndex: 1,
      currentRepeat: 2,
      totalRepeats: 3
    });

    expect(label.textContent).toBe("2/3");
    expect(toggle).toHaveBeenLastCalledWith("is-active", true);
    expect(setAttribute).toHaveBeenLastCalledWith("aria-label", "Repeat 2 of 3");

    updateMeasureRepeatProgress(container, null);

    expect(label.textContent).toBe("x3");
    expect(toggle).toHaveBeenLastCalledWith("is-active", false);
    expect(setAttribute).toHaveBeenLastCalledWith(
      "aria-label",
      "Repeat previous bar 3 times"
    );
  });
});
