import { normalizePattern } from "./kit";
import {
  DEFAULT_GRID_RESOLUTION,
  DEFAULT_LEGEND_MODE,
  DEFAULT_REPEAT_COUNT,
  DEFAULT_SHOW_CURSOR,
  DEFAULT_SHOW_HIGHLIGHT,
  DEFAULT_SHOW_RESTS,
  DEFAULT_TEMPO,
  DEFAULT_TIME_SIGNATURE,
  DEFAULT_VOICING,
  DrumBlock,
  DrumBar,
  DrumInstrument,
  DrumSectionRepeat,
  DrumSystem
} from "./types";
import { getTupletDurationDenominator } from "./rhythm";
import { normalizeLabel } from "./util";

export type SerializationMode = "minimal" | "authoring";

export interface SerializeDrumBlockOptions {
  mode?: SerializationMode;
}

// Pure, DOM-free model -> text serializer. It is the inverse of parseDrumBlock
// at the *model* level: parse(serialize(parse(x))) is structurally equal to
// parse(x), and serialize is idempotent. Byte-for-byte text fidelity is NOT a
// goal — output is normalized (canonical hit characters, default settings
// dropped, whitespace regularized) so it stays deterministic and diff-friendly.
//
export function serializeDrumBlock(block: DrumBlock, options: SerializeDrumBlockOptions = {}): string {
  if (options.mode === "authoring") {
    return serializeAuthoringBlock(block);
  }

  return serializeMinimalBlock(block);
}

function serializeMinimalBlock(block: DrumBlock): string {
  return [...serializeMinimalHeader(block), ...serializeSystems(block)].join("\n");
}

function serializeSystems(block: DrumBlock): string[] {
  const lines: string[] = [];
  const barIndexes = new Map(block.bars.map((bar, index) => [bar, index]));

  block.systems.forEach((system, index) => {
    if (index > 0) {
      lines.push("Bar");
      const previous = block.systems[index - 1];
      const meterChanged = system.timeSignature !== previous.timeSignature;

      if (meterChanged) {
        lines.push(`Time: ${system.timeSignature}`);
      }

      const previousGrouping = meterChanged ? undefined : previous.beamGrouping;

      if (!sameGrouping(system.beamGrouping, previousGrouping)) {
        lines.push(
          system.beamGrouping
            ? `Grouping: ${system.beamGrouping.join("+")}`
            : "Grouping: auto"
        );
      }
    }

    if (system.subtitle) {
      lines.push(`Subtitle: ${system.subtitle}`);
    }

    lines.push(...serializeSystem(system, block.sectionRepeats, barIndexes));
  });

  return lines;
}

