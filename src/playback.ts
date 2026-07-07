import { CountInMode, DrumBlock, DrumHit, DrumInstrument, MetronomeMode } from "./types";

export const MIN_PLAYBACK_SPEED_PERCENT = 25;
export const MAX_PLAYBACK_SPEED_PERCENT = 150;
export const PLAYBACK_SPEED_STEP_PERCENT = 5;
export const PLAYBACK_SPEED_UI_STEP_PERCENT = 10;
export const DEFAULT_PLAYBACK_SPEED_PERCENT = 100;
export const DEFAULT_METRONOME_MODE: MetronomeMode = "off";
export const DEFAULT_COUNT_IN_MODE: CountInMode = "off";

export const METRONOME_MODE_OPTIONS: ReadonlyArray<{
  value: MetronomeMode;
  label: string;
}> = [
  { value: "off", label: "Off" },
  { value: "with-drums", label: "With drums" },
  { value: "metronome-only", label: "Metronome only" }
];

export const COUNT_IN_MODE_OPTIONS: ReadonlyArray<{
  value: CountInMode;
  label: string;
}> = [
  { value: "off", label: "Off" },
  { value: "1-bar", label: "1 bar" }
];

export interface MetronomePulse {
  slotIndex: number;
  isDownbeat: boolean;
}

const METRONOME_INSTRUMENT: DrumInstrument = {
  id: "metronome",
  label: "Metronome",
  aliases: [],
  vexKey: "c/5",
  midi: 37,
  color: "#64748b",
  playback: "click"
};

const METRONOME_DOWNBEAT_VELOCITY = 1;
const METRONOME_BEAT_VELOCITY = 0.65;

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

export function getMetronomeModeLabel(mode: MetronomeMode): string {
  return METRONOME_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? "Off";
}

export function getCountInModeLabel(mode: CountInMode): string {
  return COUNT_IN_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? "Off";
}

export function getMetronomePulses(
  block: DrumBlock,
  startSlot = 0,
  endSlot = block.slots.length
): MetronomePulse[] {
  const rangeStart = Math.max(0, Math.round(startSlot));
  const rangeEnd = Math.min(block.slots.length, Math.max(rangeStart, Math.round(endSlot)));
  const pulseIntervalSlots = getMetronomePulseIntervalSlots(
    block.timeSignature,
    block.gridResolution
  );
  const pulses: MetronomePulse[] = [];

  block.bars.forEach((bar) => {
    const barEndSlot = bar.startSlot + bar.slots.length;

    if (barEndSlot <= rangeStart || bar.startSlot >= rangeEnd) {
      return;
    }

    for (let localSlot = 0; localSlot < bar.slots.length; localSlot += pulseIntervalSlots) {
      const slotIndex = bar.startSlot + localSlot;

      if (slotIndex >= rangeStart && slotIndex < rangeEnd) {
        pulses.push({ slotIndex, isDownbeat: localSlot === 0 });
      }
    }
  });

  return pulses;
}

export function getCountInSlotCount(block: DrumBlock, mode: CountInMode = DEFAULT_COUNT_IN_MODE): number {
  if (mode === "off") {
    return 0;
  }

  return getExpectedSlotsPerBar(block.timeSignature, block.gridResolution);
}

export function getCountInPulses(block: DrumBlock, mode: CountInMode = DEFAULT_COUNT_IN_MODE): MetronomePulse[] {
  const countInSlots = getCountInSlotCount(block, mode);

  if (countInSlots === 0) {
    return [];
  }

  const pulseIntervalSlots = getMetronomePulseIntervalSlots(block.timeSignature, block.gridResolution);
  const pulses: MetronomePulse[] = [];

  for (let slotIndex = 0; slotIndex < countInSlots; slotIndex += pulseIntervalSlots) {
    pulses.push({ slotIndex, isDownbeat: slotIndex === 0 });
  }

  return pulses;
}

export function createMetronomeHit(isDownbeat: boolean): DrumHit {
  return {
    instrument: METRONOME_INSTRUMENT,
    articulation: "normal",
    velocity: isDownbeat ? METRONOME_DOWNBEAT_VELOCITY : METRONOME_BEAT_VELOCITY
  };
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

export interface AudioContextStore {
  get(): AudioContext | null;
  set(context: AudioContext | null): void;
  create(): AudioContext;
}

export async function recoverAudioContext(store: AudioContextStore): Promise<boolean> {
  let context = store.get();

  if (!context || context.state === "closed") {
    try {
      context = store.create();
      store.set(context);
    } catch {
      store.set(null);
      return false;
    }
  }

  if (context.state !== "running" && context.state !== "closed") {
    try {
      await context.resume();
    } catch {
      return false;
    }
  }

  return context.state === "running";
}

export function getMetronomePulseIntervalSlots(
  timeSignature: string,
  gridResolution: DrumBlock["gridResolution"]
): number {
  const match = /^(\d+)\/(\d+)$/.exec(timeSignature);
  const numerator = Number.parseInt(match?.[1] ?? "4", 10);
  const beatValue = Math.max(1, Number.parseInt(match?.[2] ?? "4", 10));
  const writtenBeatSlots = Math.max(1, Math.round(gridResolution / beatValue));
  const compoundMultiplier = numerator >= 6 && numerator % 3 === 0 ? 3 : 1;

  return Math.max(1, writtenBeatSlots * compoundMultiplier);
}

function getExpectedSlotsPerBar(
  timeSignature: string,
  gridResolution: DrumBlock["gridResolution"]
): number {
  const match = /^(\d+)\/(\d+)$/.exec(timeSignature);
  const beats = Number.parseInt(match?.[1] ?? "4", 10);
  const beatValue = Math.max(1, Number.parseInt(match?.[2] ?? "4", 10));

  return Math.max(1, Math.round(beats * (gridResolution / beatValue)));
}

export interface DrumPlaybackBackend {
  readonly currentTime: number;
  start(): Promise<void>;
  stop(): void;
  scheduleHits(hits: DrumHit[], time: number, slotDuration?: number, noteDuration?: number): void;
}

export type DrumPlaybackBackendFactory = (audioContext: AudioContext) => DrumPlaybackBackend;
