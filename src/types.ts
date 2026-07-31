export interface DrumBlockHeader {
  tempo: number;
  timeSignature: string;
  beamGrouping?: number[];
  repeatCount: number;
  showCursor: boolean;
  showHighlight: boolean;
  showRests: boolean;
  legendMode: LegendMode;
  gridResolution: GridResolution;
  metadata: string[];
}

export interface DrumBlock extends DrumBlockHeader {
  systems: DrumSystem[];
  bars: DrumBar[];
  rows: DrumRow[];
  slots: DrumSlot[];
  containsTupletSyntax: boolean;
}

export interface ParseResult {
  block: DrumBlock;
  warnings: ParseWarning[];
}

export interface ParseWarning {
  code: ParseWarningCode;
  message: string;
  line: number;
  column?: number;
}

export type ParseWarningCode =
  | "unknown-row-label"
  | "empty-row"
  | "repeat-without-previous-bar"
  | "invalid-setting"
  | "clamped-setting"
  | "row-length-mismatch"
  | "unsupported-pattern-character"
  | "unsupported-sticking-character"
  | "malformed-tuplet"
  | "tuplet-mismatch"
  | "unsupported-tuplet-span"
  | "removed-setting";

// The pre-structure form of a row: a label, the instrument it resolved to,
// and one pattern string per bar segment it spans. Both the parser (text ->
// model) and the editor/serializer (model -> text) build the model from this
// shape, so it is the single hand-off point between notation text and slots.
export interface DrumRowInput {
  label: string;
  patterns: string[];
  instrument: DrumInstrument;
}

export interface DrumStickingInput {
  label: string;
  patterns: string[];
}

export interface MeasureRepeatInput {
  type: MeasureRepeat;
  count: number;
}

export interface DrumSystem {
  bars: DrumBar[];
  subtitle?: string;
}

export interface DrumBar {
  rows: DrumRow[];
  slots: DrumSlot[];
  startSlot: number;
  startQuarter: number;
  durationQuarter: number;
  rhythmRegions: DrumRhythmRegion[];
  stickingPattern?: string;
  measureRepeat?: MeasureRepeat;
  measureRepeatCount?: number;
}

export interface DrumRhythmRegion {
  kind: "plain" | "tuplet";
  startPosition: number;
  positionCount: number;
  startQuarter: number;
  durationQuarter: number;
  spanWrittenBeats: number;
  subdivisionCount: number;
}

export interface DrumBarClipboardPayload {
  kind: "drum-notation-bar";
  version: 1;
  timeSignature: string;
  gridResolution: GridResolution;
  width: number;
  rows: DrumBarClipboardRow[];
  stickingPattern?: string;
}

export interface DrumBarClipboardRow {
  instrumentId: string;
  label: string;
  pattern: string;
}

export interface PlaybackOptions {
  startSlot?: number;
  endSlot?: number;
  initialSlot?: number;
  loop?: boolean;
  repeatCount?: number;
  speedPercent?: number;
  mutedInstrumentIds?: ReadonlySet<string>;
  metronomeMode?: MetronomeMode;
  countInMode?: CountInMode;
  onBarChange?: (barIndex: number) => void;
}

export interface DrumRow {
  label: string;
  pattern: string;
  instrument: DrumInstrument;
}

export interface DrumSlot {
  index: number;
  hits: DrumHit[];
  startQuarter: number;
  durationQuarter: number;
  regionIndex: number;
  sticking?: StickingHand;
}

export interface ScoreRenderResult {
  cursorPositions: Array<CursorPosition | undefined>;
  barRegions: ScoreBarRegion[];
}

export interface ScoreBarRegion {
  barIndex: number;
  barIndexes: number[];
  startSlot: number;
  endSlot: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CursorPosition {
  x: number;
  y: number;
  height: number;
}

export interface DrumHit {
  instrument: DrumInstrument;
  articulation: DrumArticulation;
  velocity: number;
}

export interface DrumInstrument {
  id: string;
  label: string;
  aliases: string[];
  vexKey: string;
  midi: number;
  color: string;
  playback: DrumPlaybackKind;
}

export type DrumPlaybackKind =
  | "kick"
  | "snare"
  | "tomHigh"
  | "tomMid"
  | "tomLow"
  | "hatClosed"
  | "hatHalfOpen"
  | "hatOpen"
  | "hatFoot"
  | "hatFootSplash"
  | "ride"
  | "rideBell"
  | "crash"
  | "splash"
  | "china"
  | "stack"
  | "cowbell"
  | "click";

export type DrumArticulation = "normal" | "accent" | "ghost" | "flam" | "drag" | "diddle" | "buzz" | "choke";
export type StickingHand = "right" | "left" | "both";
export type GridResolution = 16 | 32;
export type LegendMode = "off" | "used" | "all";
export type MetronomeMode = "off" | "with-drums" | "metronome-only";
export type CountInMode = "off" | "1-bar";
export type MeasureRepeat = 1;

export const DEFAULT_TEMPO = 100;
export const DEFAULT_TIME_SIGNATURE = "4/4";
export const DEFAULT_REPEAT_COUNT = 1;
export const MAX_MEASURE_REPEAT_COUNT = 99;
export const DEFAULT_SHOW_CURSOR = false;
export const DEFAULT_SHOW_HIGHLIGHT = true;
export const DEFAULT_SHOW_RESTS = true;
export const DEFAULT_LEGEND_MODE: LegendMode = "off";
export const DEFAULT_GRID_RESOLUTION: GridResolution = 16;
