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
  COUNT_IN_MODE_OPTIONS,
  DEFAULT_COUNT_IN_MODE,
  DEFAULT_METRONOME_MODE,
  DEFAULT_PLAYBACK_SPEED_PERCENT,
  DrumPlaybackBackend,
  getCountInModeLabel,
  getEffectivePlaybackTempo,
  getMetronomeModeLabel,
  getPlaybackInstruments,
  MAX_PLAYBACK_SPEED_PERCENT,
  METRONOME_MODE_OPTIONS,
  MIN_PLAYBACK_SPEED_PERCENT,
  normalizePlaybackSpeedPercent,
  PLAYBACK_SPEED_UI_STEP_PERCENT,
  recoverAudioContext
} from "../../src/playback";
import { DrumPlayer } from "../../src/player";
import { getMeasureRepeatProgress } from "../../src/repeat-progress";
import { serializeDrumBlock } from "../../src/serializer";
import { validateDrumNotation } from "../../src/validation";
import { setGrid, setRepeatCount, setTempo, setTimeSignature } from "../../src/edit";
import { createSynthPlaybackBackend } from "../../src/synth";
import {
  CursorPosition,
  CountInMode,
  DrumBlock,
  DrumPlaybackPosition,
  DrumSlot,
  GridResolution,
  LegendMode,
  MAX_MEASURE_REPEAT_COUNT,
  MetronomeMode,
  ParseWarning,
  ScoreBarRegion
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
const speedSelect = $<HTMLSelectElement>("pg-speed");
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
const importPrompt = $<HTMLPreElement>("pg-import-prompt");
const copyPromptBtn = $<HTMLButtonElement>("pg-copy-prompt");
const sourceFileInput = $<HTMLInputElement>("pg-source-file");
const agentResponseInput = $<HTMLTextAreaElement>("pg-agent-response");
const extractResponseBtn = $<HTMLButtonElement>("pg-extract-response");
const clearVerificationBtn = $<HTMLButtonElement>("pg-clear-verification");
const verificationUndoBtn = $<HTMLButtonElement>("pg-verify-undo");
const saveVerifiedBtn = $<HTMLButtonElement>("pg-save-verified");
const verificationMessage = $<HTMLParagraphElement>("pg-verify-message");
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
let isLooping = false;
let isLoopingAll = false;
let playbackSpeedPercent = DEFAULT_PLAYBACK_SPEED_PERCENT;
let metronomeMode: MetronomeMode = DEFAULT_METRONOME_MODE;
let countInMode: CountInMode = DEFAULT_COUNT_IN_MODE;
const mutedInstrumentIds = new Set<string>();
let gridEditor: GridEditorHandle | null = null;
let isApplyingGridEdit = false;
let audioRecoveryWarning: string | null = null;
let gridEditorMessage: string | null = null;
const barClipboard = new DrumBarClipboardStore();

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
let sourceObjectUrl: string | null = null;
let focusedCropObjectUrl: string | null = null;
let focusedCropBlob: Blob | null = null;
let focusedCropSourceRect: CropRect | null = null;
let cropDragStart: CropPoint | null = null;
let cropDragPointerId: number | null = null;

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
  speedSelect.disabled = !hasRows;
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

function renderFirstRunTip(): void {
  if (isFirstRunTipDismissed()) {
    return;
  }

  const tip = preview.createDiv({ cls: "drum-notation__tip pg-discovery-tip" });
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

function renderBarSelectors(block: DrumBlock, score: HTMLElement): void {
  if (!gridEditor || barRegions.length === 0) {
    return;
  }

  clearBarSelectors();
  const layer = score.createDiv({ cls: "pg-bar-selectors" });

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
    button.addEventListener("click", () => selectBar(region.barIndex, true));
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
    const selected = indexes.includes(selectedBarIndex);

    button.classList.toggle("is-selected", selected);
    button.setAttr("aria-pressed", selected ? "true" : "false");
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

  selectBar(region.barIndex, Boolean(gridEditor));
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

function stopPlayback(): void {
  player?.stop();
  player = null;
  isLooping = false;
  isLoopingAll = false;
  setPlaying(playBtn, false);
  setPlaying(loopBtn, false);
  setPlaying(loopAllBtn, false);
  clearVisuals();
  clearRepeatProgress();
}

async function preparePlaybackStart(recoverBeforeStart: boolean): Promise<boolean> {
  stopPlayback();

  if (!recoverBeforeStart) {
    return true;
  }

  return recoverPlaybackAudio();
}

async function play(
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
  setPlaying(playBtn, true);
  player = new DrumPlayer(
    getAudioContext(),
    block,
    () => {
      setPlaying(playBtn, false);
      clearVisuals();
      clearRepeatProgress();
      player = null;
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
      repeatCount: block.repeatCount,
      speedPercent: playbackSpeedPercent,
      mutedInstrumentIds,
      metronomeMode,
      countInMode: useCountIn ? countInMode : "off",
      onBarChange: (barIndex) => showRepeatProgressForBar(block, barIndex)
    },
    createPlaybackBackend
  );
  if (!useCountIn || countInMode === "off") {
    showRepeatProgressForBar(block, barIndexForSlot(block, currentSlotIndex));
  }
  void player.play();
  return true;
}

function loopBar(): void {
  if (isLooping) {
    stopPlayback();
    return;
  }
  if (!currentBlock || currentBlock.rows.length === 0) {
    return;
  }

  void startLoopBar(barIndexForSlot(currentBlock, currentSlotIndex), undefined, true);
}

async function startLoopBar(
  barIndex = selectedBarIndex,
  initialSlot?: number,
  recoverBeforeStart = false,
  useCountIn = true
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
  isLooping = true;
  setPlaying(loopBtn, true);
  player = new DrumPlayer(
    getAudioContext(),
    block,
    () => {
      setPlaying(loopBtn, false);
      clearVisuals();
      clearRepeatProgress();
      isLooping = false;
      player = null;
    },
    (slotIndex) => {
      currentSlotIndex = slotIndex;
      moveCursor(slotIndex);
    },
    {
      startSlot: range.startSlot,
      endSlot: range.endSlot,
      initialSlot: currentSlotIndex,
      loop: true,
      speedPercent: playbackSpeedPercent,
      mutedInstrumentIds,
      metronomeMode,
      countInMode: useCountIn ? countInMode : "off"
    },
    createPlaybackBackend
  );
  void player.play();
  return true;
}

function loopAll(): void {
  if (isLoopingAll) {
    stopPlayback();
    return;
  }
  if (!currentBlock || currentBlock.rows.length === 0) {
    return;
  }

  void startLoopAll(0, true);
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
  isLoopingAll = true;
  setPlaying(loopAllBtn, true);
  player = new DrumPlayer(
    getAudioContext(),
    block,
    () => {
      setPlaying(loopAllBtn, false);
      clearVisuals();
      clearRepeatProgress();
      isLoopingAll = false;
      player = null;
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
      mutedInstrumentIds,
      metronomeMode,
      countInMode: useCountIn ? countInMode : "off",
      onBarChange: (barIndex) => showRepeatProgressForBar(block, barIndex)
    },
    createPlaybackBackend
  );
  if (!useCountIn || countInMode === "off") {
    showRepeatProgressForBar(block, barIndexForSlot(block, currentSlotIndex));
  }
  void player.play();
  return true;
}

function restartPlaybackAfterEdit(
  wasPlaying: boolean,
  wasLooping: boolean,
  wasLoopingAll: boolean,
  restartSlotIndex: number,
  restartBarIndex: number,
  restartPosition?: DrumPlaybackPosition
): void {
  if (!wasPlaying || lastRenderError || !currentBlock || currentBlock.rows.length === 0) {
    return;
  }

  if (wasLoopingAll) {
    void startLoopAll(restartSlotIndex, false, false, restartPosition);
  } else if (wasLooping) {
    void startLoopBar(restartBarIndex, undefined, false, false);
  } else {
    void play(restartSlotIndex, false, false, restartPosition);
  }
}

function capturePlaybackRestart(): (barIndex?: number) => void {
  const wasPlaying = player !== null;
  const wasLooping = isLooping;
  const wasLoopingAll = isLoopingAll;
  const restartPosition = player?.getCurrentPlaybackPosition();
  const restartSlotIndex = restartPosition?.slotIndex ?? currentSlotIndex;
  const restartBarIndex = selectedBarIndex;

  return (barIndex = restartBarIndex) => restartPlaybackAfterEdit(
    wasPlaying,
    wasLooping,
    wasLoopingAll,
    restartSlotIndex,
    barIndex,
    restartPosition
  );
}

async function restartPlaybackForControlChange(): Promise<void> {
  if (!player || !currentBlock) {
    return;
  }

  const restartPosition = player.getCurrentPlaybackPosition();
  const restartSlotIndex = restartPosition.slotIndex;
  const wasLooping = isLooping;
  const wasLoopingAll = isLoopingAll;
  const restartBarIndex = barIndexForSlot(currentBlock, restartSlotIndex);

  stopPlayback();
  if (wasLoopingAll) {
    await startLoopAll(restartSlotIndex, true, false, restartPosition);
  } else if (wasLooping) {
    await startLoopBar(restartBarIndex, restartSlotIndex, true, false);
  } else {
    await play(restartSlotIndex, true, false, restartPosition);
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

function populatePlaybackSpeeds(): void {
  for (const speed of getPlaybackSpeedOptionValues()) {
    speedSelect.createEl("option", { text: `${speed}%`, value: String(speed) });
  }
}

const PLAYBACK_SPEED_TEMP_OPTION_ATTR = "data-drum-speed-temporary";

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

function syncSpeedSelectValue(select: HTMLSelectElement, speedPercent: number): number {
  const normalized = normalizePlaybackSpeedPercent(speedPercent);

  select.querySelectorAll(`option[${PLAYBACK_SPEED_TEMP_OPTION_ATTR}="true"]`).forEach((option) => option.remove());

  const hasOption = Array.from(select.options).some((option) => Number(option.value) === normalized);

  if (!hasOption) {
    const option = select.createEl("option", { text: `${normalized}%`, value: String(normalized) });
    option.setAttribute(PLAYBACK_SPEED_TEMP_OPTION_ATTR, "true");
    const insertBefore = Array.from(select.options).find((candidate) => Number(candidate.value) < normalized) ?? null;
    select.insertBefore(option, insertBefore);
  }

  select.value = String(normalized);

  return normalized;
}

function syncPlaybackControls(block: DrumBlock): void {
  playbackSpeedPercent = syncSpeedSelectValue(speedSelect, playbackSpeedPercent);
  const effectiveTempo = getEffectivePlaybackTempo(block.tempo, playbackSpeedPercent);
  const speedDescription = `Playback speed ${playbackSpeedPercent}% · ${formatTempo(effectiveTempo)} BPM`;

  speedSelect.title = speedDescription;
  speedSelect.setAttribute("aria-label", speedDescription);
  syncMetronomeButton();
  syncMuteButton();

  if (!metronomeMenu.hidden) {
    renderMetronomeMenu();
  }

  if (!muteMenu.hidden) {
    renderMuteMenu();
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
  const description = `Metronome: ${getMetronomeModeLabel(metronomeMode)} · Count-in: ${getCountInModeLabel(countInMode)}`;

  metronomeBtn.replaceChildren(createIconSvg("timer"));
  metronomeBtn.classList.toggle("is-active", metronomeMode !== "off" || countInMode !== "off");
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
}

function setMetronomeMenuOpen(open: boolean): void {
  metronomeMenu.hidden = !open;
  metronomeBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
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
    setMetronomeMenuOpen(false);
    renderMuteMenu();
  }
}

function formatTempo(tempo: number): string {
  return Number.isInteger(tempo) ? String(tempo) : tempo.toFixed(1);
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
  sourcePane.hidden = false;
  playgroundModeBtn.classList.remove("is-active");
  playgroundModeBtn.setAttribute("aria-pressed", "false");
  verifyModeBtn.classList.add("is-active");
  verifyModeBtn.setAttribute("aria-pressed", "true");
  exampleSelect.disabled = true;
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
  activeDocument.body.classList.remove("pg-verifying");
  verifyPanel.hidden = true;
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

function extractVerificationResponse(): void {
  enterVerificationMode();
  const extracted = extractAgentResponse(agentResponseInput.value);
  verificationReport = extracted.report;
  verificationReportState = extracted.reportState;
  verificationResponseErrors = extracted.errors;
  verificationSegments = extracted.segments.map((segment) => ({
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
  populatePlaybackSpeeds();

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
    applyEditedBlock(setTempo(currentBlock, Number(tempoInput.value)));
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
    void play(0, true);
  });
  stopBtn.addEventListener("click", stopPlayback);
  loopBtn.addEventListener("click", loopBar);
  loopAllBtn.addEventListener("click", loopAll);
  speedSelect.addEventListener("change", () => {
    playbackSpeedPercent = Number(speedSelect.value);
    if (currentBlock) {
      syncPlaybackControls(currentBlock);
    }
    void restartPlaybackForControlChange();
  });
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
    setMetronomeMenuOpen(false);
    setMuteMenuOpen(false);
  });
  activeDocument.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setMetronomeMenuOpen(false);
      setMuteMenuOpen(false);
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
  copyPromptBtn.addEventListener("click", () => {
    void copyText(copyPromptBtn, importPrompt.textContent ?? "");
  });
  extractResponseBtn.addEventListener("click", extractVerificationResponse);
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
  window.addEventListener("pagehide", clearSourceImage);
  window.addEventListener("beforeunload", clearSourceImage);

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

  renderPreview();
}

init();
