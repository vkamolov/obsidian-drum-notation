import { describe, expect, it } from "vitest";
import {
  createDefaultRepetitionGoalConfig,
  createPracticeRunMetrics,
  createPracticeRunSummary,
  createTapTempoState,
  formatActiveSessionTime,
  formatPracticeSummaryMarkdown,
  formatPracticeTarget,
  insertPracticeLogEntry,
  normalizePracticeLogPath,
  recordPracticePass,
  recordTapTempo,
  resumePracticeRunMetrics,
  settlePracticeRunMetrics,
  type PracticeClock
} from "../src/practice-session";

function fakeClock(wall = new Date(2026, 7, 27, 19, 42).getTime(), monotonic = 1000) {
  let wallNow = wall;
  let monotonicNow = monotonic;
  const clock: PracticeClock = {
    wallNowMs: () => wallNow,
    monotonicNowMs: () => monotonicNow
  };
  return {
    clock,
    advance(milliseconds: number) {
      wallNow += milliseconds;
      monotonicNow += milliseconds;
    }
  };
}

describe("practice targets and repetition goals", () => {
  it("defaults to normalized selected bars and formats canonical labels", () => {
    expect(createDefaultRepetitionGoalConfig(5, [3, 1, 3], 0)).toEqual({
      target: { kind: "selected-bars", barIndexes: [1, 3] },
      totalPasses: 8
    });
    expect(formatPracticeTarget({ kind: "current-bar", barIndex: 2 })).toBe("Bar 3");
    expect(formatPracticeTarget({ kind: "selected-bars", barIndexes: [1, 2, 3] })).toBe("Bars 2–4");
    expect(formatPracticeTarget({ kind: "selected-bars", barIndexes: [0, 2, 4] })).toBe("Bars 1, 3, 5");
    expect(formatPracticeTarget({ kind: "whole-notation" })).toBe("Whole notation");
  });
});

describe("practice clock and metrics", () => {
  it("settles active time and excludes a silent interval before resume", () => {
    const controlled = fakeClock();
    let metrics = createPracticeRunMetrics(90, controlled.clock);
    controlled.advance(1500);
    metrics = settlePracticeRunMetrics(metrics, controlled.clock);
    controlled.advance(60 * 60 * 1000);
    metrics = resumePracticeRunMetrics(metrics, 95, controlled.clock);
    controlled.advance(500);
    metrics = settlePracticeRunMetrics(metrics, controlled.clock);

    expect(metrics.elapsedActiveMs).toBe(2000);
    expect(metrics.activeSinceClockMs).toBeNull();
    expect(metrics.endBpm).toBe(95);
  });

  it("keeps performed passes uncapped for session summaries", () => {
    const controlled = fakeClock();
    let metrics = createPracticeRunMetrics(80, controlled.clock);
    for (let pass = 0; pass < 24; pass++) metrics = recordPracticePass(metrics, 120);
    const summary = createPracticeRunSummary(
      "tempo-ramp",
      { kind: "whole-notation" },
      metrics,
      null,
      true,
      controlled.clock
    );
    expect(summary.performedPasses).toBe(24);
    expect(summary.requestedPasses).toBeNull();
  });
});

describe("tap tempo", () => {
  it("averages up to five recent intervals and resets after a long pause", () => {
    let state = createTapTempoState();
    [0, 500, 1000, 1500, 2000, 2500, 3000].forEach((time) => {
      state = recordTapTempo(state, time);
    });
    expect(state.bpm).toBe(120);
    expect(state.tapTimesMs).toHaveLength(6);

    state = recordTapTempo(state, 6000);
    expect(state).toEqual({ tapTimesMs: [6000], bpm: null });
  });

  it("does not offer an out-of-range measured tempo", () => {
    let state = recordTapTempo(createTapTempoState(), 0);
    state = recordTapTempo(state, 100);
    expect(state.bpm).toBeNull();
  });

  it("averages only valid intervals after an accidental double tap", () => {
    let state = createTapTempoState();
    [0, 100, 600, 1100].forEach((time) => {
      state = recordTapTempo(state, time);
    });

    expect(state.bpm).toBe(120);
  });
});

