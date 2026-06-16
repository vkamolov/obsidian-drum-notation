// Obsidian DOM shim must load before anything that touches the renderer.
import "./obsidian-dom";
// The plugin's own notation styles, plus the playground chrome.
import "../../styles.css";
import "./playground.css";

import {
  colorRenderedNoteheads,
  makeRenderedNotesInteractive,
  renderInstrumentLegend,
  renderVexflowScore
} from "../../src/engrave";
import { INSTRUMENTS_BY_ALIAS } from "../../src/kit";
import { getBarRange, getSecondsPerSlot, getSlotVisualDurationSeconds } from "../../src/music";
import { getTitle, parseDrumBlock } from "../../src/parser";
import { DrumPlayer } from "../../src/player";
import { serializeDrumBlock } from "../../src/serializer";
import { setGrid, setRepeatCount, setTempo, setTimeSignature } from "../../src/edit";
import { DrumSynth } from "../../src/synth";
import { CursorPosition, DrumBlock, DrumSlot, GridResolution, LegendMode, ScoreBarRegion } from "../../src/types";
import { normalizeLabel } from "../../src/util";
import { EXAMPLES } from "./examples";
import { GridEditorHandle, mountGridEditor } from "../../src/editor-grid";
import { iconSvg } from "./icons";

const STORAGE_KEY = "drum-playground.notation";
const THEME_KEY = "drum-playground.theme";

/* ---------- element handles ---------- */
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
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
const editBtn = $<HTMLButtonElement>("pg-edit");
const editRoot = $<HTMLDivElement>("pg-edit-root");
const copyBlockBtn = $<HTMLButtonElement>("pg-copy-block");
const copyNormalizedBtn = $<HTMLButtonElement>("pg-copy-normalized");
const themeBtn = $<HTMLButtonElement>("pg-theme");
const modelOut = $<HTMLDivElement>("pg-model");
const normalizedOut = $<HTMLPreElement>("pg-normalized");
const normalizedFlag = $<HTMLSpanElement>("pg-normalized-flag");
const notesOut = $<HTMLDivElement>("pg-notes");

/* ---------- render state ---------- */
let currentBlock: DrumBlock | null = null;
let scoreEl: HTMLElement | null = null;
let cursorEl: HTMLElement | null = null;
let cursorPositions: Array<CursorPosition | undefined> = [];
let barRegions: ScoreBarRegion[] = [];
let noteElements: Array<SVGGElement | undefined> = [];
let highlightedNote: SVGGElement | null = null;
let editHighlightedNote: SVGGElement | null = null;
let editSelectedSlotIndex: number | null = null;
let selectedBarIndex = 0;
let currentSlotIndex = 0;
let lastRenderError: string | null = null;
let isLooping = false;
let isLoopingAll = false;
let gridEditor: GridEditorHandle | null = null;
let isApplyingGridEdit = false;

/* ---------- audio (lazy, created on first user gesture) ---------- */
let audioContext: AudioContext | null = null;
let player: DrumPlayer | null = null;
let previewSynth: DrumSynth | null = null;
let previewTimer: number | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContext();
  }
  void audioContext.resume();
  return audioContext;
}

/* ---------- rendering ---------- */
function renderPreview(): void {
  const block = parseDrumBlock(editor.value);
  currentBlock = block;
  lastRenderError = null;
  selectedBarIndex = clampBarIndex(block, selectedBarIndex);

  clearEditHighlight();
  preview.empty();
  preview.classList.toggle("drum-notation--legend-color", block.legendMode !== "off");

  const viewport = preview.createEl("div", { cls: "drum-notation__score-viewport" });
  const score = viewport.createEl("div", { cls: "drum-notation__score" });
  scoreEl = score;

  const hasRows = block.rows.length > 0;
  playBtn.disabled = !hasRows;
  stopBtn.disabled = !hasRows;
  loopBtn.disabled = !hasRows;
  loopAllBtn.disabled = !hasRows;
  editBtn.disabled = !hasRows;

  if (!hasRows) {
    cursorPositions = [];
    barRegions = [];
    noteElements = [];
    cursorEl = null;
    score.createEl("div", {
      cls: "drum-notation__empty",
      text: "No supported drum rows yet. Add rows like HH, SD, BD."
    });
  } else {
    drawScore(block, score);
  }

  syncControls(block);
  updateDiagnostics(block, editor.value);
  if (gridEditor && !isApplyingGridEdit) {
    gridEditor.syncBlock(block, selectedBarIndex);
  }
  applyEditHighlight();
}

