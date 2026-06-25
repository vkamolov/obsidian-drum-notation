// A fixed-grid visual editor that runs entirely on the pure model + edit
// helpers. Rows are instruments, columns are slots — so horizontal hit-testing
// (x -> slot) is trivial and the vertical "which instrument?" ambiguity the
// architecture notes call out is resolved by the row itself (and the palette).
//
// Every mutation goes through edit.ts (setHit / applyArticulation / clearHit)
// and returns a new block. Nothing here reaches into the renderer or the DOM
// beyond its container.

import {
  applyArticulation,
  clearBarRepeat,
  clearHit,
  clearSticking,
  deleteBar,
  duplicateBar,
  duplicateBarToNextSystem,
  findHit,
  findSticking,
  insertBarAfter,
  setBarRepeat,
  setHit,
  setSticking
} from "./edit";
import { DRUM_KIT, getAllowedArticulations, getArticulationForKey, getHitChar, isArticulationAllowed } from "./kit";
import { getSlotsPerBeat } from "./music";
import { DrumArticulation, DrumBlock, DrumInstrument, StickingHand } from "./types";

export interface GridEditorHandle {
  destroy(): void;
  getSessionState(): GridEditorSessionState;
  selectBar(barIndex: number): void;
  syncBlock(block: DrumBlock, selectedBarIndex?: number): void;
}

export interface GridEditorSessionState {
  selectedBarIndex: number;
  selectedCell: SelectedCell | null;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  extraInstrumentIds: string[];
}

export interface GridEditorOptions {
  container: HTMLElement;
  block: DrumBlock;
  initialBarIndex?: number;
  initialSessionState?: GridEditorSessionState;
  onChange: (block: DrumBlock, changedSlotIndex?: number, selectedBarIndex?: number) => void;
  onPreview: (block: DrumBlock, slotIndex: number) => void;
  onSelectBar?: (barIndex: number) => void;
  confirmAction?: (message: string) => boolean | Promise<boolean>;
}

const ARTICULATION_CLASS: Record<DrumArticulation, string> = {
  normal: "is-normal",
  accent: "is-accent",
  ghost: "is-ghost",
  flam: "is-flam",
  drag: "is-drag",
  diddle: "is-diddle",
  buzz: "is-buzz",
  choke: "is-choke"
};

const ARTICULATION_LABELS: Record<DrumArticulation, string> = {
  normal: "Normal",
  accent: "Accent",
  ghost: "Ghost",
  flam: "Flam",
  drag: "Drag",
  diddle: "Diddle",
  buzz: "Buzz",
  choke: "Choke"
};

const SVG_NS = "http://www.w3.org/2000/svg";

type BarActionIcon = "add" | "copy" | "copy-next" | "new-line" | "repeat" | "unrepeat" | "delete";

export type SelectedCell = InstrumentSelectedCell | StickingSelectedCell;

export interface InstrumentSelectedCell {
  kind: "instrument";
  slotIndex: number;
  instrumentId: string;
}

export interface StickingSelectedCell {
  kind: "sticking";
  slotIndex: number;
}

export interface HistoryEntry {
  block: DrumBlock;
  slotIndex?: number;
  barIndex: number;
}

