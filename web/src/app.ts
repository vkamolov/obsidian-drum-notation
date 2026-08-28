// Obsidian DOM shim must load before anything that touches the renderer.
import "./obsidian-dom";
// The plugin's own notation styles, plus the playground chrome.
import "../../styles.css";
import "./playground.css";

import {
  clearLegendInstrumentHighlight,
  colorRenderedNoteheads,
  getLegendHighlightDurationMs,
  makeRenderedNotesInteractive,
  type RenderedNoteElements,
  renderInstrumentLegend,
  renderVexflowScore,
  setLegendInstrumentHighlight,
  updateMeasureRepeatProgress
} from "../../src/engrave";
import { DrumBarClipboardStore } from "../../src/bar-clipboard";
import {
  getBarRange,
  getSecondsPerSlot,
  getSlotVisualDurationSeconds,
  getTimeSignatureSequence,
  hasSystemRhythmOverrides
} from "../../src/music";
import { getTitle, parseDrumBlock, parseDrumBlockWithWarnings } from "../../src/parser";
import {
  CLICK_SUBDIVISION_OPTIONS,
  COUNT_IN_MODE_OPTIONS,
  DEFAULT_CLICK_SUBDIVISION,
  DEFAULT_COUNT_IN_MODE,
  DEFAULT_GAP_CLICK_MODE,
  DEFAULT_METRONOME_MODE,
  DEFAULT_PLAYBACK_SPEED_PERCENT,
  DrumPlaybackBackend,
  GAP_CLICK_MODE_OPTIONS,
  getClickSubdivisionFactor,
  getClickSubdivisionLabel,
  getClickSubdivisionMenuLabel,
  getCountInModeLabel,
  getEffectivePlaybackTempo,
  getGapClickModeLabel,
  getMetronomeModeLabel,
  getPlaybackInstruments,
  getSafeClickSubdivision,
  getSafeClickSubdivisionAtTempo,
  isClickSubdivisionSafe,
  isClickSubdivisionSafeAtTempo,
  MAX_PLAYBACK_SPEED_PERCENT,
  METRONOME_MODE_OPTIONS,
  MIN_PLAYBACK_SPEED_PERCENT,
  normalizePlaybackSpeedPercent,
  PLAYBACK_SPEED_UI_STEP_PERCENT,
  recoverAudioContext
} from "../../src/playback";
import { DrumPlayer } from "../../src/player";
import {
  hasCompatiblePracticeStructure,
  isPracticeRegionSelected,
  normalizePracticeSelection,
  togglePracticeRegion
} from "../../src/practice";
import {
  DEFAULT_COUNT_IN_CADENCE,
  MAX_REPETITION_GOAL_PASSES,
  MIN_REPETITION_GOAL_PASSES,
  createDefaultRepetitionGoalConfig,
  createPracticeClock,
  createPracticeRunMetrics,
  createPracticeRunSummary,
  createTapTempoState,
  formatActiveSessionTime,
  formatPracticeSummaryMarkdown,
  formatPracticeTarget,
  normalizeExactTempoBpm,
  normalizeRepetitionGoalConfig,
  normalizeRepetitionGoalProgress,
  recordPracticePass,
  recordTapTempo,
  resumePracticeRunMetrics,
  settlePracticeRunMetrics
} from "../../src/practice-session";
import { getMeasureRepeatProgress } from "../../src/repeat-progress";
import {
  createScreenWakeLockTarget,
  isScreenWakeLockSupported,
  ScreenWakeLockController
} from "../../src/screen-wake-lock";
import { serializeDrumBlock } from "../../src/serializer";
import { validateDrumNotation } from "../../src/validation";
import { setGrid, setRepeatCount, setTempo, setTimeSignature } from "../../src/edit";
import { createSynthPlaybackBackend } from "../../src/synth";
import {
  cloneTempoRampConfig,
  createDefaultTempoRampConfig,
  getTempoRampPassInStep,
  getTempoRampPreview,
  getTempoRampTempoBpm,
  isValidTempoRampConfigValues,
  MAX_TEMPO_RAMP_BPM,
  MAX_TEMPO_RAMP_PASSES,
  MAX_TEMPO_RAMP_STEP_BPM,
  MIN_TEMPO_RAMP_BPM,
  MIN_TEMPO_RAMP_PASSES,
  MIN_TEMPO_RAMP_STEP_BPM,
  normalizeTempoRampConfig,
  normalizeTempoRampConfigValues,
  normalizeTempoRampProgress,
  type TempoRampSessionState
} from "../../src/tempo-ramp";
import {
  ClickSubdivision,
  CountInCadence,
  CursorPosition,
  CountInMode,
  DrumBlock,
  DrumPlaybackPosition,
  DrumSlot,
  DrumTransportMode,
  GapClickMode,
  GridResolution,
  LegendMode,
  MAX_MEASURE_REPEAT_COUNT,
  MetronomeMode,
  ParseWarning,
  PlaybackBarState,
  PlaybackPassState,
  PracticeRunMetrics,
  PracticeRunSummary,
  PracticeTarget,
  PracticeSelection,
  RepetitionGoalConfig,
  RepetitionGoalProgress,
  ScoreBarRegion,
  TempoRampConfig,
  TempoRampPassState,
  TempoRampTarget
} from "../../src/types";
import { normalizeLabel } from "../../src/util";
import {
  DEFAULT_PLAYGROUND_EXAMPLE_ID,
  getPlaygroundExample,
  PLAYGROUND_EXAMPLE_CATEGORIES,
  PLAYGROUND_EXAMPLES
} from "./examples";
import {
  GridEditorHandle,
  mountGridEditor,
  RepeatBarDialogRequest,
  RepeatBarDialogResult
} from "../../src/editor-grid";
import { createIconSvg } from "./icons";
import {
  compareReportCore,
  detectRasterImageKind,
  DrumImportReport,
  ExtractedAgentResponse,
  ExtractedImportSegment,
  extractAgentResponse,
  HumanReviewState,
  isAllowedRasterDimensions,
  ImportReportMessage,
  ImportReportSegment,
  ImportReportState,
  ImportReportWorkaround,
  MAX_SOURCE_IMAGE_BYTES,
  MAX_SOURCE_IMAGE_PIXELS,
  MAX_SOURCE_IMAGE_SIDE
} from "./importer";
import {
  CropPoint,
  CropRect,
  getClampedDisplaySelection,
  getFocusedCropOutputSize,
  mapDisplaySelectionToSource
} from "./image-crop";

const STORAGE_KEY = "drum-playground.notation";
const THEME_KEY = "drum-playground.theme";
const TIP_KEY = "drum-playground.dismissedFirstRunTip";
const AUDIO_RECOVERY_WARNING =
  "Audio was interrupted by the mobile system. Try Play again, or relaunch Obsidian if playback stays silent.";
const SCREEN_WAKE_LOCK_WARNING =
  "Could not keep the screen awake. Playback will continue normally.";
const VERIFY_PANEL_MAX_VIEWPORT_RATIO = 0.42;
const VERIFY_PANEL_KEYBOARD_STEP_PX = 32;
const activeDocument: Document = window.document;
const STORAGE_GLOBAL_KEY = "local" + "Storage";

interface PlaygroundStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/* ---------- element handles ---------- */
const $ = <T extends HTMLElement>(id: string): T => {
  const el = activeDocument.getElementById(id);
  if (!el) {
    throw new Error(`missing #${id}`);
  }
  return el as T;
};

const editor = $<HTMLTextAreaElement>("pg-editor");
const preview = $<HTMLDivElement>("pg-preview");
const exampleSelect = $<HTMLSelectElement>("pg-example");
const titleInput = $<HTMLInputElement>("pg-title");
const tempoInput = $<HTMLInputElement>("pg-tempo");
const timeTopInput = $<HTMLInputElement>("pg-time-top");
const timeBottomInput = $<HTMLInputElement>("pg-time-bottom");
const gridSelect = $<HTMLSelectElement>("pg-grid");
const repeatInput = $<HTMLInputElement>("pg-repeat");
const legendSelect = $<HTMLSelectElement>("pg-legend");
const playBtn = $<HTMLButtonElement>("pg-play");
const stopBtn = $<HTMLButtonElement>("pg-stop");
const loopBtn = $<HTMLButtonElement>("pg-loop");
const loopAllBtn = $<HTMLButtonElement>("pg-loop-all");
const loopMenu = $<HTMLDivElement>("pg-loop-menu");
const speedBtn = $<HTMLButtonElement>("pg-speed");
const speedMenu = $<HTMLDivElement>("pg-speed-menu");
const metronomeBtn = $<HTMLButtonElement>("pg-metronome");
const metronomeMenu = $<HTMLDivElement>("pg-metronome-menu");
const muteBtn = $<HTMLButtonElement>("pg-mute");
const muteMenu = $<HTMLDivElement>("pg-mute-menu");
const editBtn = $<HTMLButtonElement>("pg-edit");
const editRoot = $<HTMLDivElement>("pg-edit-root");
const copyBlockBtn = $<HTMLButtonElement>("pg-copy-block");
const copyNormalizedBtn = $<HTMLButtonElement>("pg-copy-normalized");
const themeBtn = $<HTMLButtonElement>("pg-theme");
const modelOut = $<HTMLDivElement>("pg-model");
const normalizedOut = $<HTMLPreElement>("pg-normalized");
const normalizedFlag = $<HTMLSpanElement>("pg-normalized-flag");
const notesOut = $<HTMLDivElement>("pg-notes");
const playgroundModeBtn = $<HTMLButtonElement>("pg-mode-playground");
const verifyModeBtn = $<HTMLButtonElement>("pg-mode-verify");
const verifyPanel = $<HTMLElement>("pg-verify-panel");
const verifyDivider = $<HTMLDivElement>("pg-verify-divider");
const verifyResizer = $<HTMLDivElement>("pg-verify-resizer");
const toggleVerifyWorkspaceBtn = $<HTMLButtonElement>("pg-toggle-verify-workspace");
const importPrompt = $<HTMLPreElement>("pg-import-prompt");
const copyPromptBtn = $<HTMLButtonElement>("pg-copy-prompt");
const sourceFileInput = $<HTMLInputElement>("pg-source-file");
const agentResponseInput = $<HTMLTextAreaElement>("pg-agent-response");
const extractResponseBtn = $<HTMLButtonElement>("pg-extract-response");
const clearVerificationBtn = $<HTMLButtonElement>("pg-clear-verification");
const verificationUndoBtn = $<HTMLButtonElement>("pg-verify-undo");
const saveVerifiedBtn = $<HTMLButtonElement>("pg-save-verified");
const verificationMessage = $<HTMLParagraphElement>("pg-verify-message");
const unfencedRecovery = $<HTMLDivElement>("pg-unfenced-recovery");
const acceptUnfencedBtn = $<HTMLButtonElement>("pg-accept-unfenced");
const segmentTabs = $<HTMLDivElement>("pg-segment-tabs");
const signalParser = $<HTMLElement>("pg-signal-parser");
const signalReport = $<HTMLElement>("pg-signal-report");
const signalAgent = $<HTMLElement>("pg-signal-agent");
const humanReviewSelect = $<HTMLSelectElement>("pg-human-review");
const signalCore = $<HTMLElement>("pg-signal-core");
const reportDetails = $<HTMLElement>("pg-report-details");
const reportOrigin = $<HTMLSpanElement>("pg-report-origin");
const reportDetailsCount = $<HTMLSpanElement>("pg-report-details-count");
const reportDetailsContent = $<HTMLDivElement>("pg-report-details-content");
const sourcePane = $<HTMLElement>("pg-source-pane");
const sourceEmpty = $<HTMLParagraphElement>("pg-source-empty");
const sourceImage = $<HTMLImageElement>("pg-source-image");
const openCropBtn = $<HTMLButtonElement>("pg-open-crop");
const cropDialog = $<HTMLDialogElement>("pg-crop-dialog");
const closeCropBtn = $<HTMLButtonElement>("pg-close-crop");
const cropStage = $<HTMLDivElement>("pg-crop-stage");
const cropSource = $<HTMLImageElement>("pg-crop-source");
const cropSelection = $<HTMLDivElement>("pg-crop-selection");
const cropStatus = $<HTMLParagraphElement>("pg-crop-status");
const generateCropBtn = $<HTMLButtonElement>("pg-generate-crop");
const cropResult = $<HTMLElement>("pg-crop-result");
const cropPreview = $<HTMLImageElement>("pg-crop-preview");
const cropRetryPrompt = $<HTMLPreElement>("pg-crop-retry-prompt");
const copyCropBtn = $<HTMLButtonElement>("pg-copy-crop");
const downloadCropBtn = $<HTMLButtonElement>("pg-download-crop");
const copyCropPromptBtn = $<HTMLButtonElement>("pg-copy-crop-prompt");

/* ---------- render state ---------- */
let currentBlock: DrumBlock | null = null;
let currentParseWarnings: ParseWarning[] = [];
let scoreEl: HTMLElement | null = null;
let cursorEl: HTMLElement | null = null;
let cursorPositions: Array<CursorPosition | undefined> = [];
let barRegions: ScoreBarRegion[] = [];
let noteElements: RenderedNoteElements = [];
let highlightedNotes: SVGGElement[] = [];
let editHighlightedNotes: SVGGElement[] = [];
let editSelectedSlotIndex: number | null = null;
let selectedBarIndex = 0;
let currentSlotIndex = 0;
let lastRenderError: string | null = null;
let transportMode: DrumTransportMode = "idle";
let playbackSpeedPercent = DEFAULT_PLAYBACK_SPEED_PERCENT;
let metronomeMode: MetronomeMode = DEFAULT_METRONOME_MODE;
let countInMode: CountInMode = DEFAULT_COUNT_IN_MODE;
let countInCadence: CountInCadence = DEFAULT_COUNT_IN_CADENCE;
let exactTempoBpm: number | null = null;
let clickSubdivision: ClickSubdivision = DEFAULT_CLICK_SUBDIVISION;
let gapClickMode: GapClickMode = DEFAULT_GAP_CLICK_MODE;
let tempoRamp: TempoRampSessionState = {
  config: null,
  progress: { completedPasses: 0, completed: false },
  armed: false
};
let activeTempoRampPass: TempoRampPassState | null = null;
let tempoRampRunMetrics: PracticeRunMetrics | null = null;
let repetitionGoal: {
  config: RepetitionGoalConfig | null;
  progress: RepetitionGoalProgress;
  armed: boolean;
  runMetrics: PracticeRunMetrics | null;
} = {
  config: null,
  progress: { completedPasses: 0, completed: false },
  armed: false,
  runMetrics: null
};
let completedSummary: PracticeRunSummary | null = null;
let completedSummaryHandled = false;
const practiceClock = createPracticeClock();
let activePlaybackBarIndex: number | null = null;
let activePlaybackBarState: PlaybackBarState | null = null;
let keepScreenAwakeDuringPlayback = true;
const mutedInstrumentIds = new Set<string>();
let practiceSelection: PracticeSelection = { barIndexes: [] };
let selectionModeOpen = false;
let gridEditor: GridEditorHandle | null = null;
let isApplyingGridEdit = false;
let audioRecoveryWarning: string | null = null;
let screenWakeLockWarning: string | null = null;
let advancedClickWarning: string | null = null;
let gridEditorMessage: string | null = null;
const barClipboard = new DrumBarClipboardStore();
const screenWakeLock = new ScreenWakeLockController(() => {
  screenWakeLockWarning = SCREEN_WAKE_LOCK_WARNING;
  console.warn(SCREEN_WAKE_LOCK_WARNING);
  if (currentBlock) {
    renderNotes(currentBlock, editor.value);
  }
});

interface VerificationSegmentState {
  source: string;
  edited: string;
  reportBaseline: string;
  humanReview: HumanReviewState;
}

let verificationActive = false;
let playgroundDraftSnapshot = "";
let verificationSegments: VerificationSegmentState[] = [];
let selectedVerificationSegment = -1;
let verificationReport: DrumImportReport | null = null;
let verificationReportState: ImportReportState = "missing";
let verificationResponseErrors: string[] = [];
let verificationUndoStack: string[] = [];
let pendingUnfencedResponse: string | null = null;
let sourceObjectUrl: string | null = null;
let focusedCropObjectUrl: string | null = null;
let focusedCropBlob: Blob | null = null;
let focusedCropSourceRect: CropRect | null = null;
let cropDragStart: CropPoint | null = null;
let cropDragPointerId: number | null = null;
let verifyResizePointerId: number | null = null;
let verifyResizePointerOffset = 0;
let verificationPanelRequestedHeight: number | null = null;

barClipboard.subscribe(() => {
  gridEditorMessage = null;
  if (currentBlock) {
    renderNotes(currentBlock, editor.value);
  }
});

/* ---------- audio (lazy, created on first user gesture) ---------- */
let audioContext: AudioContext | null = null;
let player: DrumPlayer | null = null;
let previewSynth: DrumPlaybackBackend | null = null;
let previewTimer: number | null = null;
let legendPlaybackTimer: number | null = null;
let legendPreviewTimer: number | null = null;

function isPlaygroundStorage(value: unknown): value is PlaygroundStorage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const getItem: unknown = Reflect.get(value, "getItem");
  const setItem: unknown = Reflect.get(value, "setItem");

  return typeof getItem === "function" && typeof setItem === "function";
}

function getPlaygroundStorage(): PlaygroundStorage | null {
  const storage: unknown = Reflect.get(window, STORAGE_GLOBAL_KEY);

  return isPlaygroundStorage(storage) ? storage : null;
}

