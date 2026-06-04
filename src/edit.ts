import { getHitChar, normalizePattern } from "./kit";
import { finalizeDrumBlock } from "./parser";
import {
  DrumArticulation,
  DrumBlock,
  DrumBlockHeader,
  DrumHit,
  DrumInstrument,
  DrumRowInput,
  DrumSystem,
  GridResolution
} from "./types";

// Pure, DOM-free editing layer over the parsed model. Every helper takes a
// block and returns a NEW block; none mutate their input and none touch the
// renderer, player, or Obsidian. They are the building blocks for a future
// visual edit mode but are intentionally not wired into the live path yet.
//
// Note identity is positional: a hit is uniquely addressed by its global
// (slot index, instrument id). Because the canonical artifact is text, there is
// nowhere to persist a generated id, so identity is derived from position on
// every parse and survives the save -> reload cycle by construction.

export function hitKey(slotIndex: number, instrumentId: string): string {
  return `${slotIndex}:${instrumentId}`;
}

export function findHit(block: DrumBlock, slotIndex: number, instrumentId: string): DrumHit | undefined {
  const slot = block.slots.find((candidate) => candidate.index === slotIndex);

  return slot?.hits.find((hit) => hit.instrument.id === instrumentId);
}

// --- Header / setting edits -------------------------------------------------
// These mirror the parser's own clamping so an edited value re-parses to the
// same thing. They only swap a header field; slots are unaffected because the
// model already treats tempo/grid/meter as render-time metadata, not structure.

export function setTempo(block: DrumBlock, tempo: number): DrumBlock {
  return { ...block, tempo: Math.min(260, Math.max(30, Math.round(tempo))) };
}

export function setRepeatCount(block: DrumBlock, count: number): DrumBlock {
  return { ...block, repeatCount: Math.min(64, Math.max(1, Math.round(count))) };
}

export function setGrid(block: DrumBlock, grid: GridResolution): DrumBlock {
  return { ...block, gridResolution: grid === 32 ? 32 : 16 };
}

export function setTimeSignature(block: DrumBlock, numerator: number, denominator: number): DrumBlock {
  return { ...block, timeSignature: `${Math.max(1, Math.round(numerator))}/${Math.max(1, Math.round(denominator))}` };
}

// --- Hit edits --------------------------------------------------------------

export function toggleHit(
  block: DrumBlock,
  slotIndex: number,
  instrument: DrumInstrument,
  articulation: DrumArticulation = "normal"
): DrumBlock {
  const existing = findHit(block, slotIndex, instrument.id);

  return existing
    ? withHitChar(block, slotIndex, instrument, null)
    : withHitChar(block, slotIndex, instrument, getHitChar(instrument, articulation));
}

export function removeHit(block: DrumBlock, slotIndex: number, instrument: DrumInstrument): DrumBlock {
  return withHitChar(block, slotIndex, instrument, null);
}

export function applyArticulation(
  block: DrumBlock,
  slotIndex: number,
  instrument: DrumInstrument,
  articulation: DrumArticulation
): DrumBlock {
  return withHitChar(block, slotIndex, instrument, getHitChar(instrument, articulation));
}

export function setInstrument(
  block: DrumBlock,
  slotIndex: number,
  fromInstrument: DrumInstrument,
  toInstrument: DrumInstrument
): DrumBlock {
  const hit = findHit(block, slotIndex, fromInstrument.id);

  if (!hit) {
    return block;
  }

  const cleared = withHitChar(block, slotIndex, fromInstrument, null);

  return withHitChar(cleared, slotIndex, toInstrument, getHitChar(toInstrument, hit.articulation));
}

// --- Internal rebuild -------------------------------------------------------
// The model is redundant (rows carry pattern strings, slots carry hits), so an
// edit must keep both in sync. Rather than patch the structure in place, we
// drop back to the row-input form, change one character, and rebuild through
// the parser's own builder. That guarantees patterns, slots, and bar widths
// stay mutually consistent — the same invariant a fresh parse provides.

interface RowView {
  instrument: DrumInstrument;
  label: string;
  patterns: string[]; // one entry per leading bar the instrument spans
}

interface SystemView {
  bars: Array<{ width: number; start: number }>;
  rows: RowView[];
}

function withHitChar(
  block: DrumBlock,
  slotIndex: number,
  instrument: DrumInstrument,
  char: string | null
): DrumBlock {
  const views = block.systems.map(toSystemView);
  const location = locate(views, slotIndex);

  if (!location) {
    return block;
  }

  const view = views[location.system];
  let row = view.rows.find((candidate) => candidate.instrument.id === instrument.id);

  if (!row) {
    // Removing a hit that does not exist is a no-op; only adds create a row.
    if (char === null) {
      return block;
    }

    row = { instrument, label: defaultLabel(instrument), patterns: [] };
    view.rows.push(row);
  }

  // A row spans a leading prefix of its system's bars. Adding a hit to a later
  // bar than the row currently reaches fills the intervening bars with rests so
  // the prefix stays contiguous (the only shape the text format can express).
  while (row.patterns.length <= location.bar) {
    row.patterns.push("-".repeat(view.bars[row.patterns.length].width));
  }

  row.patterns[location.bar] = setChar(row.patterns[location.bar], location.local, char ?? "-");

  return finalizeDrumBlock(headerOf(block), views.map(toRowSection));
}

function locate(
  views: SystemView[],
  slotIndex: number
): { system: number; bar: number; local: number } | null {
  for (let system = 0; system < views.length; system++) {
    const bars = views[system].bars;

    for (let bar = 0; bar < bars.length; bar++) {
      if (slotIndex >= bars[bar].start && slotIndex < bars[bar].start + bars[bar].width) {
        return { system, bar, local: slotIndex - bars[bar].start };
      }
    }
  }

  return null;
}

function toSystemView(system: DrumSystem): SystemView {
  const bars = system.bars.map((bar) => ({ width: bar.slots.length, start: bar.startSlot }));
  const order: string[] = [];
  const byId = new Map<string, RowView>();

  for (const bar of system.bars) {
    for (const row of bar.rows) {
      let view = byId.get(row.instrument.id);

      if (!view) {
        view = { instrument: row.instrument, label: row.label, patterns: [] };
        byId.set(row.instrument.id, view);
        order.push(row.instrument.id);
      }

      view.patterns.push(normalizePattern(row.instrument, row.pattern));
    }
  }

  return { bars, rows: order.map((id) => byId.get(id)!) };
}

function toRowSection(view: SystemView): DrumRowInput[] {
  return view.rows.map((row) => ({
    label: row.label,
    patterns: row.patterns,
    instrument: row.instrument
  }));
}

function setChar(pattern: string, index: number, char: string): string {
  const padded = pattern.length > index ? pattern : pattern.padEnd(index + 1, "-");
  const chars = Array.from(padded);
  chars[index] = char;

  return chars.join("");
}

// The first alias is the conventional short code (hh, sd, bd…); upper-casing it
// matches the kit's documented row labels and re-parses to the same instrument.
function defaultLabel(instrument: DrumInstrument): string {
  return (instrument.aliases[0] ?? instrument.label).toUpperCase();
}

function headerOf(block: DrumBlock): DrumBlockHeader {
  const { tempo, timeSignature, repeatCount, showCursor, showHighlight, legendMode, gridResolution, metadata } = block;

  return { tempo, timeSignature, repeatCount, showCursor, showHighlight, legendMode, gridResolution, metadata };
}
