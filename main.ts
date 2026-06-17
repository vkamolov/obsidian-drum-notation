import {
  App,
  Editor,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  setIcon,
  setTooltip,
  Setting,
  TFile
} from "obsidian";
import { colorRenderedNoteheads, makeRenderedNotesInteractive, renderInstrumentLegend, renderVexflowScore } from "./src/engrave";
import { GridEditorHandle, GridEditorSessionState, mountGridEditor } from "./src/editor-grid";
import { getDrumsBlockEditStatus, replaceDrumsBlockBody, ReplaceDrumsBlockFailure } from "./src/markdown";
import { getBarRange, getSecondsPerSlot, getSlotVisualDurationSeconds } from "./src/music";
import { getTitle, parseDrumBlock } from "./src/parser";
import { DrumPlaybackBackend } from "./src/playback";
import { DrumPlayer } from "./src/player";
import { serializeDrumBlock } from "./src/serializer";
import { createSynthPlaybackBackend } from "./src/synth";
import { CursorPosition, DrumBlock, DrumSlot, ScoreBarRegion } from "./src/types";

const DEFAULT_TEMPLATE = `\`\`\`drums
Title: Basic rock groove
Tempo: 100
Time: 4/4
Count: 1 e & a 2 e & a 3 e & a 4 e & a
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-o-----
\`\`\``;

const WRITEBACK_DEBOUNCE_MS = 450;
const PLAYBACK_RESTART_DEBOUNCE_MS = 220;

interface DrumNotationSettings {
  enableVisualEditMode: boolean;
}

const DEFAULT_SETTINGS: DrumNotationSettings = {
  enableVisualEditMode: false
};

interface RenderState {
  cursorPositions: Array<CursorPosition | undefined>;
  barRegions: ScoreBarRegion[];
  noteElements: Array<SVGGElement | undefined>;
  cursor: HTMLElement | null;
}

interface RestoredEditSession {
  body: string;
  session: GridEditorSessionState;
  selectedSlotIndex: number | null;
  selectedBarIndex: number;
  playback: {
    wasPlaying: boolean;
    wasLooping: boolean;
    wasLoopingAll: boolean;
    slotIndex: number;
    barIndex: number;
  };
}

type EditAvailability =
  | {
      ok: true;
    }
  | {
      ok: false;
      reason: string;
    };

