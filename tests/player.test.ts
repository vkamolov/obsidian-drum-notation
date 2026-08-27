import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSecondsPerSlot, getSlotVisualDurationSeconds, getSlotsPerBar } from "../src/music";
import { parseDrumBlock } from "../src/parser";
import {
  createMetronomeHit,
  DEFAULT_COUNT_IN_MODE,
  DrumPlaybackBackend,
  DrumPlaybackBackendFactory,
  filterMutedHits,
  getCountInBarCount,
  getCountInDurationQuarter,
  getCountInModeLabel,
  getCountInPulses,
  getCountInSlotCount,
  getClickSubdivisionMenuLabel,
  getEffectivePlaybackTempo,
  getMetronomePulses,
  getSafeClickSubdivision,
  getSafeClickSubdivisionAtTempo,
  isClickSubdivisionSafe,
  isClickSubdivisionSafeAtTempo,
  isGapClickBar,
  normalizePlaybackSpeedPercent,
  recoverAudioContext
} from "../src/playback";
import { buildPlaybackRoadmap, buildSelectedPlaybackRoadmap, DrumPlayer } from "../src/player";
import { DrumHit } from "../src/types";

class FakePlaybackBackend implements DrumPlaybackBackend {
  currentTime = 10;
  started = false;
  stopped = false;
  scheduled: Array<{
    hits: DrumHit[];
    time: number;
    slotDuration?: number;
    noteDuration?: number;
  }> = [];

  async start(): Promise<void> {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }

  scheduleHits(hits: DrumHit[], time: number, slotDuration?: number, noteDuration?: number): void {
    this.scheduled.push({ hits, time, slotDuration, noteDuration });
  }
}

function metronomeSchedules(backend: FakePlaybackBackend) {
  return backend.scheduled.filter((entry) =>
    entry.hits.some((hit) => hit.instrument.id === "metronome")
  );
}

function notationSchedules(backend: FakePlaybackBackend) {
  return backend.scheduled.filter((entry) =>
    entry.hits.every((hit) => hit.instrument.id !== "metronome")
  );
}

interface FakeAudioContextOptions {
  state: string;
  resumeFails?: boolean;
}

class FakeAudioContext {
  state: string;
  resume = vi.fn(async () => {
    if (this.resumeFails) {
      throw new Error("resume failed");
    }

    this.state = "running";
  });

  constructor(private readonly options: FakeAudioContextOptions) {
    this.state = options.state;
  }

  private get resumeFails(): boolean {
    return this.options.resumeFails === true;
  }
}