function loadPlaygroundValue(key: string): string | null {
  try {
    return getPlaygroundStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function savePlaygroundValue(key: string, value: string): void {
  try {
    getPlaygroundStorage()?.setItem(key, value);
  } catch {
    // Ignore quota/private-mode storage failures; playground state is optional.
  }
}

function getAudioContext(): AudioContext {
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContext();
  }
  void audioContext.resume();
  return audioContext;
}

async function recoverPlaybackAudio(): Promise<boolean> {
  const recovered = await recoverAudioContext({
    get: () => audioContext,
    set: (context) => {
      audioContext = context;
    },
    create: () => new AudioContext()
  });

  if (recovered) {
    clearAudioRecoveryWarning();
    return true;
  }

  showAudioRecoveryWarning();
  return false;
}

function showAudioRecoveryWarning(): void {
  audioRecoveryWarning = AUDIO_RECOVERY_WARNING;
  console.warn(AUDIO_RECOVERY_WARNING);
  if (currentBlock) {
    renderNotes(currentBlock, editor.value);
  }
}

function clearAudioRecoveryWarning(): void {
  if (!audioRecoveryWarning) {
    return;
  }

  audioRecoveryWarning = null;
  if (currentBlock) {
    renderNotes(currentBlock, editor.value);
  }
}

function createPlaybackBackend(audioContext: AudioContext): DrumPlaybackBackend {
  return createSynthPlaybackBackend(audioContext);
}

/* ---------- rendering ---------- */
function renderPreview(): void {
  const scrollSnapshot = capturePreviewScroll();
  const parsed = parseDrumBlockWithWarnings(editor.value);
  const block = parsed.block;
  if (tempoRamp.config) {
    const validConfig = normalizeTempoRampConfig(tempoRamp.config, block);
    if (validConfig) {
      tempoRamp = {
        ...tempoRamp,
        config: validConfig,
        progress: normalizeTempoRampProgress(validConfig, tempoRamp.progress)
      };
    } else {
      tempoRamp = {
        config: normalizeTempoRampConfigValues(tempoRamp.config),
        progress: { completedPasses: 0, completed: false },
        armed: false
      };
      activeTempoRampPass = null;
    }
  }
  if (repetitionGoal.config) {
    const validGoal = normalizeRepetitionGoalConfig(repetitionGoal.config, block.bars.length);
    repetitionGoal = validGoal
      ? {
          ...repetitionGoal,
          config: validGoal,
          progress: normalizeRepetitionGoalProgress(validGoal, repetitionGoal.progress)
        }
      : {
          config: null,
          progress: { completedPasses: 0, completed: false },
          armed: false,
          runMetrics: null
        };
  }
  if (currentBlock && !hasCompatiblePracticeStructure(currentBlock, block)) {
    if (practiceSelection.barIndexes.length > 0) {
      stopPlayback();
    }
    practiceSelection = { barIndexes: [] };
    selectionModeOpen = false;
  } else {
    practiceSelection = normalizePracticeSelection(practiceSelection, block.bars.length);
  }
  currentBlock = block;
  currentParseWarnings = parsed.warnings;
  lastRenderError = null;
  audioRecoveryWarning = null;
  selectedBarIndex = clampBarIndex(block, selectedBarIndex);

  clearEditHighlight();
  preview.empty();
  preview.classList.toggle("drum-notation--legend-color", block.legendMode !== "off");

  renderFirstRunTip();

  const viewport = preview.createDiv({ cls: "drum-notation__score-viewport" });
  const score = viewport.createDiv({ cls: "drum-notation__score" });
  scoreEl = score;
  score.addEventListener("click", selectRenderedBarAtPoint);

  const hasRows = block.rows.length > 0;
  const playbackInstrumentIds = new Set(getPlaybackInstruments(block).map((instrument) => instrument.id));
  for (const instrumentId of mutedInstrumentIds) {
    if (!playbackInstrumentIds.has(instrumentId)) {
      mutedInstrumentIds.delete(instrumentId);
    }
  }
  playBtn.disabled = !hasRows;
  stopBtn.disabled = !hasRows;
  loopBtn.disabled = !hasRows;
  loopAllBtn.disabled = !hasRows;
  const selectedCount = practiceSelection.barIndexes.length;
  const playDescription = repetitionGoal.armed && repetitionGoal.config
    ? `Resume practice goal · ${formatPracticeTarget(repetitionGoal.config.target)}`
    : tempoRamp.armed && tempoRamp.config
    ? `Play tempo ramp · ${formatTempoRampTarget(tempoRamp.config.target)}`
    : selectedCount > 0
      ? `Play selected bars (${selectedCount})`
      : "Play whole notation";
  playBtn.title = playDescription;
  playBtn.setAttribute("aria-label", playDescription);
  const loopDescription = selectedCount > 0
    ? `Loop options · ${selectedCount} selected`
    : "Loop options";
  loopAllBtn.title = loopDescription;
  loopAllBtn.setAttribute("aria-label", loopDescription);
  speedBtn.disabled = !hasRows;
  metronomeBtn.disabled = block.slots.length === 0;
  muteBtn.disabled = !hasRows;
  const hasSystemOverrides = hasSystemRhythmOverrides(block);
  editBtn.disabled = !hasRows || block.containsTupletSyntax || hasSystemOverrides;
  const editDescription = block.containsTupletSyntax
    ? "Visual editing is not available for notation with tuplets. Edit the notation text directly."
    : hasSystemOverrides
      ? "Visual editing is not yet available for notation with system-level Time or Grouping changes. Edit the notation text directly."
      : "Edit notation visually";
  editBtn.title = editDescription;
  editBtn.setAttribute("aria-label", editDescription);
  syncPlaybackControls(block);

  if (!hasRows) {
    cursorPositions = [];
    barRegions = [];
    noteElements = [];
    cursorEl = null;
    score.createDiv({
      cls: "drum-notation__empty",
      text: "No supported drum rows yet. Add rows like HH, SD, BD."
    });
  } else {
    drawScore(block, score);
  }

  syncControls(block);
  updateDiagnostics(block, editor.value);
  if (verificationActive) {
    renderVerificationSignals();
  }
  if (gridEditor && (block.containsTupletSyntax || hasSystemOverrides)) {
    exitEditMode();
    gridEditorMessage = editDescription;
  }
  if (gridEditor && !isApplyingGridEdit) {
    gridEditor.syncBlock(block, selectedBarIndex);
  }
  applyEditHighlight();
  restorePreviewScroll(scrollSnapshot);
}

function getAdvancedClickStatus(): string | null {
  if (
    transportMode === "idle" ||
    metronomeMode === "off" ||
    (clickSubdivision === "beat" && gapClickMode === "off")
  ) {
    return null;
  }

  const details: string[] = ["Advanced click"];
  if (clickSubdivision !== "beat") {
    details.push(getClickSubdivisionLabel(clickSubdivision));
  }
  if (gapClickMode !== "off" && activePlaybackBarState) {
    details.push(activePlaybackBarState.isGapBar
      ? "Gap bar"
      : activePlaybackBarState.isNextGapBar
        ? "Gap next"
        : "Click bar");
  }
  return details.join(" · ");
}

function formatTempoRampTarget(target: TempoRampTarget): string {
  if (target.kind === "current-bar") return `Bar ${target.barIndex + 1}`;
  if (target.kind === "selected-bars") return `Selected bars (${target.barIndexes.length})`;
  return "Whole notation";
}

function startOrResumeTrackedRun(kind: PracticeRunSummary["kind"]): void {
  if (!currentBlock) return;
  const bpm = getCurrentEffectiveTempo(currentBlock);
  if (kind === "tempo-ramp") {
    tempoRampRunMetrics = tempoRampRunMetrics
      ? resumePracticeRunMetrics(tempoRampRunMetrics, bpm, practiceClock)
      : createPracticeRunMetrics(bpm, practiceClock);
  } else {
    repetitionGoal = {
      ...repetitionGoal,
      runMetrics: repetitionGoal.runMetrics
        ? resumePracticeRunMetrics(repetitionGoal.runMetrics, bpm, practiceClock)
        : createPracticeRunMetrics(bpm, practiceClock)
    };
  }
}

function settleTrackedRun(status: PracticeRunMetrics["status"] = "paused"): void {
  if (tempoRamp.armed && tempoRampRunMetrics?.status === "running") {
    tempoRampRunMetrics = settlePracticeRunMetrics(tempoRampRunMetrics, practiceClock, status);
  }
  if (repetitionGoal.armed && repetitionGoal.runMetrics?.status === "running") {
    repetitionGoal = {
      ...repetitionGoal,
      runMetrics: settlePracticeRunMetrics(repetitionGoal.runMetrics, practiceClock, status)
    };
  }
}

function finishTrackedSummary(
  kind: PracticeRunSummary["kind"],
  target: PracticeTarget,
  requestedPasses: number | null,
  completed: boolean
): void {
  const metrics = kind === "tempo-ramp" ? tempoRampRunMetrics : repetitionGoal.runMetrics;
  if (!metrics) return;
  completedSummary = createPracticeRunSummary(
    kind,
    target,
    metrics,
    requestedPasses,
    completed,
    practiceClock
  );
  completedSummaryHandled = false;
  if (kind === "tempo-ramp") {
    tempoRampRunMetrics = settlePracticeRunMetrics(metrics, practiceClock, "complete");
  } else {
    repetitionGoal = {
      ...repetitionGoal,
      armed: false,
      runMetrics: settlePracticeRunMetrics(metrics, practiceClock, "complete")
    };
  }
}

function getTempoRampStatus(): string | null {
  const config = tempoRamp.config;
  if (!config) return null;
  if (tempoRamp.progress.completed) return `Ramp complete · ${config.ceilingBpm} BPM`;
  if (!tempoRamp.armed && transportMode === "idle") return null;

  const completedPasses = activeTempoRampPass?.completedPasses ?? tempoRamp.progress.completedPasses;
  const tempoBpm = activeTempoRampPass?.tempoBpm ?? getTempoRampTempoBpm(config, completedPasses);
  const target = formatTempoRampTarget(config.target);
  const performed = tempoRampRunMetrics?.performedPasses ?? 0;
  const performedLabel = performed > 0 ? ` · ${performed} performed` : "";
  if (tempoBpm >= config.ceilingBpm) {
    return `Tempo ramp · ${target} · Ceiling · ${tempoBpm} BPM${performedLabel}`;
  }
  const passInStep = activeTempoRampPass?.passInStep ?? getTempoRampPassInStep(config, completedPasses);
  const nextTempo = getTempoRampTempoBpm(config, completedPasses + (config.passesPerStep - passInStep + 1));
  return `Tempo ramp · ${target} · ${tempoBpm} BPM · pass ${passInStep}/${config.passesPerStep} · next ${nextTempo} BPM${performedLabel}`;
}

function getRepetitionGoalStatus(): string | null {
  const config = repetitionGoal.config;
  if (!config || !currentBlock) return null;
  if (repetitionGoal.progress.completed) {
    return `Practice complete · ${repetitionGoal.progress.completedPasses}/${config.totalPasses} · View summary`;
  }
  if (!repetitionGoal.armed && repetitionGoal.runMetrics?.status !== "paused") return null;
  const prefix = repetitionGoal.runMetrics?.status === "paused" ? "Practice paused" : "Practice goal";
  return `${prefix} · ${formatPracticeTarget(config.target)} · ${repetitionGoal.progress.completedPasses}/${config.totalPasses} · ${formatTempo(getCurrentEffectiveTempo(currentBlock))} BPM`;
}

function renderFirstRunTip(): void {
  const selectedCount = practiceSelection.barIndexes.length;
  const advancedClickStatus = getAdvancedClickStatus();
  const tempoRampStatus = getTempoRampStatus();
  const goalStatus = getRepetitionGoalStatus();
  const summaryStatus = completedSummary && !goalStatus
    ? `Practice ${completedSummary.completed ? "complete" : "finished"} · ${completedSummary.requestedPasses === null
      ? `${completedSummary.performedPasses} passes`
      : `${completedSummary.performedPasses}/${completedSummary.requestedPasses}`} · View summary`
    : null;
  const pausedRepetitionGoal = repetitionGoal.config !== null &&
    repetitionGoal.runMetrics?.status === "paused" &&
    !repetitionGoal.progress.completed;
  const pausedTempoRamp = tempoRamp.config !== null &&
    tempoRamp.armed &&
    tempoRampRunMetrics?.status === "paused" &&
    !tempoRamp.progress.completed;
  const showPracticeStatus = selectionModeOpen || selectedCount > 0 || advancedClickStatus !== null || tempoRampStatus !== null || goalStatus !== null || summaryStatus !== null;
  if (!showPracticeStatus && isFirstRunTipDismissed()) {
    return;
  }

  const tip = preview.createDiv({
    cls: `drum-notation__tip pg-discovery-tip${showPracticeStatus ? " drum-notation__tip--practice" : ""}`
  });
  preview.prepend(tip);
  if (showPracticeStatus) {
    const selectionStatus = selectionModeOpen
      ? `Select bars to practise · ${selectedCount} selected`
      : selectedCount > 0
        ? `Practice selection · ${selectedCount} bar${selectedCount === 1 ? "" : "s"}`
        : null;
    tip.createSpan({
      cls: "drum-notation__practice-label",
      text: [goalStatus ?? summaryStatus, selectionStatus, tempoRampStatus, advancedClickStatus].filter(Boolean).join(" · ")
    });
    if ((goalStatus?.includes("View summary") || summaryStatus) && completedSummary) {
      const summaryButton = tip.createEl("button", {
        cls: "drum-notation__tip-dismiss drum-notation__practice-action",
        text: "Summary",
        attr: { type: "button", "aria-label": "View practice summary" }
      });
      summaryButton.addEventListener("click", openPracticeSummaryDialog);
    } else if (pausedRepetitionGoal || pausedTempoRamp) {
      const finishButton = tip.createEl("button", {
        cls: "drum-notation__tip-dismiss drum-notation__practice-action drum-notation__practice-action--labeled-icon",
        attr: { type: "button", "aria-label": "Finish session and view summary" }
      });
      finishButton.append(createIconSvg("flag"));
      finishButton.createSpan({ text: "Finish & summary" });
      finishButton.addEventListener("click", () => {
        if (pausedRepetitionGoal) {
          finishRepetitionGoalEarly();
        } else {
          finishTempoRampSessionEarly();
        }
        openPracticeSummaryDialog();
      });
    }
    if (!selectionStatus) {
      return;
    }
    const modeButton = tip.createEl("button", {
      cls: "drum-notation__tip-dismiss drum-notation__practice-action",
      attr: {
        type: "button",
        "aria-label": selectionModeOpen ? "Done selecting practice bars" : "Edit practice selection"
      }
    });
    modeButton.append(createIconSvg(selectionModeOpen ? "check" : "list-checks"));
    modeButton.createSpan({ text: selectionModeOpen ? "Done" : "Edit selection" });
    modeButton.addEventListener("click", () => setSelectionModeOpen(!selectionModeOpen));

    const clearButton = tip.createEl("button", {
      cls: "drum-notation__tip-dismiss drum-notation__practice-action",
      attr: { type: "button", "aria-label": "Clear practice selection" }
    });
    clearButton.append(createIconSvg("x"));
    clearButton.createSpan({ text: "Clear" });
    clearButton.disabled = selectedCount === 0;
    clearButton.addEventListener("click", clearPracticeSelection);
    return;
  }

  tip.createSpan({
    text: "Tip: Try the pencil/edit controls to edit notes visually, or choose an example from the list."
  });
  const dismiss = tip.createEl("button", {
    cls: "drum-notation__tip-dismiss",
    text: "Dismiss",
    attr: { type: "button" }
  });
  dismiss.addEventListener("click", () => {
    savePlaygroundValue(TIP_KEY, "1");
    tip.remove();
  });
}

function refreshPracticeStatus(): void {
  preview.querySelector(".pg-discovery-tip")?.remove();
  renderFirstRunTip();
}

function isFirstRunTipDismissed(): boolean {
  return loadPlaygroundValue(TIP_KEY) === "1";
}

function drawScore(block: DrumBlock, score: HTMLElement): void {
  try {
    const renderResult = renderVexflowScore(block, score);

    cursorPositions = renderResult.cursorPositions;
    barRegions = renderResult.barRegions;
    if (block.legendMode !== "off") {
      colorRenderedNoteheads(block, score);
    }
    cursorEl = block.showCursor ? score.createDiv({ cls: "drum-notation__cursor" }) : null;
    noteElements = makeRenderedNotesInteractive(block, score, (slot) => {
      const slotBarIndex = barIndexForSlot(block, slot.index);
      const region = barRegions.find((candidate) => candidate.barIndexes.includes(slotBarIndex));

      if (selectionModeOpen && !gridEditor && region) {
        togglePracticeBarRegion(region);
        return;
      }

      currentSlotIndex = slot.index;
      if (gridEditor) {
        selectBar(slotBarIndex, true);
      } else {
        selectedBarIndex = clampBarIndex(block, slotBarIndex);
        updateBarSelectorState(block);
      }
      void previewSlot(block, slot);
    });
    renderBarSelectors(block, score);
    renderGapOverlays(score);
    if (block.legendMode !== "off") {
      renderInstrumentLegend(block, preview);
    }
  } catch (error) {
    lastRenderError = error instanceof Error ? error.message : String(error);
    cursorPositions = [];
    barRegions = [];
    noteElements = [];
    cursorEl = null;
    score.empty();
    score.createEl("pre", { cls: "drum-notation__error", text: lastRenderError });
  }
}

interface PreviewScrollSnapshot {
  element: HTMLElement;
  scrollLeft: number;
  scrollTop: number;
}

function capturePreviewScroll(): PreviewScrollSnapshot | null {
  const element = preview.parentElement;

  if (!element) {
    return null;
  }

  return {
    element,
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop
  };
}

function restorePreviewScroll(snapshot: PreviewScrollSnapshot | null): void {
  if (!snapshot) {
    return;
  }

  snapshot.element.scrollLeft = snapshot.scrollLeft;
  snapshot.element.scrollTop = snapshot.scrollTop;
  window.requestAnimationFrame(() => {
    snapshot.element.scrollLeft = snapshot.scrollLeft;
    snapshot.element.scrollTop = snapshot.scrollTop;
  });
}

/* ---------- playback visuals ---------- */
function clearVisuals(): void {
  cursorEl?.classList.remove("is-active");
  cursorEl?.removeAttribute("style");
  highlightedNotes.forEach((element) => element.classList.remove("is-playing"));
  highlightedNotes = [];
  clearPlaybackLegendHighlight();
}

function clearPlaybackLegendHighlight(): void {
  if (legendPlaybackTimer !== null) {
    window.clearTimeout(legendPlaybackTimer);
    legendPlaybackTimer = null;
  }
  clearLegendInstrumentHighlight(preview, "playback");
}

function flashPlaybackLegendHighlight(block: DrumBlock, slot: DrumSlot | undefined): void {
  clearPlaybackLegendHighlight();

  if (!block.showHighlight || !slot || slot.hits.length === 0) {
    return;
  }

  setLegendInstrumentHighlight(
    preview,
    "playback",
    slot.hits.map((hit) => hit.instrument.id)
  );
  legendPlaybackTimer = window.setTimeout(
    clearPlaybackLegendHighlight,
    getLegendHighlightDurationMs(block, slot, playbackSpeedPercent)
  );
}

function clearPreviewLegendHighlight(): void {
  if (legendPreviewTimer !== null) {
    window.clearTimeout(legendPreviewTimer);
    legendPreviewTimer = null;
  }
  clearLegendInstrumentHighlight(preview, "preview");
}

function flashPreviewLegendHighlight(block: DrumBlock, slot: DrumSlot): void {
  clearPreviewLegendHighlight();

  if (!block.showHighlight || slot.hits.length === 0) {
    return;
  }

  setLegendInstrumentHighlight(
    preview,
    "preview",
    slot.hits.map((hit) => hit.instrument.id)
  );
  legendPreviewTimer = window.setTimeout(
    clearPreviewLegendHighlight,
    getLegendHighlightDurationMs(block, slot)
  );
}

function clearRepeatProgress(): void {
  if (scoreEl) {
    updateMeasureRepeatProgress(scoreEl, null);
  }
}

function showRepeatProgressForBar(block: DrumBlock, barIndex: number): void {
  if (scoreEl) {
    updateMeasureRepeatProgress(scoreEl, getMeasureRepeatProgress(block, barIndex));
  }
}

function handlePlaybackBarChange(
  block: DrumBlock,
  barIndex: number,
  playbackState?: PlaybackBarState
): void {
  selectedBarIndex = clampBarIndex(block, barIndex);
  activePlaybackBarIndex = barIndex;
  activePlaybackBarState = playbackState ?? null;
  showRepeatProgressForBar(block, barIndex);
  renderGapOverlays();
  refreshPracticeStatus();
}

function clearEditHighlight(): void {
  editHighlightedNotes.forEach((element) => element.classList.remove("is-edit-selected"));
  editHighlightedNotes = [];
}

function applyEditHighlight(): void {
  clearEditHighlight();

  if (editSelectedSlotIndex === null) {
    return;
  }

  editHighlightedNotes = noteElements[editSelectedSlotIndex] ?? [];
  editHighlightedNotes.forEach((element) => element.classList.add("is-edit-selected"));
}

function selectEditSlot(slotIndex: number | null): void {
  editSelectedSlotIndex = slotIndex;
  applyEditHighlight();
}

function clearBarSelectors(): void {
  scoreEl?.querySelector(".pg-bar-selectors")?.remove();
}

function clearGapOverlays(): void {
  scoreEl?.querySelector(".drum-notation__gap-overlays")?.remove();
}

function renderGapOverlays(score: HTMLElement | null = scoreEl): void {
  clearGapOverlays();
  if (
    !score ||
    metronomeMode === "off" ||
    gapClickMode === "off" ||
    activePlaybackBarIndex === null ||
    !activePlaybackBarState ||
    barRegions.length === 0
  ) {
    return;
  }

  const currentRegion = barRegions.find((region) =>
    region.barIndexes.includes(activePlaybackBarIndex ?? -1)
  );
  const nextRegion = activePlaybackBarState.nextBarIndex === null
    ? null
    : barRegions.find((region) =>
        region.barIndexes.includes(activePlaybackBarState?.nextBarIndex ?? -1)
      ) ?? null;
  const layer = score.createDiv({
    cls: "drum-notation__gap-overlays",
    attr: { "aria-hidden": "true" }
  });
  const addOverlay = (region: ScoreBarRegion, kind: "active" | "next") => {
    layer.createDiv({ cls: `drum-notation__gap-overlay is-gap-${kind}` }).setCssProps({
      "--drum-gap-left": `${Math.round(region.x)}px`,
      "--drum-gap-top": `${Math.round(region.y)}px`,
      "--drum-gap-width": `${Math.round(region.width)}px`,
      "--drum-gap-height": `${Math.round(region.height)}px`
    });
  };

  if (activePlaybackBarState.isGapBar && currentRegion) {
    addOverlay(currentRegion, "active");
  }
  if (
    activePlaybackBarState.isNextGapBar &&
    nextRegion &&
    (!activePlaybackBarState.isGapBar || nextRegion !== currentRegion)
  ) {
    addOverlay(nextRegion, "next");
  }
  if (!layer.hasChildNodes()) {
    layer.remove();
  }
}

function renderBarSelectors(block: DrumBlock, score: HTMLElement): void {
  if ((!gridEditor && !selectionModeOpen && practiceSelection.barIndexes.length === 0) || barRegions.length === 0) {
    return;
  }

  clearBarSelectors();
  const layer = score.createDiv({ cls: "pg-bar-selectors" });
  if (!gridEditor) {
    layer.addClass("is-practice-selection");
    layer.toggleClass("is-selection-open", selectionModeOpen);
  }

  barRegions.forEach((region) => {
    const button = layer.createEl("button", {
      cls: "pg-bar-selector",
      attr: {
        "aria-label": `Select bar ${region.barIndex + 1}`,
        type: "button"
      }
    });

    button.dataset.barIndex = String(region.barIndex);
    button.dataset.barIndexes = region.barIndexes.join(" ");
    button.setCssProps({
      "--pg-bar-selector-left": `${Math.round(region.x)}px`,
      "--pg-bar-selector-top": `${Math.round(region.y)}px`,
      "--pg-bar-selector-width": `${Math.round(region.width)}px`,
      "--pg-bar-selector-height": `${Math.round(region.height)}px`
    });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (gridEditor) {
        selectBar(region.barIndex, true);
      } else {
        togglePracticeBarRegion(region);
      }
    });
  });

  updateBarSelectorState(block);
}

