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
  DrumStickingInput,
  DrumSystem,
  GridResolution,
  LegendMode,
  MeasureRepeatInput,
  StickingHand
} from "./types";
import { normalizeLabel } from "./util";

interface BarSnapshotRow {
  label: string;
  instrument: DrumInstrument;
  pattern: string;
}

interface BarSnapshot {
  rows: BarSnapshotRow[];
  stickingPattern?: string;
  width: number;
}

const STICKING_LABELS = new Set(["st", "stick", "sticking", "hands"]);

export function parseDrumBlock(source: string): DrumBlock {
  const metadata: string[] = [];
  const rowSections: DrumRowInput[][] = [];
  const stickingSections: Array<DrumStickingInput | undefined> = [];
  const repeatSections: Array<Array<MeasureRepeatInput | undefined>> = [];
  const subtitleSections: Array<string | undefined> = [];
  let currentRows: DrumRowInput[] = [];
  let currentSticking: DrumStickingInput | undefined;
  let currentRepeats: Array<MeasureRepeatInput | undefined> = [];
  let currentSubtitle: string | undefined;
  const barHistory: BarSnapshot[] = [];
  let tempo = DEFAULT_TEMPO;
  let timeSignature = DEFAULT_TIME_SIGNATURE;
  let repeatCount = DEFAULT_REPEAT_COUNT;
  let showCursor = DEFAULT_SHOW_CURSOR;
  let showHighlight = DEFAULT_SHOW_HIGHLIGHT;
  let legendMode = DEFAULT_LEGEND_MODE;
  let gridResolution = DEFAULT_GRID_RESOLUTION;

  const pushCurrentBar = () => {
    if (currentRows.length === 0 && !currentSticking) {
      currentSubtitle = undefined;
      currentRepeats = [];
      return;
    }

    syncRepeatMarkers(currentRows, currentSticking, currentRepeats);
    rowSections.push(currentRows);
    stickingSections.push(currentSticking);
    repeatSections.push(currentRepeats);
    subtitleSections.push(currentSubtitle);
    barHistory.push(...snapshotBars(currentRows, currentSticking));
    currentRows = [];
    currentSticking = undefined;
    currentRepeats = [];
    currentSubtitle = undefined;
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

      const subtitle = parseSubtitleLine(line);

      if (subtitle !== null) {
        if (subtitle.length > 0) {
          currentSubtitle = subtitle;
        }

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
        const repeatedSticking = appendMeasureRepeat(currentRows, currentSticking, currentRepeats, barHistory, measureRepeat);

        if (repeatedSticking === null) {
          metadata.push(line);
        } else {
          currentSticking = repeatedSticking;
        }

        return;
      }

      const sticking = parseStickingRowInput(line);

      if (sticking) {
        currentSticking = sticking;
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
    repeatSections,
    stickingSections,
    subtitleSections
  );
}

// Assembles the structural model (systems -> bars -> rows -> slots) from a
// header plus per-system row inputs. parseDrumBlock builds the inputs from
// text; the editor builds them from an existing block. Routing both through
// one builder keeps slots, patterns, and bar widths consistent by construction.
export function finalizeDrumBlock(
  header: DrumBlockHeader,
  rowSections: DrumRowInput[][],
  repeatSections: Array<Array<MeasureRepeatInput | undefined>> = [],
  stickingSections: Array<DrumStickingInput | undefined> = [],
  subtitleSections: Array<string | undefined> = []
): DrumBlock {
  const systems = buildSystems(rowSections, repeatSections, stickingSections, subtitleSections);
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

function parseSubtitleLine(line: string): string | null {
  const match = /^subtitle\s*:\s*(.*)$/i.exec(line);

  return match ? match[1].trim() : null;
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

function parseStickingRowInput(line: string): DrumStickingInput | null {
  const dividerIndex = line.indexOf("|");

  if (dividerIndex <= 0) {
    return null;
  }

  const label = line.slice(0, dividerIndex).trim();

  if (!STICKING_LABELS.has(normalizeLabel(label))) {
    return null;
  }

  const patterns = line
    .slice(dividerIndex + 1)
    .split("|")
    .map((pattern) => pattern.replace(/\s+/g, "").trim())
    .filter((pattern) => pattern.length > 0)
    .map(normalizeStickingPattern);

  if (!label || patterns.length === 0) {
    return null;
  }

  return { label, patterns };
}

function buildSystems(
  rowSections: DrumRowInput[][],
  repeatSections: Array<Array<MeasureRepeatInput | undefined>>,
  stickingSections: Array<DrumStickingInput | undefined>,
  subtitleSections: Array<string | undefined>
): DrumSystem[] {
  let startSlot = 0;

  return rowSections.map((rowInputs, systemIndex) => {
    const stickingInput = stickingSections[systemIndex];
    const segmentCount = Math.max(1, getSegmentCount(rowInputs, stickingInput));
    const bars = Array.from({ length: segmentCount }, (_, segmentIndex) => {
      const rows = buildRowsForSegment(rowInputs, segmentIndex);
      const stickingPattern = stickingInput?.patterns[segmentIndex];
      const slots = buildSlots(rows, startSlot, stickingPattern);
      const measureRepeat = repeatSections[systemIndex]?.[segmentIndex];
      const bar = {
        rows,
        slots,
        startSlot,
        ...(stickingPattern !== undefined ? { stickingPattern } : {}),
        ...(measureRepeat ? { measureRepeat: measureRepeat.type } : {}),
        ...(measureRepeat && measureRepeat.count > 1 ? { measureRepeatCount: measureRepeat.count } : {})
      };
      startSlot += slots.length;

      return bar;
    });

    const subtitle = subtitleSections[systemIndex]?.trim();

    return {
      bars,
      ...(subtitle ? { subtitle } : {})
    };
  });
}

function appendMeasureRepeat(
  currentRows: DrumRowInput[],
  currentSticking: DrumStickingInput | undefined,
  currentRepeats: Array<MeasureRepeatInput | undefined>,
  barHistory: BarSnapshot[],
  measureRepeat: MeasureRepeatInput
): DrumStickingInput | undefined | null {
  syncRepeatMarkers(currentRows, currentSticking, currentRepeats);

  const previousBars = [...barHistory, ...snapshotBars(currentRows, currentSticking)];
  const previousBar = previousBars[previousBars.length - 1];

  if (!previousBar) {
    return null;
  }

  let nextSticking = currentSticking;

  for (let index = 0; index < measureRepeat.count; index++) {
    nextSticking = appendSnapshotBar(currentRows, nextSticking, previousBar);
    currentRepeats.push({
      type: measureRepeat.type,
      count: index === 0 ? measureRepeat.count : 1
    });
  }

  return nextSticking;
}

function appendSnapshotBar(
  currentRows: DrumRowInput[],
  currentSticking: DrumStickingInput | undefined,
  snapshot: BarSnapshot
): DrumStickingInput | undefined {
  const targetBarIndex = getSegmentCount(currentRows, currentSticking);
  const widths = getBarWidths(currentRows, currentSticking);

  snapshot.rows.forEach((snapshotRow) => {
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

  if (snapshot.stickingPattern !== undefined) {
    const nextSticking = currentSticking ?? { label: "ST", patterns: [] };

    while (nextSticking.patterns.length < targetBarIndex) {
      nextSticking.patterns.push("-".repeat(widths[nextSticking.patterns.length] ?? snapshot.width));
    }

    nextSticking.patterns.push(snapshot.stickingPattern);
    return nextSticking;
  }

  return currentSticking;
}

function syncRepeatMarkers(
  rows: DrumRowInput[],
  sticking: DrumStickingInput | undefined,
  repeats: Array<MeasureRepeatInput | undefined>
): void {
  const segmentCount = getSegmentCount(rows, sticking);

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

function snapshotBars(rows: DrumRowInput[], sticking: DrumStickingInput | undefined): BarSnapshot[] {
  const segmentCount = getSegmentCount(rows, sticking);
  const widths = getBarWidths(rows, sticking);

  return Array.from({ length: segmentCount }, (_, segmentIndex) => ({
    rows: rows
      .map((row): BarSnapshotRow | null => {
        const pattern = row.patterns[segmentIndex];

        if (!pattern) {
          return null;
        }

        return { label: row.label, instrument: row.instrument, pattern };
      })
      .filter((row): row is BarSnapshotRow => row !== null),
    ...(sticking?.patterns[segmentIndex] !== undefined ? { stickingPattern: sticking.patterns[segmentIndex] } : {}),
    width: widths[segmentIndex] ?? 0
  }));
}

function getSegmentCount(rows: DrumRowInput[], sticking?: DrumStickingInput): number {
  return Math.max(0, ...rows.map((row) => row.patterns.length), sticking?.patterns.length ?? 0);
}

function getBarWidths(rows: DrumRowInput[], sticking?: DrumStickingInput): number[] {
  const segmentCount = getSegmentCount(rows, sticking);

  return Array.from({ length: segmentCount }, (_, segmentIndex) =>
    Math.max(0, ...rows.map((row) => row.patterns[segmentIndex]?.length ?? 0), sticking?.patterns[segmentIndex]?.length ?? 0)
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

function buildSlots(rows: DrumRow[], startSlot: number, stickingPattern?: string): DrumSlot[] {
  const slotCount = Math.max(0, ...rows.map((row) => row.pattern.length), stickingPattern?.length ?? 0);

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
    const sticking = getSticking(stickingPattern?.[index] ?? "-");

    return {
      index: startSlot + index,
      hits,
      ...(sticking ? { sticking } : {})
    };
  });
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

function getSticking(value: string): StickingHand | undefined {
  if (value === "R") {
    return "right";
  }

  if (value === "L") {
    return "left";
  }

  if (value === "B") {
    return "both";
  }

  return undefined;
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
