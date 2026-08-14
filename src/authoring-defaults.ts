import { isValidBeamGrouping } from "./music";
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
  DrumVoicingMode,
  GridResolution,
  LegendMode
} from "./types";
import { normalizeLabel } from "./util";

export type DrumAuthoringHeaderKey =
  | "title"
  | "tempo"
  | "timeSignature"
  | "beamGrouping"
  | "gridResolution"
  | "voicing"
  | "repeatCount"
  | "showCursor"
  | "showHighlight"
  | "showRests"
  | "legendMode";

export interface DrumAuthoringDefaults {
  title: string;
  tempo: number;
  timeSignature: string;
  beamGrouping?: number[];
  gridResolution: GridResolution;
  voicing: DrumVoicingMode;
  repeatCount: number;
  showCursor: boolean;
  showHighlight: boolean;
  showRests: boolean;
  legendMode: LegendMode;
}

export const DEFAULT_DRUM_AUTHORING_DEFAULTS: DrumAuthoringDefaults = {
  title: "New groove",
  tempo: DEFAULT_TEMPO,
  timeSignature: DEFAULT_TIME_SIGNATURE,
  gridResolution: DEFAULT_GRID_RESOLUTION,
  voicing: DEFAULT_VOICING,
  repeatCount: DEFAULT_REPEAT_COUNT,
  showCursor: DEFAULT_SHOW_CURSOR,
  showHighlight: DEFAULT_SHOW_HIGHLIGHT,
  showRests: DEFAULT_SHOW_RESTS,
  legendMode: DEFAULT_LEGEND_MODE
};

const HEADER_KEY_ALIASES = new Map<string, DrumAuthoringHeaderKey>([
  ["title", "title"],
  ["tempo", "tempo"],
  ["bpm", "tempo"],
  ["time", "timeSignature"],
  ["timesignature", "timeSignature"],
  ["meter", "timeSignature"],
  ["grouping", "beamGrouping"],
  ["grid", "gridResolution"],
  ["subdivision", "gridResolution"],
  ["resolution", "gridResolution"],
  ["voicing", "voicing"],
  ["repeat", "repeatCount"],
  ["repeats", "repeatCount"],
  ["cursor", "showCursor"],
  ["playbackcursor", "showCursor"],
  ["highlight", "showHighlight"],
  ["notehighlight", "showHighlight"],
  ["playbackhighlight", "showHighlight"],
  ["rests", "showRests"],
  ["legend", "legendMode"],
  ["instrumentlegend", "legendMode"],
  ["kitlegend", "legendMode"],
  ["colorlegend", "legendMode"]
]);

const TIME_DENOMINATORS = new Set([2, 4, 8, 16, 32]);

export function normalizeDrumAuthoringDefaults(value: unknown): DrumAuthoringDefaults {
  const record = isRecord(value) ? value : {};
  const title = typeof record.title === "string" && record.title.trim()
    ? record.title.trim()
    : DEFAULT_DRUM_AUTHORING_DEFAULTS.title;
  const tempo = normalizeInteger(record.tempo, 30, 260, DEFAULT_DRUM_AUTHORING_DEFAULTS.tempo);
  const timeSignature = normalizeAuthoringTimeSignature(record.timeSignature);
  const grouping = normalizeAuthoringGrouping(record.beamGrouping, timeSignature);
  const gridResolution: GridResolution = record.gridResolution === 32 ? 32 : 16;
  const voicing: DrumVoicingMode = record.voicing === "split" ? "split" : "single";
  const repeatCount = normalizeInteger(record.repeatCount, 1, 64, DEFAULT_DRUM_AUTHORING_DEFAULTS.repeatCount);
  const legendMode: LegendMode = record.legendMode === "used" || record.legendMode === "all"
    ? record.legendMode
    : "off";

  return {
    title,
    tempo,
    timeSignature,
    ...(grouping ? { beamGrouping: grouping } : {}),
    gridResolution,
    voicing,
    repeatCount,
    showCursor: typeof record.showCursor === "boolean" ? record.showCursor : DEFAULT_SHOW_CURSOR,
    showHighlight: typeof record.showHighlight === "boolean" ? record.showHighlight : DEFAULT_SHOW_HIGHLIGHT,
    showRests: typeof record.showRests === "boolean" ? record.showRests : DEFAULT_SHOW_RESTS,
    legendMode
  };
}

export function getExplicitAuthoringHeaderKeys(source: string): ReadonlySet<DrumAuthoringHeaderKey> {
  const result = new Set<DrumAuthoringHeaderKey>();

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    const divider = line.indexOf(":");

    if (divider <= 0) {
      continue;
    }

    const key = HEADER_KEY_ALIASES.get(normalizeLabel(line.slice(0, divider)));
    if (key) {
      result.add(key);
    }
  }

  return result;
}

export function parseAuthoringTimeSignature(value: string): { numerator: number; denominator: number } | null {
  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const numerator = Number.parseInt(match[1], 10);
  const denominator = Number.parseInt(match[2], 10);

  return numerator >= 1 && numerator <= 32 && TIME_DENOMINATORS.has(denominator)
    ? { numerator, denominator }
    : null;
}

export function parseAuthoringGrouping(value: string, timeSignature: string): number[] | undefined | null {
  if (normalizeLabel(value) === "auto" || value.trim() === "") {
    return undefined;
  }

  const groups = value.split("+").map((part) => Number(part.trim()));
  if (!isValidBeamGrouping(timeSignature, groups)) {
    return null;
  }

  return groups;
}

export function formatAuthoringGrouping(grouping: readonly number[] | undefined): string {
  return grouping?.join("+") ?? "auto";
}

function normalizeAuthoringTimeSignature(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_TIME_SIGNATURE;
  }

  const parsed = parseAuthoringTimeSignature(value);
  return parsed ? `${parsed.numerator}/${parsed.denominator}` : DEFAULT_TIME_SIGNATURE;
}

function normalizeAuthoringGrouping(value: unknown, timeSignature: string): number[] | undefined {
  const candidate = Array.isArray(value)
    ? value.map((part) => typeof part === "number" ? part : Number.NaN)
    : typeof value === "string"
      ? parseAuthoringGrouping(value, timeSignature)
      : undefined;

  return Array.isArray(candidate) && isValidBeamGrouping(timeSignature, candidate)
    ? [...candidate]
    : undefined;
}

function normalizeInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