export default class DrumNotationPlugin extends Plugin {
  settings: DrumNotationSettings = { ...DEFAULT_SETTINGS };
  private activePlayer: DrumPlayer | null = null;
  private activePlaybackReset: (() => void) | null = null;
  private activePlaybackOwner: symbol | null = null;
  private activePreview: DrumPlaybackBackend | null = null;
  private activePreviewTimer: number | null = null;
  private activePreviewOwner: symbol | null = null;
  private audioContext: AudioContext | null = null;
  private readonly editRestoreSessions = new Map<string, RestoredEditSession>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new DrumNotationSettingTab(this.app, this));

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

  async loadSettings(): Promise<void> {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(await this.loadData())
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private renderDrumNotation(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    let block = parseDrumBlock(source);
    let sourceBody = source;
    const initialSection = ctx.getSectionInfo(el);
    const initialSessionKey = initialSection ? this.getEditSessionKey(ctx.sourcePath, initialSection.lineStart) : null;
    const restored = initialSessionKey ? this.editRestoreSessions.get(initialSessionKey) : undefined;
    const shouldRestoreEdit = !!restored && restored.body === source;

    if (initialSessionKey && restored && !shouldRestoreEdit) {
      this.editRestoreSessions.delete(initialSessionKey);
    }

    const editAvailability = this.getEditAvailability(el, ctx, initialSection, block);

    el.empty();

    const root = el.createEl("div", { cls: "drum-notation" });
    const toolbar = root.createEl("div", { cls: "drum-notation__toolbar" });
    const title = toolbar.createEl("div", { cls: "drum-notation__title" });
    const controls = toolbar.createEl("div", { cls: "drum-notation__controls" });
    const makeIconButton = (icon: string, tooltip: string): HTMLButtonElement => {
      const button = controls.createEl("button", { cls: "drum-notation__button clickable-icon" }) as HTMLButtonElement;
      setIcon(button, icon);
      setTooltip(button, tooltip, { placement: "top" });
      button.setAttribute("aria-label", tooltip);
      return button;
    };
    const playButton = makeIconButton("play", "Play");
    const stopButton = makeIconButton("square", "Stop");
    const loopButton = makeIconButton("repeat-1", "Loop current bar");
    const loopAllButton = makeIconButton("repeat", "Loop whole notation");
    controls.createEl("span", { cls: "drum-notation__control-divider" });
    const editButton = makeIconButton("pencil", "Edit notation");

    const notationViewport = root.createEl("div", { cls: "drum-notation__score-viewport" });
    const notation = notationViewport.createEl("div", { cls: "drum-notation__score" });
    const editRoot = root.createEl("div", { cls: "drum-notation__edit-root" });
    editRoot.hidden = true;

    const state: RenderState = {
      cursorPositions: [],
      barRegions: [],
      noteElements: [],
      cursor: null
    };
    let currentSlotIndex = clampSlotIndex(block, restored?.playback.slotIndex ?? 0);
    let selectedBarIndex = clampBarIndex(block, restored?.selectedBarIndex ?? barIndexForSlot(block, currentSlotIndex));
    let editSelectedSlotIndex: number | null = restored?.selectedSlotIndex ?? restored?.session.selectedCell?.slotIndex ?? null;
    let highlightedEditNote: SVGGElement | null = null;
    let gridEditor: GridEditorHandle | null = null;
    let visuals = makePlaybackVisuals(block, state);
    let isLoopingBar = false;
    let isLoopingAll = false;
    let resizeTimer: number | null = null;
    let writebackTimer: number | null = null;
    let playbackRestartTimer: number | null = null;
    const child = new MarkdownRenderChild(el);
    const renderOwner = Symbol("drum-notation-render");
    const playbackBackendFactory = (audioContext: AudioContext) => this.createPlaybackBackend(audioContext);

    ctx.addChild(child);

    const updateHeader = () => {
      root.classList.toggle("drum-notation--legend-color", block.legendMode !== "off");
      title.empty();
      title.createEl("span", { text: getTitle(block) });
      const gridSlotLabel = block.gridResolution === 32 ? "thirty-second" : "sixteenth";
      title.createEl("small", {
        text: `${block.tempo} BPM · ${block.timeSignature} · ${block.bars.length} bar${block.bars.length === 1 ? "" : "s"} · ${block.slots.length} ${gridSlotLabel} slots${block.repeatCount > 1 ? ` · repeat ${block.repeatCount}x` : ""}`
      });

      const hasRows = block.rows.length > 0;
      playButton.disabled = !hasRows;
      stopButton.disabled = !hasRows;
      loopButton.disabled = !hasRows;
      loopAllButton.disabled = !hasRows;
      editButton.disabled = !hasRows || !editAvailability.ok;
      editButton.title = !editAvailability.ok ? editAvailability.reason : "Edit notation visually";
    };

    const clearEditHighlight = () => {
      highlightedEditNote?.classList.remove("is-edit-selected");
      highlightedEditNote = null;
    };

    const applyEditHighlight = () => {
      clearEditHighlight();

      if (editSelectedSlotIndex === null) {
        return;
      }

      highlightedEditNote = state.noteElements[editSelectedSlotIndex] ?? null;
      highlightedEditNote?.classList.add("is-edit-selected");
    };

    const selectEditSlot = (slotIndex: number | null) => {
      editSelectedSlotIndex = slotIndex;
      applyEditHighlight();
    };

    const clearBarSelectors = () => {
      notation.querySelector(".pg-bar-selectors")?.remove();
    };

    const updateBarSelectorState = () => {
      selectedBarIndex = clampBarIndex(block, selectedBarIndex);
      notation.querySelectorAll<HTMLButtonElement>(".pg-bar-selector").forEach((button) => {
        const indexes = (button.dataset.barIndexes ?? "")
          .split(/\s+/)
          .map((value) => Number.parseInt(value, 10))
          .filter((value) => Number.isFinite(value));
        const selected = indexes.includes(selectedBarIndex);

        button.classList.toggle("is-selected", selected);
        button.setAttr("aria-pressed", selected ? "true" : "false");
      });
    };

    const selectBar = (barIndex: number, syncGrid: boolean) => {
      selectedBarIndex = clampBarIndex(block, barIndex);
      currentSlotIndex = block.bars[selectedBarIndex]?.startSlot ?? currentSlotIndex;
      selectEditSlot(null);
      if (syncGrid) {
        gridEditor?.selectBar(selectedBarIndex);
      }
      updateBarSelectorState();
    };

    const renderBarSelectors = () => {
      clearBarSelectors();

      if (!gridEditor || state.barRegions.length === 0) {
        return;
      }

      const layer = notation.createEl("div", { cls: "pg-bar-selectors" });

      state.barRegions.forEach((region) => {
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

      updateBarSelectorState();
    };

    const renderScore = () => {
      root.querySelector(".drum-notation__legend")?.remove();
      clearEditHighlight();
      clearBarSelectors();

      if (block.rows.length === 0) {
        notation.empty();
        notation.createEl("div", {
          cls: "drum-notation__empty",
          text: "No supported drum rows found. Try HH, SD, and BD rows."
        });
        state.cursorPositions = [];
        state.barRegions = [];
        state.noteElements = [];
        state.cursor = null;
        return;
      }

      try {
        const result = renderVexflowScore(block, notation);
        state.cursorPositions = result.cursorPositions;
        state.barRegions = result.barRegions;
        if (block.legendMode !== "off") {
          colorRenderedNoteheads(block, notation);
        }
        state.cursor = block.showCursor ? notation.createEl("div", { cls: "drum-notation__cursor" }) : null;
        state.noteElements = makeRenderedNotesInteractive(block, notation, (slot) => {
          currentSlotIndex = slot.index;
          if (gridEditor) {
            selectBar(barIndexForSlot(block, slot.index), true);
          }
          void this.previewSlot(block, slot, renderOwner);
        });
        if (block.legendMode !== "off") {
          renderInstrumentLegend(block, root);
        }
        visuals = makePlaybackVisuals(block, state);
        renderBarSelectors();
        applyEditHighlight();
      } catch (error) {
        notation.empty();
        notation.createEl("pre", {
          cls: "drum-notation__error",
          text: error instanceof Error ? error.message : String(error)
        });
        state.cursorPositions = [];
        state.barRegions = [];
        state.noteElements = [];
        state.cursor = null;
      }
    };

    const handleSlotChange = (slotIndex: number) => {
      currentSlotIndex = slotIndex;
      visuals.moveCursor(slotIndex);
    };

    const clearTransportHighlights = () => {
      playButton.removeClass("is-playing");
      loopButton.removeClass("is-playing");
      loopAllButton.removeClass("is-playing");
    };

    const stopLocalPlayback = () => {
      this.stopActivePlayer(renderOwner);
      clearTransportHighlights();
      isLoopingBar = false;
      isLoopingAll = false;
    };

    const startPlayback = (startSlot = 0) => {
      this.stopActivePlayer();

      isLoopingBar = false;
      isLoopingAll = false;
      currentSlotIndex = clampSlotIndex(block, startSlot);
      this.activePlaybackOwner = renderOwner;
      this.activePlayer = new DrumPlayer(
        this.getAudioContext(),
        block,
        () => {
          if (this.activePlaybackOwner !== renderOwner) {
            return;
          }

          clearTransportHighlights();
          visuals.clearCursor();
          this.activePlayer = null;
          this.activePlaybackReset = null;
          this.activePlaybackOwner = null;
        },
        handleSlotChange,
        { startSlot: currentSlotIndex, repeatCount: block.repeatCount },
        playbackBackendFactory
      );
      this.activePlaybackReset = () => {
        clearTransportHighlights();
        isLoopingBar = false;
        isLoopingAll = false;
        visuals.clearCursor();
      };
      clearTransportHighlights();
      playButton.addClass("is-playing");
      void this.activePlayer.play();
    };

    const startLoopBar = (barIndex = selectedBarIndex) => {
      this.stopActivePlayer();

      const bar = block.bars[clampBarIndex(block, barIndex)];
      currentSlotIndex = bar?.startSlot ?? clampSlotIndex(block, currentSlotIndex);
      const barRange = getBarRange(block, currentSlotIndex);

      isLoopingBar = true;
      isLoopingAll = false;
      clearTransportHighlights();
      loopButton.addClass("is-playing");
      this.activePlaybackOwner = renderOwner;
      this.activePlayer = new DrumPlayer(
        this.getAudioContext(),
        block,
        () => {
          if (this.activePlaybackOwner !== renderOwner) {
            return;
          }

          clearTransportHighlights();
          visuals.clearCursor();
          isLoopingBar = false;
          isLoopingAll = false;
          this.activePlayer = null;
          this.activePlaybackReset = null;
          this.activePlaybackOwner = null;
        },
        handleSlotChange,
        {
          startSlot: barRange.startSlot,
          endSlot: barRange.endSlot,
          loop: true
        },
        playbackBackendFactory
      );
      this.activePlaybackReset = () => {
        clearTransportHighlights();
        visuals.clearCursor();
        isLoopingBar = false;
        isLoopingAll = false;
      };
      void this.activePlayer.play();
    };

    const startLoopAll = () => {
      this.stopActivePlayer();

      isLoopingBar = false;
      isLoopingAll = true;
      currentSlotIndex = 0;
      clearTransportHighlights();
      loopAllButton.addClass("is-playing");
      this.activePlaybackOwner = renderOwner;
      this.activePlayer = new DrumPlayer(
        this.getAudioContext(),
        block,
        () => {
          if (this.activePlaybackOwner !== renderOwner) {
            return;
          }

          clearTransportHighlights();
          visuals.clearCursor();
          isLoopingBar = false;
          isLoopingAll = false;
          this.activePlayer = null;
          this.activePlaybackReset = null;
          this.activePlaybackOwner = null;
        },
        handleSlotChange,
        {
          startSlot: 0,
          endSlot: block.slots.length,
          loop: true
        },
        playbackBackendFactory
      );
      this.activePlaybackReset = () => {
        clearTransportHighlights();
        visuals.clearCursor();
        isLoopingBar = false;
        isLoopingAll = false;
      };
      void this.activePlayer.play();
    };

    const schedulePlaybackRestart = (
      wasPlaying: boolean,
      wasLooping: boolean,
      wasLoopingAll: boolean,
      slotIndex: number,
      barIndex: number
    ) => {
      if (!wasPlaying || block.rows.length === 0) {
        return;
      }

      if (playbackRestartTimer !== null) {
        window.clearTimeout(playbackRestartTimer);
      }

      playbackRestartTimer = window.setTimeout(() => {
        playbackRestartTimer = null;
        if (wasLoopingAll) {
          startLoopAll();
        } else if (wasLooping) {
          startLoopBar(barIndex);
        } else {
          startPlayback(slotIndex);
        }
      }, PLAYBACK_RESTART_DEBOUNCE_MS);
    };

    const persistEditedBlock = async () => {
      if (!editAvailability.ok) {
        return;
      }

      const file = this.getSourceFile(ctx.sourcePath);
      const section = ctx.getSectionInfo(el) ?? initialSection;

      if (!file || !section) {
        new Notice("Could not locate the source drums block to update.");
        return;
      }

      const nextBody = serializeDrumBlock(block, { mode: "authoring" });
      if (nextBody === sourceBody) {
        return;
      }

      const sessionKey = this.getEditSessionKey(ctx.sourcePath, section.lineStart);
      let failure: ReplaceDrumsBlockFailure | null = null;
      let wrote = false;

      try {
        await this.app.vault.process(file, (current) => {
          const result = replaceDrumsBlockBody(current, section, sourceBody, nextBody);

          if (!result.ok) {
            failure = result.reason;
            return current;
          }

          wrote = true;
          const session = gridEditor?.getSessionState();
          if (session) {
            this.editRestoreSessions.set(sessionKey, {
              body: nextBody,
              session,
              selectedSlotIndex: editSelectedSlotIndex,
              selectedBarIndex,
              playback: {
                wasPlaying: this.activePlaybackOwner === renderOwner && this.activePlayer !== null,
                wasLooping: isLoopingBar,
                wasLoopingAll: isLoopingAll,
                slotIndex: currentSlotIndex,
                barIndex: selectedBarIndex
              }
            });
          }

          return result.text;
        });
      } catch (error) {
        new Notice(`Could not update drums block: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }

      if (wrote) {
        sourceBody = nextBody;
      } else if (failure) {
        new Notice(formatWritebackFailure(failure));
      }
    };

    const scheduleWriteback = () => {
      if (writebackTimer !== null) {
        window.clearTimeout(writebackTimer);
      }

      writebackTimer = window.setTimeout(() => {
        writebackTimer = null;
        void persistEditedBlock();
      }, WRITEBACK_DEBOUNCE_MS);
    };

    const applyGridEditedBlock = (next: DrumBlock, changedSlotIndex?: number, nextSelectedBarIndex?: number) => {
      const wasPlaying = this.activePlaybackOwner === renderOwner && this.activePlayer !== null;
      const wasLooping = isLoopingBar;
      const wasLoopingAll = isLoopingAll;
      const restartSlotIndex = currentSlotIndex;
      const restartBarIndex = selectedBarIndex;

      if (wasPlaying) {
        this.stopActivePlayer(renderOwner);
      }

      block = next;
      selectedBarIndex =
        nextSelectedBarIndex !== undefined
          ? clampBarIndex(block, nextSelectedBarIndex)
          : changedSlotIndex !== undefined
            ? barIndexForSlot(block, changedSlotIndex)
            : clampBarIndex(block, selectedBarIndex);
      currentSlotIndex = changedSlotIndex ?? block.bars[selectedBarIndex]?.startSlot ?? clampSlotIndex(block, currentSlotIndex);
      updateHeader();
      renderScore();
      scheduleWriteback();
      schedulePlaybackRestart(wasPlaying, wasLooping, wasLoopingAll, restartSlotIndex, restartBarIndex);

      if (changedSlotIndex === undefined || wasPlaying) {
        selectEditSlot(null);
        return;
      }

      selectEditSlot(changedSlotIndex);
      const slot = block.slots.find((candidate) => candidate.index === changedSlotIndex);
      if (slot) {
        void this.previewSlot(block, slot, renderOwner);
      }
    };

    const enterEditMode = (session?: GridEditorSessionState) => {
      if (gridEditor || !editAvailability.ok || block.slots.length === 0) {
        if (!editAvailability.ok) {
          new Notice(editAvailability.reason);
        }
        return;
      }

      stopLocalPlayback();
      this.stopActivePreview(renderOwner);
      selectedBarIndex = clampBarIndex(block, session?.selectedBarIndex ?? selectedBarIndex);
      editSelectedSlotIndex = session?.selectedCell?.slotIndex ?? editSelectedSlotIndex;
      root.addClass("is-editing");
      editButton.addClass("is-playing");
      editRoot.hidden = false;

      gridEditor = mountGridEditor({
        container: editRoot,
        block,
        initialBarIndex: selectedBarIndex,
        initialSessionState: session,
        onChange: applyGridEditedBlock,
        onPreview: (previewBlock, slotIndex) => {
          const slot = previewBlock.slots.find((candidate) => candidate.index === slotIndex);
          if (slot) {
            selectEditSlot(slotIndex);
            void this.previewSlot(previewBlock, slot, renderOwner);
          }
        },
        onSelectBar: (barIndex) => selectBar(barIndex, false),
        confirmAction: (message) => confirmWithModal(this.app, message)
      });

      renderBarSelectors();
      applyEditHighlight();
    };

    const exitEditMode = () => {
      gridEditor?.destroy();
      gridEditor = null;
      selectEditSlot(null);
      clearBarSelectors();
      root.removeClass("is-editing");
      editButton.removeClass("is-playing");
      editRoot.hidden = true;

      const section = ctx.getSectionInfo(el);
      if (section) {
        this.editRestoreSessions.delete(this.getEditSessionKey(ctx.sourcePath, section.lineStart));
      }
    };

    updateHeader();
    renderScore();

    let lastWidth = Math.round(notationViewport.clientWidth);
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
      if (writebackTimer !== null) {
        window.clearTimeout(writebackTimer);
        writebackTimer = null;
        void persistEditedBlock();
      }
      if (playbackRestartTimer !== null) {
        window.clearTimeout(playbackRestartTimer);
        playbackRestartTimer = null;
      }
      gridEditor?.destroy();
      this.stopActivePlayer(renderOwner);
      this.stopActivePreview(renderOwner);
    });

    playButton.addEventListener("click", () => startPlayback());

    stopButton.addEventListener("click", () => {
      stopLocalPlayback();
    });

    loopButton.addEventListener("click", () => {
      if (isLoopingBar) {
        stopLocalPlayback();
        return;
      }

      startLoopBar();
    });

    loopAllButton.addEventListener("click", () => {
      if (isLoopingAll) {
        stopLocalPlayback();
        return;
      }

      startLoopAll();
    });

    editButton.addEventListener("click", () => {
      if (gridEditor) {
        exitEditMode();
      } else {
        enterEditMode();
      }
    });

    if (shouldRestoreEdit && restored) {
      enterEditMode(restored.session);
      selectedBarIndex = clampBarIndex(block, restored.selectedBarIndex);
      selectEditSlot(restored.selectedSlotIndex);
      if (restored.playback.wasPlaying) {
        window.setTimeout(() => {
          schedulePlaybackRestart(
            true,
            restored.playback.wasLooping,
            restored.playback.wasLoopingAll,
            restored.playback.slotIndex,
            restored.playback.barIndex
          );
        }, 0);
      }
    }
  }

  private getEditAvailability(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    section: ReturnType<MarkdownPostProcessorContext["getSectionInfo"]>,
    block: DrumBlock
  ): EditAvailability {
    if (block.rows.length === 0) {
      return { ok: false, reason: "Visual edit mode needs at least one parsed drum row." };
    }

    if (!this.settings.enableVisualEditMode) {
      return { ok: false, reason: "Visual edit mode is disabled in Drum Notation settings." };
    }

    if (!this.isReadingViewRender(el, ctx)) {
      return { ok: false, reason: "Visual edit mode is available in Reading view only." };
    }

    if (!this.getSourceFile(ctx.sourcePath)) {
      return { ok: false, reason: "Could not locate the source note for this drums block." };
    }

    if (!section) {
      return { ok: false, reason: "Could not locate the source drums block." };
    }

    const status = getDrumsBlockEditStatus(section.text);
    if (!status.ok && status.reason === "nested-or-indented-fence") {
      return { ok: false, reason: formatEditAvailabilityFailure(status.reason) };
    }

    return { ok: true };
  }

  private isReadingViewRender(el: HTMLElement, ctx: MarkdownPostProcessorContext): boolean {
    if (el.closest(".markdown-source-view")) {
      return false;
    }

    if (el.closest(".markdown-preview-view, .markdown-reading-view")) {
      return true;
    }

    return this.app.workspace.getLeavesOfType("markdown").some((leaf) => {
      const view = leaf.view;

      return view instanceof MarkdownView && view.file?.path === ctx.sourcePath && view.getMode() === "preview";
    });
  }

  private getSourceFile(path: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(path);

    return file instanceof TFile ? file : null;
  }

  private getEditSessionKey(sourcePath: string, lineStart: number): string {
    return `${sourcePath}:${lineStart}`;
  }

  private stopActivePlayer(owner?: symbol): void {
    if (owner && this.activePlaybackOwner !== owner) {
      return;
    }

    const reset = this.activePlaybackReset;

    this.activePlayer?.stop();
    this.activePlayer = null;
    this.activePlaybackReset = null;
    this.activePlaybackOwner = null;
    reset?.();
  }

  private async previewSlot(block: DrumBlock, slot: DrumSlot, owner: symbol): Promise<void> {
    this.stopActivePreview();

    if (slot.hits.length === 0) {
      return;
    }

    const preview = this.createPlaybackBackend(this.getAudioContext());

    this.activePreview = preview;
    this.activePreviewOwner = owner;
    await preview.start();

    if (this.activePreview !== preview || this.activePreviewOwner !== owner) {
      preview.stop();
      return;
    }

    preview.scheduleHits(
      slot.hits,
      preview.currentTime + 0.03,
      getSecondsPerSlot(block),
      getSlotVisualDurationSeconds(block, slot)
    );

    this.activePreviewTimer = window.setTimeout(() => {
      this.stopActivePreview(owner);
    }, 950);
  }

  private stopActivePreview(owner?: symbol): void {
    if (owner && this.activePreviewOwner !== owner) {
      return;
    }

    if (this.activePreviewTimer !== null) {
      window.clearTimeout(this.activePreviewTimer);
      this.activePreviewTimer = null;
    }

    this.activePreview?.stop();
    this.activePreview = null;
    this.activePreviewOwner = null;
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

  private createPlaybackBackend(audioContext: AudioContext): DrumPlaybackBackend {
    return createSynthPlaybackBackend(audioContext);
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

    if (cursorPosition === undefined) {
      state.cursor?.removeClass("is-active");
      state.cursor?.removeAttribute("style");
      return;
    }

    if (!state.cursor) {
      return;
    }

    state.cursor.addClass("is-active");
    state.cursor.style.height = `${Math.round(cursorPosition.height)}px`;
    state.cursor.style.left = `${Math.round(cursorPosition.x)}px`;
    state.cursor.style.top = `${Math.round(cursorPosition.y)}px`;
  };

  return { clearCursor, moveCursor };
}

function clampBarIndex(block: DrumBlock, barIndex: number): number {
  if (block.bars.length === 0) {
    return 0;
  }

  return Math.min(block.bars.length - 1, Math.max(0, Math.round(barIndex)));
}

function clampSlotIndex(block: DrumBlock, slotIndex: number): number {
  if (block.slots.length === 0) {
    return 0;
  }

  return Math.min(block.slots.length - 1, Math.max(0, Math.round(slotIndex)));
}

function barIndexForSlot(block: DrumBlock, slotIndex: number): number {
  const index = block.bars.findIndex((bar) => slotIndex >= bar.startSlot && slotIndex < bar.startSlot + bar.slots.length);

  return index >= 0 ? index : 0;
}

function formatEditAvailabilityFailure(reason: ReplaceDrumsBlockFailure): string {
  switch (reason) {
    case "nested-or-indented-fence":
      return "Visual edit mode is not available for nested drums blocks in callouts, lists, or indented Markdown.";
    case "not-drums-fence":
    case "missing-closing-fence":
    case "invalid-section":
      return "Could not safely identify the source drums fence.";
    case "stale-body":
      return "The source drums block changed before edit mode opened.";
  }
}

function formatWritebackFailure(reason: ReplaceDrumsBlockFailure): string {
  switch (reason) {
    case "nested-or-indented-fence":
      return "Could not update drums block because nested blocks are read-only in visual edit mode.";
    case "stale-body":
      return "Could not update drums block because the note changed outside visual edit mode.";
    case "not-drums-fence":
    case "missing-closing-fence":
    case "invalid-section":
      return "Could not update drums block because the source fence no longer matches the rendered block.";
  }
}

function confirmWithModal(app: App, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    new DrumConfirmModal(app, message, resolve).open();
  });
}

class DrumConfirmModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly message: string,
    private readonly resolve: (confirmed: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Confirm edit");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: this.message });

    const buttons = this.contentEl.createEl("div", { cls: "drum-notation__confirm-buttons" });
    const cancel = buttons.createEl("button", { text: "Cancel" });
    const confirm = buttons.createEl("button", { cls: "mod-warning", text: "Confirm" });

    cancel.addEventListener("click", () => this.finish(false));
    confirm.addEventListener("click", () => this.finish(true));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.resolve(false);
      this.settled = true;
    }
  }

  private finish(confirmed: boolean): void {
    if (!this.settled) {
      this.resolve(confirmed);
      this.settled = true;
    }
    this.close();
  }
}

class DrumNotationSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly drumPlugin: DrumNotationPlugin
  ) {
    super(app, drumPlugin);
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.createEl("h2", { text: "Drum Notation" });

    new Setting(containerEl)
      .setName("Enable visual edit mode")
      .setDesc("Show the visual editor in Reading view and allow it to write changes back to top-level drums code blocks.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.drumPlugin.settings.enableVisualEditMode)
          .onChange(async (value) => {
            this.drumPlugin.settings.enableVisualEditMode = value;
            await this.drumPlugin.saveSettings();
          });
      });
  }
}
