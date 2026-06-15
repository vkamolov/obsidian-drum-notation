import { getArticulation, getVelocity, INSTRUMENTS_BY_ALIAS, isRest } from "./kit";
import {
  DEFAULT_GRID_RESOLUTION,
  DEFAULT_LEGEND_MODE,
  DEFAULT_REPEAT_COUNT,
  DEFAULT_SHOW_CURSOR,
  DEFAULT_SHOW_HIGHLIGHT,
  DEFAULT_TEMPO,
  DEFAULT_TIME_SIGNATURE,
  DrumBlock,
  DrumBlockHeader,
  DrumHit,
  DrumInstrument,
  DrumRow,
  DrumRowInput,
  DrumSlot,
  DrumSystem,
  GridResolution,
  LegendMode,
  MeasureRepeatInput
} from "./types";
import { normalizeLabel } from "./util";

interface BarSnapshotRow {
  label: string;
  instrument: DrumInstrument;
  pattern: string;
}

type BarSnapshot = BarSnapshotRow[];

export function parseDrumBlock(source: string): DrumBlock {
  const metadata: string[] = [];
  const rowSections: DrumRowInput[][] = [];
  const repeatSections: Array<Array<MeasureRepeatInput | undefined>> = [];
  let currentRows: DrumRowInput[] = [];
  let currentRepeats: Array<MeasureRepeatInput | undefined> = [];
  const barHistory: BarSnapshot[] = [];
  let tempo = DEFAULT_TEMPO;
  let timeSignature = DEFAULT_TIME_SIGNATURE;
  let repeatCount = DEFAULT_REPEAT_COUNT;
  let showCursor = DEFAULT_SHOW_CURSOR;
  let showHighlight = DEFAULT_SHOW_HIGHLIGHT;
  let legendMode = DEFAULT_LEGEND_MODE;
  let gridResolution = DEFAULT_GRID_RESOLUTION;

  const pushCurrentBar = () => {
    if (currentRows.length === 0) {
      return;
    }

    syncRepeatMarkers(currentRows, currentRepeats);
    rowSections.push(currentRows);
    repeatSections.push(currentRepeats);
    barHistory.push(...snapshotBars(currentRows));
    currentRows = [];
    currentRepeats = [];
  };

  source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .forEach((line) => {
      if (isBarSeparator(line)) {
        pushCurrentBar();
        return;
      }

      const setting = parseSettingLine(line);

      if (setting) {
        if (setting.key === "tempo" || setting.key === "bpm") {
          tempo = clampTempo(Number.parseInt(setting.value, 10));
        } else if (setting.key === "time" || setting.key === "timesignature" || setting.key === "meter") {
          timeSignature = parseTimeSignature(setting.value);
        } else if (setting.key === "repeat" || setting.key === "repeats") {
          repeatCount = parseRepeatCount(setting.value);
        } else if (setting.key === "cursor" || setting.key === "playbackcursor") {
          showCursor = parseBooleanSetting(setting.value, DEFAULT_SHOW_CURSOR);
        } else if (setting.key === "highlight" || setting.key === "notehighlight" || setting.key === "playbackhighlight") {
          showHighlight = parseBooleanSetting(setting.value, DEFAULT_SHOW_HIGHLIGHT);
        } else if (setting.key === "legend" || setting.key === "instrumentlegend" || setting.key === "kitlegend" || setting.key === "colorlegend") {
          legendMode = parseLegendMode(setting.value);
        } else if (setting.key === "grid" || setting.key === "subdivision" || setting.key === "resolution") {
          gridResolution = parseGridResolution(setting.value);
        } else {
          metadata.push(`${setting.originalKey}: ${setting.value}`);
        }

        return;
      }

      const measureRepeat = parseMeasureRepeatLine(line);

      if (measureRepeat) {
        if (!appendMeasureRepeat(currentRows, currentRepeats, barHistory, measureRepeat)) {
          metadata.push(line);
        }

        return;
      }

      const row = parseDrumRowInput(line);

      if (row) {
        currentRows.push(row);
      } else {
        metadata.push(line);
      }
    });

  pushCurrentBar();

  return finalizeDrumBlock(
    { tempo, timeSignature, repeatCount, showCursor, showHighlight, legendMode, gridResolution, metadata },
    rowSections,
    repeatSections
  );
}

// Assembles the structural model (systems -> bars -> rows -> slots) from a
// header plus per-system row inputs. parseDrumBlock builds the inputs from
// text; the editor builds them from an existing block. Routing both through
// one builder keeps slots, patterns, and bar widths consistent by construction.
export function finalizeDrumBlock(
  header: DrumBlockHeader,
  rowSections: DrumRowInput[][],
  repeatSections: Array<Array<MeasureRepeatInput | undefined>> = []
): DrumBlock {
  const systems = buildSystems(rowSections, repeatSections);
  const bars = systems.flatMap((system) => system.bars);
  const rows = bars.flatMap((bar) => bar.rows);

  return {
    ...header,
    systems,
    bars,
    rows,
    slots: bars.flatMap((bar) => bar.slots)
  };
}

