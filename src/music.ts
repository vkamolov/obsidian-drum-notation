import { DEFAULT_GRID_RESOLUTION, DrumBlock, DrumSlot, GridResolution } from "./types";
import { getEffectivePlaybackTempo } from "./playback";

export function getBarRange(block: DrumBlock, slotIndex: number): { startSlot: number; endSlot: number } {
  const declaredBar = block.bars.find((bar) => slotIndex >= bar.startSlot && slotIndex < bar.startSlot + bar.slots.length);

  if (declaredBar) {
    return {
      startSlot: declaredBar.startSlot,
      endSlot: declaredBar.startSlot + declaredBar.slots.length
    };
  }

  const slotsPerBar = getSlotsPerBar(block.timeSignature, block.gridResolution);
  const startSlot = Math.floor(slotIndex / slotsPerBar) * slotsPerBar;

  return {
    startSlot,
    endSlot: Math.min(block.slots.length, startSlot + slotsPerBar)
  };
}

export function getSlotsPerBar(timeSignature: string, gridResolution: GridResolution = DEFAULT_GRID_RESOLUTION): number {
  const match = /^(\d+)\/(\d+)$/.exec(timeSignature);

  if (!match) {
    return 16;
  }

  const beats = Number.parseInt(match[1], 10);
  const beatValue = Number.parseInt(match[2], 10);
  const slots = beats * (gridResolution / beatValue);

  return Math.max(1, Math.round(slots));
}

export function getSlotsPerBeat(timeSignature: string, gridResolution: GridResolution = DEFAULT_GRID_RESOLUTION): number {
  const beatValue = getBeatValue(timeSignature);

  return Math.max(1, Math.round(gridResolution / beatValue));
}

export function getBeamGroupSlotCounts(
  timeSignature: string,
  gridResolution: GridResolution = DEFAULT_GRID_RESOLUTION,
  beamGrouping?: readonly number[]
): number[] {
  const slotsPerBeat = getSlotsPerBeat(timeSignature, gridResolution);
  const match = /^(\d+)\/(\d+)$/.exec(timeSignature);

  if (!match) {
    return [slotsPerBeat];
  }

  const beats = Number.parseInt(match[1], 10);
  const beatValue = Number.parseInt(match[2], 10);
  const explicitGrouping = beamGrouping && isValidBeamGrouping(timeSignature, beamGrouping)
    ? beamGrouping
    : undefined;

  if (explicitGrouping) {
    return explicitGrouping.map((group) => group * slotsPerBeat);
  }

  const usesCompoundEighthGrouping = beatValue === 8 && (beats === 6 || beats === 9 || beats === 12);

  if (usesCompoundEighthGrouping) {
    return Array.from({ length: beats / 3 }, () => slotsPerBeat * 3);
  }

  return Array.from({ length: beats }, () => slotsPerBeat);
}

export function isValidBeamGrouping(
  timeSignature: string,
  beamGrouping: readonly number[]
): boolean {
  const match = /^(\d+)\/(\d+)$/.exec(timeSignature);

  if (!match || beamGrouping.length === 0) {
    return false;
  }

  const beats = Number.parseInt(match[1], 10);
  const beatValue = Number.parseInt(match[2], 10);

  return (
    (beatValue === 8 || beatValue === 16) &&
    beamGrouping.every((group) => Number.isInteger(group) && group > 0) &&
    beamGrouping.reduce((sum, group) => sum + group, 0) === beats
  );
}

export function getBeatValue(timeSignature: string): number {
  const match = /^\d+\/(\d+)$/.exec(timeSignature);

  if (!match) {
    return 4;
  }

  return Math.max(1, Number.parseInt(match[1], 10));
}

export function getSecondsPerSlot(block: DrumBlock, speedPercent = 100): number {
  return 60 / getEffectivePlaybackTempo(block.tempo, speedPercent) / (block.gridResolution / 4);
}

export function getSecondsPerQuarter(block: DrumBlock, speedPercent = 100): number {
  return 60 / getEffectivePlaybackTempo(block.tempo, speedPercent);
}

export function getSlotStartSeconds(
  block: DrumBlock,
  slot: DrumSlot,
  speedPercent = 100
): number {
  return slot.startQuarter * getSecondsPerQuarter(block, speedPercent);
}

export function getSlotDurationSeconds(
  block: DrumBlock,
  slot: DrumSlot,
  speedPercent = 100
): number {
  return slot.durationQuarter * getSecondsPerQuarter(block, speedPercent);
}

export function getSlotBoundaryQuarter(block: DrumBlock, slotIndex: number): number {
  if (block.slots.length === 0 || slotIndex <= 0) {
    return 0;
  }

  if (slotIndex >= block.slots.length) {
    const finalSlot = block.slots[block.slots.length - 1];

    return finalSlot.startQuarter + finalSlot.durationQuarter;
  }

  return block.slots[slotIndex].startQuarter;
}

