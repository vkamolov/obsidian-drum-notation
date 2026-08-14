import { DRUM_KIT } from "./kit";
import { getSlotsPerBar, isValidBeamGrouping } from "./music";
import { finalizeDrumBlock } from "./parser";
import { serializeDrumBlock } from "./serializer";
import {
  DEFAULT_DRUM_AUTHORING_DEFAULTS,
  DrumAuthoringDefaults,
  DrumAuthoringHeaderKey
} from "./authoring-defaults";
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

export interface DrumSetupContext {
  existing?: DrumBlock;
  authoringDefaults?: DrumAuthoringDefaults;
  explicitHeaderKeys?: ReadonlySet<DrumAuthoringHeaderKey>;
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

export function getDrumSetupValues(context: DrumSetupContext = {}): DrumSetupValues {
  const defaults = context.authoringDefaults ?? DEFAULT_DRUM_AUTHORING_DEFAULTS;
  const defaultTime = parseTimeSignature(defaults.timeSignature);
  const block = context.existing;
  const explicitKeys = context.explicitHeaderKeys;

  if (!block) {
    return {
      title: defaults.title,
      tempo: defaults.tempo,
      timeNumerator: defaultTime[0],
      timeDenominator: normalizeTimeDenominator(defaultTime[1]),
      grid: defaults.gridResolution
    };
  }

  const [timeNumerator, rawDenominator] = parseTimeSignature(block.timeSignature);

  return {
    title: explicitKeys?.has("title") ? getSetupTitle(block) : defaults.title,
    tempo: explicitKeys?.has("tempo") ? block.tempo : defaults.tempo,
    timeNumerator: explicitKeys?.has("timeSignature") ? timeNumerator : defaultTime[0],
    timeDenominator: explicitKeys?.has("timeSignature")
      ? normalizeTimeDenominator(rawDenominator)
      : normalizeTimeDenominator(defaultTime[1]),
    grid: explicitKeys?.has("gridResolution") ? block.gridResolution : defaults.gridResolution
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

export function createInitialDrumBlock(values: DrumSetupValues, context: DrumSetupContext = {}): DrumBlock {
  const normalized = normalizeSetupValues(values);
  const baseHeader = getScaffoldHeader(context);
  const { beamGrouping, ...baseHeaderWithoutGrouping } = baseHeader;
  const timeSignature = `${normalized.timeNumerator}/${normalized.timeDenominator}`;
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
      ...baseHeaderWithoutGrouping,
      tempo: normalized.tempo,
      timeSignature,
      ...(beamGrouping && isValidBeamGrouping(timeSignature, beamGrouping)
        ? { beamGrouping }
        : {}),
      gridResolution: normalized.grid,
      metadata
    },
    [rows]
  );
}

export function serializeInitialDrumBlock(values: DrumSetupValues, context: DrumSetupContext = {}): string {
  return serializeDrumBlock(createInitialDrumBlock(values, context), { mode: "authoring" });
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
    showRests: DEFAULT_SHOW_RESTS,
    voicing: DEFAULT_VOICING,
    legendMode: DEFAULT_LEGEND_MODE,
    gridResolution: DEFAULT_GRID_RESOLUTION,
    metadata: []
  };
}

function getScaffoldHeader(context: DrumSetupContext): DrumBlockHeader {
  const defaults = context.authoringDefaults ?? DEFAULT_DRUM_AUTHORING_DEFAULTS;
  const existing = context.existing;
  const explicitKeys = context.explicitHeaderKeys;
  const header: DrumBlockHeader = {
    ...defaultHeader(),
    tempo: defaults.tempo,
    timeSignature: defaults.timeSignature,
    ...(defaults.beamGrouping ? { beamGrouping: [...defaults.beamGrouping] } : {}),
    repeatCount: defaults.repeatCount,
    showCursor: defaults.showCursor,
    showHighlight: defaults.showHighlight,
    showRests: defaults.showRests,
    voicing: defaults.voicing,
    legendMode: defaults.legendMode,
    gridResolution: defaults.gridResolution,
    metadata: existing ? [...existing.metadata] : []
  };

  if (!existing || !explicitKeys) {
    return header;
  }

  const existingHeader = toHeader(existing);
  if (explicitKeys.has("tempo")) header.tempo = existingHeader.tempo;
  if (explicitKeys.has("timeSignature")) header.timeSignature = existingHeader.timeSignature;
  if (explicitKeys.has("beamGrouping")) header.beamGrouping = existingHeader.beamGrouping;
  if (explicitKeys.has("repeatCount")) header.repeatCount = existingHeader.repeatCount;
  if (explicitKeys.has("showCursor")) header.showCursor = existingHeader.showCursor;
  if (explicitKeys.has("showHighlight")) header.showHighlight = existingHeader.showHighlight;
  if (explicitKeys.has("showRests")) header.showRests = existingHeader.showRests;
  if (explicitKeys.has("voicing")) header.voicing = existingHeader.voicing;
  if (explicitKeys.has("legendMode")) header.legendMode = existingHeader.legendMode;
  if (explicitKeys.has("gridResolution")) header.gridResolution = existingHeader.gridResolution;

  return header;
}

function toHeader(block: DrumBlock): DrumBlockHeader {
  return {
    tempo: block.tempo,
    timeSignature: block.timeSignature,
    ...(block.beamGrouping ? { beamGrouping: [...block.beamGrouping] } : {}),
    repeatCount: block.repeatCount,
    showCursor: block.showCursor,
    showHighlight: block.showHighlight,
    showRests: block.showRests,
    voicing: block.voicing,
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