function updateBarSelectorState(block: DrumBlock | null = currentBlock): void {
  if (!block || !scoreEl) {
    return;
  }

  selectedBarIndex = clampBarIndex(block, selectedBarIndex);
  scoreEl.querySelectorAll<HTMLButtonElement>(".pg-bar-selector").forEach((button) => {
    const indexes = (button.dataset.barIndexes ?? "")
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value));
    const selected = gridEditor
      ? indexes.includes(selectedBarIndex)
      : isPracticeRegionSelected(practiceSelection, { barIndexes: indexes });

    button.classList.toggle("is-selected", selected);
    button.classList.toggle("is-practice-selected", !gridEditor && selected);
    button.setAttr("aria-pressed", selected ? "true" : "false");
    if (!gridEditor) {
      const firstBar = (indexes[0] ?? 0) + 1;
      const lastBar = (indexes[indexes.length - 1] ?? indexes[0] ?? 0) + 1;
      const barLabel = firstBar === lastBar ? `bar ${firstBar}` : `bars ${firstBar}–${lastBar}`;
      button.setAttr(
        "aria-label",
        `${selected ? "Remove" : "Add"} ${barLabel} ${selected ? "from" : "to"} practice selection`
      );
    }
  });

  const updatedNotes = new Set<SVGGElement>();
  noteElements.forEach((elements, slotIndex) => {
    elements?.forEach((element) => {
      if (updatedNotes.has(element)) {
        return;
      }
      updatedNotes.add(element);
      const barIndex = barIndexForSlot(block, slotIndex);
      const region = barRegions.find((candidate) => candidate.barIndexes.includes(barIndex));
      if (!selectionModeOpen || !region) {
        element.setAttribute(
          "aria-label",
          element.dataset.previewAriaLabel ?? `Preview note at slot ${slotIndex + 1}`
        );
        return;
      }

      const regionSelected = isPracticeRegionSelected(practiceSelection, region);
      const firstBar = region.barIndexes[0] + 1;
      const lastBar = region.barIndexes[region.barIndexes.length - 1] + 1;
      const barLabel = firstBar === lastBar ? `bar ${firstBar}` : `bars ${firstBar}–${lastBar}`;
      element.setAttribute(
        "aria-label",
        `${regionSelected ? "Remove" : "Add"} ${barLabel} ${regionSelected ? "from" : "to"} practice selection`
      );
    });
  });
}

function selectBar(barIndex: number, syncGrid: boolean): void {
  if (!currentBlock) {
    return;
  }

  selectedBarIndex = clampBarIndex(currentBlock, barIndex);
  currentSlotIndex = currentBlock.bars[selectedBarIndex]?.startSlot ?? currentSlotIndex;
  selectEditSlot(null);
  if (syncGrid) {
    gridEditor?.selectBar(selectedBarIndex);
  }
  updateBarSelectorState(currentBlock);
}

function selectRenderedBarAtPoint(event: MouseEvent): void {
  if (event.defaultPrevented || !currentBlock || barRegions.length === 0) {
    return;
  }

  const score = event.currentTarget instanceof HTMLElement ? event.currentTarget : scoreEl;

  if (!score) {
    return;
  }

  const rect = score.getBoundingClientRect();
  const x = event.clientX - rect.left + score.scrollLeft;
  const y = event.clientY - rect.top + score.scrollTop;
  const region = barRegions.find(
    (candidate) =>
      x >= candidate.x &&
      x <= candidate.x + candidate.width &&
      y >= candidate.y &&
      y <= candidate.y + candidate.height
  );

  if (!region) {
    return;
  }

  if (selectionModeOpen && !gridEditor) {
    togglePracticeBarRegion(region);
  } else {
    selectBar(region.barIndex, Boolean(gridEditor));
  }
}

function clearPracticeSelection(): void {
  if (practiceSelection.barIndexes.length === 0 && !selectionModeOpen) {
    return;
  }
  stopPlayback();
  practiceSelection = { barIndexes: [] };
  if (tempoRamp.config?.target.kind === "selected-bars") {
    tempoRamp = {
      config: { ...tempoRamp.config, target: { kind: "selected-bars", barIndexes: [] } },
      progress: { completedPasses: 0, completed: false },
      armed: false
    };
    activeTempoRampPass = null;
  }
  if (repetitionGoal.config?.target.kind === "selected-bars") {
    repetitionGoal = {
      config: { ...repetitionGoal.config, target: { kind: "selected-bars", barIndexes: [] } },
      progress: { completedPasses: 0, completed: false },
      armed: false,
      runMetrics: null
    };
  }
  selectionModeOpen = false;
  renderPreview();
}

function setSelectionModeOpen(open: boolean): void {
  if (gridEditor && open) {
    return;
  }
  if (selectionModeOpen === open) {
    return;
  }
  stopPlayback();
  selectionModeOpen = open;
  setLoopMenuOpen(false);
  renderPreview();
}

function togglePracticeBarRegion(region: ScoreBarRegion): void {
  if (!selectionModeOpen || gridEditor || !currentBlock) {
    return;
  }
  stopPlayback();
  practiceSelection = togglePracticeRegion(practiceSelection, region, currentBlock.bars.length);
  if (tempoRamp.config?.target.kind === "selected-bars") {
    tempoRamp = {
      config: {
        ...tempoRamp.config,
        target: { kind: "selected-bars", barIndexes: [...practiceSelection.barIndexes] }
      },
      progress: { completedPasses: 0, completed: false },
      armed: practiceSelection.barIndexes.length > 0 && tempoRamp.armed
    };
    activeTempoRampPass = null;
  }
  if (repetitionGoal.config?.target.kind === "selected-bars") {
    repetitionGoal = {
      config: {
        ...repetitionGoal.config,
        target: { kind: "selected-bars", barIndexes: [...practiceSelection.barIndexes] }
      },
      progress: { completedPasses: 0, completed: false },
      armed: practiceSelection.barIndexes.length > 0 && repetitionGoal.armed,
      runMetrics: null
    };
  }
  selectedBarIndex = clampBarIndex(currentBlock, region.barIndex);
  currentSlotIndex = currentBlock.bars[selectedBarIndex]?.startSlot ?? currentSlotIndex;
  renderPreview();
}

function barIndexForSlot(block: DrumBlock, slotIndex: number): number {
  const index = block.bars.findIndex((bar) => slotIndex >= bar.startSlot && slotIndex < bar.startSlot + bar.slots.length);

  return index >= 0 ? index : 0;
}

function clampBarIndex(block: DrumBlock, barIndex: number): number {
  if (block.bars.length === 0) {
    return 0;
  }

  return Math.min(block.bars.length - 1, Math.max(0, Math.round(barIndex)));
}

function moveCursor(slotIndex: number): void {
  if (currentBlock?.showHighlight) {
    highlightedNotes.forEach((element) => element.classList.remove("is-playing"));
    highlightedNotes = noteElements[slotIndex] ?? [];
    highlightedNotes.forEach((element) => element.classList.add("is-playing"));
    flashPlaybackLegendHighlight(currentBlock, currentBlock.slots[slotIndex]);
  } else {
    clearPlaybackLegendHighlight();
  }

  const position = cursorPositions[slotIndex];
  if (!position || !cursorEl) {
    cursorEl?.classList.remove("is-active");
    cursorEl?.removeAttribute("style");
    return;
  }

  cursorEl.classList.add("is-active");
  cursorEl.setCssProps({
    "--drum-cursor-height": `${Math.round(position.height)}px`,
    "--drum-cursor-left": `${Math.round(position.x)}px`,
    "--drum-cursor-top": `${Math.round(position.y)}px`
  });
}

/* ---------- playback ---------- */
function setPlaying(button: HTMLButtonElement, on: boolean): void {
  button.classList.toggle("is-playing", on);
}

function finalizeCompletedTempoRamp(): void {
  if (tempoRamp.armed && tempoRamp.config && tempoRamp.progress.completed) {
    finishTrackedSummary("tempo-ramp", tempoRamp.config.target, null, true);
  }
}

function stopPlayback(settleSession = true): void {
  if (settleSession) settleTrackedRun();
  player?.stop();
  player = null;
  void screenWakeLock.stop();
  transportMode = "idle";
  activePlaybackBarIndex = null;
  activePlaybackBarState = null;
  activeTempoRampPass = null;
  setPlaying(playBtn, false);
  setPlaying(loopBtn, false);
  setPlaying(loopAllBtn, false);
  clearVisuals();
  clearRepeatProgress();
  clearGapOverlays();
  refreshPracticeStatus();
}

async function preparePlaybackStart(recoverBeforeStart: boolean): Promise<boolean> {
  stopPlayback(false);

  if (!recoverBeforeStart) {
    return true;
  }

  return recoverPlaybackAudio();
}

function handleTempoRampPassStart(passState: TempoRampPassState): void {
  const previousSubdivision = clickSubdivision;
  clickSubdivision = passState.clickSubdivision;
  activeTempoRampPass = { ...passState };
  if (previousSubdivision !== clickSubdivision) {
    advancedClickWarning =
      `Click subdivision changed to ${getClickSubdivisionLabel(clickSubdivision)} at ${passState.tempoBpm} BPM.`;
  }
  if (currentBlock) syncPlaybackControls(currentBlock);
  refreshPracticeStatus();
}

function handleTempoRampPassComplete(passState: TempoRampPassState): void {
  tempoRamp = {
    ...tempoRamp,
    progress: {
      completedPasses: passState.completedPasses,
      completed: passState.completed
    }
  };
  activeTempoRampPass = { ...passState };
  if (currentBlock) syncPlaybackControls(currentBlock);
  refreshPracticeStatus();
}

function getTempoRampPlaybackOptions() {
  if (!tempoRamp.armed || !tempoRamp.config) return {};
  const config = cloneTempoRampConfig(tempoRamp.config);
  if (!config) return {};
  return {
    tempoRamp: {
      config,
      progress: { ...tempoRamp.progress }
    },
    onTempoRampPassStart: handleTempoRampPassStart,
    onTempoRampPassComplete: handleTempoRampPassComplete,
    onPassComplete: (state: PlaybackPassState) => {
      if (tempoRampRunMetrics) {
        tempoRampRunMetrics = recordPracticePass(tempoRampRunMetrics, state.tempoBpm);
      }
    }
  };
}

async function play(
  initialSlot = 0,
  recoverBeforeStart = false,
  useCountIn = true,
  initialPosition?: DrumPlaybackPosition,
  useSelection = practiceSelection.barIndexes.length > 0
): Promise<boolean> {
  if (!(await preparePlaybackStart(recoverBeforeStart))) {
    return false;
  }

  if (!currentBlock || currentBlock.rows.length === 0) {
    return false;
  }

  const block = currentBlock;
  currentSlotIndex = clampSlotIndex(block, initialSlot);
  transportMode = useSelection ? "play-selection" : "play-all";
  setPlaying(playBtn, true);
  player = new DrumPlayer(
    getAudioContext(),
    block,
    () => {
      setPlaying(playBtn, false);
      clearVisuals();
      clearRepeatProgress();
      transportMode = "idle";
      activePlaybackBarIndex = null;
      activePlaybackBarState = null;
      player = null;
      clearGapOverlays();
      refreshPracticeStatus();
      finalizeCompletedTempoRamp();
      void screenWakeLock.stop();
    },
    (slotIndex) => {
      currentSlotIndex = slotIndex;
      moveCursor(slotIndex);
    },
    {
      startSlot: 0,
      endSlot: block.slots.length,
      initialSlot: currentSlotIndex,
      ...(initialPosition ? { initialPosition } : {}),
      repeatCount: useSelection ? 1 : block.repeatCount,
      ...(useSelection ? { selectedBarIndexes: practiceSelection.barIndexes } : {}),
      speedPercent: playbackSpeedPercent,
      ...(exactTempoBpm !== null ? { exactTempoBpm } : {}),
      mutedInstrumentIds,
      metronomeMode,
      countInMode: useCountIn ? countInMode : "off",
      countInCadence: "transport-start",
      clickSubdivision,
      gapClickMode,
      onBarChange: (barIndex, state) => handlePlaybackBarChange(block, barIndex, state),
      ...getTempoRampPlaybackOptions()
    },
    createPlaybackBackend
  );
  if (!useCountIn || countInMode === "off") {
    handlePlaybackBarChange(block, barIndexForSlot(block, currentSlotIndex));
  }
  void screenWakeLock.start(createScreenWakeLockTarget(scoreEl?.ownerDocument ?? activeDocument));
  void player.play();
  return true;
}

function loopBar(): void {
  if (transportMode === "loop-bar" || ((repetitionGoal.armed || tempoRamp.armed) && player)) {
    stopPlayback();
    return;
  }
  if (!currentBlock || currentBlock.rows.length === 0) {
    return;
  }

  if (repetitionGoal.armed) {
    void startRepetitionGoal(true, true);
    return;
  }

  if (tempoRamp.armed) {
    void startArmedTempoRamp(true, true);
    return;
  }

  void startLoopBar(barIndexForSlot(currentBlock, currentSlotIndex), undefined, true);
}

async function startLoopBar(
  barIndex = selectedBarIndex,
  initialSlot?: number,
  recoverBeforeStart = false,
  useCountIn = true,
  initialPosition?: DrumPlaybackPosition
): Promise<boolean> {
  if (!(await preparePlaybackStart(recoverBeforeStart))) {
    return false;
  }

  if (!currentBlock || currentBlock.rows.length === 0) {
    return false;
  }

  const block = currentBlock;
  const bar = block.bars[clampBarIndex(block, barIndex)];
  const barStartSlot = bar?.startSlot ?? clampSlotIndex(block, currentSlotIndex);
  const range = getBarRange(block, barStartSlot);
  currentSlotIndex = clampSlotToRange(initialSlot ?? range.startSlot, range.startSlot, range.endSlot);
  transportMode = "loop-bar";
  setPlaying(loopBtn, true);
  player = new DrumPlayer(
    getAudioContext(),
    block,
    () => {
      setPlaying(loopBtn, false);
      clearVisuals();
      clearRepeatProgress();
      transportMode = "idle";
      activePlaybackBarIndex = null;
      activePlaybackBarState = null;
      player = null;
      clearGapOverlays();
      refreshPracticeStatus();
      finalizeCompletedTempoRamp();
      void screenWakeLock.stop();
    },
    (slotIndex) => {
      currentSlotIndex = slotIndex;
      moveCursor(slotIndex);
    },
    {
      startSlot: range.startSlot,
      endSlot: range.endSlot,
      initialSlot: currentSlotIndex,
      ...(initialPosition ? { initialPosition } : {}),
      loop: true,
      speedPercent: playbackSpeedPercent,
      ...(exactTempoBpm !== null ? { exactTempoBpm } : {}),
      mutedInstrumentIds,
      metronomeMode,
      countInMode: useCountIn ? countInMode : "off",
      countInCadence,
      clickSubdivision,
      gapClickMode,
      onBarChange: (nextBarIndex, state) => handlePlaybackBarChange(block, nextBarIndex, state),
      ...getTempoRampPlaybackOptions()
    },
    createPlaybackBackend
  );
  void screenWakeLock.start(createScreenWakeLockTarget(scoreEl?.ownerDocument ?? activeDocument));
  void player.play();
  return true;
}

async function startLoopAll(
  initialSlot = 0,
  recoverBeforeStart = false,
  useCountIn = true,
  initialPosition?: DrumPlaybackPosition
): Promise<boolean> {
  if (!(await preparePlaybackStart(recoverBeforeStart))) {
    return false;
  }

  if (!currentBlock || currentBlock.rows.length === 0) {
    return false;
  }

  const block = currentBlock;
  currentSlotIndex = clampSlotIndex(block, initialSlot);
  transportMode = "loop-all";
  setPlaying(loopAllBtn, true);
  player = new DrumPlayer(
    getAudioContext(),
    block,
    () => {
      setPlaying(loopAllBtn, false);
      clearVisuals();
      clearRepeatProgress();
      transportMode = "idle";
      activePlaybackBarIndex = null;
      activePlaybackBarState = null;
      player = null;
      clearGapOverlays();
      refreshPracticeStatus();
      finalizeCompletedTempoRamp();
      void screenWakeLock.stop();
    },
    (slotIndex) => {
      currentSlotIndex = slotIndex;
      moveCursor(slotIndex);
    },
    {
      startSlot: 0,
      endSlot: block.slots.length,
      initialSlot: currentSlotIndex,
      ...(initialPosition ? { initialPosition } : {}),
      loop: true,
      speedPercent: playbackSpeedPercent,
      ...(exactTempoBpm !== null ? { exactTempoBpm } : {}),
      mutedInstrumentIds,
      metronomeMode,
      countInMode: useCountIn ? countInMode : "off",
      countInCadence,
      clickSubdivision,
      gapClickMode,
      onBarChange: (barIndex, state) => handlePlaybackBarChange(block, barIndex, state),
      ...getTempoRampPlaybackOptions()
    },
    createPlaybackBackend
  );
  if (!useCountIn || countInMode === "off") {
    handlePlaybackBarChange(block, barIndexForSlot(block, currentSlotIndex));
  }
  void screenWakeLock.start(createScreenWakeLockTarget(scoreEl?.ownerDocument ?? activeDocument));
  void player.play();
  return true;
}

async function startLoopSelection(
  initialSlot = practiceSelection.barIndexes.length > 0 && currentBlock
    ? currentBlock.bars[practiceSelection.barIndexes[0]]?.startSlot ?? 0
    : 0,
  recoverBeforeStart = false,
  useCountIn = true,
  initialPosition?: DrumPlaybackPosition,
  selectedBarIndexes: readonly number[] = practiceSelection.barIndexes
): Promise<boolean> {
  if (!(await preparePlaybackStart(recoverBeforeStart))) {
    return false;
  }
  if (!currentBlock || currentBlock.rows.length === 0 || selectedBarIndexes.length === 0) {
    return false;
  }

  const block = currentBlock;
  currentSlotIndex = clampSlotIndex(block, initialSlot);
  transportMode = "loop-selection";
  setPlaying(loopAllBtn, true);
  player = new DrumPlayer(
    getAudioContext(),
    block,
    () => {
      setPlaying(loopAllBtn, false);
      clearVisuals();
      clearRepeatProgress();
      transportMode = "idle";
      activePlaybackBarIndex = null;
      activePlaybackBarState = null;
      player = null;
      clearGapOverlays();
      refreshPracticeStatus();
      finalizeCompletedTempoRamp();
      void screenWakeLock.stop();
    },
    (slotIndex) => {
      currentSlotIndex = slotIndex;
      moveCursor(slotIndex);
    },
    {
      initialSlot: currentSlotIndex,
      ...(initialPosition ? { initialPosition } : {}),
      selectedBarIndexes,
      loop: true,
      speedPercent: playbackSpeedPercent,
      ...(exactTempoBpm !== null ? { exactTempoBpm } : {}),
      mutedInstrumentIds,
      metronomeMode,
      countInMode: useCountIn ? countInMode : "off",
      countInCadence,
      clickSubdivision,
      gapClickMode,
      onBarChange: (barIndex, state) => handlePlaybackBarChange(block, barIndex, state),
      ...getTempoRampPlaybackOptions()
    },
    createPlaybackBackend
  );
  if (!useCountIn || countInMode === "off") {
    handlePlaybackBarChange(block, barIndexForSlot(block, currentSlotIndex));
  }
  void screenWakeLock.start(createScreenWakeLockTarget(scoreEl?.ownerDocument ?? activeDocument));
  void player.play();
  return true;
}