export function mountGridEditor(options: GridEditorOptions): GridEditorHandle {
  let working = options.block;
  const initialSession = options.initialSessionState;
  const undoStack: HistoryEntry[] = initialSession?.undoStack ? [...initialSession.undoStack] : [];
  const redoStack: HistoryEntry[] = initialSession?.redoStack ? [...initialSession.redoStack] : [];
  let selectedCell: SelectedCell | null = normalizeSelectedCell(initialSession?.selectedCell);
  let selectedBarIndex = clampBarIndex(working, initialSession?.selectedBarIndex ?? options.initialBarIndex ?? 0);
  // Instruments shown as rows: those already in the block, plus any the user
  // adds from the palette (kept visible even before they have a hit).
  const extraInstruments: DrumInstrument[] = (initialSession?.extraInstrumentIds ?? [])
    .map((id) => DRUM_KIT.find((instrument) => instrument.id === id))
    .filter((instrument): instrument is DrumInstrument => !!instrument);
  const confirmAction = options.confirmAction ?? (() => false);

  const getSessionState = (): GridEditorSessionState => ({
    selectedBarIndex,
    selectedCell: selectedCell ? { ...selectedCell } : null,
    undoStack: [...undoStack],
    redoStack: [...redoStack],
    extraInstrumentIds: extraInstruments.map((instrument) => instrument.id)
  });

  const applyChange = (next: DrumBlock, slotIndex?: number, nextSelectedBarIndex = selectedBarIndex) => {
    if (next === working) {
      return;
    }

    undoStack.push({ block: working, slotIndex, barIndex: selectedBarIndex });
    redoStack.length = 0;
    working = next;
    selectedBarIndex = clampBarIndex(working, nextSelectedBarIndex);
    if (!cellBelongsToSelectedBar()) {
      selectedCell = null;
    }
    options.onChange(working, slotIndex, selectedBarIndex);
    render(true);
  };

  const undo = () => {
    const previous = undoStack.pop();

    if (!previous) {
      return;
    }

    redoStack.push({ block: working, slotIndex: previous.slotIndex, barIndex: selectedBarIndex });
    working = previous.block;
    selectedBarIndex = clampBarIndex(working, previous.barIndex);
    if (!cellBelongsToSelectedBar()) {
      selectedCell = null;
    }
    options.onChange(working, previous.slotIndex, selectedBarIndex);
    render(true);
  };

  const redo = () => {
    const next = redoStack.pop();

    if (!next) {
      return;
    }

    undoStack.push({ block: working, slotIndex: next.slotIndex, barIndex: selectedBarIndex });
    working = next.block;
    selectedBarIndex = clampBarIndex(working, next.barIndex);
    if (!cellBelongsToSelectedBar()) {
      selectedCell = null;
    }
    options.onChange(working, next.slotIndex, selectedBarIndex);
    render(true);
  };

  const selectBar = (barIndex: number, notify = false) => {
    const nextBarIndex = clampBarIndex(working, barIndex);

    if (nextBarIndex === selectedBarIndex && selectedCell === null) {
      return;
    }

    selectedBarIndex = nextBarIndex;
    selectedCell = null;
    if (notify) {
      options.onSelectBar?.(selectedBarIndex);
    }
    render(true);
  };

  const syncBlock = (block: DrumBlock, nextSelectedBarIndex = selectedBarIndex) => {
    working = block;
    selectedBarIndex = clampBarIndex(working, nextSelectedBarIndex);
    selectedCell = null;
    undoStack.length = 0;
    redoStack.length = 0;
    render();
  };

  const selectedBar = () => working.bars[selectedBarIndex];

  const cellBelongsToSelectedBar = (): boolean => {
    const bar = selectedBar();

    return !!bar && !!selectedCell && selectedCell.slotIndex >= bar.startSlot && selectedCell.slotIndex < bar.startSlot + bar.slots.length;
  };

  const selectedInstrument = (): DrumInstrument | undefined => {
    if (!selectedCell || selectedCell.kind !== "instrument") {
      return undefined;
    }

    const instrumentId = selectedCell.instrumentId;

    return displayedInstruments().find((instrument) => instrument.id === instrumentId);
  };

  const applyArticulationToSelection = (articulation: DrumArticulation) => {
    const instrument = selectedInstrument();

    if (!selectedCell || !instrument || !isArticulationAllowed(instrument, articulation)) {
      return;
    }

    const existing = findHit(working, selectedCell.slotIndex, instrument.id);
    const next = existing
      ? applyArticulation(working, selectedCell.slotIndex, instrument, articulation)
      : setHit(working, selectedCell.slotIndex, instrument, articulation);

    applyChange(next, selectedCell.slotIndex);
  };

  const clearSelectionHit = () => {
    const instrument = selectedInstrument();

    if (!selectedCell || !instrument) {
      return;
    }

    applyChange(clearHit(working, selectedCell.slotIndex, instrument), selectedCell.slotIndex);
  };

  const applyStickingToSelection = (hand: StickingHand) => {
    if (!selectedCell || selectedCell.kind !== "sticking") {
      return;
    }

    applyChange(setSticking(working, selectedCell.slotIndex, hand), selectedCell.slotIndex);
  };

  const clearSelectionSticking = () => {
    if (!selectedCell || selectedCell.kind !== "sticking") {
      return;
    }

    applyChange(clearSticking(working, selectedCell.slotIndex), selectedCell.slotIndex);
  };

  const clearSelection = () => {
    if (!selectedCell) {
      return;
    }

    if (selectedCell.kind === "sticking") {
      clearSelectionSticking();
      return;
    }

    clearSelectionHit();
  };

  const addBarAfterSelection = () => {
    applyChange(insertBarAfter(working, selectedBarIndex), undefined, selectedBarIndex + 1);
  };

  const duplicateSelectedBar = () => {
    applyChange(duplicateBar(working, selectedBarIndex), undefined, selectedBarIndex + 1);
  };

  const duplicateSelectedBarToNextSystem = () => {
    applyChange(duplicateBarToNextSystem(working, selectedBarIndex), undefined, barIndexForNextSystemCopy());
  };

  const addBarOnNewSystem = () => {
    applyChange(insertBarAfter(working, selectedBarIndex, "new-system"), undefined, barIndexAfterSelectedSystem());
  };

  const deleteSelectedBar = async () => {
    const bar = selectedBar();

    if (!bar) {
      return;
    }

    const hasHits = bar.slots.some((slot) => slot.hits.length > 0);
    if (hasHits && !(await confirmAction(`Delete bar ${selectedBarIndex + 1}?`))) {
      return;
    }

    applyChange(deleteBar(working, selectedBarIndex), undefined, Math.max(0, selectedBarIndex - 1));
  };

  const toggleSelectedBarRepeat = async () => {
    const bar = selectedBar();

    if (!bar) {
      return;
    }

    if (bar.measureRepeat) {
      applyChange(clearBarRepeat(working, selectedBarIndex), undefined, selectedBarIndex);
      return;
    }

    if (selectedBarIndex === 0) {
      return;
    }

    const hasHits = bar.slots.some((slot) => slot.hits.length > 0);
    if (hasHits && !(await confirmAction(`Replace bar ${selectedBarIndex + 1} with a repeat of the previous bar?`))) {
      return;
    }

    applyChange(setBarRepeat(working, selectedBarIndex), undefined, selectedBarIndex);
  };

  const barIndexAfterSelectedSystem = (): number => {
    let current = 0;

    for (const system of working.systems) {
      const next = current + system.bars.length;

      if (selectedBarIndex >= current && selectedBarIndex < next) {
        return next;
      }

      current = next;
    }

    return selectedBarIndex + 1;
  };

  const barIndexForNextSystemCopy = (): number => {
    let current = 0;

    for (let systemIndex = 0; systemIndex < working.systems.length; systemIndex++) {
      const system = working.systems[systemIndex];
      const next = current + system.bars.length;

      if (selectedBarIndex >= current && selectedBarIndex < next) {
        const nextSystem = working.systems[systemIndex + 1];
        return nextSystem ? next + nextSystem.bars.length : next;
      }

      current = next;
    }

    return selectedBarIndex + 1;
  };

  const previousTabIndex = options.container.getAttribute("tabindex");
  if (previousTabIndex === null) {
    options.container.tabIndex = -1;
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;

    if (!target || !options.container.contains(target)) {
      return;
    }

    const tagName = target?.tagName.toLowerCase();

    if (tagName === "input" || tagName === "select" || tagName === "textarea") {
      return;
    }

    const isUndo = (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "z";
    const isRedo =
      ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "z") ||
      ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y");

    if (isUndo) {
      event.preventDefault();
      undo();
    } else if (isRedo) {
      event.preventDefault();
      redo();
    } else if (selectedCell && (event.key === "Backspace" || event.key === "Delete")) {
      event.preventDefault();
      clearSelection();
    } else if (!event.metaKey && !event.ctrlKey && !event.altKey && selectedCell) {
      if (selectedCell.kind === "sticking") {
        const hand = getStickingForKey(event.key);

        if (hand) {
          event.preventDefault();
          applyStickingToSelection(hand);
        }

        return;
      }

      const articulation = getArticulationForKey(event.key);

      if (articulation) {
        event.preventDefault();
        applyArticulationToSelection(articulation);
      }
    }
  };

  options.container.addEventListener("keydown", onKeyDown);

  const render = (restoreFocus = false) => {
    const scrollSnapshot = captureEditorScroll(options.container);

    options.container.empty();
    const root = options.container.createEl("div", { cls: "pg-grid-editor" });
    root.tabIndex = -1;

    renderHeader(root);
    renderBarPager(root);
    renderBarActions(root);
    renderSelectedCellTools(root);

    if (working.slots.length === 0) {
      root.createEl("p", {
        cls: "pg-note pg-note--warn",
        text: "Edit mode needs a bar to work on. Add a row like \"HH | x---\" first."
      });
      return;
    }

    const bar = selectedBar();
    if (!bar) {
      root.createEl("p", {
        cls: "pg-note pg-note--warn",
        text: "Edit mode needs a selected bar."
      });
      return;
    }

    if (bar.measureRepeat) {
      root.createEl("p", {
        cls: "pg-grid-editor__repeat-note",
        text: `Bar ${selectedBarIndex + 1} is a one-bar repeat. Repeat bars are read-only in this editor step.`
      });
      return;
    }

    renderGrid(root);
    if (restoreFocus) {
      focusEditor(root);
    }
    restoreEditorScroll(options.container, scrollSnapshot);
    if (restoreFocus && scrollSnapshot && typeof window !== "undefined") {
      window.requestAnimationFrame(() => restoreEditorScroll(options.container, scrollSnapshot));
    }
  };

  const renderHeader = (root: HTMLElement) => {
    const bar = root.createEl("div", { cls: "pg-grid-editor__bar" });

    const paletteWrap = bar.createEl("span", { cls: "pg-grid-editor__palette-wrap" });
    const palette = paletteWrap.createEl("select", { cls: "pg-grid-editor__palette" }) as HTMLSelectElement;
    palette.createEl("option", { text: "+ add instrument", value: "" });
    palette.disabled = !!selectedBar()?.measureRepeat;
    for (const instrument of DRUM_KIT) {
      if (!displayedInstruments().some((shown) => shown.id === instrument.id)) {
        palette.createEl("option", { text: instrument.label, value: instrument.id });
      }
    }
    palette.addEventListener("change", () => {
      const instrument = DRUM_KIT.find((candidate) => candidate.id === palette.value);
      if (instrument) {
        extraInstruments.push(instrument);
        render(true);
      }
    });
    paletteWrap.createEl("span", { cls: "pg-grid-editor__palette-caret", attr: { "aria-hidden": "true" } });

    const spacer = bar.createEl("span", { cls: "pg-grid-editor__spacer" });
    spacer.textContent = "Live edit";

    const undoButton = bar.createEl("button", { cls: "pg-btn", text: "Undo" }) as HTMLButtonElement;
    undoButton.disabled = undoStack.length === 0;
    undoButton.addEventListener("click", undo);

    const redoButton = bar.createEl("button", { cls: "pg-btn", text: "Redo" }) as HTMLButtonElement;
    redoButton.disabled = redoStack.length === 0;
    redoButton.addEventListener("click", redo);
  };

  const renderBarPager = (root: HTMLElement) => {
    const pager = root.createEl("div", { cls: "pg-grid-editor__bar-pager" });

    working.bars.forEach((bar, index) => {
      const button = pager.createEl("button", {
        cls: `pg-grid-editor__bar-chip ${index === selectedBarIndex ? "is-active" : ""} ${bar.measureRepeat ? "is-repeat" : ""}`,
        text: bar.measureRepeat ? `Bar ${index + 1} %` : `Bar ${index + 1}`
      }) as HTMLButtonElement;

      button.type = "button";
      button.setAttr("aria-pressed", index === selectedBarIndex ? "true" : "false");
      button.title = bar.measureRepeat ? `Bar ${index + 1} is read-only repeat notation` : `Edit bar ${index + 1}`;
      button.addEventListener("click", () => selectBar(index, true));
    });
  };

  const renderBarActions = (root: HTMLElement) => {
    if (working.bars.length === 0) {
      return;
    }

    const actions = root.createEl("div", { cls: "pg-grid-editor__bar-actions" });
    createBarAction(actions, "Add", "add", "Add bar after", addBarAfterSelection);
    createBarAction(actions, "Copy", "copy", "Duplicate bar", duplicateSelectedBar);
    createBarAction(actions, "Copy ↓", "copy-next", "Copy bar to next line", duplicateSelectedBarToNextSystem);
    createBarAction(actions, "New line", "new-line", "Add bar on new line", addBarOnNewSystem);

    const isRepeat = !!selectedBar()?.measureRepeat;
    const repeatButton = createBarAction(
      actions,
      isRepeat ? "Unrepeat" : "Repeat",
      isRepeat ? "unrepeat" : "repeat",
      isRepeat ? "Make repeat bar editable" : "Repeat previous bar",
      () => {
        void toggleSelectedBarRepeat();
      }
    );
    repeatButton.disabled = selectedBarIndex === 0 && !selectedBar()?.measureRepeat;

    actions.createEl("span", {
      cls: "pg-grid-editor__bar-action-separator",
      attr: { "aria-hidden": "true" }
    });

    createBarAction(actions, "Delete", "delete", "Delete bar", () => {
      void deleteSelectedBar();
    }, "pg-grid-editor__bar-action--delete");
  };

  const renderSelectedCellTools = (root: HTMLElement) => {
    const tools = root.createEl("div", { cls: "pg-grid-editor__tools" });
    tools.setAttr("aria-live", "polite");

    if (selectedCell?.kind === "sticking" && renderStickingTools(tools)) {
      return;
    }

    if (selectedCell?.kind !== "sticking" && renderArticulationTools(tools)) {
      return;
    }

    tools.createEl("span", {
      cls: "pg-grid-editor__tools-placeholder",
      text: "Select a note or sticking cell to edit"
    });
  };

  const renderArticulationTools = (tools: HTMLElement): boolean => {
    const instrument = selectedInstrument();
    const slotIndex = selectedCell?.slotIndex;

    if (!instrument || slotIndex === undefined || !cellBelongsToSelectedBar()) {
      return false;
    }

    const hit = findHit(working, slotIndex, instrument.id);
    const label = tools.createEl("span", {
      cls: "pg-grid-editor__selection",
      text: `${(instrument.aliases[0] ?? instrument.id).toUpperCase()} ${slotIndex + 1}`
    });

    label.setAttr("aria-live", "polite");

    getAllowedArticulations(instrument).forEach((articulation) => {
      const button = tools.createEl("button", {
        cls: `pg-grid-editor__tool ${hit?.articulation === articulation ? "is-active" : ""}`
      }) as HTMLButtonElement;

      button.dataset.articulation = articulation;
      button.title = ARTICULATION_LABELS[articulation];
      button.setAttr("aria-label", ARTICULATION_LABELS[articulation]);
      button.appendChild(createArticulationIcon(articulation));
      button.addEventListener("click", () => applyArticulationToSelection(articulation));
    });

    tools.createEl("span", {
      cls: "pg-grid-editor__tool-separator",
      attr: { "aria-hidden": "true" }
    });

    const deleteButton = tools.createEl("button", {
      cls: "pg-grid-editor__tool pg-grid-editor__tool--delete"
    }) as HTMLButtonElement;

    deleteButton.title = "Delete note";
    deleteButton.setAttr("aria-label", "Delete note");
    deleteButton.appendChild(createDeleteIcon());
    deleteButton.disabled = !hit;
    deleteButton.addEventListener("click", clearSelectionHit);
    return true;
  };

  const renderStickingTools = (tools: HTMLElement): boolean => {
    const slotIndex = selectedCell?.slotIndex;

    if (selectedCell?.kind !== "sticking" || slotIndex === undefined || !cellBelongsToSelectedBar()) {
      return false;
    }

    const sticking = findSticking(working, slotIndex);
    tools.addClass("pg-grid-editor__tools--sticking");
    const label = tools.createEl("span", {
      cls: "pg-grid-editor__selection",
      text: `ST ${slotIndex + 1}`
    });

    label.setAttr("aria-live", "polite");

    ([
      ["right", "R", "Right hand"],
      ["left", "L", "Left hand"],
      ["both", "B", "Both hands"]
    ] as const).forEach(([hand, text, title]) => {
      const button = tools.createEl("button", {
        cls: `pg-grid-editor__tool pg-grid-editor__tool--sticking ${sticking === hand ? "is-active" : ""}`,
        text
      }) as HTMLButtonElement;

      button.title = title;
      button.setAttr("aria-label", title);
      button.addEventListener("click", () => applyStickingToSelection(hand));
    });

    tools.createEl("span", {
      cls: "pg-grid-editor__tool-separator",
      attr: { "aria-hidden": "true" }
    });

    const clearButton = tools.createEl("button", {
      cls: "pg-grid-editor__tool pg-grid-editor__tool--delete"
    }) as HTMLButtonElement;

    clearButton.title = "Clear sticking";
    clearButton.setAttr("aria-label", "Clear sticking");
    clearButton.appendChild(createDeleteIcon());
    clearButton.disabled = !sticking;
    clearButton.addEventListener("click", clearSelectionSticking);
    return true;
  };

  const displayedInstruments = (): DrumInstrument[] => {
    const seen = new Set<string>();
    const result: DrumInstrument[] = [];
    for (const row of working.rows) {
      if (!seen.has(row.instrument.id)) {
        seen.add(row.instrument.id);
        result.push(row.instrument);
      }
    }
    for (const instrument of extraInstruments) {
      if (!seen.has(instrument.id)) {
        seen.add(instrument.id);
        result.push(instrument);
      }
    }
    return result;
  };

  const renderGrid = (root: HTMLElement) => {
    const bar = selectedBar();

    if (!bar) {
      return;
    }

    const slotsPerBeat = getSlotsPerBeat(working.timeSignature, working.gridResolution);
    const barStartSlots = new Set([bar.startSlot]);
    const localIndex = new Map<number, number>();
    bar.slots.forEach((slot, index) => localIndex.set(slot.index, index));

    const grid = root.createEl("div", { cls: "pg-grid" });
    grid.style.setProperty("--pg-grid-cols", String(bar.slots.length));
    grid.style.setProperty("--pg-grid-width", gridWidth(bar.slots.length));

    renderRuler(grid, bar, slotsPerBeat, barStartSlots, localIndex);
    renderStickingRow(grid, bar, slotsPerBeat, barStartSlots, localIndex);

    for (const instrument of displayedInstruments()) {
      const rowEl = grid.createEl("div", { cls: "pg-grid__row" });
      rowEl.createEl("div", {
        cls: "pg-grid__label",
        text: (instrument.aliases[0] ?? instrument.id).toUpperCase()
      });

      const cells = rowEl.createEl("div", { cls: "pg-grid__cells" });
      cells.style.setProperty("--pg-grid-cols", String(bar.slots.length));

      for (const slot of bar.slots) {
        const hit = findHit(working, slot.index, instrument.id);
        const cell = cells.createEl("button", { cls: "pg-grid__cell" });
        const isSelected =
          selectedCell?.kind === "instrument" && selectedCell.slotIndex === slot.index && selectedCell.instrumentId === instrument.id;

        addBoundaryClasses(cell, slot.index, slotsPerBeat, barStartSlots, localIndex);

        if (hit) {
          cell.classList.add("is-hit", ARTICULATION_CLASS[hit.articulation]);
          cell.textContent = getHitChar(instrument, hit.articulation);
        }

        if (isSelected) {
          cell.classList.add("is-selected");
          cell.setAttr("aria-pressed", "true");
        }

        cell.addEventListener("click", () => {
          selectedCell = { kind: "instrument", slotIndex: slot.index, instrumentId: instrument.id };

          if (hit) {
            options.onPreview(working, slot.index);
            render(true);
            return;
          }

          applyChange(setHit(working, slot.index, instrument), slot.index);
        });

        cell.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          selectedCell = { kind: "instrument", slotIndex: slot.index, instrumentId: instrument.id };
          if (hit) {
            options.onPreview(working, slot.index);
          }
          render(true);
        });
      }
    }
  };

  const renderStickingRow = (
    grid: HTMLElement,
    bar: NonNullable<ReturnType<typeof selectedBar>>,
    slotsPerBeat: number,
    barStartSlots: Set<number>,
    localIndex: Map<number, number>
  ) => {
    const rowEl = grid.createEl("div", { cls: "pg-grid__row pg-grid__row--sticking" });
    rowEl.createEl("div", {
      cls: "pg-grid__label pg-grid__label--sticking",
      text: "ST"
    });

    const cells = rowEl.createEl("div", { cls: "pg-grid__cells" });
    cells.style.setProperty("--pg-grid-cols", String(bar.slots.length));

    for (const slot of bar.slots) {
      const sticking = findSticking(working, slot.index);
      const cell = cells.createEl("button", { cls: "pg-grid__cell pg-grid__cell--sticking" });
      const isSelected = selectedCell?.kind === "sticking" && selectedCell.slotIndex === slot.index;

      addBoundaryClasses(cell, slot.index, slotsPerBeat, barStartSlots, localIndex);

      if (sticking) {
        cell.classList.add("is-sticking", getStickingClass(sticking));
        cell.textContent = getStickingLabel(sticking);
      }

      if (isSelected) {
        cell.classList.add("is-selected");
        cell.setAttr("aria-pressed", "true");
      }

      cell.addEventListener("click", () => {
        selectedCell = { kind: "sticking", slotIndex: slot.index };

        if (sticking) {
          render(true);
          return;
        }

        applyChange(setSticking(working, slot.index, "right"), slot.index);
      });

      cell.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        selectedCell = { kind: "sticking", slotIndex: slot.index };
        render(true);
      });
    }
  };

  const renderRuler = (
    grid: HTMLElement,
    bar: NonNullable<ReturnType<typeof selectedBar>>,
    slotsPerBeat: number,
    barStartSlots: Set<number>,
    localIndex: Map<number, number>
  ) => {
    const ruler = grid.createEl("div", { cls: "pg-grid__ruler" });
    ruler.createEl("div", { cls: "pg-grid__ruler-label", text: "Count" });

    const cells = ruler.createEl("div", { cls: "pg-grid__ruler-cells" });
    cells.style.setProperty("--pg-grid-cols", String(bar.slots.length));

    for (const slot of bar.slots) {
      const cell = cells.createEl("div", {
        cls: "pg-grid__ruler-cell",
        text: countLabel(localIndex.get(slot.index) ?? 0, slotsPerBeat)
      });

      cell.setAttr("aria-label", `Slot ${slot.index + 1}`);
      addBoundaryClasses(cell, slot.index, slotsPerBeat, barStartSlots, localIndex);
    }
  };

  render();

  return {
    getSessionState() {
      return getSessionState();
    },
    selectBar(barIndex: number) {
      selectBar(barIndex);
    },
    syncBlock(block: DrumBlock, nextSelectedBarIndex?: number) {
      syncBlock(block, nextSelectedBarIndex);
    },
    destroy() {
      options.container.removeEventListener("keydown", onKeyDown);
      if (previousTabIndex === null) {
        options.container.removeAttribute("tabindex");
      } else {
        options.container.setAttribute("tabindex", previousTabIndex);
      }
      options.container.empty();
    }
  };
}

