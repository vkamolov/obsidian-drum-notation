import { getArticulation, getVelocity, INSTRUMENTS_BY_ALIAS, isRest } from "./kit";
import {
  DEFAULT_ENGRAVING_STYLE,
  DEFAULT_GRID_RESOLUTION,
  DEFAULT_LEGEND_MODE,
  DEFAULT_REPEAT_COUNT,
  DEFAULT_SHOW_CURSOR,
  DEFAULT_SHOW_HIGHLIGHT,
  DEFAULT_TEMPO,
  DEFAULT_TIME_SIGNATURE,
  DrumBlock,
  DrumHit,
  DrumRow,
  DrumSlot,
  DrumSystem,
  EngravingStyle,
  GridResolution,
  LegendMode
} from "./types";
import { normalizeLabel } from "./util";

interface DrumRowInput {
  label: string;
  patterns: string[];
  instrument: DrumRow["instrument"];
}

export function parseDrumBlock(source: string): DrumBlock {
  const metadata: string[] = [];
  const rowSections: DrumRowInput[][] = [];
  let currentRows: DrumRowInput[] = [];
  let tempo = DEFAULT_TEMPO;
  let timeSignature = DEFAULT_TIME_SIGNATURE;
  let repeatCount = DEFAULT_REPEAT_COUNT;
  let showCursor = DEFAULT_SHOW_CURSOR;
  let showHighlight = DEFAULT_SHOW_HIGHLIGHT;
  let legendMode = DEFAULT_LEGEND_MODE;
  let engravingStyle = DEFAULT_ENGRAVING_STYLE;
  let gridResolution = DEFAULT_GRID_RESOLUTION;

  const pushCurrentBar = () => {
    if (currentRows.length === 0) {
      return;
    }

    rowSections.push(currentRows);
    currentRows = [];
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
        } else if (setting.key === "engraving" || setting.key === "style" || setting.key === "renderstyle") {
          engravingStyle = parseEngravingStyle(setting.value);
        } else if (setting.key === "grid" || setting.key === "subdivision" || setting.key === "resolution") {
          gridResolution = parseGridResolution(setting.value);
        } else {
          metadata.push(`${setting.originalKey}: ${setting.value}`);
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

  const systems = buildSystems(rowSections);
  const bars = systems.flatMap((system) => system.bars);
  const rows = bars.flatMap((bar) => bar.rows);

  return {
    tempo,
    timeSignature,
    repeatCount,
    showCursor,
    showHighlight,
    legendMode,
    engravingStyle,
    gridResolution,
    metadata,
    systems,
    bars,
    rows,
    slots: bars.flatMap((bar) => bar.slots)
  };
}

function isBarSeparator(line: string): boolean {
  return /^(new\s+)?(bar|measure)\b(\s+\d+)?\s*:?.*$/i.test(line);
}

function parseSettingLine(line: string): { key: string; originalKey: string; value: string } | null {
  const match = /^([A-Za-z][A-Za-z\s-]*):\s*(.+)$/.exec(line);

  if (!match) {
    return null;
  }

  const originalKey = match[1].trim();
  const key = normalizeLabel(originalKey);
  const value = match[2].trim();
  const settingKeys = new Set(["title", "author", "comment", "tempo", "bpm", "time", "timesignature", "meter", "count", "repeat", "repeats", "cursor", "playbackcursor", "highlight", "notehighlight", "playbackhighlight", "legend", "instrumentlegend", "kitlegend", "colorlegend", "engraving", "style", "renderstyle", "grid", "subdivision", "resolution"]);

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

function buildSystems(rowSections: DrumRowInput[][]): DrumSystem[] {
  let startSlot = 0;

  return rowSections.map((rowInputs) => {
    const segmentCount = Math.max(1, ...rowInputs.map((row) => row.patterns.length));
    const bars = Array.from({ length: segmentCount }, (_, segmentIndex) => {
      const rows = buildRowsForSegment(rowInputs, segmentIndex);
      const slots = buildSlots(rows, startSlot);
      const bar = { rows, slots, startSlot };
      startSlot += slots.length;

      return bar;
    });

    return { bars };
  });
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

function parseEngravingStyle(value: string): EngravingStyle {
  const normalized = normalizeLabel(value);

  if (["classic", "legacy", "old", "original", "rollback", "default"].includes(normalized)) {
    return "classic";
  }

  if (["tidy", "neat", "compact", "abc", "abcstyle", "modern"].includes(normalized)) {
    return "tidy";
  }

  return DEFAULT_ENGRAVING_STYLE;
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
