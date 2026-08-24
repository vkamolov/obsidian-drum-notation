import { describe, expect, it, vi } from "vitest";
import {
  DrumTransportSession,
  DrumTransportSessionStore,
  hasCompatiblePracticeStructure,
  isPracticeRegionSelected,
  normalizePracticeBarIndexes,
  resolvePracticeControllerTarget,
  togglePracticeRegion
} from "../src/practice";
import { parseDrumBlock } from "../src/parser";

function makeSession(overrides: Partial<DrumTransportSession> = {}): DrumTransportSession {
  return {
    body: "HH | xxxx",
    speedPercent: 100,
    metronomeMode: "off",
    countInMode: "off",
    mutedInstrumentIds: [],
    selection: { barIndexes: [] },
    selectionModeOpen: false,
    currentBarIndex: 0,
    ...overrides
  };
}

describe("practice selection", () => {
  it("normalizes indexes into valid score order", () => {
    expect(normalizePracticeBarIndexes([3, 1, 3, -1, 7, 2.5], 5)).toEqual([1, 3]);
  });

  it("toggles every expanded bar represented by a compact repeat region", () => {
    const region = { barIndexes: [1, 2, 3] };
    const selected = togglePracticeRegion({ barIndexes: [0] }, region, 5);

    expect(selected.barIndexes).toEqual([0, 1, 2, 3]);
    expect(isPracticeRegionSelected(selected, region)).toBe(true);
    expect(togglePracticeRegion(selected, region, 5).barIndexes).toEqual([0]);
  });

  it("retains selections only across content-compatible edits", () => {
    const original = parseDrumBlock("Time: 4/4\nHH | xxxx | x---");
    const noteEdit = parseDrumBlock("Time: 4/4\nHH | x-x- | x---");
    const addedBar = parseDrumBlock("Time: 4/4\nHH | xxxx | x--- | --x-");
    const changedMeter = parseDrumBlock("Time: 3/4\nHH | xxx | x--");

    expect(hasCompatiblePracticeStructure(original, noteEdit)).toBe(true);
    expect(hasCompatiblePracticeStructure(original, addedBar)).toBe(false);
    expect(hasCompatiblePracticeStructure(original, changedMeter)).toBe(false);
  });
});

describe("practice command target resolution", () => {
  const candidate = (
    value: string,
    overrides: Partial<{
      isPlaying: boolean;
      isInActiveView: boolean;
      isVisible: boolean;
      isLastInteracted: boolean;
    }> = {}
  ) => ({
    value,
    isPlaying: false,
    isInActiveView: false,
    isVisible: true,
    isLastInteracted: false,
    ...overrides
  });

  it("prefers playing and last-interacted blocks in the active view", () => {
    expect(resolvePracticeControllerTarget([
      candidate("global", { isLastInteracted: true }),
      candidate("active-last", { isInActiveView: true, isLastInteracted: true }),
      candidate("active-playing", { isInActiveView: true, isPlaying: true })
    ])).toEqual({ value: "active-playing", ambiguous: false });

    expect(resolvePracticeControllerTarget([
      candidate("global", { isLastInteracted: true }),
      candidate("active-last", { isInActiveView: true, isLastInteracted: true })
    ])).toEqual({ value: "active-last", ambiguous: false });
  });

  it("uses the sole visible active block before a global fallback", () => {
    expect(resolvePracticeControllerTarget([
      candidate("global", { isLastInteracted: true }),
      candidate("hidden-active", { isInActiveView: true, isVisible: false }),
      candidate("visible-active", { isInActiveView: true })
    ])).toEqual({ value: "visible-active", ambiguous: false });

    expect(resolvePracticeControllerTarget([
      candidate("global", { isLastInteracted: true })
    ])).toEqual({ value: "global", ambiguous: false });
  });

  it("reports ambiguity only when multiple visible active blocks have no preferred target", () => {
    expect(resolvePracticeControllerTarget([
      candidate("one", { isInActiveView: true }),
      candidate("two", { isInActiveView: true })
    ])).toEqual({ value: null, ambiguous: true });

    expect(resolvePracticeControllerTarget([])).toEqual({ value: null, ambiguous: false });
  });
});

describe("DrumTransportSessionStore", () => {
  it("uses the exact source body as a restoration guard", () => {
    const store = new DrumTransportSessionStore();
    store.set("note.md:4", makeSession());

    expect(store.get("note.md:4", "HH | xxxx")).not.toBeNull();
    expect(store.get("note.md:4", "HH | x---")).toBeNull();
  });

  it("normalizes shared state, notifies subscribers, and skips no-op updates", () => {
    const store = new DrumTransportSessionStore();
    const listener = vi.fn();
    store.subscribe("note.md:4", listener);
    const session = makeSession({
      mutedInstrumentIds: ["snare", "kick", "snare"],
      selection: { barIndexes: [3, 1, 3] }
    });

    store.set("note.md:4", session);
    store.set("note.md:4", session);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      mutedInstrumentIds: ["kick", "snare"],
      selection: { barIndexes: [1, 3] }
    }));
  });

  it("isolates source blocks and migrates a plugin-authored body", () => {
    const store = new DrumTransportSessionStore();
    store.set("note.md:4", makeSession({ selection: { barIndexes: [1] } }));
    store.set("note.md:12", makeSession({ body: "SD | o---" }));

    expect(store.migrate(
      "note.md:4",
      "HH | xxxx",
      makeSession({ body: "HH | x-x-", selection: { barIndexes: [1] } })
    )).toBe(true);
    expect(store.get("note.md:4", "HH | x-x-")?.selection.barIndexes).toEqual([1]);
    expect(store.get("note.md:12", "SD | o---")).not.toBeNull();
  });

  it("evicts the least-recently-used session", () => {
    const store = new DrumTransportSessionStore(2);
    store.set("one", makeSession({ body: "one" }));
    store.set("two", makeSession({ body: "two" }));
    expect(store.get("one", "one")).not.toBeNull();
    store.set("three", makeSession({ body: "three" }));

    expect(store.get("one", "one")).not.toBeNull();
    expect(store.get("two", "two")).toBeNull();
    expect(store.get("three", "three")).not.toBeNull();
  });

  it("clears session state and subscriptions without persistence", () => {
    const store = new DrumTransportSessionStore();
    const listener = vi.fn();
    store.subscribe("one", listener);
    store.set("one", makeSession({ body: "one" }));
    store.clear();
    store.set("one", makeSession({ body: "one", speedPercent: 110 }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);
  });
});