function focusEditor(root: HTMLElement): void {
  const selected = root.querySelector<HTMLElement>(".pg-grid__cell.is-selected");
  (selected ?? root).focus({ preventScroll: true });
}

interface EditorScrollSnapshot {
  gridScrollLeft: number;
  gridScrollTop: number;
  ancestors: AncestorScrollSnapshot[];
}

interface AncestorScrollSnapshot {
  element: HTMLElement;
  scrollLeft: number;
  scrollTop: number;
}

function captureEditorScroll(container: HTMLElement): EditorScrollSnapshot | null {
  const grid = container.querySelector<HTMLElement>(".pg-grid");

  if (!grid) {
    return null;
  }

  return {
    ancestors: captureScrollableAncestors(container),
    gridScrollLeft: grid.scrollLeft,
    gridScrollTop: grid.scrollTop
  };
}

function restoreEditorScroll(container: HTMLElement, snapshot: EditorScrollSnapshot | null): void {
  if (!snapshot) {
    return;
  }

  const grid = container.querySelector<HTMLElement>(".pg-grid");

  if (!grid) {
    return;
  }

  grid.scrollLeft = snapshot.gridScrollLeft;
  grid.scrollTop = snapshot.gridScrollTop;
  snapshot.ancestors.forEach(({ element, scrollLeft, scrollTop }) => {
    element.scrollLeft = scrollLeft;
    element.scrollTop = scrollTop;
  });
}