describe("practice log helpers", () => {
  const controlled = fakeClock();
  const metrics = {
    ...createPracticeRunMetrics(80, controlled.clock),
    elapsedActiveMs: 252000,
    activeSinceClockMs: null,
    endBpm: 100,
    performedPasses: 8,
    status: "complete" as const
  };

  it("formats active session time with stable two-digit seconds", () => {
    expect(formatActiveSessionTime(0)).toBe("0m 00s");
    expect(formatActiveSessionTime(4 * 60_000 + 2_000)).toBe("4m 02s");
    expect(formatActiveSessionTime(12 * 60_000 + 34_000)).toBe("12m 34s");
  });

  it("formats goal and ramp entries without null denominators", () => {
    const goal = createPracticeRunSummary(
      "repetition-goal",
      { kind: "selected-bars", barIndexes: [0, 1] },
      metrics,
      8,
      true,
      controlled.clock
    );
    const goalEntry = formatPracticeSummaryMarkdown(goal, {
      sourcePath: "Practice/Grooves.md",
      blockTitle: "Single paradiddle",
      note: "Relaxed\nat the target tempo."
    });
    expect(goalEntry.date).toBe("2026-08-27");
    expect(goalEntry.markdown).toContain("8/8 passes — 80 → 100 BPM — 4m 12s");
    expect(goalEntry.markdown).toContain("Note: Relaxed at the target tempo.");

    const ramp = createPracticeRunSummary(
      "tempo-ramp",
      { kind: "selected-bars", barIndexes: [1, 2, 3] },
      { ...metrics, performedPasses: 24 },
      null,
      true,
      controlled.clock
    );
    const rampEntry = formatPracticeSummaryMarkdown(ramp, {
      sourcePath: "Practice/Grooves.md",
      blockTitle: "Single paradiddle"
    });
    expect(rampEntry.markdown).toContain("24 passes — 80 → 100 BPM");
    expect(rampEntry.markdown).not.toContain("/null");
  });

  it("formats partial goals, unchanged tempo, and escaped inline content safely", () => {
    const summary = createPracticeRunSummary(
      "repetition-goal",
      { kind: "current-bar", barIndex: 2 },
      {
        ...metrics,
        startBpm: 90,
        endBpm: 90,
        performedPasses: 5
      },
      8,
      false,
      controlled.clock
    );
    const entry = formatPracticeSummaryMarkdown(summary, {
      sourcePath: "Practice/[Grooves]|Main.md",
      blockTitle: "Single\n*paradiddle*",
      note: "Keep | relaxed\nthrough the bar"
    });

    expect(entry.markdown).toContain("5/8 passes — 90 BPM");
    expect(entry.markdown).toContain("[[Practice/\\[Grooves\\]\\|Main]]");
    expect(entry.markdown).toContain("Single \\*paradiddle\\*");
    expect(entry.markdown).toContain("Note: Keep | relaxed through the bar");
  });

  it("inserts beneath the last matching date before the next major heading", () => {
    const current = "# Practice\n\n## 2026-08-27\n\n- old\n\n## Notes\n\nText\n\n## 2026-08-27\n\n- later\n\n# Archive\n";
    const updated = insertPracticeLogEntry(current, "2026-08-27", "- new");
    expect(updated.indexOf("- later")).toBeLessThan(updated.indexOf("- new"));
    expect(updated.indexOf("- new")).toBeLessThan(updated.indexOf("# Archive"));
  });

  it("validates and normalizes vault-relative log paths", () => {
    expect(normalizePracticeLogPath("Logs/Drums")).toEqual({ ok: true, path: "Logs/Drums.md" });
    expect(normalizePracticeLogPath("../outside.md").ok).toBe(false);
    expect(normalizePracticeLogPath("/absolute.md").ok).toBe(false);
  });
});