function drawScore(block: DrumBlock, score: HTMLElement): void {
  try {
    const renderResult = renderVexflowScore(block, score);

    cursorPositions = renderResult.cursorPositions;
    barRegions = renderResult.barRegions;
    if (block.legendMode !== "off") {
      colorRenderedNoteheads(block, score);
    }
    cursorEl = block.showCursor ? score.createEl("div", { cls: "drum-notation__cursor" }) : null;
    noteElements = makeRenderedNotesInteractive(block, score, (slot) => {
      currentSlotIndex = slot.index;
      if (gridEditor) {
        selectBar(barIndexForSlot(block, slot.index), true);
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

/* ---------- playback visuals ---------- */
function clearVisuals(): void {
  cursorEl?.classList.remove("is-active");
  cursorEl?.removeAttribute("style");
  highlightedNote?.classList.remove("is-playing");
  highlightedNote = null;
}

function clearEditHighlight(): void {
  editHighlightedNote?.classList.remove("is-edit-selected");
  editHighlightedNote = null;
}

function applyEditHighlight(): void {
  clearEditHighlight();

  if (editSelectedSlotIndex === null) {
    return;
  }

  editHighlightedNote = noteElements[editSelectedSlotIndex] ?? null;
  editHighlightedNote?.classList.add("is-edit-selected");
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
  const layer = score.createEl("div", { cls: "pg-bar-selectors" });

  barRegions.forEach((region) => {
    const button = layer.createEl("button", {
      cls: "pg-bar-selector",
      attr: {
        "aria-label": `Select bar ${region.barIndex + 1}`,
        type: "button"
      }
    }) as HTMLButtonElement;

    button.dataset.barIndex = String(region.barIndex);
    button.dataset.barIndexes = region.barIndexes.join(" ");
    button.style.left = `${Math.round(region.x)}px`;
    button.style.top = `${Math.round(region.y)}px`;
    button.style.width = `${Math.round(region.width)}px`;
    button.style.height = `${Math.round(region.height)}px`;
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
    highlightedNote?.classList.remove("is-playing");
    highlightedNote = noteElements[slotIndex] ?? null;
    highlightedNote?.classList.add("is-playing");
  }

  const position = cursorPositions[slotIndex];
  if (!position || !cursorEl) {
    cursorEl?.classList.remove("is-active");
    cursorEl?.removeAttribute("style");
    return;
  }

  cursorEl.classList.add("is-active");
  cursorEl.style.height = `${Math.round(position.height)}px`;
  cursorEl.style.left = `${Math.round(position.x)}px`;
  cursorEl.style.top = `${Math.round(position.y)}px`;
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
}

function play(startSlot = 0): void {
  stopPlayback();
  if (!currentBlock || currentBlock.rows.length === 0) {
    return;
  }

  const block = currentBlock;
  currentSlotIndex = clampSlotIndex(block, startSlot);
  setPlaying(playBtn, true);
  player = new DrumPlayer(
    getAudioContext(),
    block,
    () => {
      setPlaying(playBtn, false);
      clearVisuals();
      player = null;
    },
    (slotIndex) => {
      currentSlotIndex = slotIndex;
      moveCursor(slotIndex);
    },
    { startSlot: currentSlotIndex, repeatCount: block.repeatCount }
  );
  void player.play();
}

function loopBar(): void {
  if (isLooping) {
    stopPlayback();
    return;
  }
  if (!currentBlock || currentBlock.rows.length === 0) {
    return;
  }

  startLoopBar();
}

function startLoopBar(barIndex = selectedBarIndex): void {
  if (!currentBlock || currentBlock.rows.length === 0) {
    return;
  }

  stopPlayback();
  const block = currentBlock;
  const bar = block.bars[clampBarIndex(block, barIndex)];
  currentSlotIndex = bar?.startSlot ?? clampSlotIndex(block, currentSlotIndex);
  const range = getBarRange(block, currentSlotIndex);
  isLooping = true;
  setPlaying(loopBtn, true);
  player = new DrumPlayer(
    getAudioContext(),
    block,
    () => {
      setPlaying(loopBtn, false);
      clearVisuals();
      isLooping = false;
      player = null;
    },
    (slotIndex) => {
      currentSlotIndex = slotIndex;
      moveCursor(slotIndex);
    },
    { startSlot: range.startSlot, endSlot: range.endSlot, loop: true }
  );
  void player.play();
}

function loopAll(): void {
  if (isLoopingAll) {
    stopPlayback();
    return;
  }
  if (!currentBlock || currentBlock.rows.length === 0) {
    return;
  }

  startLoopAll();
}

function startLoopAll(): void {
  if (!currentBlock || currentBlock.rows.length === 0) {
    return;
  }

  stopPlayback();
  const block = currentBlock;
  currentSlotIndex = 0;
  isLoopingAll = true;
  setPlaying(loopAllBtn, true);
  player = new DrumPlayer(
    getAudioContext(),
    block,
    () => {
      setPlaying(loopAllBtn, false);
      clearVisuals();
      isLoopingAll = false;
      player = null;
    },
    (slotIndex) => {
      currentSlotIndex = slotIndex;
      moveCursor(slotIndex);
    },
    { startSlot: 0, endSlot: block.slots.length, loop: true }
  );
  void player.play();
}

function restartPlaybackAfterEdit(
  wasPlaying: boolean,
  wasLooping: boolean,
  wasLoopingAll: boolean,
  restartSlotIndex: number,
  restartBarIndex: number
): void {
  if (!wasPlaying || lastRenderError || !currentBlock || currentBlock.rows.length === 0) {
    return;
  }

  if (wasLoopingAll) {
    startLoopAll();
  } else if (wasLooping) {
    startLoopBar(restartBarIndex);
  } else {
    play(restartSlotIndex);
  }
}

function capturePlaybackRestart(): (barIndex?: number) => void {
  const wasPlaying = player !== null;
  const wasLooping = isLooping;
  const wasLoopingAll = isLoopingAll;
  const restartSlotIndex = currentSlotIndex;
  const restartBarIndex = selectedBarIndex;

  return (barIndex = restartBarIndex) => restartPlaybackAfterEdit(wasPlaying, wasLooping, wasLoopingAll, restartSlotIndex, barIndex);
}

function clampSlotIndex(block: DrumBlock, slotIndex: number): number {
  if (block.slots.length === 0) {
    return 0;
  }

  return Math.min(block.slots.length - 1, Math.max(0, Math.round(slotIndex)));
}

async function previewSlot(block: DrumBlock, slot: DrumSlot): Promise<void> {
  stopPreview();
  if (slot.hits.length === 0) {
    return;
  }

  const synth = new DrumSynth(getAudioContext());
  previewSynth = synth;
  await synth.start();
  if (previewSynth !== synth) {
    synth.stop();
    return;
  }

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
}

/* ---------- toolbar controls ---------- */
function syncControls(block: DrumBlock): void {
  const [beats, beatValue] = block.timeSignature.split("/");

  titleInput.value = getTitle(block);
  tempoInput.value = String(block.tempo);
  timeTopInput.value = beats || "4";
  timeBottomInput.value = beatValue || "4";
  gridSelect.value = String(block.gridResolution);
  repeatInput.value = String(block.repeatCount);
  legendSelect.value = block.legendMode;
  syncExampleSelection(editor.value);
}

// Toolbar and grid edits go through the pure edit helpers where possible, then
// rewrite the editor in authoring form. The core serializer still owns the
// deterministic normalized form used in diagnostics.
function applyEditedBlock(next: DrumBlock): void {
  editor.value = serializeDrumBlock(next, { mode: "authoring" });
  persist();
  renderPreview();
}

function applyGridEditedBlock(next: DrumBlock, changedSlotIndex?: number, nextSelectedBarIndex?: number): void {
  const restartPlayback = capturePlaybackRestart();

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
  stopPlayback();
  stopPreview();
  selectedBarIndex = barIndexForSlot(currentBlock, currentSlotIndex);
  selectEditSlot(null);
  document.body.classList.add("pg-editing");
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
    confirmAction: (message) => window.confirm(message)
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
  document.body.classList.remove("pg-editing");
  editBtn.classList.remove("is-playing");
  editRoot.hidden = true;
}

/* ---------- diagnostics ---------- */
function updateDiagnostics(block: DrumBlock, raw: string): void {
  const rows: Array<[string, string]> = [
    ["title", getTitle(block)],
    ["tempo", `${block.tempo} BPM`],
    ["time", block.timeSignature],
    ["grid", `1/${block.gridResolution}`],
    ["systems", String(block.systems.length)],
    ["bars", String(block.bars.length)],
    ["rows", String(block.rows.length)],
    ["slots", String(block.slots.length)],
    ["repeat", `${block.repeatCount}×`],
    ["metadata", `${block.metadata.length} line(s)`]
  ];
  modelOut.innerHTML = "";
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
  notesOut.innerHTML = "";
  let any = false;

  if (lastRenderError) {
    notesOut.createEl("p", { cls: "pg-note pg-note--error", text: `render error: ${lastRenderError}` });
    any = true;
  }

  for (const unknown of unrecognizedRowLabels(raw)) {
    notesOut.createEl("p", {
      cls: "pg-note pg-note--warn",
      text: `unrecognized instrument "${unknown}" — line kept as text, not rendered`
    });
    any = true;
  }

  if (block.rows.length === 0) {
    notesOut.createEl("p", { cls: "pg-note pg-note--warn", text: "no drum rows parsed yet" });
    any = true;
  }

  notesOut.hidden = !any;
}

// A line with a pipe whose label is not a known instrument silently becomes
// metadata. Surfacing it is the kind of validation the playground is for.
function unrecognizedRowLabels(raw: string): string[] {
  const found: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    const pipe = trimmed.indexOf("|");
    if (pipe <= 0) {
      continue;
    }
    const label = trimmed.slice(0, pipe).trim();
    if (label.includes(":")) {
      continue; // setting-like line
    }
    if (label && !INSTRUMENTS_BY_ALIAS.has(normalizeLabel(label)) && !found.includes(label)) {
      found.push(label);
    }
  }
  return found;
}

/* ---------- persistence & examples ---------- */
function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, editor.value);
  } catch {
    /* ignore quota/private-mode errors */
  }
}

function populateExamples(): void {
  exampleSelect.createEl("option", { text: "Custom notation", value: "" });
  for (const name of Object.keys(EXAMPLES)) {
    exampleSelect.createEl("option", { text: name, value: name });
  }
}

function syncExampleSelection(raw: string): void {
  const matchingExample = Object.entries(EXAMPLES).find(([, text]) => {
    const trimmed = raw.trim();

    return text.trim() === trimmed || toAuthoringText(text).trim() === trimmed;
  });

  exampleSelect.value = matchingExample?.[0] ?? "";
}

function toAuthoringText(raw: string): string {
  return serializeDrumBlock(parseDrumBlock(raw), { mode: "authoring" });
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
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Embedded browsers can deny the async Clipboard API even after a button
    // click. Keep a synchronous fallback for those contexts.
  }

  if (copyWithClipboardEvent(text)) {
    return;
  }

  const fallback = document.createElement("textarea");
  fallback.value = text;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.left = "-9999px";
  fallback.style.top = "0";
  document.body.appendChild(fallback);
  fallback.focus();
  fallback.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("copy command failed");
    }
  } finally {
    fallback.remove();
  }
}