function captureScrollableAncestors(container: HTMLElement): AncestorScrollSnapshot[] {
  const ancestors: AncestorScrollSnapshot[] = [];
  let element = container.parentElement;

  while (element && element !== document.body) {
    if (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth) {
      ancestors.push({
        element,
        scrollLeft: element.scrollLeft,
        scrollTop: element.scrollTop
      });
    }

    element = element.parentElement;
  }

  return ancestors;
}

function normalizeSelectedCell(cell: SelectedCell | ({ slotIndex: number; instrumentId: string } & Partial<InstrumentSelectedCell>) | null | undefined): SelectedCell | null {
  if (!cell) {
    return null;
  }

  if ("kind" in cell && cell.kind === "sticking") {
    return { kind: "sticking", slotIndex: cell.slotIndex };
  }

  if ("instrumentId" in cell && cell.instrumentId) {
    return { kind: "instrument", slotIndex: cell.slotIndex, instrumentId: cell.instrumentId };
  }

  return null;
}

function getStickingForKey(value: string): StickingHand | null {
  if (value === "R" || value === "r") {
    return "right";
  }

  if (value === "L" || value === "l") {
    return "left";
  }

  if (value === "B" || value === "b") {
    return "both";
  }

  return null;
}

function getStickingLabel(hand: StickingHand): string {
  if (hand === "left") {
    return "L";
  }

  if (hand === "both") {
    return "B";
  }

  return "R";
}

