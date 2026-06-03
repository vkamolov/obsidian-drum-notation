export interface DrumBlock {
  tempo: number;
  timeSignature: string;
  repeatCount: number;
  showCursor: boolean;
  showHighlight: boolean;
  legendMode: LegendMode;
  gridResolution: GridResolution;
  metadata: string[];
  systems: DrumSystem[];
  bars: DrumBar[];
  rows: DrumRow[];
  slots: DrumSlot[];
}

export interface DrumSystem {
  bars: DrumBar[];
}

export interface DrumBar {
  rows: DrumRow[];
  slots: DrumSlot[];
  startSlot: number;
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
  | "hatOpen"
  | "hatFoot"
  | "ride"
  | "crash"
  | "splash"
  | "china"
  | "stack"
  | "cowbell"
  | "click";

export type DrumArticulation = "normal" | "accent" | "ghost" | "flam" | "diddle" | "buzz";
export type GridResolution = 16 | 32;
export type LegendMode = "off" | "used" | "all";

export const DEFAULT_TEMPO = 100;
export const DEFAULT_TIME_SIGNATURE = "4/4";
export const DEFAULT_REPEAT_COUNT = 1;
export const DEFAULT_SHOW_CURSOR = true;
export const DEFAULT_SHOW_HIGHLIGHT = true;
export const DEFAULT_LEGEND_MODE: LegendMode = "off";
export const DEFAULT_GRID_RESOLUTION: GridResolution = 16;
