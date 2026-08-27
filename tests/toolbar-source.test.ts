import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("Obsidian playback toolbar source invariants", () => {
  it("creates one metronome badge and updates it without appending timer icons", () => {
    expect(mainSource.match(/metronomeButton\.createSpan/g)).toHaveLength(1);
    expect(mainSource).not.toContain('setIcon(metronomeButton, "timer")');
    expect(mainSource).toContain("metronomeBadge.setText(badgeText)");
    expect(mainSource).toContain("metronomeBadge.hidden = badgeText.length === 0");
  });

  it("keeps the speed control sizing more specific than the generic icon button", () => {
    expect(styles).toContain(".drum-notation .drum-notation__button.drum-notation__speed");
  });
});
