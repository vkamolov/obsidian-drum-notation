import { describe, expect, it } from "vitest";
import { DRUM_KIT } from "../src/kit";
import {
  buildXNoteheadLadder,
  deriveVexStaffPosition,
  enrichKitReference,
  formatXNoteheadLadder
} from "../tools/kit-reference-data.mjs";

describe("generated drum-kit staff positions", () => {
  it.each([
    ["d/6/X", "space above the second ledger line", 2, "below-notehead"],
    ["c/6/X", "second ledger line above the staff", 2, "through-notehead"],
    ["b/5/X", "space above the first ledger line", 1, "below-notehead"],
    ["a/5/X", "first ledger line above the staff", 1, "through-notehead"],
    ["g/5/X", "space above the top staff line", 0, "none"],
    ["f/5/X", "top staff line", 0, "none"]
  ])("derives %s without relying on rhythmic context", (key, staffPosition, count, relation) => {
    expect(deriveVexStaffPosition(key)).toMatchObject({
      notehead: "x",
      staffPosition,
      requiresLedgerLine: count > 0,
      ledgerLines: { count, relation }
    });
  });

  it("derives normal and diamond notehead families", () => {
    expect(deriveVexStaffPosition("c/5").notehead).toBe("normal");
    expect(deriveVexStaffPosition("f/5/d2").notehead).toBe("diamond");
  });

  it("orders every current x-notehead cluster from top to bottom", () => {
    expect(buildXNoteheadLadder(DRUM_KIT).map((entry) => entry.vexKey)).toEqual([
      "d/6/X",
      "c/6/X",
      "b/5/X",
      "a/5/X",
      "g/5/X",
      "f/5/X",
      "e/5/X",
      "c/5/X",
      "d/4/X"
    ]);
  });

  it("does not advertise the reserved sticking label for stack", () => {
    const ladder = formatXNoteheadLadder(DRUM_KIT);
    expect(ladder).toContain("Stack (`STACK`)");
    expect(ladder).not.toContain("Stack (`ST`)");
  });

  it("enriches every kit entry from the same strict derivation", () => {
    const enriched = enrichKitReference(DRUM_KIT);
    expect(enriched).toHaveLength(DRUM_KIT.length);
    expect(enriched.find((instrument) => instrument.id === "crash")).toMatchObject({
      staffPosition: "first ledger line above the staff",
      notehead: "x",
      requiresLedgerLine: true,
      ledgerLines: { count: 1, relation: "through-notehead" }
    });
    expect(enriched.find((instrument) => instrument.id === "closed-hat")).toMatchObject({
      staffPosition: "space above the top staff line",
      notehead: "x",
      requiresLedgerLine: false
    });
  });

  it("rejects unknown positions, noteheads, and malformed keys", () => {
    expect(() => deriveVexStaffPosition("c/4/X")).toThrow(/Unhandled percussion staff position/);
    expect(() => deriveVexStaffPosition("a/5/triangle")).toThrow(/Unsupported VexFlow notehead suffix/);
    expect(() => deriveVexStaffPosition("not-a-key")).toThrow(/Unsupported VexFlow key format/);
  });
});