async function startArmedTempoRamp(recoverBeforeStart: boolean, useCountIn = true): Promise<boolean> {
  const config = tempoRamp.config;
  if (!tempoRamp.armed || !config) {
    return play(0, recoverBeforeStart, useCountIn);
  }
  if (!currentBlock) return false;

  if (tempoRamp.progress.completed) {
    if (completedSummary && !completedSummaryHandled) {
      const replace = await confirmPlaygroundAction(
        "This practice summary has not been copied. Start the tempo ramp again and replace it?"
      );
      if (!replace) return false;
    }
    tempoRamp = { ...tempoRamp, progress: { completedPasses: 0, completed: false } };
    tempoRampRunMetrics = null;
    completedSummary = null;
    completedSummaryHandled = false;
  }
  activeTempoRampPass = null;
  startOrResumeTrackedRun("tempo-ramp");

  let started: boolean;
  if (config.target.kind === "current-bar") {
    started = await startLoopBar(config.target.barIndex, undefined, recoverBeforeStart, useCountIn);
  } else if (config.target.kind === "selected-bars") {
    const firstSlot = currentBlock.bars[config.target.barIndexes[0]]?.startSlot ?? 0;
    started = await startLoopSelection(firstSlot, recoverBeforeStart, useCountIn, undefined, config.target.barIndexes);
  } else {
    started = await startLoopAll(0, recoverBeforeStart, useCountIn);
  }
  if (!started) settleTrackedRun();
  return started;
}

async function startRepetitionGoal(
  recoverBeforeStart: boolean,
  useCountIn = true,
  initialPosition?: DrumPlaybackPosition
): Promise<boolean> {
  if (!currentBlock) return false;
  const block = currentBlock;
  const config = normalizeRepetitionGoalConfig(repetitionGoal.config, block.bars.length);
  if (!repetitionGoal.armed || !config) return false;
  let progress = normalizeRepetitionGoalProgress(config, repetitionGoal.progress);
  if (
    completedSummary &&
    !completedSummaryHandled &&
    (progress.completed || repetitionGoal.runMetrics === null)
  ) {
    const replace = await confirmPlaygroundAction(
      "This practice summary has not been copied. Start the repetition goal and replace it?"
    );
    if (!replace) return false;
  }
  if (progress.completed) {
    progress = { completedPasses: 0, completed: false };
    repetitionGoal = { ...repetitionGoal, progress, runMetrics: null };
    completedSummary = null;
    completedSummaryHandled = false;
  }
  const remainingPasses = config.totalPasses - progress.completedPasses;
  if (remainingPasses <= 0 || !(await preparePlaybackStart(recoverBeforeStart))) return false;
  startOrResumeTrackedRun("repetition-goal");
  const completedBeforeTransport = progress.completedPasses;
  let startSlot = 0;
  let endSlot = block.slots.length;
  let selectedBarIndexes: readonly number[] | undefined;
  if (config.target.kind === "current-bar") {
    const bar = block.bars[config.target.barIndex];
    if (!bar) return false;
    startSlot = bar.startSlot;
    endSlot = bar.startSlot + bar.slots.length;
    transportMode = "loop-bar";
    setPlaying(loopBtn, true);
  } else if (config.target.kind === "selected-bars") {
    selectedBarIndexes = config.target.barIndexes;
    startSlot = block.bars[selectedBarIndexes[0]]?.startSlot ?? 0;
    transportMode = "loop-selection";
    setPlaying(loopAllBtn, true);
  } else {
    transportMode = "loop-all";
    setPlaying(loopAllBtn, true);
  }
  currentSlotIndex = initialPosition?.slotIndex ?? startSlot;
  player = new DrumPlayer(
    getAudioContext(),
    block,
    () => {
      setPlaying(loopBtn, false);
      setPlaying(loopAllBtn, false);
      clearVisuals();
      clearRepeatProgress();
      transportMode = "idle";
      activePlaybackBarIndex = null;
      activePlaybackBarState = null;
      player = null;
      clearGapOverlays();
      repetitionGoal = {
        ...repetitionGoal,
        progress: { completedPasses: config.totalPasses, completed: true }
      };
      finishTrackedSummary("repetition-goal", config.target, config.totalPasses, true);
      refreshPracticeStatus();
      void screenWakeLock.stop();
    },
    (slotIndex) => {
      currentSlotIndex = slotIndex;
      moveCursor(slotIndex);
    },
    {
      startSlot,
      endSlot,
      initialSlot: currentSlotIndex,
      ...(initialPosition ? { initialPosition: { ...initialPosition, blockPassIndex: 0 } } : {}),
      ...(selectedBarIndexes ? { selectedBarIndexes } : {}),
      passLimit: remainingPasses,
      speedPercent: playbackSpeedPercent,
      ...(exactTempoBpm !== null ? { exactTempoBpm } : {}),
      mutedInstrumentIds,
      metronomeMode,
      countInMode: useCountIn ? countInMode : "off",
      countInCadence,
      clickSubdivision,
      gapClickMode,
      onBarChange: (barIndex, state) => handlePlaybackBarChange(block, barIndex, state),
      onPassComplete: (state: PlaybackPassState) => {
        const completedPasses = Math.min(config.totalPasses, completedBeforeTransport + state.completedPasses);
        repetitionGoal = {
          ...repetitionGoal,
          progress: { completedPasses, completed: completedPasses >= config.totalPasses },
          runMetrics: repetitionGoal.runMetrics
            ? recordPracticePass(repetitionGoal.runMetrics, state.tempoBpm)
            : null
        };
        refreshPracticeStatus();
      }
    },
    createPlaybackBackend
  );
  refreshPracticeStatus();
  void screenWakeLock.start(createScreenWakeLockTarget(scoreEl?.ownerDocument ?? activeDocument));
  void player.play();
  return true;
}

function openRepetitionGoalDialog(): void {
  if (!currentBlock) return;
  dismissPlaygroundConfirm();
  const block = currentBlock;
  const initial = normalizeRepetitionGoalConfig(repetitionGoal.config, block.bars.length) ??
    createDefaultRepetitionGoalConfig(block.bars.length, practiceSelection.barIndexes, selectedBarIndex);
  const panel = activeDocument.body.createDiv({
    cls: "pg-confirm pg-tempo-ramp-dialog",
    attr: { role: "dialog", "aria-modal": "true", "aria-label": "Practice repetitions" }
  });
  panel.createEl("h2", { cls: "pg-tempo-ramp-dialog__title", text: "Practice repetitions" });
  const target = panel.createEl("select", { cls: "pg-confirm__number pg-tempo-ramp-dialog__select" });
  target.createEl("option", { value: "current-bar", text: `Current bar (${selectedBarIndex + 1})` });
  const selected = target.createEl("option", {
    value: "selected-bars",
    text: practiceSelection.barIndexes.length > 0 ? `Selected bars (${practiceSelection.barIndexes.length})` : "Selected bars (none)"
  });
  selected.disabled = practiceSelection.barIndexes.length === 0;
  target.createEl("option", { value: "whole-notation", text: "Whole notation" });
  target.value = initial.target.kind;
  const targetLabel = panel.createEl("label", { cls: "pg-confirm__field" });
  targetLabel.createSpan({ text: "Target" });
  targetLabel.append(target);
  const passes = panel.createEl("input", { cls: "pg-confirm__number" });
  passes.type = "number";
  passes.min = String(MIN_REPETITION_GOAL_PASSES);
  passes.max = String(MAX_REPETITION_GOAL_PASSES);
  passes.step = "1";
  passes.value = String(initial.totalPasses);
  const passesLabel = panel.createEl("label", { cls: "pg-confirm__field" });
  passesLabel.createSpan({ text: "Passes" });
  passesLabel.append(passes);
  const quick = panel.createDiv({ cls: "pg-confirm__actions" });
  [4, 8, 16, 32].forEach((value) => {
    const button = quick.createEl("button", { cls: "pg-btn pg-btn--small", text: String(value), attr: { type: "button" } });
    button.addEventListener("click", () => {
      passes.value = String(value);
      update();
    });
  });
  const summary = panel.createEl("p", { cls: "pg-tempo-ramp-dialog__summary", attr: { "aria-live": "polite" } });
  const actions = panel.createDiv({ cls: "pg-confirm__actions" });
  const cancel = actions.createEl("button", { cls: "pg-btn pg-btn--small", text: "Cancel", attr: { type: "button" } });
  const submit = actions.createEl("button", { cls: "pg-btn pg-btn--small pg-confirm__confirm", text: "Start goal", attr: { type: "button" } });
  const read = (): RepetitionGoalConfig => ({
    target: target.value === "whole-notation"
      ? { kind: "whole-notation" }
      : target.value === "selected-bars"
        ? { kind: "selected-bars", barIndexes: [...practiceSelection.barIndexes] }
        : { kind: "current-bar", barIndex: selectedBarIndex },
    totalPasses: Number(passes.value)
  });
  function update() {
    const config = normalizeRepetitionGoalConfig(read(), block.bars.length);
    submit.disabled = config === null;
    summary.setText(config ? `${config.totalPasses} complete pass${config.totalPasses === 1 ? "" : "es"}` : "Enter a valid repetition goal.");
  }
  const close = () => panel.remove();
  target.addEventListener("change", update);
  passes.addEventListener("input", update);
  cancel.addEventListener("click", close);
  const submitRepetitionGoal = async (): Promise<void> => {
    const config = normalizeRepetitionGoalConfig(read(), block.bars.length);
    if (!config) return;
    if (completedSummary && !completedSummaryHandled) {
      const replace = await confirmPlaygroundAction(
        "This practice summary has not been copied. Start a new repetition goal and replace it?"
      );
      if (!replace) return;
    }
    stopPlayback();
    tempoRamp = { ...tempoRamp, armed: false };
    repetitionGoal = {
      config,
      progress: { completedPasses: 0, completed: false },
      armed: true,
      runMetrics: null
    };
    completedSummary = null;
    completedSummaryHandled = false;
    close();
    refreshPracticeStatus();
    void startRepetitionGoal(true, true);
  };
  submit.addEventListener("click", () => {
    void submitRepetitionGoal();
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  });
  update();
  window.requestAnimationFrame(() => {
    passes.focus();
    passes.select();
  });
}

function finishRepetitionGoalEarly(): void {
  const config = repetitionGoal.config;
  if (!config || !repetitionGoal.runMetrics) return;
  stopPlayback();
  finishTrackedSummary("repetition-goal", config.target, config.totalPasses, false);
  refreshPracticeStatus();
}

function finishTempoRampSessionEarly(): void {
  if (!tempoRamp.config || !tempoRampRunMetrics) return;
  stopPlayback();
  const target = tempoRamp.config.target;
  tempoRamp = { ...tempoRamp, armed: false };
  finishTrackedSummary("tempo-ramp", target, null, false);
  refreshPracticeStatus();
}

async function resetRepetitionGoal(): Promise<void> {
  if (!repetitionGoal.config) return;
  if (completedSummary && !completedSummaryHandled) {
    const replace = await confirmPlaygroundAction(
      "This practice summary has not been copied. Reset the repetition goal and replace it?"
    );
    if (!replace) return;
  }
  stopPlayback();
  repetitionGoal = {
    ...repetitionGoal,
    armed: true,
    progress: { completedPasses: 0, completed: false },
    runMetrics: null
  };
  completedSummary = null;
  completedSummaryHandled = false;
  refreshPracticeStatus();
}

function openPracticeSummaryDialog(): void {
  if (!completedSummary || !currentBlock) return;
  dismissPlaygroundConfirm();
  const summary = completedSummary;
  const panel = activeDocument.body.createDiv({
    cls: "pg-confirm pg-tempo-ramp-dialog",
    attr: { role: "dialog", "aria-modal": "true", "aria-label": "Practice summary" }
  });
  panel.createEl("h2", { cls: "pg-tempo-ramp-dialog__title", text: "Practice summary" });
  [
    ["Notation", getTitle(currentBlock)],
    ["Target", formatPracticeTarget(summary.target)],
    ["Passes", summary.requestedPasses === null ? String(summary.performedPasses) : `${summary.performedPasses}/${summary.requestedPasses}`],
    ["Tempo", summary.startBpm === summary.endBpm ? `${summary.startBpm} BPM` : `${summary.startBpm} → ${summary.endBpm} BPM`],
    ["Active session time", formatActiveSessionTime(summary.elapsedActiveMs)],
    ["Result", summary.completed ? "Completed" : "Finished early"]
  ].forEach(([label, value]) => panel.createEl("p", { text: `${label}: ${value}` }));
  const note = panel.createEl("textarea", { cls: "pg-confirm__number", attr: { placeholder: "Optional note" } });
  const actions = panel.createDiv({ cls: "pg-confirm__actions" });
  const copy = actions.createEl("button", { cls: "pg-btn pg-btn--small pg-confirm__confirm", text: "Copy Markdown", attr: { type: "button" } });
  copy.disabled = completedSummaryHandled;
  const close = actions.createEl("button", { cls: "pg-btn pg-btn--small", text: "Close", attr: { type: "button" } });
  const discard = actions.createEl("button", { cls: "pg-btn pg-btn--small", text: "Discard summary", attr: { type: "button" } });
  const remove = () => panel.remove();
  copy.addEventListener("click", () => {
    const formatted = formatPracticeSummaryMarkdown(summary, {
      sourcePath: "Playground",
      blockTitle: getTitle(currentBlock!),
      note: note.value
    });
    void writeClipboardText(formatted.markdown)
      .then(() => {
        completedSummaryHandled = true;
        remove();
        refreshPracticeStatus();
      })
      .catch(() => {
        showManualCopyText(formatted.markdown);
      });
  });
  close.addEventListener("click", remove);
  discard.addEventListener("click", () => {
    completedSummary = null;
    completedSummaryHandled = false;
    remove();
    refreshPracticeStatus();
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      remove();
    }
  });
}

function restartPlaybackAfterEdit(
  wasPlaying: boolean,
  previousTransportMode: DrumTransportMode,
  restartSlotIndex: number,
  restartBarIndex: number,
  restartPosition?: DrumPlaybackPosition
): void {
  if (!wasPlaying || lastRenderError || !currentBlock || currentBlock.rows.length === 0) {
    return;
  }

  if (repetitionGoal.armed) {
    void startRepetitionGoal(false, false, restartPosition);
    return;
  }

  const position = tempoRamp.armed && restartPosition
    ? { ...restartPosition, blockPassIndex: 0 }
    : restartPosition;
  if (previousTransportMode === "loop-selection") {
    const selected = tempoRamp.armed && tempoRamp.config?.target.kind === "selected-bars"
      ? tempoRamp.config.target.barIndexes
      : practiceSelection.barIndexes;
    void startLoopSelection(restartSlotIndex, false, false, position, selected);
  } else if (previousTransportMode === "loop-all") {
    void startLoopAll(restartSlotIndex, false, false, position);
  } else if (previousTransportMode === "loop-bar") {
    void startLoopBar(restartBarIndex, undefined, false, false, position);
  } else if (previousTransportMode === "play-selection") {
    void play(restartSlotIndex, false, false, position, true);
  } else {
    void play(restartSlotIndex, false, false, position, false);
  }
}

function capturePlaybackRestart(): (barIndex?: number) => void {
  const wasPlaying = player !== null;
  const previousTransportMode = transportMode;
  const restartPosition = player?.getCurrentPlaybackPosition();
  const restartSlotIndex = restartPosition?.slotIndex ?? currentSlotIndex;
  const restartBarIndex = selectedBarIndex;

  return (barIndex = restartBarIndex) => restartPlaybackAfterEdit(
    wasPlaying,
    previousTransportMode,
    restartSlotIndex,
    barIndex,
    restartPosition
  );
}

async function restartPlaybackForControlChange(): Promise<void> {
  if (!player || !currentBlock) {
    return;
  }

  const currentPosition = player.getCurrentPlaybackPosition();
  if (repetitionGoal.armed) {
    stopPlayback(false);
    await startRepetitionGoal(true, false, { ...currentPosition, blockPassIndex: 0 });
    return;
  }
  const restartPosition = tempoRamp.armed
    ? { ...currentPosition, blockPassIndex: 0 }
    : currentPosition;
  const restartSlotIndex = restartPosition.slotIndex;
  const previousTransportMode = transportMode;
  const restartBarIndex = barIndexForSlot(currentBlock, restartSlotIndex);

  stopPlayback(false);
  if (previousTransportMode === "loop-selection") {
    const selected = tempoRamp.armed && tempoRamp.config?.target.kind === "selected-bars"
      ? tempoRamp.config.target.barIndexes
      : practiceSelection.barIndexes;
    await startLoopSelection(restartSlotIndex, true, false, restartPosition, selected);
  } else if (previousTransportMode === "loop-all") {
    await startLoopAll(restartSlotIndex, true, false, restartPosition);
  } else if (previousTransportMode === "loop-bar") {
    await startLoopBar(restartBarIndex, restartSlotIndex, true, false, restartPosition);
  } else if (previousTransportMode === "play-selection") {
    await play(restartSlotIndex, true, false, restartPosition, true);
  } else {
    await play(restartSlotIndex, true, false, restartPosition, false);
  }
}

function clampSlotIndex(block: DrumBlock, slotIndex: number): number {
  if (block.slots.length === 0) {
    return 0;
  }

  return Math.min(block.slots.length - 1, Math.max(0, Math.round(slotIndex)));
}

function clampSlotToRange(slotIndex: number, startSlot: number, endSlot: number): number {
  if (endSlot <= startSlot) {
    return startSlot;
  }

  return Math.min(endSlot - 1, Math.max(startSlot, Math.round(slotIndex)));
}

function getPlaybackSpeedOptionValues(): number[] {
  const speeds: number[] = [];

  for (
    let speed = MAX_PLAYBACK_SPEED_PERCENT;
    speed >= MIN_PLAYBACK_SPEED_PERCENT;
    speed -= PLAYBACK_SPEED_UI_STEP_PERCENT
  ) {
    speeds.push(speed);
  }

  if (!speeds.includes(MIN_PLAYBACK_SPEED_PERCENT)) {
    speeds.push(MIN_PLAYBACK_SPEED_PERCENT);
  }

  return speeds;
}

function getCurrentEffectiveTempo(block: DrumBlock): number {
  return tempoRamp.armed && tempoRamp.config
    ? activeTempoRampPass?.tempoBpm ?? getTempoRampTempoBpm(tempoRamp.config, tempoRamp.progress.completedPasses)
    : exactTempoBpm ?? getEffectivePlaybackTempo(block.tempo, playbackSpeedPercent);
}

function normalizeClickSubdivisionForCurrentSpeed(
  block: DrumBlock,
  notifyUser: boolean
): boolean {
  const effectiveTempo = getCurrentEffectiveTempo(block);
  const safeSubdivision = tempoRamp.armed || exactTempoBpm !== null
    ? getSafeClickSubdivisionAtTempo(block, effectiveTempo, clickSubdivision)
    : getSafeClickSubdivision(block, playbackSpeedPercent, clickSubdivision);
  if (safeSubdivision === clickSubdivision) {
    return false;
  }

  clickSubdivision = safeSubdivision;
  if (notifyUser) {
    advancedClickWarning = `Click subdivision changed to ${getClickSubdivisionLabel(safeSubdivision)} at ${formatTempo(effectiveTempo)} BPM.`;
    renderNotes(block, editor.value);
  }
  return true;
}

function syncPlaybackControls(block: DrumBlock): void {
  playbackSpeedPercent = normalizePlaybackSpeedPercent(playbackSpeedPercent);
  normalizeClickSubdivisionForCurrentSpeed(block, false);
  const effectiveTempo = getCurrentEffectiveTempo(block);
  const speedDescription = tempoRamp.armed
    ? `Tempo ramp · ${formatTempo(effectiveTempo)} BPM`
    : exactTempoBpm !== null
      ? `Exact playback tempo · ${formatTempo(effectiveTempo)} BPM`
      : `Playback speed ${playbackSpeedPercent}% · ${formatTempo(effectiveTempo)} BPM`;

  speedBtn.textContent = tempoRamp.armed
    ? `${formatTempo(effectiveTempo)} BPM ▲`
    : exactTempoBpm !== null
      ? `${formatTempo(effectiveTempo)} BPM`
      : `${playbackSpeedPercent}%`;
  speedBtn.title = speedDescription;
  speedBtn.setAttribute("aria-label", speedDescription);
  const selectedCount = practiceSelection.barIndexes.length;
  const playDescription = repetitionGoal.armed && repetitionGoal.config
    ? `Resume practice goal · ${formatPracticeTarget(repetitionGoal.config.target)}`
    : tempoRamp.armed && tempoRamp.config
    ? `Play tempo ramp · ${formatTempoRampTarget(tempoRamp.config.target)}`
    : selectedCount > 0
      ? `Play selected bars (${selectedCount})`
      : "Play whole notation";
  playBtn.title = playDescription;
  playBtn.setAttribute("aria-label", playDescription);
  syncMetronomeButton();
  syncMuteButton();

  if (!metronomeMenu.hidden) {
    renderMetronomeMenu();
  }

  if (!muteMenu.hidden) {
    renderMuteMenu();
  }

  if (!loopMenu.hidden) {
    renderLoopMenu();
  }
  if (!speedMenu.hidden) {
    renderSpeedMenu();
  }
}

