// A fixed-grid visual editor that runs entirely on the pure model + edit
// helpers. Rows are instruments, columns are slots — so horizontal hit-testing
// (x -> slot) is trivial and the vertical "which instrument?" ambiguity the
// architecture notes call out is resolved by the row itself (and the palette).
//
// Every mutation goes through edit.ts (toggleHit / applyArticulation /
// removeHit) and returns a new block; Save serializes the working block back to
// text. Nothing here reaches into the renderer or the DOM beyond its container.

import { applyArticulation, findHit, removeHit, toggleHit } from "../../src/edit";
import { DRUM_KIT, getHitChar } from "../../src/kit";
import { getSlotsPerBeat } from "../../src/music";
import { DrumArticulation, DrumBlock, DrumInstrument } from "../../src/types";

export interface GridEditorHandle {
  destroy(): void;
}

interface GridEditorOptions {
  container: HTMLElement;
  block: DrumBlock;
  onSave: (block: DrumBlock) => void;
  onCancel: () => void;
}

// Click cycle for a cell: empty -> normal -> accent -> ghost -> empty.
const CYCLE: Array<DrumArticulation | null> = [null, "normal", "accent", "ghost"];

const ARTICULATION_CLASS: Record<DrumArticulation, string> = {
  normal: "is-normal",
  accent: "is-accent",
  ghost: "is-ghost",
  flam: "is-flam",
  diddle: "is-diddle",
  buzz: "is-buzz"
};

export function mountGridEditor(options: GridEditorOptions): GridEditorHandle {
  let working = options.block;
  // Instruments shown as rows: those already in the block, plus any the user
  // adds from the palette (kept visible even before they have a hit).
  const extraInstruments: DrumInstrument[] = [];

  const render = () => {
    options.container.empty();
    const root = options.container.createEl("div", { cls: "pg-grid-editor" });

    renderHeader(root);

    if (working.slots.length === 0) {
      root.createEl("p", {
        cls: "pg-note pg-note--warn",
        text: "Edit mode needs a bar to work on. Add a row like \"HH | x---\" first."
      });
      return;
    }

    renderGrid(root);
  };

  const renderHeader = (root: HTMLElement) => {
    const bar = root.createEl("div", { cls: "pg-grid-editor__bar" });

    const palette = bar.createEl("select", { cls: "pg-grid-editor__palette" }) as HTMLSelectElement;
    palette.createEl("option", { text: "+ add instrument", value: "" });
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
    spacer.textContent = "click a cell to cycle: empty → hit → accent → ghost";

    const save = bar.createEl("button", { cls: "pg-btn pg-btn--accent", text: "Save" });
    save.addEventListener("click", () => options.onSave(working));

    const cancel = bar.createEl("button", { cls: "pg-btn", text: "Cancel" });
    cancel.addEventListener("click", () => options.onCancel());
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
    const slotsPerBeat = getSlotsPerBeat(working.timeSignature, working.gridResolution);
    const barStartSlots = new Set(working.bars.map((eachBar) => eachBar.startSlot));
    const localIndex = new Map<number, number>();
    for (const eachBar of working.bars) {
      eachBar.slots.forEach((slot, index) => localIndex.set(slot.index, index));
    }

    const grid = root.createEl("div", { cls: "pg-grid" });
    grid.style.setProperty("--pg-grid-cols", String(working.slots.length));

    for (const instrument of displayedInstruments()) {
      const rowEl = grid.createEl("div", { cls: "pg-grid__row" });
      rowEl.createEl("div", {
        cls: "pg-grid__label",
        text: (instrument.aliases[0] ?? instrument.id).toUpperCase()
      });

      const cells = rowEl.createEl("div", { cls: "pg-grid__cells" });
      cells.style.setProperty("--pg-grid-cols", String(working.slots.length));

      for (const slot of working.slots) {
        const hit = findHit(working, slot.index, instrument.id);
        const cell = cells.createEl("button", { cls: "pg-grid__cell" });

        if (barStartSlots.has(slot.index) && slot.index !== 0) {
          cell.classList.add("is-bar-start");
        } else if ((localIndex.get(slot.index) ?? 0) % slotsPerBeat === 0) {
          cell.classList.add("is-beat-start");
        }

        if (hit) {
          cell.classList.add("is-hit", ARTICULATION_CLASS[hit.articulation]);
          cell.textContent = getHitChar(instrument, hit.articulation);
        }

        cell.addEventListener("click", () => {
          working = cycleCell(working, slot.index, instrument, hit?.articulation ?? null);
          render();
        });
      }
    }
  };

  render();

  return {
    destroy() {
      options.container.empty();
    }
  };
}

function cycleCell(
  block: DrumBlock,
  slotIndex: number,
  instrument: DrumInstrument,
  current: DrumArticulation | null
): DrumBlock {
  // Only the three primary articulations participate in the click cycle; flam,
  // diddle, and buzz survive untouched (they just step to ghost -> empty).
  const position = current && CYCLE.includes(current) ? CYCLE.indexOf(current) : 0;
  const next = CYCLE[(position + 1) % CYCLE.length];

  if (next === null) {
    return removeHit(block, slotIndex, instrument);
  }
  if (current === null) {
    return toggleHit(block, slotIndex, instrument, next);
  }
  return applyArticulation(block, slotIndex, instrument, next);
}
