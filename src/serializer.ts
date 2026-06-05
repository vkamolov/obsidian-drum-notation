import { normalizePattern } from "./kit";
import {
  DEFAULT_GRID_RESOLUTION,
  DEFAULT_LEGEND_MODE,
  DEFAULT_REPEAT_COUNT,
  DEFAULT_SHOW_CURSOR,
  DEFAULT_SHOW_HIGHLIGHT,
  DEFAULT_TEMPO,
  DEFAULT_TIME_SIGNATURE,
  DrumBlock,
  DrumBar,
  DrumInstrument,
  DrumSystem
} from "./types";

// Pure, DOM-free model -> text serializer. It is the inverse of parseDrumBlock
// at the *model* level: parse(serialize(parse(x))) is structurally equal to
// parse(x), and serialize is idempotent. Byte-for-byte text fidelity is NOT a
// goal — output is normalized (canonical hit characters, default settings
// dropped, whitespace regularized) so it stays deterministic and diff-friendly.
//
// NOTE: this is intentionally not wired into the live render/play path yet. It
// exists so the parse -> edit -> serialize loop can be built and tested in
// isolation, with zero risk to the working renderer.
export function serializeDrumBlock(block: DrumBlock): string {
  const lines = [...serializeHeader(block)];

  block.systems.forEach((system, index) => {
    if (index > 0) {
      lines.push("Bar");
    }

    lines.push(...serializeSystem(system));
  });

  return lines.join("\n");
}

function serializeHeader(block: DrumBlock): string[] {
  // Unknown/unmodeled lines (Title, Author, Count, Engraving, comments…) are
  // preserved verbatim and in order so hand-written metadata is never dropped.
  const lines = [...block.metadata];

  // Only settings that differ from their defaults are emitted. Omitted settings
  // re-parse back to the same defaults, so the model round-trips while output
  // stays minimal and free of noise the user never wrote.
  if (block.tempo !== DEFAULT_TEMPO) {
    lines.push(`Tempo: ${block.tempo}`);
  }

  if (block.timeSignature !== DEFAULT_TIME_SIGNATURE) {
    lines.push(`Time: ${block.timeSignature}`);
  }

  if (block.repeatCount !== DEFAULT_REPEAT_COUNT) {
    lines.push(`Repeat: ${block.repeatCount}`);
  }

  if (block.gridResolution !== DEFAULT_GRID_RESOLUTION) {
    lines.push(`Grid: ${block.gridResolution}`);
  }

  if (block.legendMode !== DEFAULT_LEGEND_MODE) {
    lines.push(`Legend: ${block.legendMode}`);
  }

  if (block.showCursor !== DEFAULT_SHOW_CURSOR) {
    lines.push(`Cursor: ${block.showCursor ? "on" : "off"}`);
  }

  if (block.showHighlight !== DEFAULT_SHOW_HIGHLIGHT) {
    lines.push(`Highlight: ${block.showHighlight ? "on" : "off"}`);
  }

  return lines;
}

function serializeSystem(system: DrumSystem): string[] {
  const lines: string[] = [];
  let normalBars: DrumBar[] = [];

  const flushNormalBars = () => {
    if (normalBars.length === 0) {
      return;
    }

    lines.push(...serializeNormalBars(normalBars));
    normalBars = [];
  };

  for (let index = 0; index < system.bars.length; index++) {
    const bar = system.bars[index];

    if (bar.measureRepeat) {
      flushNormalBars();

      const repeatCount = Math.max(1, Math.min(bar.measureRepeatCount ?? 1, countMeasureRepeatRun(system.bars, index)));

      lines.push(formatMeasureRepeat(repeatCount));
      index += repeatCount - 1;
      continue;
    }

    normalBars.push(bar);
  }

  flushNormalBars();

  return lines;
}

function countMeasureRepeatRun(bars: DrumBar[], startIndex: number): number {
  let count = 0;

  for (let index = startIndex; index < bars.length; index++) {
    if (!bars[index].measureRepeat) {
      break;
    }

    count++;
  }

  return count;
}

function formatMeasureRepeat(count: number): string {
  return count > 1 ? `%x${count}` : "%";
}

function serializeNormalBars(bars: DrumBar[]): string[] {
  const rows = toSystemRows(bars);
  const labelWidth = Math.max(0, ...rows.map((row) => row.label.length));

  return rows.map((row) => `${row.label.padEnd(labelWidth)} | ${row.patterns.join(" | ")}`);
}

interface SystemRow {
  label: string;
  instrument: DrumInstrument;
  patterns: string[];
}

// Collapses a system's per-bar rows back into one row per instrument, ordered
// by first appearance, with one normalized pattern per bar the instrument
// spans. An instrument that is absent from a trailing bar simply contributes
// fewer patterns — which is exactly how the parser represents a row that spans
// fewer bar segments than its neighbours.
function toSystemRows(bars: DrumBar[]): SystemRow[] {
  const order: DrumInstrument[] = [];
  const labels = new Map<string, string>();
  const patterns = new Map<string, string[]>();

  for (const bar of bars) {
    for (const row of bar.rows) {
      const id = row.instrument.id;

      if (!patterns.has(id)) {
        order.push(row.instrument);
        labels.set(id, row.label);
        patterns.set(id, []);
      }

      patterns.get(id)!.push(normalizePattern(row.instrument, row.pattern));
    }
  }

  return order.map((instrument) => ({
    label: labels.get(instrument.id)!,
    instrument,
    patterns: patterns.get(instrument.id)!
  }));
}
