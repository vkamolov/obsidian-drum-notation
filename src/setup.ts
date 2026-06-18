import { DRUM_KIT } from "./kit";
import { getSlotsPerBar } from "./music";
import { finalizeDrumBlock } from "./parser";
import { serializeDrumBlock } from "./serializer";
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
  DrumInstrument,
  DrumRowInput,
  GridResolution
} from "./types";
import { normalizeLabel } from "./util";

export type DrumSetupTimeDenominator = 2 | 4 | 8 | 16 | 32;

export interface DrumSetupValues {
  title: string;
  tempo: number;
  timeNumerator: number;
  timeDenominator: DrumSetupTimeDenominator;
  grid: GridResolution;
}

export const DEFAULT_DRUM_SETUP_VALUES: DrumSetupValues = {
  title: "New groove",
  tempo: DEFAULT_TEMPO,
  timeNumerator: 4,
  timeDenominator: 4,
  grid: DEFAULT_GRID_RESOLUTION
};

const SETUP_INSTRUMENTS: Array<{ label: string; instrument: DrumInstrument }> = [
  { label: "HH", instrument: getInstrument("closed-hat") },
  { label: "SD", instrument: getInstrument("snare") },
  { label: "BD", instrument: getInstrument("kick") }
];

export function getDrumSetupValues(block?: DrumBlock): DrumSetupValues {
  if (!block) {
    return { ...DEFAULT_DRUM_SETUP_VALUES };
  }

  const [timeNumerator, rawDenominator] = parseTimeSignature(block.timeSignature);

  return {
    title: getSetupTitle(block),
    tempo: block.tempo,
    timeNumerator,
    timeDenominator: normalizeTimeDenominator(rawDenominator),
    grid: block.gridResolution
  };
}

export function isValidDrumSetupValues(values: DrumSetupValues): boolean {
  return (
    Number.isFinite(values.tempo) &&
    values.tempo >= 30 &&
    values.tempo <= 260 &&
    Number.isInteger(values.timeNumerator) &&
    values.timeNumerator >= 1 &&
    values.timeNumerator <= 32 &&
    isTimeDenominator(values.timeDenominator) &&
    (values.grid === 16 || values.grid === 32)
  );
}

export function getDrumSetupSlotCount(values: DrumSetupValues): number {
  return getSlotsPerBar(`${values.timeNumerator}/${values.timeDenominator}`, values.grid);
}

export function createInitialDrumBlock(values: DrumSetupValues, existing?: DrumBlock): DrumBlock {
  const normalized = normalizeSetupValues(values);
  const baseHeader = existing ? toHeader(existing) : defaultHeader();
  const slotCount = getDrumSetupSlotCount(normalized);
  const restPattern = "-".repeat(slotCount);
  const rows: DrumRowInput[] = SETUP_INSTRUMENTS.map(({ label, instrument }) => ({
    label,
    instrument,
    patterns: [restPattern]
  }));
  const metadata = [
    `Title: ${normalized.title}`,
    ...baseHeader.metadata.filter((line) => !isTitleMetadata(line))
  ];

  return finalizeDrumBlock(
    {
      ...baseHeader,
      tempo: normalized.tempo,
      timeSignature: `${normalized.timeNumerator}/${normalized.timeDenominator}`,
      gridResolution: normalized.grid,
      metadata
    },
    [rows]
  );
}

export function serializeInitialDrumBlock(values: DrumSetupValues, existing?: DrumBlock): string {
  return serializeDrumBlock(createInitialDrumBlock(values, existing), { mode: "authoring" });
}

export function wrapDrumsFence(body: string): string {
  return `\`\`\`drums\n${body.trim()}\n\`\`\``;
}

export function formatDrumsFenceInsertion(body: string, textBeforeSelection: string, textAfterSelection: string): string {
  const fence = wrapDrumsFence(body);
  const leading = textBeforeSelection.length > 0 ? "\n" : "";
  const trailing = textAfterSelection.length > 0 ? "\n" : "";

  return `${leading}${fence}${trailing}`;
}

function normalizeSetupValues(values: DrumSetupValues): DrumSetupValues {
  const title = values.title.trim() || DEFAULT_DRUM_SETUP_VALUES.title;

  return {
    title,
    tempo: Math.min(260, Math.max(30, Math.round(values.tempo))),
    timeNumerator: Math.min(32, Math.max(1, Math.round(values.timeNumerator))),
    timeDenominator: normalizeTimeDenominator(values.timeDenominator),
    grid: values.grid === 32 ? 32 : 16
  };
}

function getSetupTitle(block: DrumBlock): string {
  const title = block.metadata.find((line) => isTitleMetadata(line));

  if (!title) {
    return DEFAULT_DRUM_SETUP_VALUES.title;
  }

  return title.slice(title.indexOf(":") + 1).trim() || DEFAULT_DRUM_SETUP_VALUES.title;
}

function parseTimeSignature(value: string): [number, number] {
  const match = /^(\d+)\/(\d+)$/.exec(value);

  if (!match) {
    return [DEFAULT_DRUM_SETUP_VALUES.timeNumerator, DEFAULT_DRUM_SETUP_VALUES.timeDenominator];
  }

  return [Number.parseInt(match[1], 10), Number.parseInt(match[2], 10)];
}

function isTimeDenominator(value: number): value is DrumSetupTimeDenominator {
  return value === 2 || value === 4 || value === 8 || value === 16 || value === 32;
}

function normalizeTimeDenominator(value: number): DrumSetupTimeDenominator {
  return isTimeDenominator(value) ? value : DEFAULT_DRUM_SETUP_VALUES.timeDenominator;
}

function isTitleMetadata(line: string): boolean {
  const divider = line.indexOf(":");

  return divider > 0 && normalizeLabel(line.slice(0, divider)) === "title";
}

function defaultHeader(): DrumBlockHeader {
  return {
    tempo: DEFAULT_TEMPO,
    timeSignature: DEFAULT_TIME_SIGNATURE,
    repeatCount: DEFAULT_REPEAT_COUNT,
    showCursor: DEFAULT_SHOW_CURSOR,
    showHighlight: DEFAULT_SHOW_HIGHLIGHT,
    legendMode: DEFAULT_LEGEND_MODE,
    gridResolution: DEFAULT_GRID_RESOLUTION,
    metadata: []
  };
}

function toHeader(block: DrumBlock): DrumBlockHeader {
  return {
    tempo: block.tempo,
    timeSignature: block.timeSignature,
    repeatCount: block.repeatCount,
    showCursor: block.showCursor,
    showHighlight: block.showHighlight,
    legendMode: block.legendMode,
    gridResolution: block.gridResolution,
    metadata: [...block.metadata]
  };
}

function getInstrument(id: string): DrumInstrument {
  const instrument = DRUM_KIT.find((candidate) => candidate.id === id);

  if (!instrument) {
    throw new Error(`Missing setup instrument: ${id}`);
  }

  return instrument;
}
