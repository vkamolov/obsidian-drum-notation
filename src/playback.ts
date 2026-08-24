import {
  ClickSubdivision,
  CountInMode,
  DrumBlock,
  DrumHit,
  DrumInstrument,
  GapClickMode,
  MetronomeMode,
  MetronomePulseKind
} from "./types";

export const MIN_PLAYBACK_SPEED_PERCENT = 25;
export const MAX_PLAYBACK_SPEED_PERCENT = 150;
export const PLAYBACK_SPEED_STEP_PERCENT = 5;
export const PLAYBACK_SPEED_UI_STEP_PERCENT = 10;
export const DEFAULT_PLAYBACK_SPEED_PERCENT = 100;
export const DEFAULT_METRONOME_MODE: MetronomeMode = "off";
export const DEFAULT_COUNT_IN_MODE: CountInMode = "off";
export const DEFAULT_CLICK_SUBDIVISION: ClickSubdivision = "beat";
export const DEFAULT_GAP_CLICK_MODE: GapClickMode = "off";
export const MAX_CLICK_PULSES_PER_SECOND = 16;

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
  { value: "1-bar", label: "1 bar" },
  { value: "2-bars", label: "2 bars" }
];

export const CLICK_SUBDIVISION_OPTIONS: ReadonlyArray<{
  value: ClickSubdivision;
  label: string;
}> = [
  { value: "beat", label: "Beat" },
  { value: "2-per-beat", label: "2 per beat" },
  { value: "3-per-beat", label: "3 per beat" },
  { value: "4-per-beat", label: "4 per beat" }
];

export const GAP_CLICK_MODE_OPTIONS: ReadonlyArray<{
  value: GapClickMode;
  label: string;
}> = [
  { value: "off", label: "Off" },
  { value: "1-on-1-off", label: "1 on / 1 off" },
  { value: "2-on-2-off", label: "2 on / 2 off" },
  { value: "4-on-4-off", label: "4 on / 4 off" }
];