function copyWithClipboardEvent(text: string): boolean {
  let handled = false;
  const listener = (event: ClipboardEvent) => {
    event.clipboardData?.setData("text/plain", text);
    event.preventDefault();
    handled = true;
  };

  document.addEventListener("copy", listener);
  try {
    return document.execCommand("copy") || handled;
  } catch {
    return false;
  } finally {
    document.removeEventListener("copy", listener);
  }
}

function showManualCopyText(text: string): void {
  document.querySelector(".pg-copy-fallback")?.remove();

  const panel = document.body.createEl("div", {
    cls: "pg-copy-fallback",
    attr: {
      role: "dialog",
      "aria-label": "Copy fallback"
    }
  });
  const header = panel.createEl("div", { cls: "pg-copy-fallback__head" });
  header.createEl("strong", { text: "Clipboard blocked" });
  const close = header.createEl("button", {
    cls: "pg-btn pg-btn--small",
    text: "Close",
    attr: { type: "button" }
  });
  const textarea = panel.createEl("textarea", { cls: "pg-copy-fallback__text" }) as HTMLTextAreaElement;
  textarea.value = text;
  close.addEventListener("click", () => panel.remove());

  requestAnimationFrame(() => {
    textarea.focus();
    textarea.select();
  });
}

/* ---------- buttons ---------- */
// Prepends a Lucide icon before the existing button label (icon + text).
function decorateButton(button: HTMLButtonElement, icon: string): void {
  const label = button.textContent ?? "";
  button.textContent = "";
  button.insertAdjacentHTML("afterbegin", iconSvg(icon));
  const span = document.createElement("span");
  span.className = "pg-btn__label";
  span.textContent = label;
  button.appendChild(span);
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
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  })();
  editor.value = toAuthoringText(stored ?? EXAMPLES["Basic rock groove"]);

  if (localStorage.getItem(THEME_KEY) === "dark") {
    document.body.classList.add("theme-dark");
  }

  const onEdit = debounce(() => {
    const restartPlayback = capturePlaybackRestart();
    persist();
    renderPreview();
    restartPlayback();
  }, 250);
  editor.addEventListener("input", onEdit);

  exampleSelect.addEventListener("change", () => {
    if (!exampleSelect.value) {
      return;
    }

    const text = EXAMPLES[exampleSelect.value];
    if (text === undefined) {
      return;
    }
    editor.value = toAuthoringText(text);
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

    applyEditedBlock(setTimeSignature(currentBlock, Number(timeTopInput.value), Number(timeBottomInput.value)));
  };
  timeTopInput.addEventListener("change", applyTimeSignature);
  timeBottomInput.addEventListener("change", applyTimeSignature);

  gridSelect.addEventListener("change", () => {
    if (!currentBlock) {
      return;
    }
    applyEditedBlock(setGrid(currentBlock, Number(gridSelect.value) as GridResolution));
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
    applyEditedBlock({ ...currentBlock, legendMode: legendSelect.value as LegendMode });
  });

  decorateButton(playBtn, "play");
  decorateButton(stopBtn, "square");
  decorateButton(loopBtn, "repeat-1");
  decorateButton(loopAllBtn, "repeat");
  decorateButton(editBtn, "pencil");

  playBtn.addEventListener("click", () => play());
  stopBtn.addEventListener("click", stopPlayback);
  loopBtn.addEventListener("click", loopBar);
  loopAllBtn.addEventListener("click", loopAll);
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
    const dark = document.body.classList.toggle("theme-dark");
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  });

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
