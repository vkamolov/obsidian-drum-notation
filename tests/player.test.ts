import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSecondsPerSlot } from "../src/music";
import { parseDrumBlock } from "../src/parser";
import { DrumPlaybackBackend, DrumPlaybackBackendFactory } from "../src/playback";
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
});
