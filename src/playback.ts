import { DrumHit } from "./types";

export interface DrumPlaybackBackend {
  readonly currentTime: number;
  start(): Promise<void>;
  stop(): void;
  scheduleHits(hits: DrumHit[], time: number, slotDuration?: number, noteDuration?: number): void;
}

export type DrumPlaybackBackendFactory = (audioContext: AudioContext) => DrumPlaybackBackend;