export function getRangeDurationSeconds(
  block: DrumBlock,
  startSlot: number,
  endSlot: number,
  speedPercent = 100
): number {
  const startQuarter = getSlotBoundaryQuarter(block, startSlot);
  const endQuarter = getSlotBoundaryQuarter(block, endSlot);

  return Math.max(0, endQuarter - startQuarter) * getSecondsPerQuarter(block, speedPercent);
}

export function getSlotIndexAtQuarter(
  block: DrumBlock,
  quarter: number,
  startSlot = 0,
  endSlot = block.slots.length
): number {
  const rangeStart = Math.max(0, Math.min(block.slots.length, Math.round(startSlot)));
  const rangeEnd = Math.max(rangeStart, Math.min(block.slots.length, Math.round(endSlot)));

  if (rangeEnd <= rangeStart) {
    return rangeStart;
  }

  let low = rangeStart;
  let high = rangeEnd;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);

    if (block.slots[middle].startQuarter <= quarter + Number.EPSILON) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return Math.min(rangeEnd - 1, Math.max(rangeStart, low - 1));
}

export function getSlotVisualDurationSeconds(block: DrumBlock, targetSlot: DrumSlot, speedPercent = 100): number {
  const bar = block.bars.find((candidate) => candidate.slots.some((slot) => slot.index === targetSlot.index));

  if (!bar) {
    return getSlotDurationSeconds(block, targetSlot, speedPercent);
  }

  const region = bar.rhythmRegions[targetSlot.regionIndex];

  if (!region || region.kind === "tuplet") {
    return getSlotDurationSeconds(block, targetSlot, speedPercent);
  }

  const beatSlots = bar.slots.slice(
    region.startPosition,
    region.startPosition + region.positionCount
  );
  const indexInBeat = beatSlots.findIndex((slot) => slot.index === targetSlot.index);

  if (indexInBeat < 0 || targetSlot.hits.length === 0) {
    return getSlotDurationSeconds(block, targetSlot, speedPercent);
  }

  const hitIndexes = beatSlots
    .map((slot, index) => (slot.hits.length > 0 ? index : -1))
    .filter((index) => index >= 0);
  const hitPosition = hitIndexes.indexOf(indexInBeat);

  if (hitPosition < 0) {
    return getSlotDurationSeconds(block, targetSlot, speedPercent);
  }

  const span = getGridSpanToNextHit(
    indexInBeat,
    hitIndexes[hitPosition + 1],
    beatSlots.length,
    block.gridResolution
  ).supportedSpan;

  return Math.max(
    getSlotDurationSeconds(block, targetSlot, speedPercent),
    span * getSlotDurationSeconds(block, targetSlot, speedPercent)
  );
}

export function durationForGridSpan(gridResolution: GridResolution, span: number): string {
  return durationForDenominator(gridResolution / Math.max(1, span));
}

export interface GridSpanDuration {
  duration: string;
  dots: number;
  supportedSpan: number;
}

export function getGridSpanToNextHit(
  hitIndex: number,
  nextHitIndex: number | undefined,
  beatSlotCount: number,
  gridResolution: GridResolution
): GridSpanDuration {
  const span = Math.max(1, Math.round((nextHitIndex ?? beatSlotCount) - hitIndex));
  const dottedBaseSpan = baseSpanForSingleDottedSpan(span);

  if (dottedBaseSpan !== null) {
    return {
      duration: durationForGridSpan(gridResolution, dottedBaseSpan),
      dots: 1,
      supportedSpan: span
    };
  }

  const supportedSpan = isPowerOfTwo(span) ? span : 1;

  return {
    duration: durationForGridSpan(gridResolution, supportedSpan),
    dots: 0,
    supportedSpan
  };
}

function baseSpanForSingleDottedSpan(span: number): number | null {
  const halfBaseSpan = span / 3;

  if (!Number.isInteger(halfBaseSpan) || !isPowerOfTwo(halfBaseSpan)) {
    return null;
  }

  return halfBaseSpan * 2;
}

export function largestPowerOfTwoAtMost(value: number): number {
  let power = 1;

  while (power * 2 <= value) {
    power *= 2;
  }

  return power;
}

export function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

export function durationForDenominator(denominator: number): string {
  const rounded = Math.max(1, Math.round(denominator));

  if (rounded <= 1) {
    return "1";
  }

  if (rounded <= 2) {
    return "2";
  }

  if (rounded <= 4) {
    return "4";
  }

  if (rounded <= 8) {
    return "8";
  }

  if (rounded <= 16) {
    return "16";
  }

  return "32";
}

export function compareVexKeys(left: string, right: string): number {
  return vexKeyRank(left) - vexKeyRank(right);
}

export function vexKeyRank(key: string): number {
  const [pitch, octave = "4"] = key.split("/");
  const pitchRanks: Record<string, number> = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };

  return Number.parseInt(octave, 10) * 7 + (pitchRanks[pitch.toLowerCase()] ?? 0);
}
