export interface DrumBlockHeader {
  tempo: number;
  timeSignature: string;
  beamGrouping?: number[];
  voicing: DrumVoicingMode;
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
  sectionRepeats: DrumSectionRepeat[];
}

export interface DrumSectionRepeat {
  startBarIndex: number;
  endBarIndex: number;
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
  | "unsupported-tuplet-duration"
  | "unsupported-tuplet-span"
  | "late-system-setting"
  | "repeat-meter-mismatch"
  | "invalid-section-repeat"
  | "section-repeat-mismatch"
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

export interface DrumSystemSettings {
  timeSignature: string;
  beamGrouping?: number[];
}

export interface MeasureRepeatInput {
  type: MeasureRepeat;
  count: number;
}

export interface DrumSystem {
  timeSignature: string;
  beamGrouping?: number[];
  bars: DrumBar[];
  subtitle?: string;
}

export interface DrumBar {
  timeSignature: string;
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
  tupletSpan?: DrumTupletSpan;
}

export type DrumTupletSpan =
  | { kind: "written-beats"; beats: number }
  | { kind: "note-value"; denominator: 2 | 4 | 8 | 16 | 32 };

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
  initialPosition?: DrumPlaybackPosition;
  loop?: boolean;
  repeatCount?: number;
  speedPercent?: number;
  mutedInstrumentIds?: ReadonlySet<string>;
  metronomeMode?: MetronomeMode;
  countInMode?: CountInMode;
  clickSubdivision?: ClickSubdivision;
  gapClickMode?: GapClickMode;
  tempoRamp?: TempoRampPlaybackState;
  selectedBarIndexes?: readonly number[];
  onBarChange?: (barIndex: number, state: PlaybackBarState) => void;
  onTempoRampPassStart?: (state: TempoRampPassState) => void;
  onTempoRampPassComplete?: (state: TempoRampPassState) => void;
}

export interface PracticeSelection {
  barIndexes: number[];
}

export type DrumTransportMode =
  | "idle"
  | "play-all"
  | "play-selection"
  | "loop-bar"
  | "loop-all"
  | "loop-selection";

export interface DrumPlaybackPosition {
  slotIndex: number;
  roadmapEntryIndex: number;
  blockPassIndex: number;
  barOccurrenceIndex?: number;
}

export interface PlaybackBarState {
  barOccurrenceIndex: number;
  isGapBar: boolean;
  nextBarIndex: number | null;
  isNextGapBar: boolean;
}

export type TempoRampTarget =
  | { kind: "current-bar"; barIndex: number }
  | { kind: "selected-bars"; barIndexes: number[] }
  | { kind: "whole-notation" };

export type TempoRampEndBehavior = "hold" | "stop";

export interface TempoRampConfig {
  target: TempoRampTarget;
  startBpm: number;
  stepBpm: number;
  passesPerStep: number;
  ceilingBpm: number;
  endBehavior: TempoRampEndBehavior;
}

export interface TempoRampProgress {
  completedPasses: number;
  completed: boolean;
}

export interface TempoRampPlaybackState {
  config: TempoRampConfig;
  progress: TempoRampProgress;
}

export interface TempoRampPassState extends TempoRampProgress {
  tempoBpm: number;
  nextTempoBpm: number;
  passInStep: number;
  passesPerStep: number;
  atCeiling: boolean;
  clickSubdivision: ClickSubdivision;
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
  notationVoice: DrumNotationVoice;
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
export type DrumVoicingMode = "single" | "split";
export type DrumNotationVoice = "upper" | "lower";
export type MetronomeMode = "off" | "with-drums" | "metronome-only";
export type CountInMode = "off" | "1-bar" | "2-bars";
export type ClickSubdivision = "beat" | "2-per-beat" | "3-per-beat" | "4-per-beat";
export type GapClickMode = "off" | "1-on-1-off" | "2-on-2-off" | "4-on-4-off";
export type MetronomePulseKind = "downbeat" | "beat" | "subdivision";
export type MeasureRepeat = 1;

export const DEFAULT_TEMPO = 100;
export const DEFAULT_TIME_SIGNATURE = "4/4";
export const DEFAULT_VOICING: DrumVoicingMode = "single";
export const DEFAULT_REPEAT_COUNT = 1;
export const MAX_MEASURE_REPEAT_COUNT = 99;
export const DEFAULT_SHOW_CURSOR = false;
export const DEFAULT_SHOW_HIGHLIGHT = true;
export const DEFAULT_SHOW_RESTS = true;
export const DEFAULT_LEGEND_MODE: LegendMode = "off";
export const DEFAULT_GRID_RESOLUTION: GridResolution = 16;