describe("DrumPlayer", () => {
  let clearTimeoutMock: ReturnType<typeof vi.fn>;
  let scheduledTimers: Array<() => void>;
  let scheduledTimerDelays: number[];

  beforeEach(() => {
    scheduledTimers = [];
    scheduledTimerDelays = [];
    clearTimeoutMock = vi.fn();

    vi.stubGlobal("window", {
      setTimeout: vi.fn((callback: TimerHandler, delay?: number) => {
        if (typeof callback === "function") {
          scheduledTimers.push(callback);
          scheduledTimerDelays.push(delay ?? 0);
        }

        return scheduledTimers.length;
      }),
      clearTimeout: clearTimeoutMock
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the injected playback backend for scheduled hits and stop", async () => {
    const block = parseDrumBlock(`Tempo: 100
HH | x---
BD | o---`);
    const backend = new FakePlaybackBackend();
    const audioContext = {} as AudioContext;
    const factory = vi.fn((receivedAudioContext: AudioContext) => {
      expect(receivedAudioContext).toBe(audioContext);
      return backend;
    }) as DrumPlaybackBackendFactory;
    const player = new DrumPlayer(audioContext, block, vi.fn(), vi.fn(), { repeatCount: 1 }, factory);

    await player.play();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(backend.started).toBe(true);
    expect(backend.scheduled).toHaveLength(4);
    expect(backend.scheduled[0].hits.map((hit) => hit.instrument.id)).toEqual(["closed-hat", "kick"]);
    expect(backend.scheduled[0].time).toBeCloseTo(10.08);
    expect(backend.scheduled[0].slotDuration).toBeCloseTo(getSecondsPerSlot(block));
    expect(backend.scheduled[1].hits).toEqual([]);

    player.stop();

    expect(backend.stopped).toBe(true);
    expect(clearTimeoutMock).toHaveBeenCalledTimes(scheduledTimers.length);
  });

  it("schedules tuplet positions on the quarter-note timeline", async () => {
    const block = parseDrumBlock(`Tempo: 100
HH | 3(xxx)`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { repeatCount: 1 },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(backend.scheduled.map((entry) => entry.time)).toEqual([
      expect.closeTo(10.08, 8),
      expect.closeTo(10.28, 8),
      expect.closeTo(10.48, 8)
    ]);
    expect(backend.scheduled.map((entry) => entry.slotDuration)).toEqual([
      expect.closeTo(0.2, 8),
      expect.closeTo(0.2, 8),
      expect.closeTo(0.2, 8)
    ]);

    backend.currentTime = 10.29;
    expect(player.getCurrentSlotIndex()).toBe(1);
  });

  it("normalizes speed and schedules scaled slot and note durations", async () => {
    const block = parseDrumBlock(`Tempo: 100
SD | z---`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { speedPercent: 62 },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(normalizePlaybackSpeedPercent(10)).toBe(25);
    expect(normalizePlaybackSpeedPercent(24)).toBe(25);
    expect(normalizePlaybackSpeedPercent(37)).toBe(35);
    expect(normalizePlaybackSpeedPercent(47)).toBe(45);
    expect(normalizePlaybackSpeedPercent(62)).toBe(60);
    expect(normalizePlaybackSpeedPercent(88)).toBe(90);
    expect(normalizePlaybackSpeedPercent(100)).toBe(100);
    expect(normalizePlaybackSpeedPercent(153)).toBe(150);
    expect(normalizePlaybackSpeedPercent(Number.NaN)).toBe(100);
    expect(getEffectivePlaybackTempo(100, 50)).toBe(50);
    expect(getEffectivePlaybackTempo(100, 150)).toBe(150);
    expect(backend.scheduled[0].slotDuration).toBeCloseTo(getSecondsPerSlot(block, 60));
    expect(backend.scheduled[0].noteDuration).toBeCloseTo(
      getSlotVisualDurationSeconds(block, block.slots[0], 60)
    );
  });

  it("schedules transport playback at 150 percent speed", async () => {
    const block = parseDrumBlock(`Tempo: 100
HH | x---`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { speedPercent: 150 },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    const expectedSlotDuration = 60 / (100 * 1.5) / 4;

    expect(backend.scheduled[0].slotDuration).toBeCloseTo(expectedSlotDuration);
    expect(backend.scheduled[0].slotDuration).toBeCloseTo(getSecondsPerSlot(block, 150));
  });

  it("uses exact BPM and stops after a finite pass goal", async () => {
    const block = parseDrumBlock("Tempo: 120\nHH | x---");
    const backend = new FakePlaybackBackend();
    const onPassStart = vi.fn();
    const onPassComplete = vi.fn();
    const onEnded = vi.fn();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      onEnded,
      vi.fn(),
      {
        exactTempoBpm: 90,
        passLimit: 2,
        onPassStart,
        onPassComplete
      },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();
    expect(notationSchedules(backend)[0].slotDuration).toBeCloseTo(60 / 90 / 4);
    expect(onPassStart).toHaveBeenCalledWith({ passIndex: 0, completedPasses: 0, tempoBpm: 90 });

    scheduledTimers[scheduledTimers.length - 1]?.();
    expect(onPassComplete).toHaveBeenCalledWith({ passIndex: 0, completedPasses: 1, tempoBpm: 90 });
    expect(onPassStart).toHaveBeenLastCalledWith({ passIndex: 1, completedPasses: 1, tempoBpm: 90 });

    scheduledTimers[scheduledTimers.length - 1]?.();
    expect(onPassComplete).toHaveBeenLastCalledWith({ passIndex: 1, completedPasses: 2, tempoBpm: 90 });
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("adds beat-only count-in before every later pass", async () => {
    const block = parseDrumBlock("Tempo: 120\nHH | x---------------");
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      {
        exactTempoBpm: 60,
        countInMode: "1-bar",
        countInCadence: "every-pass",
        passLimit: 2
      },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();
    expect(metronomeSchedules(backend)).toHaveLength(4);
    scheduledTimers[scheduledTimers.length - 1]?.();
    expect(metronomeSchedules(backend)).toHaveLength(8);
    expect(metronomeSchedules(backend).every((entry) => entry.hits[0]?.velocity !== 0.45)).toBe(true);
    const secondPassStart = notationSchedules(backend)[16].time;
    expect(secondPassStart).toBeCloseTo(10.08 + 12);
  });

  it("uses the upcoming ramp BPM for an every-pass count-in", async () => {
    const block = parseDrumBlock("Tempo: 120\nHH | x---");
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      {
        countInMode: "1-bar",
        countInCadence: "every-pass",
        tempoRamp: {
          config: {
            target: { kind: "whole-notation" },
            startBpm: 60,
            stepBpm: 10,
            passesPerStep: 1,
            ceilingBpm: 70,
            endBehavior: "stop"
          },
          progress: { completedPasses: 0, completed: false }
        }
      },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();
    scheduledTimers[scheduledTimers.length - 1]?.();

    const secondCountIn = metronomeSchedules(backend).slice(4);
    expect(secondCountIn).toHaveLength(4);
    expect(secondCountIn[1].time - secondCountIn[0].time).toBeCloseTo(60 / 70);
    expect(notationSchedules(backend)[4].time - secondCountIn[0].time).toBeCloseTo(4 * 60 / 70);
  });

  it("schedules tempo-ramp passes at exact BPM without recreating the backend", async () => {
    const block = parseDrumBlock(`Tempo: 120
HH | x---`);
    const backend = new FakePlaybackBackend();
    const factory = vi.fn(() => backend) as DrumPlaybackBackendFactory;
    const onPassStart = vi.fn();
    const onPassComplete = vi.fn();
    const onEnded = vi.fn();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      onEnded,
      vi.fn(),
      {
        tempoRamp: {
          config: {
            target: { kind: "whole-notation" },
            startBpm: 60,
            stepBpm: 10,
            passesPerStep: 1,
            ceilingBpm: 70,
            endBehavior: "stop"
          },
          progress: { completedPasses: 0, completed: false }
        },
        onTempoRampPassStart: onPassStart,
        onTempoRampPassComplete: onPassComplete
      },
      factory
    );

    await player.play();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(onPassStart.mock.calls[0]?.[0]).toMatchObject({ tempoBpm: 60, passInStep: 1 });
    expect(notationSchedules(backend)[0].slotDuration).toBeCloseTo(0.25);

    scheduledTimers[scheduledTimers.length - 1]?.();

    expect(onPassComplete.mock.calls[0]?.[0]).toMatchObject({ completedPasses: 1, tempoBpm: 70 });
    expect(onPassStart.mock.calls[1]?.[0]).toMatchObject({ tempoBpm: 70, atCeiling: true });
    expect(notationSchedules(backend)[4].slotDuration).toBeCloseTo(60 / 70 / 4);
    expect(factory).toHaveBeenCalledTimes(1);
    backend.currentTime = notationSchedules(backend)[4].time + 0.01;
    expect(player.getCurrentPlaybackPosition()).toMatchObject({
      slotIndex: 0,
      blockPassIndex: 1,
      roadmapEntryIndex: 0
    });

    scheduledTimers[scheduledTimers.length - 1]?.();

    expect(onPassComplete.mock.calls[1]?.[0]).toMatchObject({ completedPasses: 2, completed: true });
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("runs trainer count-in at the current exact ramp BPM", async () => {
    const block = parseDrumBlock(`Tempo: 120
HH | x---`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      {
        countInMode: "1-bar",
        tempoRamp: {
          config: {
            target: { kind: "whole-notation" },
            startBpm: 60,
            stepBpm: 5,
            passesPerStep: 4,
            ceilingBpm: 80,
            endBehavior: "hold"
          },
          progress: { completedPasses: 4, completed: false }
        }
      },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(metronomeSchedules(backend)).toHaveLength(4);
    expect(notationSchedules(backend)[0].time).toBeCloseTo(10.08 + 4 * (60 / 65));
  });

  it("steps an unsafe advanced-click subdivision down at the active ramp BPM", async () => {
    const block = parseDrumBlock("Tempo: 60\nTime: 4/4\nHH | x---------------");
    const backend = new FakePlaybackBackend();
    const onPassStart = vi.fn();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      {
        clickSubdivision: "4-per-beat",
        tempoRamp: {
          config: {
            target: { kind: "whole-notation" },
            startBpm: 250,
            stepBpm: 10,
            passesPerStep: 1,
            ceilingBpm: 260,
            endBehavior: "hold"
          },
          progress: { completedPasses: 1, completed: false }
        },
        onTempoRampPassStart: onPassStart
      },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(onPassStart).toHaveBeenCalledWith(expect.objectContaining({
      tempoBpm: 260,
      clickSubdivision: "3-per-beat"
    }));
    expect(metronomeSchedules(backend)).toHaveLength(0);
  });

  it("schedules buzz rolls for the corrected Grid 16 visual span", async () => {
    const block = parseDrumBlock(`Tempo: 100
SD | z--o`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      {},
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(backend.scheduled[0].hits[0].articulation).toBe("buzz");
    expect(backend.scheduled[0].noteDuration).toBeCloseTo(getSecondsPerSlot(block) * 3);
    expect(backend.scheduled[3].noteDuration).toBeCloseTo(getSecondsPerSlot(block));
  });

  it("passes the inferred eighth-note duration to double-stroke diddles", async () => {
    const block = parseDrumBlock(`Tempo: 72
Grid: 16
SD | d-d-d-d-d-d-d-d-`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      {},
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    const diddles = backend.scheduled.filter((entry) =>
      entry.hits.some((hit) => hit.articulation === "diddle")
    );
    const expectedDuration = getSecondsPerSlot(block) * 2;

    expect(diddles).toHaveLength(8);
    diddles.forEach((entry) => expect(entry.noteDuration).toBeCloseTo(expectedDuration));
  });

  it.each([
    ["4/4", 16, [0, 4, 8, 12]],
    ["4/4", 32, [0, 8, 16, 24]],
    ["3/4", 16, [0, 4, 8]],
    ["3/4", 32, [0, 8, 16]],
    ["7/8", 16, [0, 2, 4, 6, 8, 10, 12]],
    ["7/8", 32, [0, 4, 8, 12, 16, 20, 24]],
    ["6/8", 16, [0, 6]],
    ["6/8", 32, [0, 12]],
    ["9/8", 16, [0, 6, 12]],
    ["9/8", 32, [0, 12, 24]],
    ["12/8", 16, [0, 6, 12, 18]],
    ["12/8", 32, [0, 12, 24, 36]]
  ] as const)("places metronome pulses for %s at grid %i", (timeSignature, grid, expected) => {
    const slotsPerBar = getSlotsPerBar(timeSignature, grid);
    const block = parseDrumBlock(`Time: ${timeSignature}
Grid: ${grid}
HH | ${"-".repeat(slotsPerBar)}`);

    expect(getMetronomePulses(block).map((pulse) => pulse.slotIndex)).toEqual(expected);
  });

  it("uses each bar's effective meter for mixed-meter metronome pulses", () => {
    const block = parseDrumBlock(`Time: 4/4
HH | x-x-x-x-x-x-x-x-
Bar
Time: 3/4
HH | x-x-x-x-x-x-`);

    expect(getMetronomePulses(block).map((pulse) => [
      pulse.slotIndex,
      pulse.quarterOffset,
      pulse.intervalQuarter,
      pulse.kind
    ])).toEqual([
      [0, 0, 1, "downbeat"],
      [4, 1, 1, "beat"],
      [8, 2, 1, "beat"],
      [12, 3, 1, "beat"],
      [16, 4, 1, "downbeat"],
      [20, 5, 1, "beat"],
      [24, 6, 1, "beat"]
    ]);
  });

  it("subdivides 4/4 metronome beats into 4, 8, 12, and 16 pulses", () => {
    const block = parseDrumBlock("Time: 4/4\nGrid: 16\nHH | x---------------");

    expect(getMetronomePulses(block, 0, block.slots.length, "beat")).toHaveLength(4);
    expect(getMetronomePulses(block, 0, block.slots.length, "2-per-beat")).toHaveLength(8);
    expect(getMetronomePulses(block, 0, block.slots.length, "3-per-beat")).toHaveLength(12);
    expect(getMetronomePulses(block, 0, block.slots.length, "4-per-beat")).toHaveLength(16);
  });

  it("keeps compound-meter main beats and derives contextual subdivision labels", () => {
    const fourFour = parseDrumBlock("Time: 4/4\nHH | x---------------");
    const sixEight = parseDrumBlock("Time: 6/8\nHH | x-----------");

    expect(getMetronomePulses(sixEight)).toHaveLength(2);
    expect(getMetronomePulses(sixEight, 0, sixEight.slots.length, "3-per-beat")).toHaveLength(6);
    expect(getClickSubdivisionMenuLabel(fourFour, "3-per-beat")).toBe("3 per beat · eighth-note triplets");
    expect(getClickSubdivisionMenuLabel(sixEight, "3-per-beat")).toBe("3 per beat · eighths");
  });

  it.each([
    ["9/8", 12],
    ["12/8", 16],
    ["7/8", 28],
    ["7/16", 28]
  ] as const)("schedules four-per-beat clicks through %s", (timeSignature, pulseCount) => {
    const slots = getSlotsPerBar(timeSignature, 32);
    const block = parseDrumBlock(`Time: ${timeSignature}\nGrid: 32\nHH | ${"-".repeat(slots)}`);
    const pulses = getMetronomePulses(block, 0, block.slots.length, "4-per-beat");

    expect(pulses).toHaveLength(pulseCount);
    expect(pulses.every((pulse) => pulse.intervalQuarter > 0)).toBe(true);
  });

  it("labels mixed-meter subdivision values as varying by meter", () => {
    const block = parseDrumBlock(`Time: 4/4
HH | x---------------
Bar
Time: 6/8
HH | x-----------`);

    expect(getClickSubdivisionMenuLabel(block, "3-per-beat")).toBe("3 per beat · varies by meter");
  });

  it("uses distinct downbeat, beat, and subdivision click strengths", () => {
    expect(createMetronomeHit("downbeat").velocity).toBe(1);
    expect(createMetronomeHit("beat").velocity).toBe(0.65);
    expect(createMetronomeHit("subdivision").velocity).toBe(0.45);
  });

  it("enforces the added-click rate cap while keeping Beat available", () => {
    const block = parseDrumBlock("Tempo: 300\nTime: 4/4\nHH | x---------------");

    expect(isClickSubdivisionSafe(block, 150, "beat")).toBe(true);
    expect(isClickSubdivisionSafe(block, 150, "2-per-beat")).toBe(true);
    expect(isClickSubdivisionSafe(block, 150, "3-per-beat")).toBe(false);
    expect(isClickSubdivisionSafe(block, 150, "4-per-beat")).toBe(false);
    expect(getSafeClickSubdivision(block, 150, "4-per-beat")).toBe("2-per-beat");
  });

  it("enforces the click-rate cap against an exact trainer BPM", () => {
    const block = parseDrumBlock("Tempo: 60\nTime: 4/4\nHH | x---------------");

    expect(isClickSubdivisionSafeAtTempo(block, 240, "4-per-beat")).toBe(true);
    expect(isClickSubdivisionSafeAtTempo(block, 260, "4-per-beat")).toBe(false);
    expect(getSafeClickSubdivisionAtTempo(block, 260, "4-per-beat")).toBe("3-per-beat");
  });

  it("starts gap cycles with clicked bars and follows exact on/off patterns", () => {
    expect(Array.from({ length: 8 }, (_, index) => isGapClickBar("1-on-1-off", index))).toEqual([
      false, true, false, true, false, true, false, true
    ]);
    expect(Array.from({ length: 8 }, (_, index) => isGapClickBar("2-on-2-off", index))).toEqual([
      false, false, true, true, false, false, true, true
    ]);
    expect(Array.from({ length: 8 }, (_, index) => isGapClickBar("4-on-4-off", index))).toEqual([
      false, false, false, false, true, true, true, true
    ]);
  });

  it("defaults count-in to off and labels both count-in modes", () => {
    const block = parseDrumBlock("HH | x---");

    expect(DEFAULT_COUNT_IN_MODE).toBe("off");
    expect(getCountInModeLabel("off")).toBe("Off");
    expect(getCountInModeLabel("1-bar")).toBe("1 bar");
    expect(getCountInModeLabel("2-bars")).toBe("2 bars");
    expect(getCountInBarCount("off")).toBe(0);
    expect(getCountInBarCount("1-bar")).toBe(1);
    expect(getCountInBarCount("2-bars")).toBe(2);
    expect(getCountInSlotCount(block)).toBe(0);
    expect(getCountInPulses(block)).toEqual([]);
  });

  it("keeps count-in beat-only regardless of performance subdivision", () => {
    const block = parseDrumBlock("Time: 4/4\nHH | x---------------");
    const pulses = getCountInPulses(block, "2-bars");

    expect(pulses).toHaveLength(8);
    expect(pulses.every((pulse) => pulse.kind === "downbeat" || pulse.kind === "beat")).toBe(true);
    expect(pulses.filter((pulse) => pulse.kind === "downbeat")).toHaveLength(2);
  });

  it.each([
    ["4/4", 16, 16, [0, 4, 8, 12]],
    ["3/4", 16, 12, [0, 4, 8]],
    ["6/8", 16, 12, [0, 6]],
    ["7/8", 16, 14, [0, 2, 4, 6, 8, 10, 12]],
    ["12/8", 16, 24, [0, 6, 12, 18]]
  ] as const)("uses one expected meter bar for %s count-in", (timeSignature, grid, expectedSlots, expectedPulses) => {
    const block = parseDrumBlock(`Time: ${timeSignature}
Grid: ${grid}
HH | x---`);

    expect(getCountInSlotCount(block, "1-bar")).toBe(expectedSlots);
    expect(getCountInPulses(block, "1-bar").map((pulse) => pulse.slotIndex)).toEqual(expectedPulses);
  });

  it.each([
    ["4/4", 16, 16, [0, 4, 8, 12]],
    ["3/4", 16, 12, [0, 4, 8]],
    ["6/8", 16, 12, [0, 6]],
    ["7/8", 16, 14, [0, 2, 4, 6, 8, 10, 12]],
    ["12/8", 16, 24, [0, 6, 12, 18]]
  ] as const)("uses two complete meter bars for %s count-in", (timeSignature, grid, slotsPerBar, firstBarPulses) => {
    const block = parseDrumBlock(`Time: ${timeSignature}
Grid: ${grid}
HH | x---`);
    const pulses = getCountInPulses(block, "2-bars");

    expect(getCountInSlotCount(block, "2-bars")).toBe(slotsPerBar * 2);
    expect(pulses.map((pulse) => pulse.slotIndex)).toEqual([
      ...firstBarPulses,
      ...firstBarPulses.map((slot) => slot + slotsPerBar)
    ]);
    expect(pulses.filter((pulse) => pulse.kind === "downbeat").map((pulse) => pulse.slotIndex)).toEqual([
      0,
      slotsPerBar
    ]);
  });

  it("uses the first played bar's meter for count-in", () => {
    const block = parseDrumBlock(`Time: 4/4
HH | x-x-x-x-x-x-x-x-
Bar
Time: 3/4
HH | x-x-x-x-x-x-`);

    expect(getCountInSlotCount(block, "1-bar", 16)).toBe(12);
    expect(getCountInPulses(block, "1-bar", 16).map((pulse) => pulse.slotIndex)).toEqual([0, 4, 8]);
    expect(getCountInSlotCount(block, "2-bars", 16)).toBe(24);
    expect(getCountInPulses(block, "2-bars", 16).map((pulse) => pulse.slotIndex)).toEqual([
      0, 4, 8, 12, 16, 20
    ]);
  });

  it("repeats the selected phrase's first meter for both count-in bars", async () => {
    const block = parseDrumBlock(`Tempo: 100
Time: 4/4
HH | x---------------
Bar
Time: 3/4
HH | x-----------`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { selectedBarIndexes: [1], countInMode: "2-bars" },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(metronomeSchedules(backend)).toHaveLength(6);
    expect(metronomeSchedules(backend).filter((entry) => entry.hits[0]?.velocity === 1)).toHaveLength(2);
    expect(notationSchedules(backend)[0].time).toBeCloseTo(10.08 + 6 * 0.6);
  });

  it("schedules a count-in from the resumed mixed-meter bar", async () => {
    const block = parseDrumBlock(`Tempo: 100
Time: 4/4
HH | x---------------
Bar
Time: 3/4
HH | x-----------`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { startSlot: 16, initialSlot: 16, countInMode: "1-bar" },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(backend.scheduled.slice(0, 3).every((entry) => entry.hits[0]?.instrument.id === "metronome")).toBe(true);
    expect(backend.scheduled[3].time).toBeCloseTo(10.08 + 3 * 0.6);
  });

  it("schedules one-bar count-in with the metronome off and without visual callbacks", async () => {
    const block = parseDrumBlock(`Tempo: 100
HH | x---------------`);
    const backend = new FakePlaybackBackend();
    const onSlotChange = vi.fn();
    const onBarChange = vi.fn();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      onSlotChange,
      { countInMode: "1-bar", metronomeMode: "off", onBarChange },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(backend.scheduled.slice(0, 4).map((entry) => entry.hits.map((hit) => hit.instrument.id))).toEqual([
      ["metronome"],
      ["metronome"],
      ["metronome"],
      ["metronome"]
    ]);
    expect(backend.scheduled[0].time).toBeCloseTo(10.08);
    expect(backend.scheduled[1].time).toBeCloseTo(10.08 + 4 * getSecondsPerSlot(block));
    expect(backend.scheduled[4].hits.map((hit) => hit.instrument.id)).toEqual(["closed-hat"]);
    expect(backend.scheduled[4].time).toBeCloseTo(10.08 + 16 * getSecondsPerSlot(block));
    expect(onSlotChange).not.toHaveBeenCalled();
    expect(onBarChange).not.toHaveBeenCalled();
  });

  it.each([25, 100, 150])("scales a two-bar count-in at %i percent speed", async (speedPercent) => {
    const block = parseDrumBlock(`Tempo: 100
HH | x---------------`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { countInMode: "2-bars", speedPercent },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(getCountInDurationQuarter(block, "2-bars")).toBe(8);
    expect(notationSchedules(backend)[0].time).toBeCloseTo(
      10.08 + 32 * getSecondsPerSlot(block, speedPercent)
    );
  });

  it("does not schedule another two-bar count-in between loop passes", async () => {
    const block = parseDrumBlock(`Tempo: 100
HH | x---------------`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { countInMode: "2-bars", loop: true },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();
    expect(metronomeSchedules(backend)).toHaveLength(8);

    const firstPassTimers = [...scheduledTimers];
    firstPassTimers[firstPassTimers.length - 1]();
    expect(metronomeSchedules(backend)).toHaveLength(8);
  });

  it("scales count-in timing with playback speed", async () => {
    const block = parseDrumBlock(`Tempo: 100
HH | x---------------`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { countInMode: "1-bar", speedPercent: 50 },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(backend.scheduled[4].time).toBeCloseTo(10.08 + 16 * getSecondsPerSlot(block, 50));
  });

  it("scales count-in timing at 150 percent speed", async () => {
    const block = parseDrumBlock(`Tempo: 100
HH | x---------------`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { countInMode: "1-bar", speedPercent: 150 },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(backend.scheduled[1].time).toBeCloseTo(10.08 + 4 * getSecondsPerSlot(block, 150));
    expect(backend.scheduled[4].time).toBeCloseTo(10.08 + 16 * getSecondsPerSlot(block, 150));
  });

  it("stops callbacks when cancelled during count-in", async () => {
    const block = parseDrumBlock(`Tempo: 100
HH | x---------------`);
    const backend = new FakePlaybackBackend();
    const onEnded = vi.fn();
    const onSlotChange = vi.fn();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      onEnded,
      onSlotChange,
      { countInMode: "1-bar" },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();
    player.stop();
    scheduledTimers.forEach((timer) => timer());

    expect(backend.stopped).toBe(true);
    expect(onSlotChange).not.toHaveBeenCalled();
    expect(onEnded).not.toHaveBeenCalled();
  });

  it("plays metronome pulses with drums and accents each bar downbeat", async () => {
    const block = parseDrumBlock(`HH | x---------------
BD | o---------------`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { metronomeMode: "with-drums" },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(backend.scheduled[0].hits.map((hit) => hit.instrument.id)).toEqual([
      "closed-hat",
      "kick"
    ]);
    expect(metronomeSchedules(backend)).toHaveLength(4);
    expect(
      metronomeSchedules(backend)[0].hits[0].velocity
    ).toBeGreaterThan(
      metronomeSchedules(backend)[1].hits[0].velocity
    );
  });

  it("schedules subdivided performance clicks without changing count-in clicks", async () => {
    const block = parseDrumBlock("Time: 4/4\nHH | x---------------");
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      {
        metronomeMode: "with-drums",
        countInMode: "1-bar",
        clickSubdivision: "3-per-beat"
      },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    const clicks = metronomeSchedules(backend);
    expect(clicks).toHaveLength(16);
    expect(clicks.slice(0, 4).every((entry) => entry.hits[0].velocity !== 0.45)).toBe(true);
    expect(clicks.slice(4).filter((entry) => entry.hits[0].velocity === 0.45)).toHaveLength(8);
  });

  it("continues gap phase through authored repeat passes and reports every occurrence", async () => {
    const block = parseDrumBlock("Repeat: 2\nHH | ---------------- | ----------------");
    const backend = new FakePlaybackBackend();
    const onBarChange = vi.fn();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      {
        metronomeMode: "metronome-only",
        gapClickMode: "1-on-1-off",
        repeatCount: block.repeatCount,
        onBarChange
      },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();
    const firstPassTimers = [...scheduledTimers];
    firstPassTimers.slice(0, -1).forEach((timer) => timer());
    firstPassTimers[firstPassTimers.length - 1]();
    scheduledTimers.slice(firstPassTimers.length).forEach((timer) => timer());

    expect(metronomeSchedules(backend)).toHaveLength(8);
    expect(onBarChange.mock.calls.map(([barIndex, state]) => [
      barIndex,
      state.barOccurrenceIndex,
      state.isGapBar
    ])).toEqual([
      [0, 0, false],
      [1, 1, true],
      [0, 2, false],
      [1, 3, true]
    ]);
  });

  it("reports the next silent occurrence when Loop Bar maps back to the same bar", async () => {
    const block = parseDrumBlock("HH | ----------------");
    const backend = new FakePlaybackBackend();
    const onBarChange = vi.fn();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { loop: true, gapClickMode: "1-on-1-off", onBarChange },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();
    scheduledTimers[0]();

    expect(onBarChange).toHaveBeenCalledWith(0, expect.objectContaining({
      barOccurrenceIndex: 0,
      isGapBar: false,
      nextBarIndex: 0,
      isNextGapBar: true
    }));
    player.stop();
  });

  it("plays only the metronome without letting instrument mutes suppress it", async () => {
    const block = parseDrumBlock("HH | xxxxxxxxxxxxxxxx");
    const backend = new FakePlaybackBackend();
    const onSlotChange = vi.fn();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      onSlotChange,
      {
        metronomeMode: "metronome-only",
        mutedInstrumentIds: new Set(["closed-hat", "metronome"])
      },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(notationSchedules(backend).every((entry) => entry.hits.length === 0)).toBe(true);
    expect(metronomeSchedules(backend)).toHaveLength(4);
    [...scheduledTimers].forEach((timer) => timer());
    expect(onSlotChange).toHaveBeenCalledWith(1);
  });

  it("keeps the metronome audible through all-rest bars", async () => {
    const block = parseDrumBlock("HH | ----------------");
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { metronomeMode: "with-drums" },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(metronomeSchedules(backend).map((entry) => entry.time)).toEqual([
      10.08,
      10.08 + 4 * getSecondsPerSlot(block),
      10.08 + 8 * getSecondsPerSlot(block),
      10.08 + 12 * getSecondsPerSlot(block)
    ]);
  });

  it("waits for the next aligned metronome pulse after a mid-beat resume", async () => {
    const block = parseDrumBlock("HH | xxxxxxxxxxxxxxxx");
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { initialSlot: 2, metronomeMode: "with-drums", speedPercent: 50 },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(metronomeSchedules(backend)).toHaveLength(3);
    expect(metronomeSchedules(backend)[0].time).toBeCloseTo(
      10.08 + 2 * getSecondsPerSlot(block, 50)
    );
  });

  it("schedules metronome pulses independently inside a multi-beat tuplet", async () => {
    const block = parseDrumBlock(`Tempo: 120
Time: 4/4
HH | 3@2(xxx)`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { metronomeMode: "with-drums" },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(notationSchedules(backend).map((entry) => entry.time)).toEqual([
      10.08,
      10.08 + 1 / 3,
      10.08 + 2 / 3
    ]);
    expect(metronomeSchedules(backend).map((entry) => entry.time)).toEqual([
      10.08,
      10.58
    ]);
  });

  it("keeps the next written-beat pulse after resuming inside a long tuplet slot", async () => {
    const block = parseDrumBlock(`Tempo: 120
Time: 4/4
HH | 3@2(xxx)`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      {
        initialSlot: 1,
        metronomeMode: "with-drums"
      },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(metronomeSchedules(backend)).toHaveLength(1);
    expect(metronomeSchedules(backend)[0].time).toBeCloseTo(
      10.08 + (1 / 3) * 0.5
    );
  });

  it("filters muted instruments by canonical instrument id", async () => {
    const block = parseDrumBlock(`HH | x---
SD | o---
BD | o---
BD2 | o---`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { mutedInstrumentIds: new Set(["kick", "closed-hat"]) },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(backend.scheduled[0].hits.map((hit) => hit.instrument.id)).toEqual(["snare", "second-kick"]);
  });

  it("keeps hat and tom voices independently mutable", () => {
    const block = parseDrumBlock(`HH | x
OH | x
HT | o
FT | o`);
    const filtered = filterMutedHits(block.slots[0].hits, new Set(["open-hat", "floor-tom"]));

    expect(filtered.map((hit) => hit.instrument.id)).toEqual(["closed-hat", "high-tom"]);
  });

  it("keeps written-slot timing when every instrument is muted", async () => {
    const block = parseDrumBlock(`HH | x---
BD | o---`);
    const backend = new FakePlaybackBackend();
    const onSlotChange = vi.fn();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      onSlotChange,
      { mutedInstrumentIds: new Set(["closed-hat", "kick"]) },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(backend.scheduled[0].hits).toEqual([]);
    scheduledTimers[1]();
    expect(onSlotChange).toHaveBeenCalledWith(0);
  });

  it("reports bar changes at playback start and silent bar boundaries", async () => {
    const block = parseDrumBlock(`Tempo: 100
HH | ---- | ---- | ----`);
    const backend = new FakePlaybackBackend();
    const onBarChange = vi.fn();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { onBarChange },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    scheduledTimers.forEach((timer) => timer());

    expect(onBarChange.mock.calls.map(([barIndex]) => barIndex)).toEqual([0, 1, 2]);
    expect(scheduledTimerDelays.some((delay) => Math.abs(delay - 80) < 0.01)).toBe(true);
    expect(scheduledTimerDelays.some((delay) => Math.abs(delay - 680) < 0.01)).toBe(true);
    expect(scheduledTimerDelays.some((delay) => Math.abs(delay - 1280) < 0.01)).toBe(true);
  });

  it("reports the active bar for a mid-bar resume", async () => {
    const block = parseDrumBlock(`Tempo: 100
HH | xxxx | xxxx | xxxx`);
    const backend = new FakePlaybackBackend();
    const onBarChange = vi.fn();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { initialSlot: 6, onBarChange },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    scheduledTimers.forEach((timer) => timer());

    expect(onBarChange.mock.calls.map(([barIndex]) => barIndex)).toEqual([1, 2]);
  });

  it("restarts bar progress from the range start on later loop passes", async () => {
    const block = parseDrumBlock(`Tempo: 100
HH | xxxx | xxxx`);
    const backend = new FakePlaybackBackend();
    const onBarChange = vi.fn();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { initialSlot: 5, loop: true, onBarChange },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    const firstPassTimers = [...scheduledTimers];
    const firstPassEndTimer = firstPassTimers[firstPassTimers.length - 1];
    firstPassTimers.slice(0, -1).forEach((timer) => timer());
    firstPassEndTimer();
    const secondPassTimers = scheduledTimers.slice(firstPassTimers.length);
    secondPassTimers.slice(0, -1).forEach((timer) => timer());

    expect(onBarChange.mock.calls.map(([barIndex]) => barIndex)).toEqual([1, 0, 1]);
  });

  it("restarts bar progress for each finite block repeat", async () => {
    const block = parseDrumBlock(`Tempo: 100
HH | xxxx | xxxx`);
    const backend = new FakePlaybackBackend();
    const onBarChange = vi.fn();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      {
        initialSlot: 5,
        repeatCount: 2,
        metronomeMode: "metronome-only",
        onBarChange
      },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    const firstPassTimers = [...scheduledTimers];
    const firstPassEndTimer = firstPassTimers[firstPassTimers.length - 1];
    firstPassTimers.slice(0, -1).forEach((timer) => timer());
    firstPassEndTimer();
    const secondPassTimers = scheduledTimers.slice(firstPassTimers.length);
    secondPassTimers.slice(0, -1).forEach((timer) => timer());

    expect(onBarChange.mock.calls.map(([barIndex]) => barIndex)).toEqual([1, 0, 1]);
    expect(metronomeSchedules(backend).length).toBeGreaterThan(0);
  });

  it("starts a looped bar on its aligned downbeat after a mid-bar resume", async () => {
    const block = parseDrumBlock("HH | ---- | ----");
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      {
        startSlot: 4,
        endSlot: 8,
        initialSlot: 5,
        loop: true,
        metronomeMode: "metronome-only"
      },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(backend.scheduled.every((entry) => entry.hits.length === 0)).toBe(true);
    const firstPassEndTimer = scheduledTimers[scheduledTimers.length - 1];
    firstPassEndTimer();

    expect(metronomeSchedules(backend)).toHaveLength(1);
    expect(metronomeSchedules(backend)[0].hits[0].velocity).toBe(1);
  });

  it("reports the current slot and resumes later loop passes from the range start", async () => {
    const block = parseDrumBlock(`Tempo: 100
HH | xxxx`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      {
        startSlot: 0,
        endSlot: 4,
        initialSlot: 2,
        loop: true,
        metronomeMode: "with-drums"
      },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(player.getCurrentSlotIndex()).toBe(2);

    backend.currentTime = 10.24;
    expect(player.getCurrentSlotIndex()).toBe(3);

    backend.currentTime = 10.39;
    expect(player.getCurrentSlotIndex()).toBe(0);

    const firstPassEndTimer = scheduledTimers[scheduledTimers.length - 1];
    firstPassEndTimer();
    expect(metronomeSchedules(backend)).toHaveLength(1);
    expect(notationSchedules(backend).slice(2).map((entry) => entry.hits[0]?.instrument.id ?? null)).toEqual([
      "closed-hat",
      "closed-hat",
      "closed-hat",
      "closed-hat"
    ]);
  });

  it("clamps non-loop current-slot reporting at the playback end", async () => {
    const block = parseDrumBlock(`Tempo: 100
HH | xxxx`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { startSlot: 0, endSlot: 4, initialSlot: 1 },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();
    backend.currentTime = 20;

    expect(player.getCurrentSlotIndex()).toBe(3);
  });
});

describe("section-repeat playback roadmap", () => {
  let sectionScheduledTimers: Array<() => void>;

  beforeEach(() => {
    sectionScheduledTimers = [];

    vi.stubGlobal("window", {
      setTimeout: vi.fn((callback: TimerHandler, delay?: number) => {
        if (typeof callback === "function") {
          sectionScheduledTimers.push(callback);
        }

        return sectionScheduledTimers.length;
      }),
      clearTimeout: vi.fn()
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("expands section bars twice while keeping source slot indexes", () => {
    const block = parseDrumBlock(`HH | xxxx [ xxxx | xxxx ] xxxx`);

    expect(buildPlaybackRoadmap(block).map((entry) => ({
      barIndex: entry.barIndex,
      traversal: entry.sectionTraversal
    }))).toEqual([
      { barIndex: 0, traversal: 0 },
      { barIndex: 1, traversal: 1 },
      { barIndex: 2, traversal: 1 },
      { barIndex: 1, traversal: 2 },
      { barIndex: 2, traversal: 2 },
      { barIndex: 3, traversal: 0 }
    ]);
  });

  it("executes multiple disjoint sections in score order", () => {
    const block = parseDrumBlock("HH [ xxxx | xxxx ] xxxx [ xxxx | xxxx ]");

    expect(buildPlaybackRoadmap(block).map((entry) => entry.barIndex)).toEqual([
      0, 1, 0, 1, 2, 3, 4, 3, 4
    ]);
  });

  it("starts inside a section by completing its first traversal", async () => {
    const block = parseDrumBlock(`HH | xxxx [ xxxx | xxxx | xxxx ] xxxx`);
    const backend = new FakePlaybackBackend();
    const onBarChange = vi.fn();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { initialSlot: block.bars[2].startSlot, onBarChange },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();
    sectionScheduledTimers.forEach((timer) => timer());

    expect(onBarChange.mock.calls.map(([barIndex]) => barIndex)).toEqual([2, 3, 1, 2, 3, 4]);
  });

  it("starting after a section does not jump backward", async () => {
    const block = parseDrumBlock(`HH [ xxxx | xxxx ] xxxx`);
    const backend = new FakePlaybackBackend();
    const onBarChange = vi.fn();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { initialSlot: block.bars[2].startSlot, onBarChange },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();
    sectionScheduledTimers.forEach((timer) => timer());

    expect(onBarChange.mock.calls.map(([barIndex]) => barIndex)).toEqual([2]);
  });

  it("runs compact measure-repeat progress bars again on the second traversal", async () => {
    const block = parseDrumBlock(`HH [ xxxx
%x3
HH | xxxx ]`);
    const backend = new FakePlaybackBackend();
    const onBarChange = vi.fn();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { onBarChange },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();
    sectionScheduledTimers.forEach((timer) => timer());

    expect(onBarChange.mock.calls.map(([barIndex]) => barIndex)).toEqual([
      0, 1, 2, 3, 4,
      0, 1, 2, 3, 4
    ]);
  });

  it("reports the active roadmap occurrence during the second traversal", async () => {
    const block = parseDrumBlock("Tempo: 100\nHH [ xxxx | xxxx ]");
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      {},
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();
    backend.currentTime = 11.38;

    expect(player.getCurrentPlaybackPosition()).toEqual({
      slotIndex: 0,
      roadmapEntryIndex: 2,
      blockPassIndex: 0,
      barOccurrenceIndex: 2
    });
  });

  it("restores a specific section traversal and falls back from an invalid position", async () => {
    const block = parseDrumBlock("HH [ xxxx | xxxx ]");
    const secondTraversalBackend = new FakePlaybackBackend();
    const secondTraversalBars = vi.fn();
    const secondTraversalPlayer = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      {
        initialPosition: {
          slotIndex: block.bars[0].startSlot,
          roadmapEntryIndex: 2,
          blockPassIndex: 0
        },
        onBarChange: secondTraversalBars
      },
      (() => secondTraversalBackend) as DrumPlaybackBackendFactory
    );

    await secondTraversalPlayer.play();
    const secondTraversalTimers = [...sectionScheduledTimers];
    secondTraversalTimers.forEach((timer) => timer());
    expect(secondTraversalBars.mock.calls.map(([barIndex]) => barIndex)).toEqual([0, 1]);

    sectionScheduledTimers.length = 0;
    const fallbackBackend = new FakePlaybackBackend();
    const fallbackBars = vi.fn();
    const fallbackPlayer = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      {
        initialPosition: {
          slotIndex: block.bars[0].startSlot,
          roadmapEntryIndex: 99,
          blockPassIndex: 0
        },
        onBarChange: fallbackBars
      },
      (() => fallbackBackend) as DrumPlaybackBackendFactory
    );

    await fallbackPlayer.play();
    sectionScheduledTimers.forEach((timer) => timer());
    expect(fallbackBars.mock.calls.map(([barIndex]) => barIndex)).toEqual([0, 1, 0, 1]);
  });

  it("ignores section navigation for a selected-bar range", async () => {
    const block = parseDrumBlock("HH [ xxxx | xxxx ]");
    const backend = new FakePlaybackBackend();
    const onBarChange = vi.fn();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      {
        startSlot: block.bars[1].startSlot,
        endSlot: block.bars[1].startSlot + block.bars[1].slots.length,
        loop: true,
        onBarChange
      },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();
    const firstPassTimers = [...sectionScheduledTimers];
    firstPassTimers.slice(0, -1).forEach((timer) => timer());

    expect(onBarChange.mock.calls.map(([barIndex]) => barIndex)).toEqual([1]);
  });
});

describe("practice-selection playback roadmap", () => {
  let selectionTimers: Array<() => void>;

  beforeEach(() => {
    selectionTimers = [];
    vi.stubGlobal("window", {
      setTimeout: vi.fn((callback: TimerHandler) => {
        if (typeof callback === "function") {
          selectionTimers.push(callback);
        }
        return selectionTimers.length;
      }),
      clearTimeout: vi.fn()
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes selected bars and keeps complete bar ranges in score order", () => {
    const block = parseDrumBlock("HH | xxxx | x--- | --x- | ---x");

    expect(buildSelectedPlaybackRoadmap(block, [3, 1, 3, -1, 9])).toEqual([
      {
        barIndex: 1,
        startSlot: block.bars[1].startSlot,
        endSlot: block.bars[1].startSlot + block.bars[1].slots.length,
        sectionTraversal: 0
      },
      {
        barIndex: 3,
        startSlot: block.bars[3].startSlot,
        endSlot: block.bars[3].startSlot + block.bars[3].slots.length,
        sectionTraversal: 0
      }
    ]);
  });

  it("ignores section navigation and authored repeats for one selected pass", async () => {
    const block = parseDrumBlock(`Repeat: 4
HH [ xxxx | x--- ] --x-`);
    const backend = new FakePlaybackBackend();
    const onBarChange = vi.fn();
    const onEnded = vi.fn();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      onEnded,
      vi.fn(),
      { selectedBarIndexes: [2, 0], repeatCount: block.repeatCount, onBarChange },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();
    selectionTimers.slice().forEach((timer) => timer());

    expect(onBarChange.mock.calls.map(([barIndex]) => barIndex)).toEqual([0, 2]);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("falls back to the first selected bar for an incompatible restored position", async () => {
    const block = parseDrumBlock("HH | xxxx | x--- | --x-");
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      {
        selectedBarIndexes: [2],
        initialPosition: { slotIndex: 0, roadmapEntryIndex: 0, blockPassIndex: 3 }
      },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    expect(player.getCurrentPlaybackPosition()).toEqual({
      slotIndex: block.bars[2].startSlot,
      roadmapEntryIndex: 0,
      blockPassIndex: 0,
      barOccurrenceIndex: 0
    });
  });

  it("plays every expanded compact-repeat bar selected by its visual region", () => {
    const block = parseDrumBlock("HH | xxxx\n%x3");

    expect(buildSelectedPlaybackRoadmap(block, [1, 2, 3]).map((entry) => entry.barIndex)).toEqual([
      1, 2, 3
    ]);
  });

  it("schedules selected mixed-meter bars and their metronome pulses contiguously", async () => {
    const block = parseDrumBlock(`Tempo: 120
Time: 4/4
HH | x---------------

Bar
Time: 3/4
HH | x-----------

Bar
Time: 6/8
HH | x-----------`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { selectedBarIndexes: [2, 1], metronomeMode: "with-drums" },
      (() => backend) as DrumPlaybackBackendFactory
    );

    await player.play();

    const pulseTimes = metronomeSchedules(backend).map((entry) => entry.time);
    expect(pulseTimes).toHaveLength(5);
    [10.08, 10.58, 11.08, 11.58, 12.33].forEach((expected, index) => {
      expect(pulseTimes[index]).toBeCloseTo(expected);
    });
  });
});

describe("recoverAudioContext", () => {
  it("succeeds for an already running context without recreating or resuming", async () => {
    const context = new FakeAudioContext({ state: "running" });
    const create = vi.fn();
    const set = vi.fn();

    await expect(
      recoverAudioContext({
        get: () => context as unknown as AudioContext,
        set,
        create: create as unknown as () => AudioContext
      })
    ).resolves.toBe(true);

    expect(context.resume).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("resumes a suspended context", async () => {
    const context = new FakeAudioContext({ state: "suspended" });

    await expect(
      recoverAudioContext({
        get: () => context as unknown as AudioContext,
        set: vi.fn(),
        create: vi.fn() as unknown as () => AudioContext
      })
    ).resolves.toBe(true);

    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.state).toBe("running");
  });

  it("returns failure when resume fails", async () => {
    const context = new FakeAudioContext({ state: "suspended", resumeFails: true });

    await expect(
      recoverAudioContext({
        get: () => context as unknown as AudioContext,
        set: vi.fn(),
        create: vi.fn() as unknown as () => AudioContext
      })
    ).resolves.toBe(false);
  });

  it("recreates a closed context", async () => {
    let context: FakeAudioContext | null = new FakeAudioContext({ state: "closed" });
    const replacement = new FakeAudioContext({ state: "running" });
    const create = vi.fn(() => replacement as unknown as AudioContext);
    const set = vi.fn((next: AudioContext | null) => {
      context = next as unknown as FakeAudioContext | null;
    });

    await expect(
      recoverAudioContext({
        get: () => context as unknown as AudioContext | null,
        set,
        create
      })
    ).resolves.toBe(true);

    expect(create).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(replacement);
    expect(context).toBe(replacement);
  });

  it("creates a missing context", async () => {
    let context: FakeAudioContext | null = null;
    const replacement = new FakeAudioContext({ state: "suspended" });
    const create = vi.fn(() => replacement as unknown as AudioContext);

    await expect(
      recoverAudioContext({
        get: () => context as unknown as AudioContext | null,
        set: (next) => {
          context = next as unknown as FakeAudioContext | null;
        },
        create
      })
    ).resolves.toBe(true);

    expect(create).toHaveBeenCalledTimes(1);
    expect(replacement.resume).toHaveBeenCalledTimes(1);
    expect(context).toBe(replacement);
  });
});