function isBarSeparator(line: string): boolean {
  return /^(new\s+)?(bar|measure)\b(\s+\d+)?\s*:?.*$/i.test(line);
}

function parseMeasureRepeatLine(line: string): MeasureRepeatInput | null {
  const percentMatch = /^%(?:\s*x\s*(\d+))?$/i.exec(line);

  if (percentMatch) {
    return { type: 1, count: parseMeasureRepeatCount(percentMatch[1]) };
  }

  const textMatch = /^repeat(?:\s+(?:bar|measure|previous\s+(?:bar|measure)|1(?:[-\s]*(?:bar|measure))?|one(?:[-\s]*(?:bar|measure))?))?(?:\s*x\s*(\d+))?$/i.exec(line);

  if (!textMatch) {
    return null;
  }

  return { type: 1, count: parseMeasureRepeatCount(textMatch[1]) };
}

function parseSettingLine(line: string): { key: string; originalKey: string; value: string } | null {
  const match = /^([A-Za-z][A-Za-z\s-]*):\s*(.+)$/.exec(line);

  if (!match) {
    return null;
  }

  const originalKey = match[1].trim();
  const key = normalizeLabel(originalKey);
  const value = match[2].trim();
  const settingKeys = new Set(["title", "author", "comment", "tempo", "bpm", "time", "timesignature", "meter", "count", "repeat", "repeats", "cursor", "playbackcursor", "highlight", "notehighlight", "playbackhighlight", "legend", "instrumentlegend", "kitlegend", "colorlegend", "grid", "subdivision", "resolution"]);

  if (!settingKeys.has(key)) {
    return null;
  }

  return { key, originalKey, value };
}

function parseDrumRowInput(line: string): DrumRowInput | null {
  const dividerIndex = line.indexOf("|");

  if (dividerIndex <= 0) {
    return null;
  }

  const label = line.slice(0, dividerIndex).trim();
  const instrument = INSTRUMENTS_BY_ALIAS.get(normalizeLabel(label));
  const patterns = line
    .slice(dividerIndex + 1)
    .split("|")
    .map((pattern) => pattern.replace(/\s+/g, "").trim())
    .filter((pattern) => pattern.length > 0);

  if (!label || !instrument || patterns.length === 0) {
    return null;
  }

  return { label, patterns, instrument };
}

function buildSystems(
  rowSections: DrumRowInput[][],
  repeatSections: Array<Array<MeasureRepeatInput | undefined>>
): DrumSystem[] {
  let startSlot = 0;

  return rowSections.map((rowInputs, systemIndex) => {
    const segmentCount = Math.max(1, ...rowInputs.map((row) => row.patterns.length));
    const bars = Array.from({ length: segmentCount }, (_, segmentIndex) => {
      const rows = buildRowsForSegment(rowInputs, segmentIndex);
      const slots = buildSlots(rows, startSlot);
      const measureRepeat = repeatSections[systemIndex]?.[segmentIndex];
      const bar = {
        rows,
        slots,
        startSlot,
        ...(measureRepeat ? { measureRepeat: measureRepeat.type } : {}),
        ...(measureRepeat && measureRepeat.count > 1 ? { measureRepeatCount: measureRepeat.count } : {})
      };
      startSlot += slots.length;

      return bar;
    });

    return { bars };
  });
}

function appendMeasureRepeat(
  currentRows: DrumRowInput[],
  currentRepeats: Array<MeasureRepeatInput | undefined>,
  barHistory: BarSnapshot[],
  measureRepeat: MeasureRepeatInput
): boolean {
  syncRepeatMarkers(currentRows, currentRepeats);

  const previousBars = [...barHistory, ...snapshotBars(currentRows)];
  const previousBar = previousBars[previousBars.length - 1];

  if (!previousBar) {
    return false;
  }

  for (let index = 0; index < measureRepeat.count; index++) {
    appendSnapshotBar(currentRows, previousBar);
    currentRepeats.push({
      type: measureRepeat.type,
      count: index === 0 ? measureRepeat.count : 1
    });
  }

  return true;
}

function appendSnapshotBar(currentRows: DrumRowInput[], snapshot: BarSnapshot): void {
  const targetBarIndex = getSegmentCount(currentRows);
  const widths = getBarWidths(currentRows);

  snapshot.forEach((snapshotRow) => {
    let row = currentRows.find((candidate) => candidate.instrument.id === snapshotRow.instrument.id);

    if (!row) {
      row = {
        label: snapshotRow.label,
        patterns: [],
        instrument: snapshotRow.instrument
      };
      currentRows.push(row);
    }

    while (row.patterns.length < targetBarIndex) {
      row.patterns.push("-".repeat(widths[row.patterns.length] ?? snapshotRow.pattern.length));
    }

    row.patterns.push(snapshotRow.pattern);
  });
}