function setFixedPlaybackSpeed(speedPercent: number): void {
  if (tempoRamp.armed) settleTrackedRun();
  playbackSpeedPercent = normalizePlaybackSpeedPercent(speedPercent);
  exactTempoBpm = null;
  tempoRamp = { ...tempoRamp, armed: false };
  activeTempoRampPass = null;
  if (currentBlock) {
    normalizeClickSubdivisionForCurrentSpeed(currentBlock, true);
    syncPlaybackControls(currentBlock);
  }
  refreshPracticeStatus();
  void restartPlaybackForControlChange();
}

function setExactPlaybackTempo(bpm: number): void {
  const normalized = normalizeExactTempoBpm(bpm);
  if (normalized === null) return;
  if (tempoRamp.armed) settleTrackedRun();
  exactTempoBpm = normalized;
  tempoRamp = { ...tempoRamp, armed: false };
  activeTempoRampPass = null;
  if (currentBlock) {
    normalizeClickSubdivisionForCurrentSpeed(currentBlock, true);
    syncPlaybackControls(currentBlock);
  }
  advancedClickWarning = `Tapped tempo: ${normalized} BPM`;
  refreshPracticeStatus();
  void restartPlaybackForControlChange();
}

function openTapTempoDialog(): void {
  if (player) return;
  dismissPlaygroundConfirm();
  let state = createTapTempoState();
  const panel = activeDocument.body.createDiv({
    cls: "pg-confirm pg-tempo-ramp-dialog",
    attr: { role: "dialog", "aria-modal": "true", "aria-label": "Tap tempo" }
  });
  panel.createEl("h2", { cls: "pg-tempo-ramp-dialog__title", text: "Tap tempo" });
  const measured = panel.createEl("p", {
    cls: "pg-confirm__message",
    text: "Tap at least twice",
    attr: { "aria-live": "polite" }
  });
  const tap = panel.createEl("button", {
    cls: "pg-btn pg-tap-tempo-button",
    text: "Tap",
    attr: { type: "button" }
  });
  const actions = panel.createDiv({ cls: "pg-confirm__actions" });
  const reset = actions.createEl("button", { cls: "pg-btn pg-btn--small", text: "Reset", attr: { type: "button" } });
  const cancel = actions.createEl("button", { cls: "pg-btn pg-btn--small", text: "Cancel", attr: { type: "button" } });
  const use = actions.createEl("button", { cls: "pg-btn pg-btn--small pg-confirm__confirm", text: "Use BPM", attr: { type: "button" } });
  use.disabled = true;
  const record = () => {
    state = recordTapTempo(state, practiceClock.monotonicNowMs());
    measured.setText(state.bpm === null ? "Keep tapping…" : `${state.bpm} BPM`);
    use.disabled = state.bpm === null;
  };
  tap.addEventListener("click", record);
  reset.addEventListener("click", () => {
    state = createTapTempoState();
    measured.setText("Tap at least twice");
    use.disabled = true;
    tap.focus();
  });
  const close = () => panel.remove();
  cancel.addEventListener("click", close);
  use.addEventListener("click", () => {
    if (state.bpm === null) return;
    setExactPlaybackTempo(state.bpm);
    close();
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    } else if ((event.key === " " || event.key === "Enter") && event.target === tap && !event.repeat) {
      event.preventDefault();
      record();
    }
  });
  window.requestAnimationFrame(() => tap.focus());
}

async function resetTempoRamp(): Promise<void> {
  if (!tempoRamp.config) return;
  if (completedSummary && !completedSummaryHandled) {
    const replace = await confirmPlaygroundAction(
      "This practice summary has not been copied. Reset the tempo ramp and replace it?"
    );
    if (!replace) return;
  }
  const wasPlaying = player !== null;
  stopPlayback();
  tempoRamp = {
    ...tempoRamp,
    armed: true,
    progress: { completedPasses: 0, completed: false }
  };
  tempoRampRunMetrics = null;
  completedSummary = null;
  completedSummaryHandled = false;
  activeTempoRampPass = null;
  if (currentBlock) {
    normalizeClickSubdivisionForCurrentSpeed(currentBlock, true);
    syncPlaybackControls(currentBlock);
  }
  refreshPracticeStatus();
  if (wasPlaying) void startArmedTempoRamp(true, true);
}

function turnOffTempoRamp(): void {
  if (!currentBlock || !tempoRamp.config) return;
  const rampBpm = getCurrentEffectiveTempo(currentBlock);
  const fixedPercent = normalizePlaybackSpeedPercent((rampBpm / currentBlock.tempo) * 100);
  const fixedBpm = getEffectivePlaybackTempo(currentBlock.tempo, fixedPercent);
  setFixedPlaybackSpeed(fixedPercent);
  if (Math.abs(fixedBpm - rampBpm) >= 0.05) {
    advancedClickWarning =
      `Tempo ramp ended at ${formatTempo(rampBpm)} BPM; fixed playback is limited to ${formatTempo(fixedBpm)} BPM (${fixedPercent}%).`;
    renderNotes(currentBlock, editor.value);
  }
}

function renderSpeedMenu(): void {
  speedMenu.empty();
  if (!currentBlock) return;
  const block = currentBlock;
  const addItem = (
    label: string,
    checked: boolean | null,
    onActivate: () => void,
    disabled = false
  ) => {
    const item = speedMenu.createEl("button", {
      cls: "pg-metronome-menu__item",
      attr: {
        type: "button",
        role: checked === null ? "menuitem" : "menuitemradio",
        ...(checked === null ? {} : { "aria-checked": checked ? "true" : "false" })
      }
    });
    item.createSpan({ cls: "pg-metronome-menu__check", text: checked === true ? "✓" : "" });
    item.createSpan({ text: label });
    item.disabled = disabled;
    item.addEventListener("click", () => {
      setSpeedMenuOpen(false);
      onActivate();
    });
  };

  speedMenu.createDiv({ cls: "pg-metronome-menu__label", text: "Fixed speed" });
  for (const speed of getPlaybackSpeedOptionValues()) {
    addItem(
      `${speed}% · ${formatTempo(getEffectivePlaybackTempo(block.tempo, speed))} BPM`,
      !tempoRamp.armed && exactTempoBpm === null && playbackSpeedPercent === speed,
      () => setFixedPlaybackSpeed(speed)
    );
  }

  speedMenu.createDiv({ cls: "pg-metronome-menu__label", text: "Trainer" });
  addItem(player ? "Tap tempo… · Stop playback first" : "Tap tempo…", null, openTapTempoDialog, player !== null);
  addItem("Tempo ramp…", null, openTempoRampDialog);
  if (tempoRamp.config && (!tempoRamp.armed || !player)) {
    addItem(tempoRamp.progress.completed ? "Run tempo ramp again" : "Resume tempo ramp", null, () => {
      tempoRamp = {
        ...tempoRamp,
        armed: true,
        progress: tempoRamp.progress.completed
          ? { completedPasses: 0, completed: false }
          : tempoRamp.progress
      };
      activeTempoRampPass = null;
      normalizeClickSubdivisionForCurrentSpeed(block, true);
      syncPlaybackControls(block);
      refreshPracticeStatus();
      void startArmedTempoRamp(true, true);
    });
  }
  if (tempoRamp.config) addItem("Reset ramp", null, () => {
    void resetTempoRamp();
  });
  if (tempoRamp.armed) addItem("Turn off trainer", null, turnOffTempoRamp);
}

function setSpeedMenuOpen(open: boolean): void {
  speedMenu.hidden = !open;
  speedBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    setLoopMenuOpen(false);
    setMetronomeMenuOpen(false);
    setMuteMenuOpen(false);
    renderSpeedMenu();
    const focusFirstItem = () => {
      if (!speedMenu.hidden && !speedMenu.contains(activeDocument.activeElement)) {
        speedMenu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      }
    };
    focusFirstItem();
    window.requestAnimationFrame(focusFirstItem);
  }
}

function handleMenuArrowNavigation(event: KeyboardEvent): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const menu = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const items = menu ? [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")] : [];
  if (items.length === 0) return;
  event.preventDefault();
  const activeIndex = items.findIndex((item) => item === activeDocument.activeElement);
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? items.length - 1
      : event.key === "ArrowUp"
        ? (activeIndex <= 0 ? items.length : activeIndex) - 1
        : (activeIndex + 1) % items.length;
  items[nextIndex]?.focus();
}

function openTempoRampDialog(): void {
  if (!currentBlock) return;
  dismissPlaygroundConfirm();
  const block = currentBlock;
  const defaultConfig = createDefaultTempoRampConfig(
    block,
    getCurrentEffectiveTempo(block),
    practiceSelection,
    selectedBarIndex
  );
  const preservedValues = normalizeTempoRampConfigValues(tempoRamp.config);
  const initial = normalizeTempoRampConfig(tempoRamp.config, block) ??
    (preservedValues ? { ...preservedValues, target: defaultConfig.target } : defaultConfig);
  const panel = activeDocument.body.createDiv({
    cls: "pg-confirm pg-tempo-ramp-dialog",
    attr: { role: "dialog", "aria-modal": "true", "aria-label": "Tempo ramp trainer" }
  });
  panel.createEl("h2", { cls: "pg-tempo-ramp-dialog__title", text: "Tempo ramp trainer" });
  panel.createEl("p", {
    cls: "pg-confirm__message",
    text: `Build an ascending ladder from ${MIN_TEMPO_RAMP_BPM} to ${MAX_TEMPO_RAMP_BPM} BPM.`
  });

  const addField = (label: string, control: HTMLElement) => {
    const field = panel.createEl("label", { cls: "pg-confirm__field" });
    field.createSpan({ text: label });
    field.append(control);
  };
  const target = panel.createEl("select");
  target.addClass("pg-confirm__number", "pg-tempo-ramp-dialog__select");
  target.createEl("option", { value: "current-bar", text: `Current bar (${selectedBarIndex + 1})` });
  const selectedOption = target.createEl("option", {
    value: "selected-bars",
    text: practiceSelection.barIndexes.length > 0
      ? `Selected bars (${practiceSelection.barIndexes.length})`
      : "Selected bars (none)"
  });
  selectedOption.disabled = practiceSelection.barIndexes.length === 0;
  target.createEl("option", { value: "whole-notation", text: "Whole notation" });
  target.value = initial.target.kind;
  addField("Target", target);

  const addNumber = (label: string, value: number, minimum: number, maximum: number) => {
    const input = panel.createEl("input");
    input.addClass("pg-confirm__number");
    input.type = "number";
    input.min = String(minimum);
    input.max = String(maximum);
    input.step = "1";
    input.value = String(value);
    addField(label, input);
    return input;
  };
  const start = addNumber("Start BPM", initial.startBpm, MIN_TEMPO_RAMP_BPM, MAX_TEMPO_RAMP_BPM);
  const step = addNumber("Increase by BPM", initial.stepBpm, MIN_TEMPO_RAMP_STEP_BPM, MAX_TEMPO_RAMP_STEP_BPM);
  const passes = addNumber("Every N passes", initial.passesPerStep, MIN_TEMPO_RAMP_PASSES, MAX_TEMPO_RAMP_PASSES);
  const ceiling = addNumber("Ceiling BPM", initial.ceilingBpm, MIN_TEMPO_RAMP_BPM, MAX_TEMPO_RAMP_BPM);
  const ending = panel.createEl("select");
  ending.addClass("pg-confirm__number", "pg-tempo-ramp-dialog__select");
  ending.createEl("option", { value: "hold", text: "Hold and keep looping" });
  ending.createEl("option", { value: "stop", text: "Stop after final passes" });
  ending.value = initial.endBehavior;
  addField("At ceiling", ending);

  const summary = panel.createEl("p", {
    cls: "pg-tempo-ramp-dialog__summary",
    attr: { "aria-live": "polite" }
  });
  const actions = panel.createDiv({ cls: "pg-confirm__actions" });
  const cancel = actions.createEl("button", { cls: "pg-btn pg-btn--small", text: "Cancel", attr: { type: "button" } });
  const submit = actions.createEl("button", {
    cls: "pg-btn pg-btn--small pg-confirm__confirm",
    text: "Start ramp",
    attr: { type: "button" }
  });

  const readConfig = (): TempoRampConfig => {
    const targetConfig: TempoRampTarget = target.value === "whole-notation"
      ? { kind: "whole-notation" }
      : target.value === "selected-bars"
        ? { kind: "selected-bars", barIndexes: [...practiceSelection.barIndexes] }
        : { kind: "current-bar", barIndex: selectedBarIndex };
    return {
      target: targetConfig,
      startBpm: Number(start.value),
      stepBpm: Number(step.value),
      passesPerStep: Number(passes.value),
      ceilingBpm: Number(ceiling.value),
      endBehavior: ending.value === "stop" ? "stop" : "hold"
    };
  };
  const update = () => {
    const config = readConfig();
    const valid = isValidTempoRampConfigValues(config) &&
      (config.target.kind !== "selected-bars" || config.target.barIndexes.length > 0);
    submit.disabled = !valid;
    summary.setText(valid
      ? `${getTempoRampPreview(config).join(" → ")} BPM · ${config.passesPerStep} pass${config.passesPerStep === 1 ? "" : "es"} each`
      : "Enter a valid ascending tempo ladder.");
  };
  const close = () => panel.remove();
  [target, start, step, passes, ceiling, ending].forEach((control) => {
    control.addEventListener("input", update);
    control.addEventListener("change", update);
  });
  cancel.addEventListener("click", close);
  const submitTempoRamp = async (): Promise<void> => {
    const config = normalizeTempoRampConfig(readConfig(), block);
    if (!config) return;
    if (completedSummary && !completedSummaryHandled) {
      const replace = await confirmPlaygroundAction(
        "This practice summary has not been copied. Start a new tempo ramp and replace it?"
      );
      if (!replace) return;
    }
    stopPlayback();
    repetitionGoal = { ...repetitionGoal, armed: false };
    tempoRamp = { config, progress: { completedPasses: 0, completed: false }, armed: true };
    tempoRampRunMetrics = null;
    completedSummary = null;
    completedSummaryHandled = false;
    activeTempoRampPass = null;
    normalizeClickSubdivisionForCurrentSpeed(block, true);
    syncPlaybackControls(block);
    refreshPracticeStatus();
    close();
    void startArmedTempoRamp(true, true);
  };
  submit.addEventListener("click", () => {
    void submitTempoRamp();
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    } else if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement) && !submit.disabled) {
      event.preventDefault();
      submit.click();
    }
  });
  update();
  window.requestAnimationFrame(() => {
    start.focus();
    start.select();
  });
}

function renderLoopMenu(): void {
  const previouslyFocusedIndex = [
    ...loopMenu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")
  ].findIndex((item) => item === activeDocument.activeElement);
  loopMenu.empty();
  const selectedCount = practiceSelection.barIndexes.length;
  const addItem = (
    label: string,
    checked: boolean | null,
    onActivate: () => void,
    disabled = false
  ) => {
    const item = loopMenu.createEl("button", {
      cls: "pg-metronome-menu__item",
      attr: {
        type: "button",
        role: checked === null ? "menuitem" : "menuitemcheckbox",
        ...(checked === null ? {} : { "aria-checked": checked ? "true" : "false" })
      }
    });
    item.createSpan({
      cls: "pg-metronome-menu__check",
      text: checked === true ? "✓" : ""
    });
    item.createSpan({ text: label });
    item.disabled = disabled;
    item.addEventListener("click", () => {
      setLoopMenuOpen(false);
      onActivate();
    });
  };

  if (repetitionGoal.armed && repetitionGoal.config) {
    addItem(
      `Practice goal · ${formatPracticeTarget(repetitionGoal.config.target)} · ${repetitionGoal.progress.completedPasses}/${repetitionGoal.config.totalPasses}`,
      player !== null,
      () => {
        if (player) stopPlayback();
        else void startRepetitionGoal(true, true);
      }
    );
  } else if (tempoRamp.armed && tempoRamp.config) {
    addItem(`Tempo ramp · ${formatTempoRampTarget(tempoRamp.config.target)}`, player !== null, () => {
      if (player) stopPlayback();
      else void startArmedTempoRamp(true, true);
    });
  } else {
    addItem("Loop whole notation", transportMode === "loop-all", () => {
      if (transportMode === "loop-all") stopPlayback();
      else void startLoopAll(0, true);
    });
    if (selectedCount > 0) {
      addItem(`Loop selected bars (${selectedCount})`, transportMode === "loop-selection", () => {
        if (transportMode === "loop-selection") stopPlayback();
        else void startLoopSelection(undefined, true);
      });
    }
  }

  loopMenu.createDiv({ cls: "pg-metronome-menu__label", text: "Practice session" });
  addItem("Practice repetitions…", null, openRepetitionGoalDialog);
  if (repetitionGoal.config) addItem("Reset practice goal", null, () => {
    void resetRepetitionGoal();
  });
  if (repetitionGoal.runMetrics && !repetitionGoal.progress.completed) {
    addItem("Finish session", null, finishRepetitionGoalEarly);
  }
  if (tempoRampRunMetrics && tempoRamp.armed && !tempoRamp.progress.completed) {
    addItem("Finish tempo-ramp session", null, finishTempoRampSessionEarly);
  }
  if (completedSummary) addItem("View practice summary", null, openPracticeSummaryDialog);

  loopMenu.createDiv({ cls: "pg-metronome-menu__label", text: "Practice selection" });
  addItem(selectionModeOpen ? "Done selecting" : "Select bars", selectionModeOpen, () => {
    setSelectionModeOpen(!selectionModeOpen);
  });
  addItem("Clear selection", null, clearPracticeSelection, selectedCount === 0);

  if (previouslyFocusedIndex >= 0) {
    const items = [...loopMenu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    items[Math.min(previouslyFocusedIndex, items.length - 1)]?.focus();
  }
}

function setLoopMenuOpen(open: boolean): void {
  loopMenu.hidden = !open;
  loopAllBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    setSpeedMenuOpen(false);
    setMetronomeMenuOpen(false);
    setMuteMenuOpen(false);
    renderLoopMenu();
    const focusFirstItem = () => {
      if (!loopMenu.hidden && !loopMenu.contains(activeDocument.activeElement)) {
        loopMenu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      }
    };
    focusFirstItem();
    window.requestAnimationFrame(focusFirstItem);
  }
}

function getSelectedGridResolution(): GridResolution {
  return Number(gridSelect.value) === 32 ? 32 : 16;
}

function getSelectedLegendMode(): LegendMode {
  const value = legendSelect.value;

  if (value === "all" || value === "used") {
    return value;
  }

  return "off";
}

function syncMetronomeButton(): void {
  const description = [
    `Metronome: ${getMetronomeModeLabel(metronomeMode)}`,
    `Subdivision: ${getClickSubdivisionLabel(clickSubdivision)}`,
    `Gap click: ${getGapClickModeLabel(gapClickMode)}`,
    `Count-in: ${getCountInModeLabel(countInMode)}`,
    `Count-in timing: ${countInCadence === "every-pass" ? "Before every pass" : "Once at start"}`
  ].join(" · ");

  metronomeBtn.replaceChildren(createIconSvg("timer"));
  const badgeText = `${clickSubdivision === "beat" ? "" : getClickSubdivisionFactor(clickSubdivision)}${gapClickMode === "off" ? "" : "G"}`;
  if (badgeText) {
    metronomeBtn.createSpan({
      cls: "drum-notation__click-badge",
      text: badgeText,
      attr: { "aria-hidden": "true" }
    });
  }
  metronomeBtn.classList.toggle("is-active", metronomeMode !== "off" || countInMode !== "off");
  metronomeBtn.classList.toggle("is-metronome-off", metronomeMode === "off");
  metronomeBtn.title = description;
  metronomeBtn.setAttribute("aria-label", description);
}

