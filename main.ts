import { Editor, MarkdownPostProcessorContext, MarkdownRenderChild, Notice, Plugin } from "obsidian";
import { colorRenderedNoteheads, makeRenderedNotesInteractive, renderInstrumentLegend, renderVexflowScore } from "./src/engrave";
import { getBarRange, getSecondsPerSlot, getSlotVisualDurationSeconds } from "./src/music";
import { getTitle, parseDrumBlock } from "./src/parser";
import { DrumPlayer } from "./src/player";
import { DrumSynth } from "./src/synth";
import { CursorPosition, DrumBlock, DrumSlot } from "./src/types";

const DEFAULT_TEMPLATE = `\`\`\`drums
Title: Basic rock groove
Tempo: 100
Time: 4/4
Count: 1 e & a 2 e & a 3 e & a 4 e & a
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-o-----
\`\`\``;

interface RenderState {
  cursorPositions: Array<CursorPosition | undefined>;
  noteElements: Array<SVGGElement | undefined>;
  cursor: HTMLElement | null;
}

export default class DrumNotationPlugin extends Plugin {
  private activePlayer: DrumPlayer | null = null;
  private activePlaybackReset: (() => void) | null = null;
  private activePreview: DrumSynth | null = null;
  private activePreviewTimer: number | null = null;
  private audioContext: AudioContext | null = null;

  async onload(): Promise<void> {
    this.registerMarkdownCodeBlockProcessor("drums", (source, el, ctx) => {
      this.renderDrumNotation(source, el, ctx);
    });

    this.addCommand({
      id: "insert-drum-notation-template",
      name: "Insert drum notation template",
      editorCallback: (editor: Editor) => {
        editor.replaceSelection(DEFAULT_TEMPLATE);
        new Notice("Inserted drum notation template");
      }
    });
  }

  onunload(): void {
    this.stopActivePlayer();
    this.stopActivePreview();
    this.closeAudioContext();
  }

  private renderDrumNotation(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    const block = parseDrumBlock(source);

    el.empty();

    const root = el.createEl("div", { cls: "drum-notation" });
    root.addClass(`drum-notation--${block.engravingStyle}`);
    if (block.legendMode !== "off") {
      root.addClass("drum-notation--legend-color");
    }
    const toolbar = root.createEl("div", { cls: "drum-notation__toolbar" });
    const title = toolbar.createEl("div", { cls: "drum-notation__title" });
    title.createEl("span", { text: getTitle(block) });
    const gridSlotLabel = block.gridResolution === 32 ? "thirty-second" : "sixteenth";
    title.createEl("small", {
      text: `${block.tempo} BPM · ${block.timeSignature} · ${block.bars.length} bar${block.bars.length === 1 ? "" : "s"} · ${block.slots.length} ${gridSlotLabel} slots${block.repeatCount > 1 ? ` · repeat ${block.repeatCount}x` : ""}`
    });

    const controls = toolbar.createEl("div", { cls: "drum-notation__controls" });
    const playButton = controls.createEl("button", {
      cls: "drum-notation__button",
      text: "Play"
    });
    const stopButton = controls.createEl("button", {
      cls: "drum-notation__button",
      text: "Stop"
    });
    const loopButton = controls.createEl("button", {
      cls: "drum-notation__button",
      text: "Loop Bar"
    });

    const notationViewport = root.createEl("div", { cls: "drum-notation__score-viewport" });
    const notation = notationViewport.createEl("div", { cls: "drum-notation__score" });

    if (block.rows.length === 0) {
      notation.createEl("div", {
        cls: "drum-notation__empty",
        text: "No supported drum rows found. Try HH, SD, and BD rows."
      });
      playButton.disabled = true;
      stopButton.disabled = true;
      return;
    }

    // A MarkdownRenderChild ties cleanup to this block's lifecycle, so the
    // observers/listeners below are released when the element is detached rather
    // than accumulating on the plugin until it unloads.
    const child = new MarkdownRenderChild(el);
    ctx.addChild(child);

    const state: RenderState = {
      cursorPositions: [],
      noteElements: [],
      cursor: null
    };
    let currentSlotIndex = 0;
    let isLoopingBar = false;
    let legendRendered = false;

    const renderScore = () => {
      try {
        state.cursorPositions = renderVexflowScore(block, notation).cursorPositions;
        if (block.legendMode !== "off") {
          colorRenderedNoteheads(block, notation);
        }
        state.cursor = block.showCursor ? notation.createEl("div", { cls: "drum-notation__cursor" }) : null;
        state.noteElements = makeRenderedNotesInteractive(block, notation, (slot) => {
          currentSlotIndex = slot.index;
          void this.previewSlot(block, slot);
        });
        if (!legendRendered) {
          renderInstrumentLegend(block, root);
          legendRendered = true;
        }
      } catch (error) {
        notation.empty();
        notation.createEl("pre", {
          cls: "drum-notation__error",
          text: error instanceof Error ? error.message : String(error)
        });
        state.cursorPositions = [];
        state.noteElements = [];
        state.cursor = null;
      }
    };

    renderScore();

    const visuals = makePlaybackVisuals(block, state);
    const handleSlotChange = (slotIndex: number) => {
      currentSlotIndex = slotIndex;
      visuals.moveCursor(slotIndex);
    };

    // Re-fit the score when the pane width changes. Skipped while a width is
    // unchanged to avoid redundant VexFlow re-renders, and debounced so a drag
    // resize only redraws once it settles.
    let lastWidth = Math.round(notationViewport.clientWidth);
    let resizeTimer: number | null = null;
    const observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0);