function getStickingClass(hand: StickingHand): string {
  if (hand === "left") {
    return "is-left";
  }

  if (hand === "both") {
    return "is-both";
  }

  return "is-right";
}

function addBoundaryClasses(
  element: HTMLElement,
  slotIndex: number,
  slotsPerBeat: number,
  barStartSlots: Set<number>,
  localIndex: Map<number, number>
): void {
  if (barStartSlots.has(slotIndex) && slotIndex !== 0) {
    element.classList.add("is-bar-start");
  } else if ((localIndex.get(slotIndex) ?? 0) % slotsPerBeat === 0) {
    element.classList.add("is-beat-start");
  }
}

function countLabel(slotIndexInBar: number, slotsPerBeat: number): string {
  const beat = Math.floor(slotIndexInBar / slotsPerBeat) + 1;
  const offset = slotIndexInBar % slotsPerBeat;

  if (offset === 0) {
    return String(beat);
  }

  if (slotsPerBeat === 4) {
    return ["", "e", "&", "a"][offset] ?? "";
  }

  if (slotsPerBeat === 8) {
    return ["", "", "e", "", "&", "", "a", ""][offset] ?? "";
  }

  return "";
}

function gridWidth(slotCount: number): string {
  const cellWidth = 26;
  const gapWidth = 2;
  return `${slotCount * cellWidth + Math.max(0, slotCount - 1) * gapWidth}px`;
}