function renderMetronomeMenu(): void {
  metronomeMenu.empty();

  metronomeMenu.createDiv({ cls: "pg-metronome-menu__label", text: "Metronome" });

  METRONOME_MODE_OPTIONS.forEach((option) => {
    const item = metronomeMenu.createEl("button", {
      cls: "pg-metronome-menu__item",
      attr: {
        type: "button",
        role: "menuitemradio",
        "aria-label": option.label,
        "aria-checked": metronomeMode === option.value ? "true" : "false"
      }
    });

    item.createSpan({
      cls: "pg-metronome-menu__check",
      text: metronomeMode === option.value ? "✓" : ""
    });
    item.createSpan({ text: option.label });
    item.addEventListener("click", () => {
      const block = currentBlock;
      if (!block) {
        return;
      }

      metronomeMode = option.value;
      syncPlaybackControls(block);
      renderGapOverlays();
      refreshPracticeStatus();
      setMetronomeMenuOpen(false);
      void restartPlaybackForControlChange();
    });
  });

  metronomeMenu.createDiv({ cls: "pg-metronome-menu__label", text: "Click subdivision" });

  CLICK_SUBDIVISION_OPTIONS.forEach((option) => {
    const block = currentBlock;
    const effectiveTempo = block ? getCurrentEffectiveTempo(block) : 0;
    const safe = block
      ? tempoRamp.armed || exactTempoBpm !== null
        ? isClickSubdivisionSafeAtTempo(block, effectiveTempo, option.value)
        : isClickSubdivisionSafe(block, playbackSpeedPercent, option.value)
      : option.value === "beat";
    const label = block ? getClickSubdivisionMenuLabel(block, option.value) : option.label;
    const item = metronomeMenu.createEl("button", {
      cls: "pg-metronome-menu__item",
      attr: {
        type: "button",
        role: "menuitemradio",
        "aria-label": safe ? label : `${label} (unavailable at ${formatTempo(effectiveTempo)} BPM)`,
        "aria-checked": clickSubdivision === option.value ? "true" : "false"
      }
    });
    item.disabled = !safe;
    item.createSpan({
      cls: "pg-metronome-menu__check",
      text: clickSubdivision === option.value ? "✓" : ""
    });
    item.createSpan({ text: safe ? label : `${label} · unavailable at ${formatTempo(effectiveTempo)} BPM` });
    item.addEventListener("click", () => {
      if (!currentBlock) return;
      advancedClickWarning = null;
      clickSubdivision = option.value;
      syncPlaybackControls(currentBlock);
      refreshPracticeStatus();
      setMetronomeMenuOpen(false);
      void restartPlaybackForControlChange();
    });
  });

  metronomeMenu.createDiv({ cls: "pg-metronome-menu__label", text: "Gap click" });

  GAP_CLICK_MODE_OPTIONS.forEach((option) => {
    const item = metronomeMenu.createEl("button", {
      cls: "pg-metronome-menu__item",
      attr: {
        type: "button",
        role: "menuitemradio",
        "aria-label": option.label,
        "aria-checked": gapClickMode === option.value ? "true" : "false"
      }
    });
    item.createSpan({
      cls: "pg-metronome-menu__check",
      text: gapClickMode === option.value ? "✓" : ""
    });
    item.createSpan({ text: option.label });
    item.addEventListener("click", () => {
      if (!currentBlock) return;
      gapClickMode = option.value;
      syncPlaybackControls(currentBlock);
      renderGapOverlays();
      refreshPracticeStatus();
      setMetronomeMenuOpen(false);
      void restartPlaybackForControlChange();
    });
  });

  metronomeMenu.createDiv({ cls: "pg-metronome-menu__label", text: "Count-in" });

  COUNT_IN_MODE_OPTIONS.forEach((option) => {
    const item = metronomeMenu.createEl("button", {
      cls: "pg-metronome-menu__item",
      attr: {
        type: "button",
        role: "menuitemradio",
        "aria-label": `Count-in: ${option.label}`,
        "aria-checked": countInMode === option.value ? "true" : "false"
      }
    });

    item.createSpan({
      cls: "pg-metronome-menu__check",
      text: countInMode === option.value ? "✓" : ""
    });
    item.createSpan({ text: option.label });
    item.addEventListener("click", () => {
      const block = currentBlock;
      if (!block) {
        return;
      }

      countInMode = option.value;
      syncPlaybackControls(block);
      setMetronomeMenuOpen(false);
      void restartPlaybackForControlChange();
    });
  });

  metronomeMenu.createDiv({ cls: "pg-metronome-menu__label", text: "Count-in timing" });
  ([
    ["transport-start", "Once at start"],
    ["every-pass", "Before every pass"]
  ] as const).forEach(([value, label]) => {
    const item = metronomeMenu.createEl("button", {
      cls: "pg-metronome-menu__item",
      attr: {
        type: "button",
        role: "menuitemradio",
        "aria-checked": countInCadence === value ? "true" : "false"
      }
    });
    item.createSpan({
      cls: "pg-metronome-menu__check",
      text: countInCadence === value ? "✓" : ""
    });
    item.createSpan({ text: label });
    item.addEventListener("click", () => {
      countInCadence = value;
      if (currentBlock) syncPlaybackControls(currentBlock);
      setMetronomeMenuOpen(false);
      void restartPlaybackForControlChange();
    });
  });

  const wakeLockSupported = isScreenWakeLockSupported(activeDocument);
  metronomeMenu.createDiv({ cls: "pg-metronome-menu__label", text: "Playback" });
  const wakeLockItem = metronomeMenu.createEl("button", {
    cls: "pg-metronome-menu__item",
    attr: {
      type: "button",
      role: "menuitemcheckbox",
      "aria-label": wakeLockSupported
        ? "Keep screen awake"
        : "Keep screen awake (unavailable)",
      "aria-checked": keepScreenAwakeDuringPlayback ? "true" : "false"
    }
  });
  wakeLockItem.disabled = !wakeLockSupported;
  wakeLockItem.createSpan({
    cls: "pg-metronome-menu__check",
    text: keepScreenAwakeDuringPlayback ? "✓" : ""
  });
  wakeLockItem.createSpan({
    text: wakeLockSupported ? "Keep screen awake" : "Keep screen awake (unavailable)"
  });
  wakeLockItem.addEventListener("click", () => {
    keepScreenAwakeDuringPlayback = !keepScreenAwakeDuringPlayback;
    void screenWakeLock.setEnabled(keepScreenAwakeDuringPlayback);
    setMetronomeMenuOpen(false);
  });
}

function setMetronomeMenuOpen(open: boolean): void {
  metronomeMenu.hidden = !open;
  metronomeBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    setSpeedMenuOpen(false);
    setLoopMenuOpen(false);
    setMuteMenuOpen(false);
    renderMetronomeMenu();
  }
}

function syncMuteButton(): void {
  const icon = mutedInstrumentIds.size > 0 ? "volume-x" : "volume-2";
  const label =
    mutedInstrumentIds.size > 0
      ? `Mute (${mutedInstrumentIds.size})`
      : "Mute";
  const description =
    mutedInstrumentIds.size > 0
      ? `${mutedInstrumentIds.size} muted instrument${mutedInstrumentIds.size === 1 ? "" : "s"}`
      : "Mute instruments";

  const labelEl = muteBtn.createSpan();
  labelEl.addClass("pg-btn__label");
  labelEl.textContent = label;
  muteBtn.replaceChildren(createIconSvg(icon), labelEl);
  muteBtn.title = description;
  muteBtn.setAttribute("aria-label", description);
}

function renderMuteMenu(): void {
  muteMenu.empty();

  if (!currentBlock) {
    return;
  }

  getPlaybackInstruments(currentBlock).forEach((instrument) => {
    const item = muteMenu.createEl("button", {
      cls: "pg-mute-menu__item",
      attr: {
        type: "button",
        role: "menuitemcheckbox",
        "aria-label": instrument.label,
        "aria-checked": mutedInstrumentIds.has(instrument.id) ? "true" : "false"
      }
    });
    item.createSpan({
      cls: "pg-mute-menu__check",
      text: mutedInstrumentIds.has(instrument.id) ? "✓" : ""
    });
    item.createSpan({ text: instrument.label });
    item.addEventListener("click", () => {
      const block = currentBlock;
      if (!block) {
        return;
      }

      if (mutedInstrumentIds.has(instrument.id)) {
        mutedInstrumentIds.delete(instrument.id);
      } else {
        mutedInstrumentIds.add(instrument.id);
      }
      syncPlaybackControls(block);
      void restartPlaybackForControlChange();
    });
  });

  const reset = muteMenu.createEl("button", {
    cls: "pg-mute-menu__item pg-mute-menu__reset",
    text: "Unmute all",
    attr: { type: "button", role: "menuitem" }
  });
  reset.disabled = mutedInstrumentIds.size === 0;
  reset.addEventListener("click", () => {
    const block = currentBlock;
    if (!block) {
      return;
    }

    mutedInstrumentIds.clear();
    syncPlaybackControls(block);
    void restartPlaybackForControlChange();
  });
}

function setMuteMenuOpen(open: boolean): void {
  muteMenu.hidden = !open;
  muteBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    setSpeedMenuOpen(false);
    setLoopMenuOpen(false);
    setMetronomeMenuOpen(false);
    renderMuteMenu();
  }
}

function formatTempo(tempo: number): string {
  const rounded = Math.round(tempo);
  return Math.abs(tempo - rounded) < 1e-9 ? String(rounded) : tempo.toFixed(1);
}

async function previewSlot(block: DrumBlock, slot: DrumSlot): Promise<void> {
  stopPreview();
  if (slot.hits.length === 0) {
    return;
  }

  const synth = createPlaybackBackend(getAudioContext());
  previewSynth = synth;
  await synth.start();
  if (previewSynth !== synth) {
    synth.stop();
    return;
  }

  flashPreviewLegendHighlight(block, slot);

  synth.scheduleHits(
    slot.hits,
    synth.currentTime + 0.03,
    getSecondsPerSlot(block),
    getSlotVisualDurationSeconds(block, slot)
  );
  previewTimer = window.setTimeout(stopPreview, 950);
}

function stopPreview(): void {
  if (previewTimer !== null) {
    window.clearTimeout(previewTimer);
    previewTimer = null;
  }
  previewSynth?.stop();
  previewSynth = null;
  clearPreviewLegendHighlight();
}

/* ---------- toolbar controls ---------- */
function syncControls(block: DrumBlock): void {
  const [beats, beatValue] = block.timeSignature.split("/");

  titleInput.value = getTitle(block);
  tempoInput.value = String(block.tempo);
  timeTopInput.value = beats || "4";
  timeBottomInput.value = beatValue || "4";
  const hasSystemOverrides = hasSystemRhythmOverrides(block);
  timeTopInput.disabled = hasSystemOverrides;
  timeBottomInput.disabled = hasSystemOverrides;
  const timeControlDescription = hasSystemOverrides
    ? "Edit system-level Time declarations in the notation text."
    : "Time signature";
  timeTopInput.title = timeControlDescription;
  timeBottomInput.title = timeControlDescription;
  gridSelect.value = String(block.gridResolution);
  repeatInput.value = String(block.repeatCount);
  legendSelect.value = block.legendMode;
  syncExampleSelection(editor.value);
}

// Toolbar and grid edits go through the pure edit helpers where possible, then
// rewrite the editor in authoring form. The core serializer still owns the
// deterministic normalized form used in diagnostics.
function applyEditedBlock(next: DrumBlock): void {
  recordVerificationUndo();
  markVerificationNeedsChanges();
  dismissManualCopyText();
  editor.value = serializeDrumBlock(next, { mode: "authoring" });
  persist();
  renderPreview();
}

function applyGridEditedBlock(next: DrumBlock, changedSlotIndex?: number, nextSelectedBarIndex?: number): void {
  const restartPlayback = capturePlaybackRestart();
  recordVerificationUndo();
  markVerificationNeedsChanges();
  dismissManualCopyText();
  gridEditorMessage = null;

  if (nextSelectedBarIndex !== undefined) {
    selectedBarIndex = clampBarIndex(next, nextSelectedBarIndex);
  } else if (changedSlotIndex !== undefined) {
    selectedBarIndex = barIndexForSlot(next, changedSlotIndex);
  }

  editor.value = serializeDrumBlock(next, { mode: "authoring" });
  persist();
  isApplyingGridEdit = true;
  try {
    renderPreview();
  } finally {
    isApplyingGridEdit = false;
  }

  restartPlayback(selectedBarIndex);

  if (changedSlotIndex === undefined || !currentBlock) {
    return;
  }

  selectEditSlot(changedSlotIndex);
  const slot = currentBlock.slots.find((candidate) => candidate.index === changedSlotIndex);

  if (slot && player === null) {
    void previewSlot(currentBlock, slot);
  }
}

function withTitle(block: DrumBlock, title: string): DrumBlock {
  const normalizedTitle = title.trim() || "Drum notation";
  const metadata = block.metadata.filter((line) => {
    const divider = line.indexOf(":");

    return divider <= 0 || normalizeLabel(line.slice(0, divider)) !== "title";
  });

  return { ...block, metadata: [`Title: ${normalizedTitle}`, ...metadata] };
}

/* ---------- edit mode (grid editor) ---------- */
function enterEditMode(): void {
  if (gridEditor || !currentBlock || currentBlock.slots.length === 0) {
    return;
  }
  if (currentBlock.containsTupletSyntax) {
    gridEditorMessage =
      "Visual editing is not available for notation with tuplets. Edit the notation text directly.";
    renderNotes(currentBlock, editor.value);
    return;
  }
  if (hasSystemRhythmOverrides(currentBlock)) {
    gridEditorMessage =
      "Visual editing is not yet available for notation with system-level Time or Grouping changes. Edit the notation text directly.";
    renderNotes(currentBlock, editor.value);
    return;
  }
  if (selectionModeOpen) {
    selectionModeOpen = false;
    renderPreview();
  }
  stopPlayback();
  stopPreview();
  selectedBarIndex = barIndexForSlot(currentBlock, currentSlotIndex);
  selectEditSlot(null);
  activeDocument.body.classList.add("pg-editing");
  editBtn.classList.add("is-playing");
  editRoot.hidden = false;

  gridEditor = mountGridEditor({
    container: editRoot,
    block: currentBlock,
    initialBarIndex: selectedBarIndex,
    onChange: applyGridEditedBlock,
    onPreview: (block, slotIndex) => {
      const slot = block.slots.find((candidate) => candidate.index === slotIndex);
      if (slot) {
        selectEditSlot(slotIndex);
        void previewSlot(block, slot);
      }
    },
    onSelectBar: (barIndex) => selectBar(barIndex, false),
    confirmAction: confirmPlaygroundAction,
    requestRepeatAction: requestPlaygroundRepeatAction,
    notifyAction: (message) => {
      gridEditorMessage = message;
      if (currentBlock) {
        renderNotes(currentBlock, editor.value);
      }
    },
    barClipboard,
    writeClipboardText
  });

  if (scoreEl) {
    renderBarSelectors(currentBlock, scoreEl);
  }
}

function exitEditMode(): void {
  gridEditor?.destroy();
  gridEditor = null;
  selectEditSlot(null);
  clearBarSelectors();
  activeDocument.body.classList.remove("pg-editing");
  editBtn.classList.remove("is-playing");
  editRoot.hidden = true;
  renderPreview();
}

/* ---------- diagnostics ---------- */
function updateDiagnostics(block: DrumBlock, raw: string): void {
  const timeSequence = getTimeSignatureSequence(block);
  const rows: Array<[string, string]> = [
    ["title", getTitle(block)],
    ["tempo", `${block.tempo} BPM`],
    ["time", timeSequence.join(" → ")],
    ["grid", `1/${block.gridResolution}`],
    ["systems", String(block.systems.length)],
    ["bars", String(block.bars.length)],
    ["rows", String(block.rows.length)],
    [block.containsTupletSyntax ? "rhythmic positions" : "slots", String(block.slots.length)],
    ["repeat", `${block.repeatCount}×`],
    ["metadata", `${block.metadata.length} line(s)`]
  ];
  modelOut.replaceChildren();
  const dl = modelOut.createEl("dl", { cls: "pg-model-grid" });
  for (const [key, value] of rows) {
    dl.createEl("dt", { text: key });
    dl.createEl("dd", { text: value });
  }

  const normalized = serializeDrumBlock(block);
  normalizedOut.textContent = normalized;
  const matches = normalized.trim() === raw.trim();
  normalizedFlag.textContent = matches ? "matches input" : "normalized ≠ input";
  normalizedFlag.className = matches ? "pg-flag" : "pg-flag pg-flag--normalized";

  renderNotes(block, raw);
}

function renderNotes(block: DrumBlock, raw: string): void {
  notesOut.replaceChildren();
  let any = false;

  if (lastRenderError) {
    notesOut.createEl("p", { cls: "pg-note pg-note--error", text: `render error: ${lastRenderError}` });
    any = true;
  }

  if (audioRecoveryWarning) {
    notesOut.createEl("p", { cls: "pg-note pg-note--warn", text: audioRecoveryWarning });
    any = true;
  }

  if (screenWakeLockWarning) {
    notesOut.createEl("p", { cls: "pg-note pg-note--warn", text: screenWakeLockWarning });
    any = true;
  }

  if (advancedClickWarning) {
    notesOut.createEl("p", { cls: "pg-note pg-note--warn", text: advancedClickWarning });
    any = true;
  }

  if (gridEditorMessage) {
    notesOut.createEl("p", { cls: "pg-note pg-note--warn", text: gridEditorMessage });
    any = true;
  }

  for (const warning of currentParseWarnings) {
    notesOut.createEl("p", {
      cls: "pg-note pg-note--warn",
      text: formatParseWarning(warning)
    });
    any = true;
  }

  if (block.rows.length === 0) {
    notesOut.createEl("p", { cls: "pg-note pg-note--warn", text: "no drum rows parsed yet" });
    any = true;
  }

  notesOut.hidden = !any;
}

function formatParseWarning(warning: ParseWarning): string {
  const location = warning.column !== undefined ? `line ${warning.line}, column ${warning.column}` : `line ${warning.line}`;

  return `${location}: ${warning.message}`;
}

/* ---------- agent-result verification ---------- */
function getVerificationPanelMaxHeight(): number {
  return Math.max(0, Math.round(activeDocument.documentElement.clientHeight * VERIFY_PANEL_MAX_VIEWPORT_RATIO));
}

function updateVerificationResizerAccessibility(): void {
  const height = Math.round(verifyPanel.getBoundingClientRect().height);
  const maxHeight = getVerificationPanelMaxHeight();
  verifyResizer.setAttribute("aria-valuemin", "0");
  verifyResizer.setAttribute("aria-valuemax", String(maxHeight));
  verifyResizer.setAttribute("aria-valuenow", String(height));
  verifyResizer.setAttribute(
    "aria-valuetext",
    height === 0 ? "Verification controls collapsed" : `Verification controls ${height} pixels high`
  );
}

function reconcileVerificationPanelHeight(): void {
  const boundedHeight = verificationPanelRequestedHeight === null
    ? null
    : Math.max(0, Math.min(getVerificationPanelMaxHeight(), verificationPanelRequestedHeight));
  const value = boundedHeight === null ? "auto" : `${boundedHeight}px`;

  if (activeDocument.body.style.getPropertyValue("--pg-verify-panel-height") !== value) {
    activeDocument.body.setCssProps({ "--pg-verify-panel-height": value });
  }
  verifyPanel.classList.toggle("is-collapsed", boundedHeight === 0);
  updateVerificationResizerAccessibility();
}

function setVerificationPanelHeight(height: number | null): void {
  verificationPanelRequestedHeight = height === null
    ? null
    : Math.max(0, Math.min(getVerificationPanelMaxHeight(), Math.round(height)));
  reconcileVerificationPanelHeight();
}

function setVerificationWorkspaceMaximized(maximized: boolean): void {
  activeDocument.body.classList.toggle("pg-verify-workspace-maximized", maximized);
  toggleVerifyWorkspaceBtn.textContent = maximized ? "Restore" : "Full screen";
  toggleVerifyWorkspaceBtn.setAttribute("aria-pressed", String(maximized));
  toggleVerifyWorkspaceBtn.title = maximized ? "Restore verification controls" : "Expand comparison workspace to full screen";
  verifyResizer.tabIndex = maximized ? -1 : 0;
}

function resizeVerificationPanelFromPointer(clientY: number): void {
  const panelTop = verifyPanel.getBoundingClientRect().top;
  setVerificationPanelHeight(clientY - verifyResizePointerOffset - panelTop);
}

function finishVerificationPanelResize(pointerId: number): void {
  if (verifyResizePointerId !== pointerId) {
    return;
  }
  if (verifyResizer.hasPointerCapture(pointerId)) {
    verifyResizer.releasePointerCapture(pointerId);
  }
  verifyResizePointerId = null;
  verifyResizePointerOffset = 0;
}

