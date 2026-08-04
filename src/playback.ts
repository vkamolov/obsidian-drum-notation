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
  quarterOffset: number;
  intervalQuarter: number;
  isDownbeat: boolean;
}

const METRONOME_INSTRUMENT: DrumInstrument = {
  id: "metronome",
  label: "Metronome",
  aliases: [],
  notationVoice: "upper",
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
  const rangeStartQuarter = slotBoundaryQuarter(block, rangeStart);
  const rangeEndQuarter = slotBoundaryQuarter(block, rangeEnd);
  const pulses: MetronomePulse[] = [];

  block.bars.forEach((bar) => {
    const pulseIntervalQuarter = getMetronomePulseIntervalQuarter(bar.timeSignature);
    const barEndQuarter = bar.startQuarter + bar.durationQuarter;

    if (barEndQuarter <= rangeStartQuarter || bar.startQuarter >= rangeEndQuarter) {
      return;
    }

    for (
      let localQuarter = 0;
      localQuarter < bar.durationQuarter - Number.EPSILON;
      localQuarter += pulseIntervalQuarter
    ) {
      const quarterOffset = bar.startQuarter + localQuarter;

      if (
        quarterOffset >= rangeStartQuarter &&
        quarterOffset < rangeEndQuarter
      ) {
        pulses.push({
          slotIndex: slotIndexAtQuarter(
            block,
            quarterOffset,
            rangeStart,
            rangeEnd
          ),
          quarterOffset,
          intervalQuarter: pulseIntervalQuarter,
          isDownbeat: localQuarter === 0
        });
      }
    }
  });

  return pulses;
}

export function getCountInSlotCount(
  block: DrumBlock,
  mode: CountInMode = DEFAULT_COUNT_IN_MODE,
  startSlot = 0
): number {
  if (mode === "off") {
    return 0;
  }

  return getExpectedSlotsPerBar(getPlaybackStartMeter(block, startSlot), block.gridResolution);
}

export function getCountInPulses(
  block: DrumBlock,
  mode: CountInMode = DEFAULT_COUNT_IN_MODE,
  startSlot = 0
): MetronomePulse[] {
  const timeSignature = getPlaybackStartMeter(block, startSlot);
  const countInSlots = getCountInSlotCount(block, mode, startSlot);

  if (countInSlots === 0) {
    return [];
  }

  const pulseIntervalSlots = getMetronomePulseIntervalSlots(timeSignature, block.gridResolution);
  const pulseIntervalQuarter = getMetronomePulseIntervalQuarter(timeSignature);
  const pulses: MetronomePulse[] = [];

  for (let slotIndex = 0; slotIndex < countInSlots; slotIndex += pulseIntervalSlots) {
    pulses.push({
      slotIndex,
      quarterOffset: (slotIndex / pulseIntervalSlots) * pulseIntervalQuarter,
      intervalQuarter: pulseIntervalQuarter,
      isDownbeat: slotIndex === 0
    });
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

export function getMetronomePulseIntervalQuarter(timeSignature: string): number {
  const match = /^(\d+)\/(\d+)$/.exec(timeSignature);
  const numerator = Number.parseInt(match?.[1] ?? "4", 10);
  const beatValue = Math.max(1, Number.parseInt(match?.[2] ?? "4", 10));
  const compoundMultiplier = numerator >= 6 && numerator % 3 === 0 ? 3 : 1;

  return (4 / beatValue) * compoundMultiplier;
}

export function getCountInDurationQuarter(
  block: DrumBlock,
  mode: CountInMode = DEFAULT_COUNT_IN_MODE,
  startSlot = 0
): number {
  if (mode === "off") {
    return 0;
  }

  const match = /^(\d+)\/(\d+)$/.exec(getPlaybackStartMeter(block, startSlot));
  const beats = Number.parseInt(match?.[1] ?? "4", 10);
  const beatValue = Math.max(1, Number.parseInt(match?.[2] ?? "4", 10));

  return beats * (4 / beatValue);
}

function getPlaybackStartMeter(block: DrumBlock, startSlot: number): string {
  const containingBar = block.bars.find(
    (bar) => startSlot >= bar.startSlot && startSlot < bar.startSlot + bar.slots.length
  );

  if (containingBar) {
    return containingBar.timeSignature;
  }

  if (block.bars.length === 0) {
    return block.timeSignature;
  }

  return startSlot < block.bars[0].startSlot
    ? block.bars[0].timeSignature
    : block.bars[block.bars.length - 1].timeSignature;
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

function slotBoundaryQuarter(block: DrumBlock, slotIndex: number): number {
  if (block.slots.length === 0 || slotIndex <= 0) {
    return 0;
  }

  if (slotIndex >= block.slots.length) {
    const finalSlot = block.slots[block.slots.length - 1];

    return finalSlot.startQuarter + finalSlot.durationQuarter;
  }

  return block.slots[slotIndex].startQuarter;
}

function slotIndexAtQuarter(
  block: DrumBlock,
  quarter: number,
  startSlot: number,
  endSlot: number
): number {
  if (endSlot <= startSlot) {
    return startSlot;
  }

  let low = startSlot;
  let high = endSlot;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);

    if (block.slots[middle].startQuarter <= quarter + Number.EPSILON) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return Math.min(endSlot - 1, Math.max(startSlot, low - 1));
}

export interface DrumPlaybackBackend {
  readonly currentTime: number;
  start(): Promise<void>;
  stop(): void;
  scheduleHits(hits: DrumHit[], time: number, slotDuration?: number, noteDuration?: number): void;
}

export type DrumPlaybackBackendFactory = (audioContext: AudioContext) => DrumPlaybackBackend;