function clampBarIndex(block: DrumBlock, barIndex: number): number {
  if (block.bars.length === 0) {
    return 0;
  }

  return Math.min(block.bars.length - 1, Math.max(0, Math.round(barIndex)));
}

function createArticulationIcon(articulation: DrumArticulation): SVGSVGElement {
  const svg = createSvg("svg", {
    class: "pg-grid-editor__tool-icon",
    viewBox: "0 0 36 36",
    "aria-hidden": "true",
    focusable: "false"
  });

  switch (articulation) {
    case "accent":
      appendSvg(svg, "polyline", {
        points: "12 13 25 18 12 23",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "3.3",
        "stroke-linecap": "round",
        "stroke-linejoin": "round"
      });
      break;
    case "ghost":
      appendNotehead(svg, 18, 19, 8, 5);
      appendSvg(svg, "path", {
        d: "M11 8 C6 13 6 24 11 29",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2.3",
        "stroke-linecap": "round"
      });
      appendSvg(svg, "path", {
        d: "M25 8 C30 13 30 24 25 29",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2.3",
        "stroke-linecap": "round"
      });
      break;
    case "flam":
      appendGraceNote(svg, 11, 24, 0.72);
      appendMainNote(svg, 25, 24);
      appendSvg(svg, "path", {
        d: "M15 21 C18 17 21 17 24 21",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.8",
        "stroke-linecap": "round"
      });
      break;
    case "drag":
      appendGraceNote(svg, 8, 24, 0.65);
      appendGraceNote(svg, 15, 24, 0.65);
      appendSvg(svg, "polygon", {
        points: "11 9 22 9 22 12 11 12",
        fill: "currentColor"
      });
      appendMainNote(svg, 27, 24);
      appendSvg(svg, "path", {
        d: "M11 28 C16 31 23 31 28 27",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.8",
        "stroke-linecap": "round"
      });
      break;
    case "diddle":
      appendSvg(svg, "line", {
        x1: "13",
        y1: "23",
        x2: "24",
        y2: "13",
        stroke: "currentColor",
        "stroke-width": "5.5",
        "stroke-linecap": "round"
      });
      break;
    case "buzz":
      appendSvg(svg, "path", {
        d: "M10 13 H25 L11 23 H26",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "3.5",
        "stroke-linecap": "round",
        "stroke-linejoin": "round"
      });
      break;
    case "choke":
      appendSvg(svg, "line", {
        x1: "11",
        y1: "12",
        x2: "25",
        y2: "26",
        stroke: "currentColor",
        "stroke-width": "3",
        "stroke-linecap": "round"
      });
      appendSvg(svg, "line", {
        x1: "25",
        y1: "12",
        x2: "11",
        y2: "26",
        stroke: "currentColor",
        "stroke-width": "3",
        "stroke-linecap": "round"
      });
      appendSvg(svg, "path", {
        d: "M14 8 C17 6 21 6 24 8",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2",
        "stroke-linecap": "round"
      });
      break;
    case "normal":
    default:
      appendNotehead(svg, 18, 18, 8.5, 5.3);
      break;
  }

  return svg;
}

