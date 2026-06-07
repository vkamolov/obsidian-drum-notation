export interface DrumBlockHeader {
  tempo: number;
  timeSignature: string;
  repeatCount: number;
  showCursor: boolean;
  showHighlight: boolean;
  legendMode: LegendMode;
  gridResolution: GridResolution;
  metadata: string[];
}

export interface DrumBlock extends DrumBlockHeader {
  systems: DrumSystem[];
  bars: DrumBar[];
  rows: DrumRow[];
  slots: DrumSlot[];
}

// The pre-structure form of a row: a label, the instrument it resolved to,
// and one pattern string per bar segment it spans. Both the parser (text ->
// model) and the editor/serializer (model -> text) build the model from this
// shape, so it is the single hand-off point between notation text and slots.
export interface DrumRowInput {
  label: string;
  patterns: string[];
  instrument: DrumInstrument;
}

export interface DrumSystem {
  bars: DrumBar[];
}

export interface DrumBar {
  rows: DrumRow[];
  slots: DrumSlot[];
  startSlot: number;
  measureRepeat?: MeasureRepeat;
  measureRepeatCount?: number;
}

export interface PlaybackOptions {
  startSlot?: number;
  endSlot?: number;
  loop?: boolean;
  repeatCount?: number;
}

export interface DrumRow {
  label: string;
  pattern: string;
  instrument: DrumInstrument;
}

export interface DrumSlot {
  index: number;
  hits: DrumHit[];
}

export interface ScoreRenderResult {
  cursorPositions: Array<CursorPosition | undefined>;
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
  | "crash"
  | "splash"
  | "china"
  | "stack"
  | "cowbell"
  | "click";

export type DrumArticulation = "normal" | "accent" | "ghost" | "flam" | "drag" | "diddle" | "buzz" | "choke";
export type GridResolution = 16 | 32;
export type LegendMode = "off" | "used" | "all";
export type MeasureRepeat = 1;

export const DEFAULT_TEMPO = 100;
export const DEFAULT_TIME_SIGNATURE = "4/4";
export const DEFAULT_REPEAT_COUNT = 1;
export const DEFAULT_SHOW_CURSOR = false;
export const DEFAULT_SHOW_HIGHLIGHT = true;
export const DEFAULT_LEGEND_MODE: LegendMode = "off";
export const DEFAULT_GRID_RESOLUTION: GridResolution = 16;