function syncRepeatMarkers(rows: DrumRowInput[], repeats: Array<MeasureRepeatInput | undefined>): void {
  const segmentCount = getSegmentCount(rows);

  while (repeats.length < segmentCount) {
    repeats.push(undefined);
  }
}

function parseMeasureRepeatCount(value: string | undefined): number {
  const count = value ? Number.parseInt(value, 10) : 1;

  if (!Number.isFinite(count)) {
    return 1;
  }

  return Math.min(64, Math.max(1, count));
}

function snapshotBars(rows: DrumRowInput[]): BarSnapshot[] {
  const segmentCount = getSegmentCount(rows);

  return Array.from({ length: segmentCount }, (_, segmentIndex) =>
    rows
      .map((row): BarSnapshotRow | null => {
        const pattern = row.patterns[segmentIndex];

        if (!pattern) {
          return null;
        }

        return { label: row.label, instrument: row.instrument, pattern };
      })
      .filter((row): row is BarSnapshotRow => row !== null)
  );
}

function getSegmentCount(rows: DrumRowInput[]): number {
  return Math.max(0, ...rows.map((row) => row.patterns.length));
}

function getBarWidths(rows: DrumRowInput[]): number[] {
  const segmentCount = getSegmentCount(rows);

  return Array.from({ length: segmentCount }, (_, segmentIndex) =>
    Math.max(0, ...rows.map((row) => row.patterns[segmentIndex]?.length ?? 0))
  );
}

function buildRowsForSegment(rowInputs: DrumRowInput[], segmentIndex: number): DrumRow[] {
  return rowInputs
    .map((row): DrumRow | null => {
      const pattern = row.patterns[segmentIndex];

      if (!pattern) {
        return null;
      }

      return {
        label: row.label,
        pattern,
        instrument: row.instrument
      };
    })
    .filter((row): row is DrumRow => row !== null);
}

function buildSlots(rows: DrumRow[], startSlot: number): DrumSlot[] {
  const slotCount = Math.max(0, ...rows.map((row) => row.pattern.length));

  return Array.from({ length: slotCount }, (_, index) => {
    const hits = rows
      .map((row): DrumHit | null => {
        const value = row.pattern[index] ?? "-";

        if (isRest(value)) {
          return null;
        }

        return {
          instrument: row.instrument,
          articulation: getArticulation(value),
          velocity: getVelocity(value)
        };
      })
      .filter((hit): hit is DrumHit => hit !== null);

    return { index: startSlot + index, hits };
  });
}

export function getTitle(block: DrumBlock): string {
  const title = block.metadata.find((line) => normalizeLabel(line.split(":")[0] ?? "") === "title");

  if (!title) {
    return "Drum notation";
  }

  return title.slice(title.indexOf(":") + 1).trim() || "Drum notation";
}

function parseTimeSignature(value: string): string {
  const match = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(value);

  if (!match) {
    return DEFAULT_TIME_SIGNATURE;
  }

  return `${match[1]}/${match[2]}`;
}

function parseRepeatCount(value: string): number {
  const match = /(\d+)/.exec(value);

  if (!match) {
    return DEFAULT_REPEAT_COUNT;
  }

  return Math.min(64, Math.max(1, Number.parseInt(match[1], 10)));
}

function parseBooleanSetting(value: string, fallback: boolean): boolean {
  const normalized = normalizeLabel(value);

  if (["on", "true", "yes", "y", "1", "show", "visible"].includes(normalized)) {
    return true;
  }

  if (["off", "false", "no", "n", "0", "hide", "hidden"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseLegendMode(value: string): LegendMode {
  const normalized = normalizeLabel(value);

  if (["on", "true", "yes", "y", "1", "show", "visible", "used", "current", "present"].includes(normalized)) {
    return "used";
  }

  if (["all", "full", "kit", "complete", "supported", "everything"].includes(normalized)) {
    return "all";
  }

  if (["off", "false", "no", "n", "0", "hide", "hidden", "none"].includes(normalized)) {
    return "off";
  }

  return DEFAULT_LEGEND_MODE;
}

function parseGridResolution(value: string): GridResolution {
  const match = /(\d+)/.exec(value);

  if (!match) {
    return DEFAULT_GRID_RESOLUTION;
  }

  return Number.parseInt(match[1], 10) === 32 ? 32 : 16;
}

function clampTempo(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TEMPO;
  }

  return Math.min(260, Math.max(30, value));
}