export interface MetronomePulse {
  slotIndex: number;
  quarterOffset: number;
  intervalQuarter: number;
  kind: MetronomePulseKind;
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
const METRONOME_SUBDIVISION_VELOCITY = 0.45;

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

export function normalizeClickSubdivision(value: unknown): ClickSubdivision {
  if (value === "2-per-beat" || value === "3-per-beat" || value === "4-per-beat") {
    return value;
  }

  return DEFAULT_CLICK_SUBDIVISION;
}

export function normalizeGapClickMode(value: unknown): GapClickMode {
  if (value === "1-on-1-off" || value === "2-on-2-off" || value === "4-on-4-off") {
    return value;
  }

  return DEFAULT_GAP_CLICK_MODE;
}

export function getClickSubdivisionLabel(mode: ClickSubdivision): string {
  return CLICK_SUBDIVISION_OPTIONS.find((option) => option.value === mode)?.label ?? "Beat";
}

export function getGapClickModeLabel(mode: GapClickMode): string {
  return GAP_CLICK_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? "Off";
}

export function getMetronomePulses(
  block: DrumBlock,
  startSlot = 0,
  endSlot = block.slots.length,
  subdivision: ClickSubdivision = DEFAULT_CLICK_SUBDIVISION
): MetronomePulse[] {
  const rangeStart = Math.max(0, Math.round(startSlot));
  const rangeEnd = Math.min(block.slots.length, Math.max(rangeStart, Math.round(endSlot)));
  const rangeStartQuarter = slotBoundaryQuarter(block, rangeStart);
  const rangeEndQuarter = slotBoundaryQuarter(block, rangeEnd);
  const pulses: MetronomePulse[] = [];
  const subdivisionFactor = getClickSubdivisionFactor(subdivision);

  block.bars.forEach((bar) => {
    const mainPulseIntervalQuarter = getMetronomePulseIntervalQuarter(bar.timeSignature);
    const pulseIntervalQuarter = mainPulseIntervalQuarter / subdivisionFactor;
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
          kind: Math.abs(localQuarter) < Number.EPSILON
            ? "downbeat"
            : Math.abs((localQuarter / mainPulseIntervalQuarter) - Math.round(localQuarter / mainPulseIntervalQuarter)) < 1e-8
              ? "beat"
              : "subdivision"
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
  return (
    getExpectedSlotsPerBar(getPlaybackStartMeter(block, startSlot), block.gridResolution) *
    getCountInBarCount(mode)
  );
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

  const countInBarCount = getCountInBarCount(mode);
  const slotsPerBar = countInSlots / countInBarCount;
  const pulseIntervalSlots = getMetronomePulseIntervalSlots(timeSignature, block.gridResolution);
  const pulseIntervalQuarter = getMetronomePulseIntervalQuarter(timeSignature);
  const pulses: MetronomePulse[] = [];

  for (let countInBarIndex = 0; countInBarIndex < countInBarCount; countInBarIndex++) {
    for (let localSlotIndex = 0; localSlotIndex < slotsPerBar; localSlotIndex += pulseIntervalSlots) {
      const slotIndex = countInBarIndex * slotsPerBar + localSlotIndex;
      pulses.push({
        slotIndex,
        quarterOffset: (slotIndex / pulseIntervalSlots) * pulseIntervalQuarter,
        intervalQuarter: pulseIntervalQuarter,
        kind: localSlotIndex === 0 ? "downbeat" : "beat"
      });
    }
  }

  return pulses;
}

export function createMetronomeHit(kind: MetronomePulseKind): DrumHit {
  return {
    instrument: METRONOME_INSTRUMENT,
    articulation: "normal",
    velocity: kind === "downbeat"
      ? METRONOME_DOWNBEAT_VELOCITY
      : kind === "subdivision"
        ? METRONOME_SUBDIVISION_VELOCITY
        : METRONOME_BEAT_VELOCITY
  };
}

export function getClickSubdivisionFactor(mode: ClickSubdivision): 1 | 2 | 3 | 4 {
  if (mode === "2-per-beat") return 2;
  if (mode === "3-per-beat") return 3;
  if (mode === "4-per-beat") return 4;
  return 1;
}

export function isGapClickBar(mode: GapClickMode, barOccurrenceIndex: number): boolean {
  const occurrence = Math.max(0, Math.round(barOccurrenceIndex));
  if (mode === "1-on-1-off") return occurrence % 2 >= 1;
  if (mode === "2-on-2-off") return occurrence % 4 >= 2;
  if (mode === "4-on-4-off") return occurrence % 8 >= 4;
  return false;
}

export function isClickSubdivisionSafe(
  block: DrumBlock,
  speedPercent: number,
  subdivision: ClickSubdivision
): boolean {
  const factor = getClickSubdivisionFactor(subdivision);
  if (factor === 1) return true;

  const effectiveTempo = getEffectivePlaybackTempo(block.tempo, speedPercent);
  const meters = block.bars.length > 0
    ? block.bars.map((bar) => bar.timeSignature)
    : [block.timeSignature];

  return meters.every((timeSignature) => {
    const intervalQuarter = getMetronomePulseIntervalQuarter(timeSignature) / factor;
    return effectiveTempo / (60 * intervalQuarter) <= MAX_CLICK_PULSES_PER_SECOND + Number.EPSILON;
  });
}

export function getSafeClickSubdivision(
  block: DrumBlock,
  speedPercent: number,
  requested: ClickSubdivision
): ClickSubdivision {
  const requestedFactor = getClickSubdivisionFactor(requested);
  const candidates = [...CLICK_SUBDIVISION_OPTIONS]
    .map((option) => option.value)
    .filter((candidate) => getClickSubdivisionFactor(candidate) <= requestedFactor)
    .sort((left, right) => getClickSubdivisionFactor(right) - getClickSubdivisionFactor(left));

  return candidates.find((candidate) => isClickSubdivisionSafe(block, speedPercent, candidate))
    ?? DEFAULT_CLICK_SUBDIVISION;
}

export function getClickSubdivisionMenuLabel(
  block: DrumBlock,
  subdivision: ClickSubdivision
): string {
  const label = getClickSubdivisionLabel(subdivision);
  if (subdivision === "beat") return label;

  const factor = getClickSubdivisionFactor(subdivision);
  const meters = new Set(
    (block.bars.length > 0 ? block.bars.map((bar) => bar.timeSignature) : [block.timeSignature])
  );
  const descriptions = new Set<string>();

  for (const meter of meters) {
    const durationQuarter = getMetronomePulseIntervalQuarter(meter) / factor;
    const description = describeClickDuration(durationQuarter);
    if (!description) return label;
    descriptions.add(description);
  }

  return descriptions.size === 1
    ? `${label} · ${[...descriptions][0]}`
    : `${label} · varies by meter`;
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
  const barCount = getCountInBarCount(mode);
  if (barCount === 0) {
    return 0;
  }

  const match = /^(\d+)\/(\d+)$/.exec(getPlaybackStartMeter(block, startSlot));
  const beats = Number.parseInt(match?.[1] ?? "4", 10);
  const beatValue = Math.max(1, Number.parseInt(match?.[2] ?? "4", 10));

  return beats * (4 / beatValue) * barCount;
}

export function getCountInBarCount(mode: CountInMode): 0 | 1 | 2 {
  if (mode === "1-bar") {
    return 1;
  }

  return mode === "2-bars" ? 2 : 0;
}

function describeClickDuration(durationQuarter: number): string | null {
  const namedDurations: ReadonlyArray<readonly [number, string]> = [
    [4, "whole notes"],
    [3, "dotted half notes"],
    [2, "half notes"],
    [1.5, "dotted quarters"],
    [1, "quarters"],
    [0.75, "dotted eighths"],
    [0.5, "eighths"],
    [0.375, "dotted sixteenths"],
    [0.25, "sixteenths"],
    [0.125, "32nd notes"],
    [4 / 3, "half-note triplets"],
    [2 / 3, "quarter-note triplets"],
    [1 / 3, "eighth-note triplets"],
    [1 / 6, "sixteenth-note triplets"],
    [1 / 12, "32nd-note triplets"]
  ];

  return namedDurations.find(([duration]) => Math.abs(durationQuarter - duration) < 1e-8)?.[1] ?? null;
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
