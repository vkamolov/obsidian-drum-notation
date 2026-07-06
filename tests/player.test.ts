import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSecondsPerSlot, getSlotVisualDurationSeconds, getSlotsPerBar } from "../src/music";
import { parseDrumBlock } from "../src/parser";
import {
  DrumPlaybackBackend,
  DrumPlaybackBackendFactory,
  filterMutedHits,
  getEffectivePlaybackTempo,
  getMetronomePulses,
  normalizePlaybackSpeedPercent,
  recoverAudioContext
} from "../src/playback";
import { DrumPlayer } from "../src/player";
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

    expect(normalizePlaybackSpeedPercent(24)).toBe(25);
    expect(normalizePlaybackSpeedPercent(37)).toBe(25);
    expect(normalizePlaybackSpeedPercent(62)).toBe(50);
    expect(normalizePlaybackSpeedPercent(88)).toBe(100);
    expect(normalizePlaybackSpeedPercent(100)).toBe(100);
    expect(normalizePlaybackSpeedPercent(151)).toBe(100);
    expect(getEffectivePlaybackTempo(100, 50)).toBe(50);
    expect(backend.scheduled[0].slotDuration).toBeCloseTo(getSecondsPerSlot(block, 50));
    expect(backend.scheduled[0].noteDuration).toBeCloseTo(
      getSlotVisualDurationSeconds(block, block.slots[0], 50)
    );
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
      "kick",
      "metronome"
    ]);
    expect(backend.scheduled[4].hits.map((hit) => hit.instrument.id)).toEqual(["metronome"]);
    expect(backend.scheduled[8].hits.map((hit) => hit.instrument.id)).toEqual(["metronome"]);
    expect(backend.scheduled[12].hits.map((hit) => hit.instrument.id)).toEqual(["metronome"]);
    expect(
      backend.scheduled[0].hits[backend.scheduled[0].hits.length - 1].velocity
    ).toBeGreaterThan(
      backend.scheduled[4].hits[0].velocity
    );
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

    expect(backend.scheduled[0].hits.map((hit) => hit.instrument.id)).toEqual(["metronome"]);
    expect(backend.scheduled[1].hits).toEqual([]);
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

    expect(
      backend.scheduled
        .map((entry, slotIndex) =>
          entry.hits.some((hit) => hit.instrument.id === "metronome") ? slotIndex : -1
        )
        .filter((slotIndex) => slotIndex >= 0)
    ).toEqual([0, 4, 8, 12]);
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

    expect(backend.scheduled[0].hits.some((hit) => hit.instrument.id === "metronome")).toBe(false);
    expect(backend.scheduled[2].hits.some((hit) => hit.instrument.id === "metronome")).toBe(true);
    expect(backend.scheduled[2].time).toBeCloseTo(
      10.08 + 2 * getSecondsPerSlot(block, 50)
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
    expect(backend.scheduled[3].hits.map((hit) => hit.instrument.id)).toEqual(["metronome"]);
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

    expect(backend.scheduled[3].hits.map((hit) => hit.instrument.id)).toEqual(["metronome"]);
    expect(backend.scheduled[3].hits[0].velocity).toBe(1);
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
    expect(backend.scheduled[2].hits.map((hit) => hit.instrument.id)).toEqual([
      "closed-hat",
      "metronome"
    ]);
    expect(backend.scheduled.slice(2).map((entry) => entry.hits[0]?.instrument.id ?? null)).toEqual([
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
