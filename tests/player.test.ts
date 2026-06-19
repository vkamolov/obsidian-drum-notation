import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSecondsPerSlot, getSlotVisualDurationSeconds } from "../src/music";
import { parseDrumBlock } from "../src/parser";
import {
  DrumPlaybackBackend,
  DrumPlaybackBackendFactory,
  filterMutedHits,
  getEffectivePlaybackTempo,
  normalizePlaybackSpeedPercent
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

describe("DrumPlayer", () => {
  let clearTimeoutMock: ReturnType<typeof vi.fn>;
  let scheduledTimers: Array<() => void>;

  beforeEach(() => {
    scheduledTimers = [];
    clearTimeoutMock = vi.fn();

    vi.stubGlobal("window", {
      setTimeout: vi.fn((callback: TimerHandler) => {
        if (typeof callback === "function") {
          scheduledTimers.push(callback);
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

  it("reports the current slot and resumes later loop passes from the range start", async () => {
    const block = parseDrumBlock(`Tempo: 100
HH | xxxx`);
    const backend = new FakePlaybackBackend();
    const player = new DrumPlayer(
      {} as AudioContext,
      block,
      vi.fn(),
      vi.fn(),
      { startSlot: 0, endSlot: 4, initialSlot: 2, loop: true },
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
