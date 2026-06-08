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
import { setGrid, setTempo } from "../../src/edit";
import { DrumSynth } from "../../src/synth";
import { CursorPosition, DrumBlock, DrumSlot, GridResolution, ScoreBarRegion } from "../../src/types";
import { normalizeLabel } from "../../src/util";
import { EXAMPLES } from "./examples";
import { GridEditorHandle, mountGridEditor } from "./editor-grid";

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
const tempoInput = $<HTMLInputElement>("pg-tempo");
const gridSelect = $<HTMLSelectElement>("pg-grid");
const playBtn = $<HTMLButtonElement>("pg-play");
const stopBtn = $<HTMLButtonElement>("pg-stop");
const loopBtn = $<HTMLButtonElement>("pg-loop");
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
let gridEditor: GridEditorHandle | null = null;

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
  setPlaying(playBtn, false);
  setPlaying(loopBtn, false);
  clearVisuals();
}

function play(): void {
  stopPlayback();
  if (!currentBlock || currentBlock.rows.length === 0) {
    return;
  }

  const block = currentBlock;
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
    { repeatCount: block.repeatCount }
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

  stopPlayback();
  const block = currentBlock;
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
  tempoInput.value = String(block.tempo);
  gridSelect.value = String(block.gridResolution);
}

// Tempo/Grid edits go through the pure edit helpers and serializer, then rewrite
// the editor — exercising the full model -> text loop (and normalizing the text).
function applyEditedBlock(next: DrumBlock): void {
  editor.value = serializeDrumBlock(next);
  persist();
  renderPreview();
}

function applyGridEditedBlock(next: DrumBlock, changedSlotIndex?: number): void {
  if (changedSlotIndex !== undefined) {
    selectedBarIndex = barIndexForSlot(next, changedSlotIndex);
  }
  editor.value = serializeDrumBlock(next);
  persist();
  renderPreview();

  if (changedSlotIndex === undefined || !currentBlock) {
    return;
  }

  selectEditSlot(changedSlotIndex);
  const slot = currentBlock.slots.find((candidate) => candidate.index === changedSlotIndex);

  if (slot) {
    void previewSlot(currentBlock, slot);
  }
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
    onSelectBar: (barIndex) => selectBar(barIndex, false)
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

  if (!any) {
    notesOut.createEl("p", { cls: "pg-note pg-note--ok", text: "no issues" });
  }
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
  for (const name of Object.keys(EXAMPLES)) {
    exampleSelect.createEl("option", { text: name, value: name });
  }
}

async function copyText(button: HTMLButtonElement, text: string): Promise<void> {
  const original = button.textContent ?? "";
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied!";
  } catch {
    button.textContent = "Copy failed";
  }
  window.setTimeout(() => {
    button.textContent = original;
  }, 1200);
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
  editor.value = stored ?? EXAMPLES["Basic rock groove"];

  if (localStorage.getItem(THEME_KEY) === "dark") {
    document.body.classList.add("theme-dark");
  }

  const onEdit = debounce(() => {
    persist();
    renderPreview();
  }, 250);
  editor.addEventListener("input", onEdit);

  exampleSelect.addEventListener("change", () => {
    const text = EXAMPLES[exampleSelect.value];
    if (text === undefined) {
      return;
    }
    editor.value = text;
    persist();
    renderPreview();
    exampleSelect.selectedIndex = 0;
  });

  tempoInput.addEventListener("change", () => {
    if (!currentBlock) {
      return;
    }
    applyEditedBlock(setTempo(currentBlock, Number(tempoInput.value)));
  });

  gridSelect.addEventListener("change", () => {
    if (!currentBlock) {
      return;
    }
    applyEditedBlock(setGrid(currentBlock, Number(gridSelect.value) as GridResolution));
  });

  playBtn.addEventListener("click", play);
  stopBtn.addEventListener("click", stopPlayback);
  loopBtn.addEventListener("click", loopBar);
  editBtn.addEventListener("click", () => {
    if (gridEditor) {
      exitEditMode();
    } else {
      enterEditMode();
    }
  });

  copyBlockBtn.addEventListener("click", () => {
    void copyText(copyBlockBtn, "```drums\n" + editor.value.trim() + "\n```");
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
