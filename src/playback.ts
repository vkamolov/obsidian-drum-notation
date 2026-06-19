import { DrumBlock, DrumHit, DrumInstrument } from "./types";

export const MIN_PLAYBACK_SPEED_PERCENT = 25;
export const MAX_PLAYBACK_SPEED_PERCENT = 100;
export const PLAYBACK_SPEED_STEP_PERCENT = 25;
export const DEFAULT_PLAYBACK_SPEED_PERCENT = 100;

export function normalizePlaybackSpeedPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PLAYBACK_SPEED_PERCENT;
  }

  const clamped = Math.min(MAX_PLAYBACK_SPEED_PERCENT, Math.max(MIN_PLAYBACK_SPEED_PERCENT, value));

  return Math.round(clamped / PLAYBACK_SPEED_STEP_PERCENT) * PLAYBACK_SPEED_STEP_PERCENT;
}

export function getEffectivePlaybackTempo(tempo: number, speedPercent: number): number {
  return tempo * (normalizePlaybackSpeedPercent(speedPercent) / 100);
}

export function getPlaybackInstruments(block: DrumBlock): DrumInstrument[] {
  const seen = new Set<string>();
  const instruments: DrumInstrument[] = [];

  block.rows.forEach((row) => {
    if (!seen.has(row.instrument.id)) {
      seen.add(row.instrument.id);
      instruments.push(row.instrument);
    }
  });

  return instruments;
}

export function filterMutedHits(hits: DrumHit[], mutedInstrumentIds?: ReadonlySet<string>): DrumHit[] {
  if (!mutedInstrumentIds || mutedInstrumentIds.size === 0) {
    return hits;
  }

  return hits.filter((hit) => !mutedInstrumentIds.has(hit.instrument.id));
}

export interface DrumPlaybackBackend {
  readonly currentTime: number;
  start(): Promise<void>;
  stop(): void;
  scheduleHits(hits: DrumHit[], time: number, slotDuration?: number, noteDuration?: number): void;
}

export type DrumPlaybackBackendFactory = (audioContext: AudioContext) => DrumPlaybackBackend;