function appendReportMessageGroup(title: string, messages: ImportReportMessage[], tone: "warning" | "ambiguity"): void {
  const group = reportDetailsContent.createDiv({ cls: `pg-report-group pg-report-group--${tone}` });
  group.createEl("h3", { text: title });
  const list = group.createEl("ul");
  for (const entry of messages) {
    const item = list.createEl("li");
    item.createEl("code", { text: entry.code });
    item.createSpan({ text: entry.message });
  }
}

function appendReportWorkaroundGroup(workarounds: ImportReportWorkaround[]): void {
  const group = reportDetailsContent.createDiv({ cls: "pg-report-group pg-report-group--workaround" });
  group.createEl("h3", { text: "Workarounds" });
  const list = group.createEl("ul");
  for (const workaround of workarounds) {
    const item = list.createEl("li");
    item.createSpan({
      cls: `pg-report-loss pg-report-loss--${workaround.loss}`,
      text: workaround.loss
    });
    const description = item.createSpan();
    description.createEl("strong", { text: workaround.feature });
    description.append(` — ${workaround.action}`);
  }
}

function renderVerificationReportDetails(
  localWarnings: ParseWarning[],
  reportSegment: ImportReportSegment | undefined,
  reportStale: boolean
): void {
  reportDetailsContent.replaceChildren();
  let detailCount = 0;

  reportOrigin.hidden = !reportSegment;
  reportOrigin.textContent = reportSegment
    ? reportStale
      ? "Original agent report · may not match current edits"
      : "Original agent report"
    : "";
  reportOrigin.classList.toggle("is-stale", reportStale);

  if (localWarnings.length > 0) {
    appendReportMessageGroup("Local parser warnings", localWarnings.map((warning) => ({
      code: warning.code,
      message: formatParseWarning(warning)
    })), "warning");
    detailCount += localWarnings.length;
  }

  if (reportSegment?.issues.length) {
    appendReportMessageGroup("Agent observations", reportSegment.issues, "warning");
    detailCount += reportSegment.issues.length;
  }

  if (reportSegment?.ambiguities.length) {
    appendReportMessageGroup("Ambiguities", reportSegment.ambiguities, "ambiguity");
    detailCount += reportSegment.ambiguities.length;
  }

  if (reportSegment?.workarounds.length) {
    appendReportWorkaroundGroup(reportSegment.workarounds);
    detailCount += reportSegment.workarounds.length;
  }

  if (reportSegment?.validationStatus === "warnings" &&
      reportSegment.issues.length === 0 &&
      reportSegment.ambiguities.length === 0 &&
      reportSegment.workarounds.length === 0) {
    appendReportMessageGroup("Agent observations", [{
      code: "warning-details-missing",
      message: "The agent reported validation warnings but supplied no issue, ambiguity, or workaround details."
    }], "warning");
    detailCount += 1;
  }

  reportDetailsCount.textContent = detailCount === 1 ? "1 item" : `${detailCount} items`;
  reportDetails.hidden = detailCount === 0 && !reportStale;
}

function setVerificationMessage(message: string, error = false): void {
  verificationMessage.textContent = message;
  verificationMessage.classList.toggle("is-error", error);
}

function saveCurrentVerificationText(): void {
  const segment = verificationSegments[selectedVerificationSegment];
  if (verificationActive && segment) {
    segment.edited = editor.value;
  }
}

function updateVerificationUndoButton(): void {
  verificationUndoBtn.disabled = !verificationActive || verificationUndoStack.length === 0;
}

function recordVerificationUndo(): void {
  if (!verificationActive || selectedVerificationSegment < 0) {
    return;
  }
  if (verificationUndoStack[verificationUndoStack.length - 1] !== editor.value) {
    verificationUndoStack.push(editor.value);
    if (verificationUndoStack.length > 50) {
      verificationUndoStack.shift();
    }
  }
  updateVerificationUndoButton();
}

function markVerificationNeedsChanges(): void {
  if (!verificationActive || selectedVerificationSegment < 0) {
    return;
  }
  const segment = verificationSegments[selectedVerificationSegment];
  if (segment) {
    segment.humanReview = "needs-changes";
    humanReviewSelect.value = "needs-changes";
  }
}

function notationComparisonValue(text: string, validation = validateDrumNotation(text)): string {
  return validation.status === "invalid"
    ? text.replace(/\r\n?/g, "\n").trim()
    : serializeDrumBlock(parseDrumBlock(validation.normalized), { mode: "authoring" });
}

function renderSegmentTabs(): void {
  segmentTabs.replaceChildren();
  verificationSegments.forEach((segment, index) => {
    const reportSegment = verificationReport?.segments.find((candidate) => candidate.blockIndex === index);
    const button = segmentTabs.createEl("button", {
      cls: `pg-segment-tab${index === selectedVerificationSegment ? " is-active" : ""}`,
      text: reportSegment?.title?.trim() || `Segment ${index + 1}`,
      attr: {
        type: "button",
        role: "tab",
        "aria-selected": index === selectedVerificationSegment ? "true" : "false"
      }
    });
    button.addEventListener("click", () => selectVerificationSegment(index));
    button.title = segment.source.slice(0, 120);
  });
}

function selectVerificationSegment(index: number): void {
  if (index < 0 || index >= verificationSegments.length) {
    return;
  }
  stopPlayback();
  exitEditMode();
  saveCurrentVerificationText();
  selectedVerificationSegment = index;
  verificationUndoStack = [];
  editor.value = verificationSegments[index].edited;
  humanReviewSelect.value = verificationSegments[index].humanReview;
  renderSegmentTabs();
  renderPreview();
  updateVerificationUndoButton();
}

function renderVerificationSignals(): void {
  if (!verificationActive || selectedVerificationSegment < 0) {
    signalParser.textContent = "Waiting for a segment";
    signalReport.textContent = verificationReportState === "malformed" ? "Malformed" : "Not supplied";
    signalAgent.textContent = "Unavailable";
    signalCore.textContent = "Unavailable";
    reportDetailsContent.replaceChildren();
    reportOrigin.textContent = "";
    reportOrigin.hidden = true;
    reportOrigin.classList.remove("is-stale");
    reportDetailsCount.textContent = "";
    reportDetails.hidden = true;
    saveVerifiedBtn.disabled = true;
    return;
  }

  const local = validateDrumNotation(editor.value);
  signalParser.textContent = local.status === "clean"
    ? "Valid · clean"
    : local.status === "warnings"
      ? `Valid · ${local.warnings.length} warning${local.warnings.length === 1 ? "" : "s"}`
      : `Invalid · ${local.errors.join(" ")}`;
  signalReport.textContent = verificationReportState === "valid"
    ? "Schema v1 valid"
    : verificationReportState === "malformed"
      ? "Malformed · ignored"
      : "Not supplied";

  const activeSegment = verificationSegments[selectedVerificationSegment];
  const reportSegment = verificationReport?.segments.find((segment) => segment.blockIndex === selectedVerificationSegment);
  const reportStale = Boolean(reportSegment) &&
    notationComparisonValue(editor.value, local) !== notationComparisonValue(activeSegment.reportBaseline);
  renderVerificationReportDetails(local.warnings, reportSegment, reportStale);
  if (!reportSegment) {
    signalAgent.textContent = "Unavailable";
  } else if (reportSegment.validationStatus === "unavailable") {
    signalAgent.textContent = reportStale
      ? "Validation unavailable · original result; current notation edited"
      : "Validation unavailable";
  } else if (reportStale) {
    signalAgent.textContent = `${reportSegment.validationStatus} · original result; current notation edited`;
  } else {
    const agrees = reportSegment.validationStatus === local.status;
    signalAgent.textContent = `${reportSegment.validationStatus}${agrees ? " · agrees" : " · differs locally"}`;
  }

  const compatibility = compareReportCore(verificationReport, __NOTATION_CORE_VERSION__, __NOTATION_CORE_DIGEST__);
  if (compatibility === "unavailable") {
    signalCore.textContent = `Page ${__NOTATION_CORE_VERSION__} · report unavailable`;
  } else if (compatibility === "same") {
    signalCore.textContent = `Compatible · ${__NOTATION_CORE_VERSION__}`;
  } else {
    signalCore.textContent = `Transcribed against notation core ${verificationReport?.notationCoreVersion}; this page validates against ${__NOTATION_CORE_VERSION__}.`;
  }

  humanReviewSelect.value = activeSegment.humanReview;
  saveVerifiedBtn.disabled = local.status === "invalid";
}

function enterVerificationMode(): void {
  if (verificationActive) {
    return;
  }
  playgroundDraftSnapshot = editor.value;
  verificationActive = true;
  activeDocument.body.classList.add("pg-verifying");
  verifyPanel.hidden = false;
  verifyDivider.hidden = false;
  sourcePane.hidden = false;
  playgroundModeBtn.classList.remove("is-active");
  playgroundModeBtn.setAttribute("aria-pressed", "false");
  verifyModeBtn.classList.add("is-active");
  verifyModeBtn.setAttribute("aria-pressed", "true");
  exampleSelect.disabled = true;
  reconcileVerificationPanelHeight();
  renderSegmentTabs();
  renderVerificationSignals();
}

function exitVerificationModeToDraft(): void {
  if (!verificationActive) {
    return;
  }
  saveCurrentVerificationText();
  stopPlayback();
  exitEditMode();
  verificationActive = false;
  clearPendingUnfencedRecovery();
  setVerificationWorkspaceMaximized(false);
  activeDocument.body.classList.remove("pg-verifying");
  verifyPanel.hidden = true;
  verifyDivider.hidden = true;
  sourcePane.hidden = true;
  playgroundModeBtn.classList.add("is-active");
  playgroundModeBtn.setAttribute("aria-pressed", "true");
  verifyModeBtn.classList.remove("is-active");
  verifyModeBtn.setAttribute("aria-pressed", "false");
  exampleSelect.disabled = false;
  editor.value = playgroundDraftSnapshot;
  verificationUndoStack = [];
  renderPreview();
  updateVerificationUndoButton();
}

function clearPendingUnfencedRecovery(): void {
  pendingUnfencedResponse = null;
  unfencedRecovery.hidden = true;
}

function applyVerificationExtraction(
  extracted: ExtractedAgentResponse,
  segments: readonly ExtractedImportSegment[],
  responseErrors: readonly string[]
): void {
  verificationReport = extracted.report;
  verificationReportState = extracted.reportState;
  verificationResponseErrors = [...responseErrors];
  verificationSegments = segments.map((segment) => ({
    source: segment.source,
    edited: segment.source,
    reportBaseline: segment.validation.status === "invalid"
      ? segment.source.replace(/\r\n?/g, "\n").trim()
      : segment.validation.normalized,
    humanReview: "unreviewed"
  }));

  if (verificationSegments.length === 0) {
    selectedVerificationSegment = -1;
    renderSegmentTabs();
    renderVerificationSignals();
    setVerificationMessage(verificationResponseErrors.join(" ") || "No usable notation segments found.", true);
    return;
  }

  const suffix = verificationResponseErrors.length > 0 ? ` ${verificationResponseErrors.join(" ")}` : "";
  setVerificationMessage(
    `Extracted ${verificationSegments.length} segment${verificationSegments.length === 1 ? "" : "s"}. Source, report, and review state remain ephemeral.${suffix}`,
    verificationResponseErrors.length > 0
  );
  selectVerificationSegment(0);
}

function extractVerificationResponse(): void {
  enterVerificationMode();
  clearPendingUnfencedRecovery();
  const response = agentResponseInput.value;
  const extracted = extractAgentResponse(response);

  if (extracted.segments.length === 0 && extracted.unfencedCandidate) {
    verificationReport = extracted.report;
    verificationReportState = extracted.reportState;
    verificationResponseErrors = extracted.errors;
    verificationSegments = [];
    selectedVerificationSegment = -1;
    pendingUnfencedResponse = response;
    unfencedRecovery.hidden = false;
    renderSegmentTabs();
    renderVerificationSignals();
    setVerificationMessage(
      "No fenced drums block was found. The complete contents of the box—including any surrounding text—can be treated as one notation block."
    );
    acceptUnfencedBtn.focus();
    return;
  }

  applyVerificationExtraction(extracted, extracted.segments, extracted.errors);
}

function acceptUnfencedVerificationResponse(): void {
  const response = agentResponseInput.value;
  const extracted = extractAgentResponse(response);
  const candidate = extracted.unfencedCandidate;

  if (pendingUnfencedResponse === null || response !== pendingUnfencedResponse || !candidate || extracted.segments.length > 0) {
    clearPendingUnfencedRecovery();
    setVerificationMessage("The pasted text changed or no longer validates. Select Extract and verify again.", true);
    return;
  }

  clearPendingUnfencedRecovery();
  applyVerificationExtraction(extracted, [candidate], []);
  setVerificationMessage(
    "Treated the complete pasted text as one drums block. Source, report, and review state remain ephemeral."
  );
}

function setCropStatus(message: string, error = false): void {
  cropStatus.textContent = message;
  cropStatus.classList.toggle("is-error", error);
}

function clearFocusedCropResult(): void {
  if (focusedCropObjectUrl) {
    URL.revokeObjectURL(focusedCropObjectUrl);
    focusedCropObjectUrl = null;
  }
  focusedCropBlob = null;
  cropPreview.removeAttribute("src");
  cropResult.hidden = true;
}

function resetFocusedCropSelection(): void {
  clearFocusedCropResult();
  focusedCropSourceRect = null;
  cropDragStart = null;
  cropDragPointerId = null;
  cropSelection.hidden = true;
  generateCropBtn.disabled = true;
}

function closeFocusedCropDialog(): void {
  resetFocusedCropSelection();
  cropSource.removeAttribute("src");
  if (cropDialog.open) {
    cropDialog.close();
  }
}

function openFocusedCropDialog(): void {
  if (!sourceObjectUrl || sourceImage.hidden || sourceImage.naturalWidth <= 0 || sourceImage.naturalHeight <= 0) {
    setVerificationMessage("Load a source image before creating a focused crop.", true);
    return;
  }

  resetFocusedCropSelection();
  cropSource.src = sourceObjectUrl;
  setCropStatus("Drag on the image to select a focused region.");
  cropDialog.showModal();
}

function cropStagePoint(event: PointerEvent): CropPoint {
  const bounds = cropStage.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function cropStageSize(): { width: number; height: number } {
  const bounds = cropStage.getBoundingClientRect();
  return { width: bounds.width, height: bounds.height };
}

function cropImageSize(): { width: number; height: number } {
  return { width: cropSource.naturalWidth, height: cropSource.naturalHeight };
}

function renderCropSelection(start: CropPoint, end: CropPoint): void {
  const displayRect = getClampedDisplaySelection(start, end, cropStageSize(), cropImageSize());
  if (!displayRect) {
    cropSelection.hidden = true;
    return;
  }

  cropSelection.setCssProps({
    left: `${displayRect.x}px`,
    top: `${displayRect.y}px`,
    width: `${displayRect.width}px`,
    height: `${displayRect.height}px`
  });
  cropSelection.hidden = false;
}

function finishCropSelection(end: CropPoint): void {
  if (!cropDragStart) {
    return;
  }

  renderCropSelection(cropDragStart, end);
  focusedCropSourceRect = mapDisplaySelectionToSource(cropDragStart, end, cropStageSize(), cropImageSize());
  generateCropBtn.disabled = focusedCropSourceRect === null;
  if (focusedCropSourceRect) {
    setCropStatus(`Selected ${focusedCropSourceRect.width}×${focusedCropSourceRect.height} source pixels.`);
  } else {
    setCropStatus("Select a larger region inside the image.", true);
  }
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("The focused crop could not be encoded."));
      }
    }, "image/png");
  });
}

async function generateFocusedCrop(): Promise<void> {
  const sourceRect = focusedCropSourceRect;
  if (!sourceRect) {
    setCropStatus("Select a focused region first.", true);
    return;
  }

  const output = getFocusedCropOutputSize(sourceRect);
  if (!output || output.width * output.height > MAX_SOURCE_IMAGE_PIXELS) {
    setCropStatus("The selected crop exceeds the safe output limits.", true);
    return;
  }

  clearFocusedCropResult();
  const canvas = activeDocument.body.createEl("canvas");
  canvas.remove();
  canvas.width = output.width;
  canvas.height = output.height;
  const context = canvas.getContext("2d");
  if (!context) {
    setCropStatus("This browser cannot create a focused crop.", true);
    return;
  }

  context.imageSmoothingEnabled = false;
  context.drawImage(
    cropSource,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    0,
    0,
    output.width,
    output.height
  );

  try {
    focusedCropBlob = await canvasToPngBlob(canvas);
    focusedCropObjectUrl = URL.createObjectURL(focusedCropBlob);
    cropPreview.src = focusedCropObjectUrl;
    cropResult.hidden = false;
    setCropStatus(`Focused PNG ready (${output.width}×${output.height}). Nothing was uploaded or saved.`);
  } catch (error) {
    setCropStatus(error instanceof Error ? error.message : "The focused crop could not be created.", true);
  }
}

async function copyFocusedCrop(): Promise<void> {
  if (!focusedCropBlob) {
    setCropStatus("Generate a focused crop before copying it.", true);
    return;
  }

  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("Image clipboard writing is unavailable");
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": focusedCropBlob })]);
    setCropStatus("Focused crop copied. Paste it now; copying anything else will replace it.");
  } catch {
    setCropStatus("The browser blocked image copying. Use Download crop instead.", true);
    downloadCropBtn.focus();
  }
}

async function copyFocusedCropPrompt(): Promise<void> {
  const original = copyCropPromptBtn.textContent ?? "";
  const prompt = cropRetryPrompt.textContent ?? "";
  try {
    await writeClipboardText(prompt);
    copyCropPromptBtn.textContent = "Copied!";
    setCropStatus("Retry prompt copied. Paste it first, then return to copy the crop.");
  } catch {
    showManualCopyText(prompt);
    copyCropPromptBtn.textContent = "Text selected";
    setCropStatus("Clipboard text copying is unavailable. Copy the selected retry prompt, paste it, then return for the crop.", true);
  }
  window.setTimeout(() => {
    copyCropPromptBtn.textContent = original;
  }, 1200);
}

function downloadFocusedCrop(): void {
  if (!focusedCropBlob) {
    setCropStatus("Generate a focused crop before downloading it.", true);
    return;
  }

  const downloadUrl = URL.createObjectURL(focusedCropBlob);
  const link = activeDocument.body.createEl("a", {
    href: downloadUrl,
    attr: { download: "drum-score-focused-crop.png" }
  });
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
  setCropStatus("Focused crop downloaded. Attach it to a new importer request with the retry prompt.");
}

function clearSourceImage(): void {
  closeFocusedCropDialog();
  if (sourceObjectUrl) {
    URL.revokeObjectURL(sourceObjectUrl);
    sourceObjectUrl = null;
  }
  sourceImage.removeAttribute("src");
  sourceImage.hidden = true;
  sourceEmpty.hidden = false;
  openCropBtn.hidden = true;
}

async function loadSourceImage(file: File | undefined): Promise<void> {
  clearSourceImage();
  if (!file) {
    return;
  }
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    setVerificationMessage(`Image exceeds ${MAX_SOURCE_IMAGE_BYTES} bytes.`, true);
    sourceFileInput.value = "";
    return;
  }

  const signature = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const kind = detectRasterImageKind(signature);
  if (!kind) {
    setVerificationMessage("Only raster PNG, JPEG, and WebP images are accepted. SVG and unknown formats are rejected.", true);
    sourceFileInput.value = "";
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  const candidate = new Image();
  candidate.src = objectUrl;
  try {
    await candidate.decode();
  } catch {
    URL.revokeObjectURL(objectUrl);
    setVerificationMessage("The selected image could not be decoded.", true);
    sourceFileInput.value = "";
    return;
  }

  if (!isAllowedRasterDimensions(candidate.naturalWidth, candidate.naturalHeight)) {
    URL.revokeObjectURL(objectUrl);
    setVerificationMessage(`Decoded image exceeds ${MAX_SOURCE_IMAGE_SIDE}px per side or ${MAX_SOURCE_IMAGE_PIXELS} total pixels.`, true);
    sourceFileInput.value = "";
    return;
  }

  sourceObjectUrl = objectUrl;
  sourceImage.src = objectUrl;
  sourceImage.hidden = false;
  sourceEmpty.hidden = true;
  openCropBtn.hidden = false;
  setVerificationMessage(`${kind.toUpperCase()} source loaded locally (${candidate.naturalWidth}×${candidate.naturalHeight}).`);
}

