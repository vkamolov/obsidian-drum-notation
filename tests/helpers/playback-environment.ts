import { vi } from "vitest";
import type { DrumHit } from "../../src/types";
import type { DrumPlaybackBackend } from "../../src/playback";

/** Audio, elapsed wall time, timer delivery, context state and notification are independent. */
export class PlaybackEnvironment {
  audioTime = 10;
  wallTime = 1_700_000_000_000;
  monotonicTime = 1000;
  state = "running";
  private nextTimer = 1;
  readonly timers = new Map<number, { callback: () => void; deadline: number }>();
  readonly events = new EventTarget();
  readonly scheduled: Array<{ hits: DrumHit[]; time: number; submittedAt: number; duration: number }> = [];
  readonly stop = vi.fn();
  readonly start = vi.fn(async () => {});
  readonly backend: DrumPlaybackBackend;
  readonly context: AudioContext;
  readonly window = {
    setTimeout: (callback: () => void, delay = 0): number => {
      const id = this.nextTimer++;
      this.timers.set(id, {callback, deadline: this.monotonicTime + delay});
      return id;
    },
    clearTimeout: (id: number): void => { this.timers.delete(id); },
    document: {visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn()}
  };

  constructor() {
    const environment = this;
    this.backend = {
      get currentTime() { return environment.audioTime; },
      start: this.start,
      stop: this.stop,
      scheduleHits(hits, time, duration = 0) {
        environment.scheduled.push({hits, time, submittedAt: environment.audioTime, duration});
      }
    };
    this.context = {
      get currentTime() { return environment.audioTime; },
      get state() { return environment.state; },
      addEventListener: this.events.addEventListener.bind(this.events),
      removeEventListener: this.events.removeEventListener.bind(this.events),
      resume: async () => { this.setState("running"); }
    } as unknown as AudioContext;
  }

  setState(state: string, notify = true): void {
    this.state = state;
    if (notify) this.notifyState();
  }
  notifyState(): void { this.events.dispatchEvent(new Event("statechange")); }
  advanceAudio(seconds: number): void { this.audioTime += seconds; }
  advanceClocks(milliseconds: number): void { this.wallTime += milliseconds; this.monotonicTime += milliseconds; }
  deliver(id: number): void {
    const timer = this.timers.get(id);
    this.timers.delete(id);
    timer?.callback();
  }
  deliverNext(): void {
    const next = [...this.timers].sort((left, right) => left[1].deadline - right[1].deadline)[0];
    if (next) this.deliver(next[0]);
  }
  runUntil(audioTime: number): void {
    let safety = 100_000;
    while (this.timers.size && safety-- > 0) {
      const next = [...this.timers].sort((left, right) => left[1].deadline - right[1].deadline)[0];
      const delta = Math.max(0, next[1].deadline - this.monotonicTime);
      if (this.audioTime + delta / 1000 > audioTime + 1e-9) break;
      this.advanceAudio(delta / 1000);
      this.advanceClocks(delta);
      this.deliver(next[0]);
    }
    if (safety <= 0) throw new Error("Playback timer did not make progress");
    this.advanceClocks(Math.max(0, audioTime - this.audioTime) * 1000);
    this.audioTime = audioTime;
  }
}
