// A fixed-grid visual editor that runs entirely on the pure model + edit
// helpers. Rows are instruments, columns are slots — so horizontal hit-testing
// (x -> slot) is trivial and the vertical "which instrument?" ambiguity the
// architecture notes call out is resolved by the row itself (and the palette).
//
// Every mutation goes through edit.ts (setHit / applyArticulation / clearHit)
// and returns a new block. Nothing here reaches into the renderer or the DOM
// beyond its container.

import { applyArticulation, clearHit, findHit, setHit } from "../../src/edit";
import { DRUM_KIT, getAllowedArticulations, getHitChar, isArticulationAllowed } from "../../src/kit";
import { getSlotsPerBeat } from "../../src/music";
import { DrumArticulation, DrumBlock, DrumInstrument } from "../../src/types";

export interface GridEditorHandle {
  destroy(): void;
  selectBar(barIndex: number): void;
}

interface GridEditorOptions {
  container: HTMLElement;
  block: DrumBlock;
  initialBarIndex?: number;
  onChange: (block: DrumBlock, changedSlotIndex?: number) => void;
  onPreview: (block: DrumBlock, slotIndex: number) => void;
  onSelectBar?: (barIndex: number) => void;
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

interface SelectedCell {
  slotIndex: number;
  instrumentId: string;
}

export function mountGridEditor(options: GridEditorOptions): GridEditorHandle {
  let working = options.block;
  const undoStack: Array<{ block: DrumBlock; slotIndex?: number }> = [];
  const redoStack: Array<{ block: DrumBlock; slotIndex?: number }> = [];
  let selectedCell: SelectedCell | null = null;
  let selectedBarIndex = clampBarIndex(working, options.initialBarIndex ?? 0);
  // Instruments shown as rows: those already in the block, plus any the user
  // adds from the palette (kept visible even before they have a hit).
  const extraInstruments: DrumInstrument[] = [];

  const applyChange = (next: DrumBlock, slotIndex?: number) => {
    if (next === working) {
      return;
    }

    undoStack.push({ block: working, slotIndex });
    redoStack.length = 0;
    working = next;
    selectedBarIndex = clampBarIndex(working, selectedBarIndex);
    if (!cellBelongsToSelectedBar()) {
      selectedCell = null;
    }
    options.onChange(working, slotIndex);
    render();
  };

  const undo = () => {
    const previous = undoStack.pop();

    if (!previous) {
      return;
    }

    redoStack.push({ block: working, slotIndex: previous.slotIndex });
    working = previous.block;
    selectedBarIndex = clampBarIndex(working, selectedBarIndex);
    if (!cellBelongsToSelectedBar()) {
      selectedCell = null;
    }
    options.onChange(working, previous.slotIndex);
    render();
  };

  const redo = () => {
    const next = redoStack.pop();

    if (!next) {
      return;
    }

    undoStack.push({ block: working, slotIndex: next.slotIndex });
    working = next.block;
    selectedBarIndex = clampBarIndex(working, selectedBarIndex);
    if (!cellBelongsToSelectedBar()) {
      selectedCell = null;
    }
    options.onChange(working, next.slotIndex);
    render();
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
    render();
  };

  const selectedBar = () => working.bars[selectedBarIndex];

  const cellBelongsToSelectedBar = (): boolean => {
    const bar = selectedBar();

    return !!bar && !!selectedCell && selectedCell.slotIndex >= bar.startSlot && selectedCell.slotIndex < bar.startSlot + bar.slots.length;
  };

  const selectedInstrument = (): DrumInstrument | undefined => {
    if (!selectedCell) {
      return undefined;
    }

    return displayedInstruments().find((instrument) => instrument.id === selectedCell?.instrumentId);
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

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
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
      clearSelectionHit();
    } else if (!event.metaKey && !event.ctrlKey && !event.altKey && selectedCell) {
      const articulation = articulationFromKey(event.key);

      if (articulation) {
        event.preventDefault();
        applyArticulationToSelection(articulation);
      }
    }
  };

  document.addEventListener("keydown", onKeyDown);

  const render = () => {
    options.container.empty();
    const root = options.container.createEl("div", { cls: "pg-grid-editor" });

    renderHeader(root);
    renderBarPager(root);
    renderArticulationTools(root);

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
  };

  const renderHeader = (root: HTMLElement) => {
    const bar = root.createEl("div", { cls: "pg-grid-editor__bar" });

    const palette = bar.createEl("select", { cls: "pg-grid-editor__palette" }) as HTMLSelectElement;
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
        render();
      }
    });

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

  const renderArticulationTools = (root: HTMLElement) => {
    const instrument = selectedInstrument();
    const slotIndex = selectedCell?.slotIndex;

    if (!instrument || slotIndex === undefined || !cellBelongsToSelectedBar()) {
      return;
    }

    const hit = findHit(working, slotIndex, instrument.id);
    const tools = root.createEl("div", { cls: "pg-grid-editor__tools" });
    const label = tools.createEl("span", {
      cls: "pg-grid-editor__selection",
      text: `${(instrument.aliases[0] ?? instrument.id).toUpperCase()} ${slotIndex + 1}`
    });

    label.setAttr("aria-live", "polite");

    getAllowedArticulations(instrument).forEach((articulation) => {
      const button = tools.createEl("button", {
        cls: `pg-grid-editor__tool ${hit?.articulation === articulation ? "is-active" : ""}`,
        text: getHitChar(instrument, articulation)
      }) as HTMLButtonElement;

      button.dataset.articulation = articulation;
      button.title = ARTICULATION_LABELS[articulation];
      button.setAttr("aria-label", ARTICULATION_LABELS[articulation]);
      button.addEventListener("click", () => applyArticulationToSelection(articulation));
    });

    const deleteButton = tools.createEl("button", {
      cls: "pg-grid-editor__tool pg-grid-editor__tool--delete",
      text: "×"
    }) as HTMLButtonElement;

    deleteButton.title = "Delete";
    deleteButton.setAttr("aria-label", "Delete");
    deleteButton.disabled = !hit;
    deleteButton.addEventListener("click", clearSelectionHit);
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
        const isSelected = selectedCell?.slotIndex === slot.index && selectedCell.instrumentId === instrument.id;

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
          selectedCell = { slotIndex: slot.index, instrumentId: instrument.id };

          if (hit) {
            options.onPreview(working, slot.index);
            render();
            return;
          }

          applyChange(setHit(working, slot.index, instrument), slot.index);
        });

        cell.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          selectedCell = { slotIndex: slot.index, instrumentId: instrument.id };
          if (hit) {
            options.onPreview(working, slot.index);
          }
          render();
        });
      }
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
    selectBar(barIndex: number) {
      selectBar(barIndex);
    },
    destroy() {
      document.removeEventListener("keydown", onKeyDown);
      options.container.empty();
    }
  };
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

function articulationFromKey(key: string): DrumArticulation | null {
  switch (key) {
    case "x":
    case "o":
      return "normal";
    case "X":
    case "O":
      return "accent";
    case "g":
      return "ghost";
    case "f":
      return "flam";
    case "r":
      return "drag";
    case "d":
      return "diddle";
    case "z":
      return "buzz";
    case "c":
      return "choke";
    default:
      return null;
  }
}