function clearVerificationWorkspace(): void {
  stopPlayback();
  exitEditMode();
  clearPendingUnfencedRecovery();
  verificationSegments = [];
  selectedVerificationSegment = -1;
  verificationReport = null;
  verificationReportState = "missing";
  verificationResponseErrors = [];
  verificationUndoStack = [];
  agentResponseInput.value = "";
  sourceFileInput.value = "";
  clearSourceImage();
  editor.value = playgroundDraftSnapshot;
  renderSegmentTabs();
  renderPreview();
  updateVerificationUndoButton();
  setVerificationMessage("Verification workspace cleared. Your saved playground draft was not changed.");
}

function undoVerificationEdit(): void {
  const previous = verificationUndoStack.pop();
  if (previous === undefined) {
    return;
  }
  editor.value = previous;
  saveCurrentVerificationText();
  renderPreview();
  updateVerificationUndoButton();
}

function saveVerifiedNotation(): void {
  if (!verificationActive || !currentBlock || selectedVerificationSegment < 0) {
    return;
  }
  const validated = validateDrumNotation(editor.value);
  if (validated.status === "invalid") {
    setVerificationMessage("Invalid notation cannot be saved to the playground.", true);
    return;
  }
  playgroundDraftSnapshot = validated.normalized;
  savePlaygroundValue(STORAGE_KEY, validated.normalized);
  setVerificationMessage("Saved normalized notation only. The source image and import report were not persisted.");
}

/* ---------- persistence & examples ---------- */
function persist(): void {
  if (verificationActive) {
    saveCurrentVerificationText();
  } else {
    savePlaygroundValue(STORAGE_KEY, editor.value);
  }
}

function populateExamples(): void {
  exampleSelect.createEl("option", { text: "Custom notation", value: "" });

  for (const category of PLAYGROUND_EXAMPLE_CATEGORIES) {
    const group = exampleSelect.createEl("optgroup", { attr: { label: category.label } });
    for (const example of PLAYGROUND_EXAMPLES) {
      if (example.category === category.id) {
        group.createEl("option", { text: example.name, value: example.id });
      }
    }
  }
}

function syncExampleSelection(raw: string): void {
  const matchingExample = PLAYGROUND_EXAMPLES.find((example) => {
    const trimmed = raw.trim();

    return example.source.trim() === trimmed || toAuthoringText(example.source).trim() === trimmed;
  });

  exampleSelect.value = matchingExample?.id ?? "";
}

function toAuthoringText(raw: string): string {
  return serializeDrumBlock(parseDrumBlock(raw), { mode: "authoring" });
}

function dismissManualCopyText(): void {
  activeDocument.querySelector(".pg-copy-fallback")?.remove();
}

function dismissPlaygroundConfirm(): void {
  activeDocument.querySelector(".pg-confirm")?.remove();
}

function confirmPlaygroundAction(message: string): Promise<boolean> {
  dismissPlaygroundConfirm();

  return new Promise((resolve) => {
    const panel = activeDocument.body.createDiv({
      cls: "pg-confirm",
      attr: {
        role: "dialog",
        "aria-modal": "true",
        "aria-label": "Confirm action"
      }
    });
    panel.createEl("p", { cls: "pg-confirm__message", text: message });
    const actions = panel.createDiv({ cls: "pg-confirm__actions" });
    const cancel = actions.createEl("button", {
      cls: "pg-btn pg-btn--small",
      text: "Cancel",
      attr: { type: "button" }
    });
    const confirm = actions.createEl("button", {
      cls: "pg-btn pg-btn--small pg-confirm__confirm",
      text: "Confirm",
      attr: { type: "button" }
    });

    const finish = (value: boolean): void => {
      panel.remove();
      resolve(value);
    };

    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        finish(false);
      }
    });

    window.requestAnimationFrame(() => cancel.focus());
  });
}

function requestPlaygroundRepeatAction(
  request: RepeatBarDialogRequest
): Promise<RepeatBarDialogResult | null> {
  dismissPlaygroundConfirm();

  return new Promise((resolve) => {
    const isEditing = request.mode === "edit";
    const panel = activeDocument.body.createDiv({
      cls: "pg-confirm",
      attr: {
        role: "dialog",
        "aria-modal": "true",
        "aria-label": isEditing ? "Edit repeat bar" : "Add repeat bar"
      }
    });
    panel.createEl("p", {
      cls: "pg-confirm__message",
      text: isEditing
        ? "Change the repeat count, or replace the group with one editable copy."
        : `Choose how many times to repeat the selected bar (1–${MAX_MEASURE_REPEAT_COUNT}).`
    });
    const field = panel.createEl("label", { cls: "pg-confirm__field" });
    field.createSpan({ text: "Number of repeats" });
    const input = field.createEl("input", {
      cls: "pg-confirm__number",
      attr: {
        type: "number",
        min: "1",
        max: String(MAX_MEASURE_REPEAT_COUNT),
        step: "1",
        value: String(request.initialCount)
      }
    });
    const actions = panel.createDiv({ cls: "pg-confirm__actions" });
    const cancel = actions.createEl("button", {
      cls: "pg-btn pg-btn--small",
      text: "Cancel",
      attr: { type: "button" }
    });
    if (isEditing) {
      const makeEditable = actions.createEl("button", {
        cls: "pg-btn pg-btn--small",
        text: "Make editable",
        attr: { type: "button" }
      });

      makeEditable.addEventListener("click", () => finish({ action: "make-editable" }));
    }
    const confirm = actions.createEl("button", {
      cls: "pg-btn pg-btn--small pg-confirm__confirm",
      text: isEditing ? "Update repeat" : "Add repeat",
      attr: { type: "button" }
    });

    const readCount = (): number | null => {
      const value = Number(input.value);

      return Number.isInteger(value) && value >= 1 && value <= MAX_MEASURE_REPEAT_COUNT ? value : null;
    };
    const updateValidity = (): void => {
      confirm.disabled = readCount() === null;
    };
    const finish = (value: RepeatBarDialogResult | null): void => {
      panel.remove();
      resolve(value);
    };

    input.addEventListener("input", updateValidity);
    cancel.addEventListener("click", () => finish(null));
    confirm.addEventListener("click", () => {
      const count = readCount();

      if (count !== null) {
        finish({ action: "set-count", count });
      }
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        finish(null);
      } else if (event.key === "Enter") {
        const count = readCount();
        if (count !== null) {
          event.preventDefault();
          finish({ action: "set-count", count });
        }
      }
    });

    updateValidity();
    window.requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}

async function copyText(button: HTMLButtonElement, text: string): Promise<void> {
  const original = button.textContent ?? "";
  try {
    await writeClipboardText(text);
    button.textContent = "Copied!";
  } catch {
    showManualCopyText(text);
    button.textContent = "Text selected";
  }
  window.setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

async function writeClipboardText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard API is unavailable");
  }

  await navigator.clipboard.writeText(text);
}

function showManualCopyText(text: string): void {
  dismissManualCopyText();

  const panel = activeDocument.body.createDiv({
    cls: "pg-copy-fallback",
    attr: {
      role: "dialog",
      "aria-label": "Copy fallback"
    }
  });
  const header = panel.createDiv({ cls: "pg-copy-fallback__head" });
  header.createEl("strong", { text: "Clipboard blocked" });
  const close = header.createEl("button", {
    cls: "pg-btn pg-btn--small",
    text: "Close",
    attr: { type: "button" }
  });
  const textarea = panel.createEl("textarea", { cls: "pg-copy-fallback__text" });
  textarea.value = text;
  close.addEventListener("click", () => panel.remove());

  window.requestAnimationFrame(() => {
    textarea.focus();
    textarea.select();
  });
}

/* ---------- buttons ---------- */
// Prepends a Lucide icon before the existing button label (icon + text).
function decorateButton(button: HTMLButtonElement, icon: string): void {
  const label = button.textContent ?? "";
  const span = button.createSpan();
  span.addClass("pg-btn__label");
  span.textContent = label;
  button.replaceChildren(createIconSvg(icon), span);
}

/* ---------- debounce ---------- */
function debounce(fn: () => void, ms: number): () => void {
  let timer: number | null = null;
  return () => {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(fn, ms);
  };
}

/* ---------- wiring ---------- */
function init(): void {
  populateExamples();

  const stored = (() => {
    return loadPlaygroundValue(STORAGE_KEY);
  })();
  const defaultExample = getPlaygroundExample(DEFAULT_PLAYGROUND_EXAMPLE_ID);
  editor.value = toAuthoringText(stored ?? defaultExample?.source ?? "");

  if (loadPlaygroundValue(THEME_KEY) === "dark") {
    activeDocument.body.classList.add("theme-dark");
  }

  const onEdit = debounce(() => {
    const restartPlayback = capturePlaybackRestart();
    persist();
    renderPreview();
    restartPlayback();
  }, 250);
  editor.addEventListener("beforeinput", (event) => {
    if (event.inputType !== "historyUndo" && event.inputType !== "historyRedo") {
      recordVerificationUndo();
    }
  });
  editor.addEventListener("input", () => {
    markVerificationNeedsChanges();
    dismissManualCopyText();
    onEdit();
  });

  exampleSelect.addEventListener("change", () => {
    if (!exampleSelect.value) {
      return;
    }

    const example = getPlaygroundExample(exampleSelect.value);
    if (example === undefined) {
      return;
    }
    dismissManualCopyText();
    editor.value = toAuthoringText(example.source);
    persist();
    renderPreview();
  });

  titleInput.addEventListener("change", () => {
    if (!currentBlock) {
      return;
    }
    applyEditedBlock(withTitle(currentBlock, titleInput.value));
  });

  tempoInput.addEventListener("change", () => {
    if (!currentBlock) {
      return;
    }
    const nextBlock = setTempo(currentBlock, Number(tempoInput.value));
    normalizeClickSubdivisionForCurrentSpeed(nextBlock, true);
    applyEditedBlock(nextBlock);
  });

  const applyTimeSignature = () => {
    if (!currentBlock) {
      return;
    }

    const result = setTimeSignature(
      currentBlock,
      Number(timeTopInput.value),
      Number(timeBottomInput.value)
    );

    if (!result.ok) {
      gridEditorMessage = result.message;
      syncControls(result.block);
      renderNotes(result.block, editor.value);
      return;
    }

    gridEditorMessage = null;
    applyEditedBlock(result.block);
  };
  timeTopInput.addEventListener("change", applyTimeSignature);
  timeBottomInput.addEventListener("change", applyTimeSignature);

  gridSelect.addEventListener("change", () => {
    if (!currentBlock) {
      return;
    }
    applyEditedBlock(setGrid(currentBlock, getSelectedGridResolution()));
  });

  repeatInput.addEventListener("change", () => {
    if (!currentBlock) {
      return;
    }
    applyEditedBlock(setRepeatCount(currentBlock, Number(repeatInput.value)));
  });

  legendSelect.addEventListener("change", () => {
    if (!currentBlock) {
      return;
    }
    applyEditedBlock({ ...currentBlock, legendMode: getSelectedLegendMode() });
  });

  decorateButton(playBtn, "play");
  decorateButton(stopBtn, "square");
  decorateButton(loopBtn, "repeat-1");
  decorateButton(loopAllBtn, "repeat");
  decorateButton(editBtn, "pencil");
  syncMetronomeButton();
  syncMuteButton();

  playBtn.addEventListener("click", () => {
    void (repetitionGoal.armed
      ? startRepetitionGoal(true, true)
      : tempoRamp.armed
        ? startArmedTempoRamp(true, true)
        : play(0, true));
  });
  stopBtn.addEventListener("click", () => stopPlayback());
  loopBtn.addEventListener("click", loopBar);
  loopAllBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    setLoopMenuOpen(loopMenu.hidden);
  });
  loopMenu.addEventListener("click", (event) => event.stopPropagation());
  loopMenu.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }

    const items = [...loopMenu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    if (items.length === 0) {
      return;
    }
    event.preventDefault();
    const targetIndex = items.findIndex((item) => item === event.target);
    const activeIndex =
      targetIndex >= 0
        ? targetIndex
        : items.findIndex((item) => item === activeDocument.activeElement);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowUp"
            ? (activeIndex <= 0 ? items.length : activeIndex) - 1
            : (activeIndex + 1) % items.length;
    items[nextIndex]?.focus();
  });
  speedBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    setSpeedMenuOpen(speedMenu.hidden);
  });
  speedMenu.addEventListener("click", (event) => event.stopPropagation());
  speedMenu.addEventListener("keydown", handleMenuArrowNavigation);
  metronomeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    setMetronomeMenuOpen(metronomeMenu.hidden);
  });
  metronomeMenu.addEventListener("click", (event) => event.stopPropagation());
  muteBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    setMuteMenuOpen(muteMenu.hidden);
  });
  muteMenu.addEventListener("click", (event) => event.stopPropagation());
  activeDocument.addEventListener("click", () => {
    setLoopMenuOpen(false);
    setSpeedMenuOpen(false);
    setMetronomeMenuOpen(false);
    setMuteMenuOpen(false);
  });
  activeDocument.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const returnFocusToLoop = !loopMenu.hidden && loopMenu.contains(activeDocument.activeElement);
      const returnFocusToSpeed = !speedMenu.hidden && speedMenu.contains(activeDocument.activeElement);
      setLoopMenuOpen(false);
      setSpeedMenuOpen(false);
      setMetronomeMenuOpen(false);
      setMuteMenuOpen(false);
      if (returnFocusToLoop) {
        loopAllBtn.focus();
      } else if (returnFocusToSpeed) {
        speedBtn.focus();
      }
      if (activeDocument.body.classList.contains("pg-verify-workspace-maximized")) {
        setVerificationWorkspaceMaximized(false);
      }
    }
  });
  editBtn.addEventListener("click", () => {
    if (gridEditor) {
      exitEditMode();
    } else {
      enterEditMode();
    }
  });

  copyBlockBtn.addEventListener("click", () => {
    const text = currentBlock ? serializeDrumBlock(currentBlock, { mode: "authoring" }) : editor.value.trim();

    void copyText(copyBlockBtn, "```drums\n" + text.trim() + "\n```");
  });
  copyNormalizedBtn.addEventListener("click", () => {
    void copyText(copyNormalizedBtn, currentBlock ? serializeDrumBlock(currentBlock) : "");
  });

  themeBtn.addEventListener("click", () => {
    const dark = activeDocument.body.classList.toggle("theme-dark");
    savePlaygroundValue(THEME_KEY, dark ? "dark" : "light");
  });

  playgroundModeBtn.addEventListener("click", exitVerificationModeToDraft);
  verifyModeBtn.addEventListener("click", enterVerificationMode);
  verifyResizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || activeDocument.body.classList.contains("pg-verify-workspace-maximized")) {
      return;
    }
    event.preventDefault();
    verifyResizePointerId = event.pointerId;
    verifyResizePointerOffset = event.clientY - verifyPanel.getBoundingClientRect().bottom;
    verifyResizer.setPointerCapture(event.pointerId);
  });
  verifyResizer.addEventListener("pointermove", (event) => {
    if (verifyResizePointerId === event.pointerId) {
      resizeVerificationPanelFromPointer(event.clientY);
    }
  });
  verifyResizer.addEventListener("pointerup", (event) => finishVerificationPanelResize(event.pointerId));
  verifyResizer.addEventListener("pointercancel", (event) => finishVerificationPanelResize(event.pointerId));
  verifyResizer.addEventListener("lostpointercapture", (event) => {
    if (verifyResizePointerId !== event.pointerId) {
      return;
    }
    verifyResizePointerId = null;
    verifyResizePointerOffset = 0;
  });
  verifyResizer.addEventListener("dblclick", () => setVerificationPanelHeight(null));
  verifyResizer.addEventListener("keydown", (event) => {
    const currentHeight = verifyPanel.getBoundingClientRect().height;
    let nextHeight: number | null = null;
    if (event.key === "ArrowUp") {
      nextHeight = currentHeight - VERIFY_PANEL_KEYBOARD_STEP_PX;
    } else if (event.key === "ArrowDown") {
      nextHeight = currentHeight + VERIFY_PANEL_KEYBOARD_STEP_PX;
    } else if (event.key === "Home") {
      nextHeight = 0;
    } else if (event.key === "End") {
      nextHeight = getVerificationPanelMaxHeight();
    }
    if (nextHeight !== null) {
      event.preventDefault();
      setVerificationPanelHeight(nextHeight);
    }
  });
  toggleVerifyWorkspaceBtn.addEventListener("click", () => {
    setVerificationWorkspaceMaximized(!activeDocument.body.classList.contains("pg-verify-workspace-maximized"));
  });
  copyPromptBtn.addEventListener("click", () => {
    void copyText(copyPromptBtn, importPrompt.textContent ?? "");
  });
  extractResponseBtn.addEventListener("click", extractVerificationResponse);
  acceptUnfencedBtn.addEventListener("click", acceptUnfencedVerificationResponse);
  agentResponseInput.addEventListener("input", () => {
    if (pendingUnfencedResponse === null) {
      return;
    }
    clearPendingUnfencedRecovery();
    setVerificationMessage("Pasted text changed. Select Extract and verify to validate it again.");
  });
  clearVerificationBtn.addEventListener("click", clearVerificationWorkspace);
  verificationUndoBtn.addEventListener("click", undoVerificationEdit);
  saveVerifiedBtn.addEventListener("click", saveVerifiedNotation);
  sourceFileInput.addEventListener("change", () => {
    void loadSourceImage(sourceFileInput.files?.[0]);
  });
  openCropBtn.addEventListener("click", openFocusedCropDialog);
  closeCropBtn.addEventListener("click", closeFocusedCropDialog);
  cropDialog.addEventListener("close", () => {
    resetFocusedCropSelection();
    cropSource.removeAttribute("src");
  });
  cropStage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || cropSource.naturalWidth <= 0 || cropSource.naturalHeight <= 0) {
      return;
    }
    event.preventDefault();
    resetFocusedCropSelection();
    cropDragStart = cropStagePoint(event);
    cropDragPointerId = event.pointerId;
    cropStage.setPointerCapture(event.pointerId);
    renderCropSelection(cropDragStart, cropDragStart);
  });
  cropStage.addEventListener("pointermove", (event) => {
    if (cropDragStart && cropDragPointerId === event.pointerId) {
      renderCropSelection(cropDragStart, cropStagePoint(event));
    }
  });
  cropStage.addEventListener("pointerup", (event) => {
    if (cropDragStart && cropDragPointerId === event.pointerId) {
      finishCropSelection(cropStagePoint(event));
      cropStage.releasePointerCapture(event.pointerId);
      cropDragStart = null;
      cropDragPointerId = null;
    }
  });
  cropStage.addEventListener("pointercancel", () => {
    cropDragStart = null;
    cropDragPointerId = null;
    focusedCropSourceRect = null;
    cropSelection.hidden = true;
    generateCropBtn.disabled = true;
    setCropStatus("Selection cancelled. Drag on the image to try again.");
  });
  generateCropBtn.addEventListener("click", () => {
    void generateFocusedCrop();
  });
  copyCropBtn.addEventListener("click", () => {
    void copyFocusedCrop();
  });
  downloadCropBtn.addEventListener("click", downloadFocusedCrop);
  copyCropPromptBtn.addEventListener("click", () => {
    void copyFocusedCropPrompt();
  });
  humanReviewSelect.addEventListener("change", () => {
    const segment = verificationSegments[selectedVerificationSegment];
    if (segment) {
      segment.humanReview = humanReviewSelect.value as HumanReviewState;
      renderVerificationSignals();
    }
  });
  const handlePageUnload = () => {
    settleTrackedRun();
    stopPlayback(false);
    clearSourceImage();
    void screenWakeLock.destroy();
  };
  window.addEventListener("pagehide", handlePageUnload);
  window.addEventListener("beforeunload", handlePageUnload);
  window.addEventListener("resize", reconcileVerificationPanelHeight);

  // Refit the score to the pane width (debounced; skip no-op width changes).
  let lastWidth = 0;
  const refit = debounce(() => {
    if (!gridEditor && currentBlock && currentBlock.rows.length > 0 && scoreEl) {
      renderPreview();
    }
  }, 150);
  const observer = new ResizeObserver((entries) => {
    const width = Math.round(entries[0]?.contentRect.width ?? 0);
    if (width === 0 || width === lastWidth) {
      return;
    }
    lastWidth = width;
    refit();
  });
  observer.observe(preview.parentElement ?? preview);
  const verificationPanelObserver = new ResizeObserver(reconcileVerificationPanelHeight);
  verificationPanelObserver.observe(verifyPanel);

  renderPreview();
}

init();
