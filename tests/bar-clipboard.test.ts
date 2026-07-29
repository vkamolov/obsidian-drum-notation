import { describe, expect, it, vi } from "vitest";
import {
  DrumBarClipboardStore,
  isDrumBarClipboardPayload,
  serializeDrumBarClipboardText
} from "../src/bar-clipboard";
import {
  barHasMeaningfulContent,
  captureBarClipboardPayload,
  findHit,
  findSticking,
  pasteBarClipboardPayload
} from "../src/edit";
import { parseDrumBlock } from "../src/parser";
import { serializeDrumBlock } from "../src/serializer";

describe("bar clipboard model helpers", () => {
  it("captures canonical notes, articulations, sticking, and source timing", () => {
    const block = parseDrumBlock("Time: 4/4\nGrid: 16\nST | R---\nHH | X---\nSD | --g-");
    const payload = captureBarClipboardPayload(block, 0);

    expect(payload).toEqual({
      kind: "drum-notation-bar",
      version: 1,
      timeSignature: "4/4",
      gridResolution: 16,
      width: 4,
      rows: [
        { instrumentId: "closed-hat", label: "HH", pattern: "X---" },
        { instrumentId: "snare", label: "SD", pattern: "--g-" }
      ],
      stickingPattern: "R---"
    });
  });

  it("captures an empty bar without structural rest rows", () => {
    const block = parseDrumBlock("HH | x--- | ----\nSD | ---- | ----");

    expect(captureBarClipboardPayload(block, 1)?.rows).toEqual([]);
    expect(barHasMeaningfulContent(block, 1)).toBe(false);
  });

  it("pastes into the selected bar while preserving its system and subtitle", () => {
    const source = parseDrumBlock("ST | R---\nHH | X---\nSD | --g-");
    const target = parseDrumBlock(`Rests: off
Subtitle: Keep me
BD | o--- | ----
HH | ---- | x---
Bar
CR | c---`);
    const payload = captureBarClipboardPayload(source, 0);

    expect(payload).not.toBeNull();
    const result = pasteBarClipboardPayload(target, 1, payload!);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.block.systems[0].subtitle).toBe("Keep me");
    expect(result.block.showRests).toBe(false);
    expect(findHit(result.block, result.block.bars[1].startSlot, "closed-hat")?.articulation).toBe("accent");
    expect(findHit(result.block, result.block.bars[1].startSlot + 2, "snare")?.articulation).toBe("ghost");
    expect(findSticking(result.block, result.block.bars[1].startSlot)).toBe("right");
    expect(findHit(result.block, result.block.bars[0].startSlot, "kick")).toBeTruthy();
    expect(findHit(result.block, result.block.bars[2].startSlot, "crash")).toBeTruthy();
  });

  it("clears target-only instruments and preserves prefixes needed by later bars", () => {
    const source = parseDrumBlock("HH | x---");
    const target = parseDrumBlock("SD | o--- | --o- | o---\nBD | o--- | --o- | ----");
    const payload = captureBarClipboardPayload(source, 0);

    const result = pasteBarClipboardPayload(target, 1, payload!);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(serializeDrumBlock(result.block)).toContain("SD | o--- | ---- | o---");
    expect(findHit(result.block, result.block.bars[1].startSlot, "kick")).toBeUndefined();
    expect(serializeDrumBlock(result.block)).toContain("BD | o---");
  });

  it("copies repeat playback content and pastes it as a normal editable bar", () => {
    const source = parseDrumBlock("HH | X---\n%x2");
    const target = parseDrumBlock("SD | o--- | ----");
    const payload = captureBarClipboardPayload(source, 1);

    const result = pasteBarClipboardPayload(target, 1, payload!);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.block.bars[1].measureRepeat).toBeUndefined();
    expect(findHit(result.block, result.block.bars[1].startSlot, "closed-hat")?.articulation).toBe("accent");
  });

  it("rejects incompatible timing without mutating the target", () => {
    const source = parseDrumBlock("Time: 3/4\nHH | x-----------");
    const target = parseDrumBlock("Time: 4/4\nHH | x---------------");
    const payload = captureBarClipboardPayload(source, 0);

    const result = pasteBarClipboardPayload(target, 0, payload!);

    expect(result).toEqual({ ok: false, reason: "incompatible" });
    expect(serializeDrumBlock(target)).toBe("HH | x---------------");
  });

  it("rejects different grids and different shorthand bar widths", () => {
    const grid32Payload = captureBarClipboardPayload(parseDrumBlock("Grid: 32\nHH | x---"), 0)!;
    const shortPayload = captureBarClipboardPayload(parseDrumBlock("HH | x---"), 0)!;
    const grid16Target = parseDrumBlock("HH | ----------------");

    expect(pasteBarClipboardPayload(grid16Target, 0, grid32Payload)).toEqual({
      ok: false,
      reason: "incompatible"
    });
    expect(pasteBarClipboardPayload(grid16Target, 0, shortPayload)).toEqual({
      ok: false,
      reason: "incompatible"
    });
  });

  it("treats repeat and sticking content as meaningful overwrite targets", () => {
    const repeat = parseDrumBlock("HH | x---\n%");
    const sticking = parseDrumBlock("ST | R---\nHH | ----");
    const empty = parseDrumBlock("HH | ----");

    expect(barHasMeaningfulContent(repeat, 1)).toBe(true);
    expect(barHasMeaningfulContent(sticking, 0)).toBe(true);
    expect(barHasMeaningfulContent(empty, 0)).toBe(false);
  });

  it("round-trips pasted content idempotently", () => {
    const source = parseDrumBlock("ST | R-L-\nHH | X-x-\nSD | --g-");
    const target = parseDrumBlock("HH | ---- | x---\nBD | o--- | ----");
    const payload = captureBarClipboardPayload(source, 0);
    const result = pasteBarClipboardPayload(target, 1, payload!);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const serialized = serializeDrumBlock(result.block);
    expect(serializeDrumBlock(parseDrumBlock(serialized))).toBe(serialized);
  });
});

describe("session bar clipboard", () => {
  it("starts empty, validates payloads, and notifies subscribers", () => {
    const store = new DrumBarClipboardStore();
    const listener = vi.fn();
    const payload = captureBarClipboardPayload(parseDrumBlock("HH | x---"), 0)!;
    const unsubscribe = store.subscribe(listener);

    expect(store.get()).toBeNull();
    expect(store.set("HH | x---")).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(store.set(payload)).toBe(true);
    expect(listener).toHaveBeenLastCalledWith(payload);

    const replacement = captureBarClipboardPayload(parseDrumBlock("SD | --o-"), 0)!;
    expect(store.set(replacement)).toBe(true);
    expect(listener).toHaveBeenLastCalledWith(replacement);

    unsubscribe();
    store.clear();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("recognizes only versioned bar payloads and serializes readable notation", () => {
    const payload = captureBarClipboardPayload(
      parseDrumBlock("Time: 3/4\nST | R-----------\nHH | X-----------"),
      0
    )!;

    expect(isDrumBarClipboardPayload(payload)).toBe(true);
    expect(isDrumBarClipboardPayload({ ...payload, kind: "something-else" })).toBe(false);
    expect(serializeDrumBarClipboardText(payload)).toBe(
      "```drums\nTime: 3/4\nGrid: 16\nST | R-----------\nHH | X-----------\n```"
    );
  });
});