function serializeMinimalHeader(block: DrumBlock): string[] {
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

  if (block.beamGrouping) {
    lines.push(`Grouping: ${block.beamGrouping.join("+")}`);
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

  if (block.showRests !== DEFAULT_SHOW_RESTS) {
    lines.push(`Rests: ${block.showRests ? "on" : "off"}`);
  }

  if (block.voicing !== DEFAULT_VOICING) {
    lines.push(`Voicing: ${block.voicing}`);
  }

  return lines;
}

function serializeAuthoringBlock(block: DrumBlock): string {
  const requiredLines = [
    `Title: ${getMetadataTitle(block)}`,
    `Tempo: ${block.tempo}`,
    `Time: ${block.timeSignature}`,
    ...(block.beamGrouping ? [`Grouping: ${block.beamGrouping.join("+")}`] : []),
    ...(block.voicing !== DEFAULT_VOICING ? [`Voicing: ${block.voicing}`] : []),
    `Grid: ${block.gridResolution}`
  ];

  if (block.repeatCount !== DEFAULT_REPEAT_COUNT) {
    requiredLines.push(`Repeat: ${block.repeatCount}`);
  }

  if (block.legendMode !== DEFAULT_LEGEND_MODE) {
    requiredLines.push(`Legend: ${block.legendMode}`);
  }

  const supplementalHeader = serializeMinimalHeader(block)
    .filter((line) => line.trim().length > 0)
    .filter((line) => !isManagedAuthoringLine(line));
  const bodyLines = serializeSystems(block);

  return [...requiredLines, ...supplementalHeader, ...bodyLines].join("\n");
}

function sameGrouping(left: number[] | undefined, right: number[] | undefined): boolean {
  if (!left || !right) {
    return left === right;
  }

  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function getMetadataTitle(block: DrumBlock): string {
  const title = block.metadata.find((line) => normalizeLabel(line.split(":")[0] ?? "") === "title");

  if (!title) {
    return "Drum notation";
  }

  return title.slice(title.indexOf(":") + 1).trim() || "Drum notation";
}

function isManagedAuthoringLine(line: string): boolean {
  const divider = line.indexOf(":");

  if (divider <= 0) {
    return false;
  }

  return new Set([
    "title",
    "tempo",
    "bpm",
    "time",
    "timesignature",
    "meter",
    "grouping",
    "voicing",
    "repeat",
    "repeats",
    "grid",
    "subdivision",
    "resolution",
    "legend",
    "instrumentlegend",
    "kitlegend",
    "colorlegend"
  ]).has(normalizeLabel(line.slice(0, divider)));
}

function serializeSystem(
  system: DrumSystem,
  sectionRepeats: readonly DrumSectionRepeat[],
  barIndexes: ReadonlyMap<DrumBar, number>
): string[] {
  const lines: string[] = [];
  let normalBars: DrumBar[] = [];

  const flushNormalBars = () => {
    if (normalBars.length === 0) {
      return;
    }

    lines.push(...serializeNormalBars(normalBars, sectionRepeats, barIndexes));
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

function serializeNormalBars(
  bars: DrumBar[],
  sectionRepeats: readonly DrumSectionRepeat[],
  barIndexes: ReadonlyMap<DrumBar, number>
): string[] {
  const rows: SystemRow[] = [];
  const stickingRow = toStickingRow(bars);

  if (stickingRow) {
    rows.push(stickingRow);
  }

  for (const row of toSystemRows(bars)) {
    rows.push(row);
  }

  let labelWidth = 0;
  for (const row of rows) {
    labelWidth = Math.max(labelWidth, row.label.length);
  }

  const lines: string[] = [];
  const globalBarIndexes = bars.map((bar) => barIndexes.get(bar) ?? -1);
  for (const row of rows) {
    lines.push(
      `${padRight(row.label, labelWidth)} ${joinPatterns(row.patterns, globalBarIndexes, sectionRepeats)}`
    );
  }

  return lines;
}

interface SystemRow {
  label: string;
  instrument?: DrumInstrument;
  patterns: string[];
}

function padRight(value: string, width: number): string {
  let padded = value;

  while (padded.length < width) {
    padded += " ";
  }

  return padded;
}

function joinPatterns(
  patterns: string[],
  globalBarIndexes: number[],
  sectionRepeats: readonly DrumSectionRepeat[]
): string {
  let result = "";
  const starts = new Set(sectionRepeats.map((repeat) => repeat.startBarIndex));
  const ends = new Set(sectionRepeats.map((repeat) => repeat.endBarIndex));

  for (let index = 0; index < patterns.length; index++) {
    const globalBarIndex = globalBarIndexes[index] ?? -1;
    const previousGlobalBarIndex = globalBarIndexes[index - 1] ?? -1;
    const separator = index > 0 && ends.has(previousGlobalBarIndex)
      ? "]"
      : starts.has(globalBarIndex)
        ? "["
        : "|";

    result += `${index > 0 ? " " : ""}${separator} ${patterns[index]}`;
  }

  const finalGlobalBarIndex = globalBarIndexes[patterns.length - 1] ?? -1;
  if (ends.has(finalGlobalBarIndex)) {
    result += " ]";
  }

  return result;
}

function toStickingRow(bars: DrumBar[]): SystemRow | null {
  if (!bars.some((bar) => bar.stickingPattern !== undefined)) {
    return null;
  }

  return {
    label: "ST",
    patterns: bars.map((bar) =>
      serializeRhythmicPattern(
        bar,
        normalizeStickingPattern(bar.stickingPattern ?? "-".repeat(bar.slots.length))
      )
    )
  };
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

      patterns.get(id)!.push(
        serializeRhythmicPattern(
          bar,
          normalizePattern(row.instrument, row.pattern)
        )
      );
    }
  }

  return order.map((instrument) => ({
    label: labels.get(instrument.id)!,
    instrument,
    patterns: patterns.get(instrument.id)!
  }));
}

function serializeRhythmicPattern(
  bar: DrumBar,
  pattern: string
): string {
  if (!bar.rhythmRegions.some((region) => region.kind === "tuplet")) {
    return pattern;
  }

  let result = "";
  let cursor = 0;

  for (const region of bar.rhythmRegions) {
    if (region.startPosition > cursor) {
      result += pattern.slice(cursor, region.startPosition);
    }

    const end = region.startPosition + region.positionCount;
    const sourceBody = pattern.slice(region.startPosition, end);
    const body = sourceBody +
      "-".repeat(Math.max(0, region.positionCount - sourceBody.length));

    if (region.kind === "tuplet") {
      const span = region.tupletSpan;

      if (span?.kind === "written-beats") {
        const prefix = span.beats === 1
          ? String(region.subdivisionCount)
          : `${span.beats}/${region.subdivisionCount}`;

        result += `${prefix}(${body})`;
      } else {
        const denominator = span?.kind === "note-value"
          ? span.denominator
          : getTupletDurationDenominator(region);

        result += `${region.subdivisionCount}@${denominator}(${body})`;
      }
    } else {
      result += body;
    }
    cursor = end;
  }

  return result + pattern.slice(cursor);
}

function normalizeStickingPattern(pattern: string): string {
  return Array.from(pattern)
    .map((char) => {
      if (char === "R" || char === "r") {
        return "R";
      }

      if (char === "L" || char === "l") {
        return "L";
      }

      if (char === "B" || char === "b") {
        return "B";
      }

      return "-";
    })
    .join("");
}