function createBarAction(
  parent: HTMLElement,
  label: string,
  icon: BarActionIcon,
  title: string,
  onClick: () => void,
  extraClass = ""
): HTMLButtonElement {
  const button = parent.createEl("button", {
    cls: `pg-grid-editor__bar-action ${extraClass}`.trim()
  }) as HTMLButtonElement;

  button.type = "button";
  button.title = title;
  button.setAttr("aria-label", title);
  button.appendChild(createBarActionIcon(icon));
  button.createEl("span", { cls: "pg-grid-editor__bar-action-label", text: label });
  button.addEventListener("click", onClick);

  return button;
}

function createBarActionIcon(icon: BarActionIcon): SVGSVGElement {
  const svg = createSvg("svg", {
    class: "pg-grid-editor__bar-action-icon",
    viewBox: "0 0 24 24",
    "aria-hidden": "true",
    focusable: "false"
  });
  const lineAttrs = {
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  };

  switch (icon) {
    case "add":
      appendSvg(svg, "path", { d: "M12 5 V19 M5 12 H19", ...lineAttrs });
      break;
    case "copy":
      appendSvg(svg, "rect", { x: "8", y: "8", width: "10", height: "10", rx: "1.5", ...lineAttrs });
      appendSvg(svg, "path", { d: "M6 15 H5 C4.4 15 4 14.6 4 14 V5 C4 4.4 4.4 4 5 4 H14 C14.6 4 15 4.4 15 5 V6", ...lineAttrs });
      break;
    case "copy-next":
      appendSvg(svg, "rect", { x: "5", y: "4", width: "9", height: "9", rx: "1.5", ...lineAttrs });
      appendSvg(svg, "path", { d: "M10 13 H15 C15.6 13 16 13.4 16 14 V19", ...lineAttrs });
      appendSvg(svg, "path", { d: "M12.5 16.5 L16 20 L19.5 16.5", ...lineAttrs });
      break;
    case "new-line":
      appendSvg(svg, "path", { d: "M5 6 H19 M5 11 H13 M13 11 V19", ...lineAttrs });
      appendSvg(svg, "path", { d: "M9.5 15.5 L13 19 L16.5 15.5", ...lineAttrs });
      break;
    case "repeat":
      appendSvg(svg, "path", { d: "M17 2 L21 6 L17 10", ...lineAttrs });
      appendSvg(svg, "path", { d: "M3 11 V9 C3 7.3 4.3 6 6 6 H21", ...lineAttrs });
      appendSvg(svg, "path", { d: "M7 22 L3 18 L7 14", ...lineAttrs });
      appendSvg(svg, "path", { d: "M21 13 V15 C21 16.7 19.7 18 18 18 H3", ...lineAttrs });
      break;
    case "unrepeat":
      appendSvg(svg, "path", { d: "M17 2 L21 6 L17 10", ...lineAttrs });
      appendSvg(svg, "path", { d: "M3 11 V9 C3 7.3 4.3 6 6 6 H21", ...lineAttrs });
      appendSvg(svg, "path", { d: "M7 22 L3 18 L7 14", ...lineAttrs });
      appendSvg(svg, "path", { d: "M21 13 V15 C21 16.7 19.7 18 18 18 H3", ...lineAttrs });
      appendSvg(svg, "path", {
        d: "M9.5 9.5 L14.5 14.5 M14.5 9.5 L9.5 14.5",
        ...lineAttrs,
        "stroke-width": "2.2"
      });
      break;
    case "delete":
      appendSvg(svg, "path", { d: "M5 7 H19", ...lineAttrs });
      appendSvg(svg, "path", { d: "M9 7 V5 C9 4.4 9.4 4 10 4 H14 C14.6 4 15 4.4 15 5 V7", ...lineAttrs });
      appendSvg(svg, "path", { d: "M17 7 L16.3 19 C16.2 19.6 15.7 20 15.1 20 H8.9 C8.3 20 7.8 19.6 7.7 19 L7 7", ...lineAttrs });
      appendSvg(svg, "path", { d: "M10 11 V16 M14 11 V16", ...lineAttrs });
      break;
  }

  return svg;
}

