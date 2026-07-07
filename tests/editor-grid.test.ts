import { describe, expect, it } from "vitest";
import {
  formatGridCountSpeechLabel,
  formatGridSelectionCountLabel,
  formatInstrumentCellAriaLabel,
  formatStickingCellAriaLabel
} from "../src/editor-grid";

describe("visual editor grid labels", () => {
  it("formats selected-cell count labels", () => {
    expect(formatGridSelectionCountLabel(0, 4)).toBe("1");
    expect(formatGridSelectionCountLabel(1, 4)).toBe("1e");
    expect(formatGridSelectionCountLabel(6, 4)).toBe("2&");
  });

  it("formats count labels for screen-reader text", () => {
    expect(formatGridCountSpeechLabel(0, 4)).toBe("beat 1");
    expect(formatGridCountSpeechLabel(1, 4)).toBe("beat 1 e");
    expect(formatGridCountSpeechLabel(6, 4)).toBe("beat 2 &");
  });

  it("describes instrument grid cells", () => {
    expect(formatInstrumentCellAriaLabel("Snare", "beat 2 e")).toBe("Snare, beat 2 e, empty");
    expect(formatInstrumentCellAriaLabel("Snare", "beat 2 e", "normal")).toBe("Snare, beat 2 e, normal");
    expect(formatInstrumentCellAriaLabel("Snare", "beat 2 e", "accent")).toBe("Snare, beat 2 e, accent");
  });

  it("describes sticking grid cells", () => {
    expect(formatStickingCellAriaLabel("beat 3 &")).toBe("Sticking, beat 3 &, empty");
    expect(formatStickingCellAriaLabel("beat 3 &", "right")).toBe("Sticking, beat 3 &, right hand");
    expect(formatStickingCellAriaLabel("beat 3 &", "both")).toBe("Sticking, beat 3 &, both hands");
  });
});