      if (width === 0 || width === lastWidth) {
        return;
      }

      lastWidth = width;

      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
      }

      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        renderScore();
      }, 150);
    });
    observer.observe(notationViewport);

    child.register(() => {
      observer.disconnect();
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
        resizeTimer = null;
      }
      this.stopActivePlayer();
      this.stopActivePreview();
    });

    playButton.addEventListener("click", () => {
      this.stopActivePlayer();

      isLoopingBar = false;
      this.activePlayer = new DrumPlayer(this.getAudioContext(), block, () => {
        playButton.removeClass("is-playing");
        loopButton.removeClass("is-playing");
        visuals.clearCursor();
        this.activePlayer = null;
        this.activePlaybackReset = null;
      }, handleSlotChange, { repeatCount: block.repeatCount });
      this.activePlaybackReset = () => {
        playButton.removeClass("is-playing");
        loopButton.removeClass("is-playing");
        isLoopingBar = false;
        visuals.clearCursor();
      };
      playButton.addClass("is-playing");
      void this.activePlayer.play();
    });

    stopButton.addEventListener("click", () => {
      this.stopActivePlayer();
      playButton.removeClass("is-playing");
      loopButton.removeClass("is-playing");
      isLoopingBar = false;
    });

    loopButton.addEventListener("click", () => {
      if (isLoopingBar) {
        this.stopActivePlayer();
        loopButton.removeClass("is-playing");
        isLoopingBar = false;
        return;
      }

      this.stopActivePlayer();

      const barRange = getBarRange(block, currentSlotIndex);

      isLoopingBar = true;
      loopButton.addClass("is-playing");
      playButton.removeClass("is-playing");
      this.activePlayer = new DrumPlayer(this.getAudioContext(), block, () => {
        loopButton.removeClass("is-playing");
        visuals.clearCursor();
        isLoopingBar = false;
        this.activePlayer = null;
        this.activePlaybackReset = null;
      }, handleSlotChange, {
        startSlot: barRange.startSlot,
        endSlot: barRange.endSlot,
        loop: true
      });
      this.activePlaybackReset = () => {
        loopButton.removeClass("is-playing");
        playButton.removeClass("is-playing");
        visuals.clearCursor();
        isLoopingBar = false;
      };
      void this.activePlayer.play();
    });
  }

  private stopActivePlayer(): void {
    this.activePlayer?.stop();
    this.activePlayer = null;
    this.activePlaybackReset?.();
    this.activePlaybackReset = null;
  }

  private async previewSlot(block: DrumBlock, slot: DrumSlot): Promise<void> {
    this.stopActivePreview();

    if (slot.hits.length === 0) {
      return;
    }

    this.activePreview = new DrumSynth(this.getAudioContext());
    await this.activePreview.start();
    this.activePreview.scheduleHits(
      slot.hits,
      this.activePreview.currentTime + 0.03,
      getSecondsPerSlot(block),
      getSlotVisualDurationSeconds(block, slot)
    );

    this.activePreviewTimer = window.setTimeout(() => {
      this.stopActivePreview();
    }, 950);
  }

  private stopActivePreview(): void {
    if (this.activePreviewTimer !== null) {
      window.clearTimeout(this.activePreviewTimer);
      this.activePreviewTimer = null;
    }

    this.activePreview?.stop();
    this.activePreview = null;
  }

  // A single AudioContext is shared across every block and every preview. Browsers
  // cap the number of live contexts, so creating one per play/preview (and closing
  // it on stop) risks exhausting them; we create lazily on the first user gesture
  // and reuse it for the plugin's lifetime.
  private getAudioContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === "closed") {
      this.audioContext = new AudioContext();
    }

    return this.audioContext;
  }

  private closeAudioContext(): void {
    if (this.audioContext && this.audioContext.state !== "closed") {
      void this.audioContext.close();
    }

    this.audioContext = null;
  }
}

function makePlaybackVisuals(
  block: DrumBlock,
  state: RenderState
): { clearCursor: () => void; moveCursor: (slotIndex: number) => void } {
  let highlightedNote: SVGGElement | null = null;

  const clearCursor = () => {
    state.cursor?.removeClass("is-active");
    state.cursor?.removeAttribute("style");
    highlightedNote?.classList.remove("is-playing");
    highlightedNote = null;
  };

  const moveCursor = (slotIndex: number) => {
    const cursorPosition = state.cursorPositions[slotIndex];

    if (block.showHighlight) {
      highlightedNote?.classList.remove("is-playing");
      highlightedNote = state.noteElements[slotIndex] ?? null;
      highlightedNote?.classList.add("is-playing");
    }

    if (!state.cursor || cursorPosition === undefined) {
      return;
    }

    state.cursor.addClass("is-active");
    state.cursor.style.height = `${Math.round(cursorPosition.height)}px`;
    state.cursor.style.left = `${Math.round(cursorPosition.x)}px`;
    state.cursor.style.top = `${Math.round(cursorPosition.y)}px`;
  };

  return { clearCursor, moveCursor };
}