function createDeleteIcon(): SVGSVGElement {
  const svg = createSvg("svg", {
    class: "pg-grid-editor__tool-icon",
    viewBox: "0 0 36 36",
    "aria-hidden": "true",
    focusable: "false"
  });

  appendSvg(svg, "path", {
    d: "M10 13 H26",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2.5",
    "stroke-linecap": "round"
  });
  appendSvg(svg, "path", {
    d: "M15 13 V10 C15 9.4 15.4 9 16 9 H20 C20.6 9 21 9.4 21 10 V13",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2.3",
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  });
  appendSvg(svg, "path", {
    d: "M24 13 L23 27 C22.9 28.1 22 29 20.9 29 H15.1 C14 29 13.1 28.1 13 27 L12 13",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2.3",
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  });
  appendSvg(svg, "path", {
    d: "M16.5 17 V25 M19.5 17 V25",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2.1",
    "stroke-linecap": "round"
  });

  return svg;
}

function appendGraceNote(svg: SVGSVGElement, x: number, y: number, scale: number): void {
  appendNotehead(svg, x, y, 5.2 * scale, 3.5 * scale);
  appendSvg(svg, "line", {
    x1: String(x + 3.2 * scale),
    y1: String(y - 1.8 * scale),
    x2: String(x + 3.2 * scale),
    y2: String(y - 15 * scale),
    stroke: "currentColor",
    "stroke-width": String(1.9 * scale),
    "stroke-linecap": "round"
  });
}

function appendMainNote(svg: SVGSVGElement, x: number, y: number): void {
  appendNotehead(svg, x, y, 7.2, 4.8);
  appendSvg(svg, "line", {
    x1: String(x + 4.5),
    y1: String(y - 2.4),
    x2: String(x + 4.5),
    y2: "7",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round"
  });
}

function appendNotehead(svg: SVGSVGElement, cx: number, cy: number, rx: number, ry: number): void {
  appendSvg(svg, "ellipse", {
    cx: String(cx),
    cy: String(cy),
    rx: String(rx),
    ry: String(ry),
    transform: `rotate(-18 ${cx} ${cy})`,
    fill: "currentColor"
  });
}

function appendSvg<K extends keyof SVGElementTagNameMap>(
  parent: SVGElement,
  name: K,
  attrs: Record<string, string>
): SVGElementTagNameMap[K] {
  const element = createSvg(name, attrs);

  parent.appendChild(element);

  return element;
}

function createSvg<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string>
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);

  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));

  return element;
}
