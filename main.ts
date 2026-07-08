import {
  App,
  Editor,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownView,
  Menu,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  setIcon,
  setTooltip,
  Setting,
  TFile
} from "obsidian";
import {
  clearLegendInstrumentHighlight,
  colorRenderedNoteheads,
  getLegendHighlightDurationMs,
  makeRenderedNotesInteractive,
  renderInstrumentLegend,
  renderVexflowScore,
  setLegendInstrumentHighlight,
  updateMeasureRepeatProgress
} from "./src/engrave";
import { GridEditorHandle, GridEditorSessionState, mountGridEditor } from "./src/editor-grid";
import {
  getRenderedDrumsBlockEditStatus,
  replaceDrumsBlockBody,
  ReplaceDrumsBlockFailure
} from "./src/markdown";
import { getBarRange, getSecondsPerSlot, getSlotVisualDurationSeconds } from "./src/music";
import { ensureNotationFontsInDocument } from "./src/notation-fonts";
import { getTitle, parseDrumBlockWithWarnings } from "./src/parser";
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
} from "./src/playback";
import { DrumPlayer } from "./src/player";
import { getMeasureRepeatProgress } from "./src/repeat-progress";
import { serializeDrumBlock } from "./src/serializer";
import {
  DEFAULT_DRUM_SETUP_VALUES,
  DrumSetupTimeDenominator,
  DrumSetupValues,
  formatDrumsFenceInsertion,
  getDrumSetupSlotCount,
  getDrumSetupValues,
  isValidDrumSetupValues,
  serializeInitialDrumBlock
} from "./src/setup";
import { createSynthPlaybackBackend } from "./src/synth";
import {
  CursorPosition,
  CountInMode,
  DrumBlock,
  DrumSlot,
  MetronomeMode,
  ParseWarning,
  ScoreBarRegion
} from "./src/types";

const WRITEBACK_DEBOUNCE_MS = 450;
const PLAYBACK_RESTART_DEBOUNCE_MS = 220;
const EDIT_RESTORE_RETRY_MS = 50;
const EDIT_RESTORE_MAX_ATTEMPTS = 40;
const MAX_INLINE_PARSE_WARNINGS = 5;
const AUDIO_RECOVERY_NOTICE =
  "Audio was interrupted by the mobile system. Try Play again, or relaunch Obsidian if playback stays silent.";

interface DrumNotationSettings {
  enableVisualEditMode: boolean;
  dismissedFirstRunTip: boolean;
}

const DEFAULT_SETTINGS: DrumNotationSettings = {
  enableVisualEditMode: false,
  dismissedFirstRunTip: false
};

function isSettingsRecord(value: unknown): value is Partial<DrumNotationSettings> {
  return typeof value === "object" && value !== null;
}

function loadSavedSettings(value: unknown): Partial<DrumNotationSettings> {
  if (!isSettingsRecord(value)) {
    return {};
  }

  return {
    ...(typeof value.enableVisualEditMode === "boolean" ? { enableVisualEditMode: value.enableVisualEditMode } : {}),
    ...(typeof value.dismissedFirstRunTip === "boolean" ? { dismissedFirstRunTip: value.dismissedFirstRunTip } : {})
  };
}

function getSetupTimeDenominator(value: string): DrumSetupTimeDenominator {
  const denominator = Number(value);

  if (denominator === 2 || denominator === 4 || denominator === 8 || denominator === 16 || denominator === 32) {
    return denominator;
  }

  return DEFAULT_DRUM_SETUP_VALUES.timeDenominator;
}

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
  private activePreviewLegendReset: (() => void) | null = null;
  private audioContext: AudioContext | null = null;
  private readonly editRestoreSessions = new Map<string, RestoredEditSession>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new DrumNotationSettingTab(this.app, this));

    this.registerMarkdownCodeBlockProcessor("drums", async (source, el, ctx) => {
      // PDF export and pop-out windows render in separate documents that lack
      // VexFlow's FontFace registrations. Ensure the music fonts exist there
      // before engraving; the returned promise keeps Obsidian's export flow
      // waiting until the block renders with real glyphs.
      await ensureNotationFontsInDocument(el.ownerDocument);
      this.renderDrumNotation(source, el, ctx);
    });

    this.addCommand({
      id: "insert-notation-block",
      name: "Insert notation block",
      editorCallback: (editor: Editor) => {
        new DrumSetupModal(this.app, {
          mode: "command",
          initialValues: DEFAULT_DRUM_SETUP_VALUES,
          onSubmit: async (values) => {
            const from = editor.getCursor("from");
            const to = editor.getCursor("to");
            const before = editor.getLine(from.line).slice(0, from.ch);
            const after = editor.getLine(to.line).slice(to.ch);
            const body = serializeInitialDrumBlock(values);

            editor.replaceSelection(formatDrumsFenceInsertion(body, before, after));
            new Notice("Created drum notation");
            return true;
          }
        }).open();
      }
    });
  }

  onunload(): void {
    this.stopActivePlayer();
    this.stopActivePreview();
    this.closeAudioContext();
  }

  async loadSettings(): Promise<void> {
    const savedData = (await this.loadData()) as unknown;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loadSavedSettings(savedData)
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

	private renderDrumNotation(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		const parsed = parseDrumBlockWithWarnings(source);
		let block = parsed.block;
    let parseWarnings = parsed.warnings;
    let sourceBody = source;
    const initialSection = ctx.getSectionInfo(el);
    const initialSessionKey = initialSection ? this.getEditSessionKey(ctx.sourcePath, initialSection.lineStart) : null;
    const restored = initialSessionKey ? this.editRestoreSessions.get(initialSessionKey) : undefined;
    const shouldRestoreEdit = !!restored && restored.body === source;

    if (initialSessionKey && restored && !shouldRestoreEdit) {
      this.editRestoreSessions.delete(initialSessionKey);
    }

    el.empty();
    el.addClass("drum-notation-host");
    this.markDrumNotationWrappers(el);

    const root = el.createEl("div", { cls: "drum-notation" });
    const toolbar = root.createEl("div", { cls: "drum-notation__toolbar" });
    const title = toolbar.createEl("div", { cls: "drum-notation__title" });
    const controls = toolbar.createEl("div", { cls: "drum-notation__controls" });
    const makeIconButton = (icon: string, tooltip: string): HTMLButtonElement => {
      const button = controls.createEl("button", { cls: "drum-notation__button" });
      setIcon(button, icon);
      setTooltip(button, tooltip, { placement: "top" });
      button.setAttribute("aria-label", tooltip);
      return button;
    };
    const playButton = makeIconButton("play", "Play");
    const stopButton = makeIconButton("square", "Stop");
    const loopButton = makeIconButton("repeat-1", "Loop current bar");
    const loopAllButton = makeIconButton("repeat", "Loop whole notation");
    const speedSelect = controls.createEl("select", {
      cls: "drum-notation__speed",
      attr: { "aria-label": "Playback speed" }
    });
    populatePlaybackSpeedOptions(speedSelect);
    const metronomeButton = makeIconButton("timer", "Metronome: Off");
    metronomeButton.setAttribute("aria-haspopup", "menu");
    const muteButton = makeIconButton("volume-2", "Mute instruments");
    controls.createEl("span", { cls: "drum-notation__control-divider" });
    const editButton = makeIconButton("pencil", "Edit notation");
    const createButton = makeIconButton("square-plus", "Create first bar");

    const tipEl = root.createEl("div", { cls: "drum-notation__tip" });
    const warningsEl = root.createEl("div", { cls: "drum-notation__warnings" });
    warningsEl.hidden = true;
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
    let editSelectedSlotIndex: number | null = restored?.selectedSlotIndex ?? selectedSlotIndexFromSession(restored?.session) ?? null;
    let highlightedEditNote: SVGGElement | null = null;
    let gridEditor: GridEditorHandle | null = null;
    let playbackSpeedPercent = DEFAULT_PLAYBACK_SPEED_PERCENT;
    let visuals = makePlaybackVisuals(block, state, root, () => playbackSpeedPercent);
    let isLoopingBar = false;
    let isLoopingAll = false;
    let metronomeMode: MetronomeMode = DEFAULT_METRONOME_MODE;
    let countInMode: CountInMode = DEFAULT_COUNT_IN_MODE;
    const mutedInstrumentIds = new Set<string>();
    let resizeTimer: number | null = null;
    let writebackTimer: number | null = null;
    let hasPendingWriteback = false;
    let playbackRestartTimer: number | null = null;
    let modeRefreshFrame: number | null = null;
    let modeRefreshTimer: number | null = null;
    let editRestoreTimer: number | null = null;
    const child = new MarkdownRenderChild(el);
    const renderOwner = Symbol("drum-notation-render");
    const playbackBackendFactory = (audioContext: AudioContext) => this.createPlaybackBackend(audioContext);

    ctx.addChild(child);

    const getCurrentSection = () => ctx.getSectionInfo(el) ?? initialSection;
    const getCurrentEditAvailability = () =>
      this.getEditAvailability(el, ctx, getCurrentSection(), block);
    const getCurrentCreateAvailability = () =>
      this.getCreateAvailability(el, ctx, getCurrentSection(), block);

    const renderFirstRunTip = () => {
      tipEl.empty();
      tipEl.hidden = this.settings.dismissedFirstRunTip;

      if (this.settings.dismissedFirstRunTip) {
        return;
	}

      tipEl.createEl("span", {
        text: "Tip: Use the playback controls here, and switch to Reading view to edit notation visually with the pencil button. Live Preview visual editing is planned."
      });
      const dismiss = tipEl.createEl("button", {
        cls: "drum-notation__tip-dismiss",
        text: "Dismiss",
        attr: { type: "button" }
      });
      dismiss.addEventListener("click", () => {
        this.settings.dismissedFirstRunTip = true;
        void this.saveSettings();
        root.ownerDocument.querySelectorAll<HTMLElement>(".drum-notation__tip").forEach((tip) => {
          tip.hidden = true;
        });
      });
    };

    const renderParseWarnings = () => {
      warningsEl.empty();
      warningsEl.hidden = parseWarnings.length === 0;

      if (parseWarnings.length === 0) {
        return;
      }

      const visibleWarnings = parseWarnings.slice(0, MAX_INLINE_PARSE_WARNINGS);
      const list = warningsEl.createEl("ul");

      for (const warning of visibleWarnings) {
        list.createEl("li", { text: formatParseWarning(warning) });
      }

      const hiddenCount = parseWarnings.length - visibleWarnings.length;
      if (hiddenCount > 0) {
        list.createEl("li", { text: `…and ${hiddenCount} more parser warning${hiddenCount === 1 ? "" : "s"}.` });
      }
    };

    const updateHeader = () => {
      const playbackInstruments = getPlaybackInstruments(block);
      const playableInstrumentIds = new Set(playbackInstruments.map((instrument) => instrument.id));
      for (const instrumentId of mutedInstrumentIds) {
        if (!playableInstrumentIds.has(instrumentId)) {
          mutedInstrumentIds.delete(instrumentId);
        }
      }

      root.classList.toggle("drum-notation--legend-color", block.legendMode !== "off");
      title.empty();
      title.createEl("span", { text: getTitle(block) });
      const gridSlotLabel = block.gridResolution === 32 ? "thirty-second" : "sixteenth";
      title.createEl("small", {
        text: `${block.tempo} BPM · ${block.timeSignature} · ${block.bars.length} bar${block.bars.length === 1 ? "" : "s"} · ${block.slots.length} ${gridSlotLabel} slots${block.repeatCount > 1 ? ` · repeat ${block.repeatCount}x` : ""}`
      });

      const hasRows = block.rows.length > 0;
      const isEmptyBlock = block.bars.length === 0;
      const editAvailability = getCurrentEditAvailability();
      const createAvailability = getCurrentCreateAvailability();
      playButton.disabled = !hasRows;
      stopButton.disabled = !hasRows;
      loopButton.disabled = !hasRows;
      loopAllButton.disabled = !hasRows;
      speedSelect.disabled = !hasRows;
      playbackSpeedPercent = syncSpeedSelectValue(speedSelect, playbackSpeedPercent);
      const effectiveTempo = getEffectivePlaybackTempo(block.tempo, playbackSpeedPercent);
      const speedDescription = `Playback speed ${playbackSpeedPercent}% · ${formatTempo(effectiveTempo)} BPM`;
      speedSelect.title = speedDescription;
      speedSelect.setAttribute("aria-label", speedDescription);
      metronomeButton.disabled = block.slots.length === 0;
      metronomeButton.classList.toggle("is-active", metronomeMode !== "off" || countInMode !== "off");
      const metronomeDescription = `Metronome: ${getMetronomeModeLabel(metronomeMode)} · Count-in: ${getCountInModeLabel(countInMode)}`;
      metronomeButton.title = metronomeDescription;
      metronomeButton.setAttribute("aria-label", metronomeDescription);
      muteButton.disabled = !hasRows;
      setIcon(muteButton, mutedInstrumentIds.size > 0 ? "volume-x" : "volume-2");
      const muteDescription =
        mutedInstrumentIds.size > 0
          ? `${mutedInstrumentIds.size} muted instrument${mutedInstrumentIds.size === 1 ? "" : "s"}`
          : "Mute instruments";
      muteButton.title = muteDescription;
      muteButton.setAttribute("aria-label", muteDescription);
      editButton.hidden = isEmptyBlock;
      editButton.disabled = !hasRows || !editAvailability.ok;
      editButton.title = !editAvailability.ok ? editAvailability.reason : "Edit notation visually";
      editButton.setAttribute(
        "aria-label",
        !editAvailability.ok ? editAvailability.reason : "Edit notation"
      );
      createButton.hidden = !isEmptyBlock;
      createButton.disabled = !isEmptyBlock || !createAvailability.ok;
      createButton.title = !createAvailability.ok ? createAvailability.reason : "Create first bar";
      createButton.setAttribute(
        "aria-label",
        !createAvailability.ok ? createAvailability.reason : "Create first bar"
      );

      const emptyAction = notation.querySelector<HTMLButtonElement>(".drum-notation__empty-action");
      if (emptyAction) {
        emptyAction.disabled = !createAvailability.ok;
        emptyAction.title = !createAvailability.ok ? createAvailability.reason : "Create first bar";
      }
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

    const openCreateFirstBarModal = () => {
      const createAvailability = getCurrentCreateAvailability();
      if (!createAvailability.ok) {
        new Notice(createAvailability.reason);
        return;
      }

      new DrumSetupModal(this.app, {
        mode: "first-bar",
        initialValues: getDrumSetupValues(block),
        onSubmit: async (values) => {
          const createAvailability = getCurrentCreateAvailability();
          if (!createAvailability.ok) {
            new Notice(createAvailability.reason);
            return false;
          }

          const file = this.getSourceFile(ctx.sourcePath);
          const section = getCurrentSection();

          if (!file || !section) {
            new Notice("Could not locate the source drums block to update.");
            return false;
          }

          const nextBody = serializeInitialDrumBlock(values, block);
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
              if (this.settings.enableVisualEditMode) {
                this.editRestoreSessions.set(sessionKey, makeInitialEditSession(nextBody));
              }

              return result.text;
            });
          } catch (error) {
            new Notice(`Could not create first bar: ${error instanceof Error ? error.message : String(error)}`);
            return false;
          }

          if (!wrote) {
            if (failure) {
              new Notice(formatCreationFailure(failure));
            }
            return false;
          }

          sourceBody = nextBody;
          if (!this.settings.enableVisualEditMode) {
            new Notice(
              "First bar created. Enable visual edit mode in Drum Notation settings to edit it visually."
            );
          }

          return true;
        }
      }).open();
    };

    const clearBarSelectors = () => {
      notation.querySelector(".pg-bar-selectors")?.remove();
    };

    const createBufferedScoreTarget = (): HTMLElement => {
      const target = notationViewport.createEl("div", { cls: "drum-notation__score" });

      target.addClass("drum-notation__score-buffer");
      target.setCssProps({
        "--drum-score-buffer-left": `${notation.offsetLeft}px`,
        "--drum-score-buffer-top": `${notation.offsetTop}px`,
        "--drum-score-buffer-width": `${notation.clientWidth || notationViewport.clientWidth}px`,
        "--drum-score-buffer-min-height": notation.style.getPropertyValue("--drum-score-min-height")
      });

      return target;
    };

    const commitBufferedScoreTarget = (target: HTMLElement) => {
      if (target === notation) {
        return;
      }

      notation.setCssProps({
        "--drum-score-min-height": target.style.getPropertyValue("--drum-score-min-height")
      });
      notation.replaceChildren(...Array.from(target.childNodes));
      target.remove();
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

    const selectRenderedBarAtPoint = (event: MouseEvent) => {
      if (event.defaultPrevented || state.barRegions.length === 0) {
        return;
      }

      const rect = notation.getBoundingClientRect();
      const x = event.clientX - rect.left + notation.scrollLeft;
      const y = event.clientY - rect.top + notation.scrollTop;
      const region = state.barRegions.find(
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

      updateBarSelectorState();
    };

    notation.addEventListener("click", selectRenderedBarAtPoint);

    const renderScore = () => {
      root.querySelector(".drum-notation__legend")?.remove();
      clearEditHighlight();
      clearBarSelectors();

      if (block.rows.length === 0) {
        notation.empty();
        if (block.bars.length === 0) {
          const createAvailability = getCurrentCreateAvailability();
          const empty = notation.createEl("div", { cls: "drum-notation__empty" });
          empty.createEl("span", {
            text: "Create an empty first bar, then add notes with visual edit mode."
          });
          const action = empty.createEl("button", {
            cls: "drum-notation__empty-action mod-cta",
            text: "Create first bar",
            attr: { type: "button" }
          });
          action.disabled = !createAvailability.ok;
          action.title = !createAvailability.ok ? createAvailability.reason : "Create first bar";
          action.addEventListener("click", openCreateFirstBarModal);
        } else {
          notation.createEl("div", {
            cls: "drum-notation__empty",
            text: "No supported drum rows found. Add an instrument row such as HH, SD, or BD."
          });
        }
        state.cursorPositions = [];
        state.barRegions = [];
        state.noteElements = [];
        state.cursor = null;
        return;
      }

      let target: HTMLElement | null = null;

      try {
        target = notation.hasChildNodes() ? createBufferedScoreTarget() : notation;
        const result = renderVexflowScore(block, target);

        commitBufferedScoreTarget(target);
        target = null;
        state.cursorPositions = result.cursorPositions;
        state.barRegions = result.barRegions;
        if (block.legendMode !== "off") {
          colorRenderedNoteheads(block, notation);
        }
        state.cursor = block.showCursor ? notation.createEl("div", { cls: "drum-notation__cursor" }) : null;
        state.noteElements = makeRenderedNotesInteractive(block, notation, (slot) => {
          const slotBarIndex = barIndexForSlot(block, slot.index);

          currentSlotIndex = slot.index;
          if (gridEditor) {
            selectBar(slotBarIndex, true);
          } else {
            selectedBarIndex = clampBarIndex(block, slotBarIndex);
            updateBarSelectorState();
          }
          void this.previewSlot(block, slot, renderOwner, root);
        });
        if (block.legendMode !== "off") {
          renderInstrumentLegend(block, root);
        }
        visuals = makePlaybackVisuals(block, state, root, () => playbackSpeedPercent);
        renderBarSelectors();
        applyEditHighlight();
      } catch (error) {
        if (target && target !== notation) {
          target.remove();
        }

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

    const clearRepeatProgress = () => {
      updateMeasureRepeatProgress(notation, null);
    };

    const handleBarChange = (barIndex: number) => {
      updateMeasureRepeatProgress(notation, getMeasureRepeatProgress(block, barIndex));
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
      clearRepeatProgress();
    };

    const prepareTransportStart = async (recoverBeforeStart: boolean): Promise<boolean> => {
      this.stopActivePlayer();
      clearTransportHighlights();
      visuals.clearCursor();
      clearRepeatProgress();
      isLoopingBar = false;
      isLoopingAll = false;

      if (!recoverBeforeStart) {
        return true;
      }

      const recovered = await this.recoverAudioContext();

      if (!recovered) {
        new Notice(AUDIO_RECOVERY_NOTICE);
      }

      return recovered;
    };

    const startPlayback = async (
      initialSlot = 0,
      recoverBeforeStart = false,
      useCountIn = true
    ): Promise<boolean> => {
      if (!(await prepareTransportStart(recoverBeforeStart))) {
        return false;
      }

      isLoopingBar = false;
      isLoopingAll = false;
      currentSlotIndex = clampSlotIndex(block, initialSlot);
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
          clearRepeatProgress();
          this.activePlayer = null;
          this.activePlaybackReset = null;
          this.activePlaybackOwner = null;
        },
        handleSlotChange,
        {
          startSlot: 0,
          endSlot: block.slots.length,
          initialSlot: currentSlotIndex,
          repeatCount: block.repeatCount,
          speedPercent: playbackSpeedPercent,
          mutedInstrumentIds,
          metronomeMode,
          countInMode: useCountIn ? countInMode : "off",
          onBarChange: handleBarChange
        },
        playbackBackendFactory
      );
      this.activePlaybackReset = () => {
        clearTransportHighlights();
        isLoopingBar = false;
        isLoopingAll = false;
        visuals.clearCursor();
        clearRepeatProgress();
      };
      clearTransportHighlights();
      playButton.addClass("is-playing");
      if (!useCountIn || countInMode === "off") {
        handleBarChange(barIndexForSlot(block, currentSlotIndex));
      }
      void this.activePlayer.play();
      return true;
    };

    const startLoopBar = async (
      barIndex = selectedBarIndex,
      initialSlot?: number,
      recoverBeforeStart = false,
      useCountIn = true
    ): Promise<boolean> => {
      if (!(await prepareTransportStart(recoverBeforeStart))) {
        return false;
      }

      const bar = block.bars[clampBarIndex(block, barIndex)];
      const barStartSlot = bar?.startSlot ?? clampSlotIndex(block, currentSlotIndex);
      const barRange = getBarRange(block, barStartSlot);
      currentSlotIndex = clampSlotToRange(initialSlot ?? barRange.startSlot, barRange.startSlot, barRange.endSlot);

      isLoopingBar = true;
      isLoopingAll = false;
      clearRepeatProgress();
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
          clearRepeatProgress();
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
          initialSlot: currentSlotIndex,
          loop: true,
          speedPercent: playbackSpeedPercent,
          mutedInstrumentIds,
          metronomeMode,
          countInMode: useCountIn ? countInMode : "off"
        },
        playbackBackendFactory
      );
      this.activePlaybackReset = () => {
        clearTransportHighlights();
        visuals.clearCursor();
        clearRepeatProgress();
        isLoopingBar = false;
        isLoopingAll = false;
      };
      void this.activePlayer.play();
      return true;
    };

    const startLoopAll = async (
      initialSlot = 0,
      recoverBeforeStart = false,
      useCountIn = true
    ): Promise<boolean> => {
      if (!(await prepareTransportStart(recoverBeforeStart))) {
        return false;
      }

      isLoopingBar = false;
      isLoopingAll = true;
      currentSlotIndex = clampSlotIndex(block, initialSlot);
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
          clearRepeatProgress();
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
          initialSlot: currentSlotIndex,
          loop: true,
          speedPercent: playbackSpeedPercent,
          mutedInstrumentIds,
          metronomeMode,
          countInMode: useCountIn ? countInMode : "off",
          onBarChange: handleBarChange
        },
        playbackBackendFactory
      );
      this.activePlaybackReset = () => {
        clearTransportHighlights();
        visuals.clearCursor();
        clearRepeatProgress();
        isLoopingBar = false;
        isLoopingAll = false;
      };
      if (!useCountIn || countInMode === "off") {
        handleBarChange(barIndexForSlot(block, currentSlotIndex));
      }
      void this.activePlayer.play();
      return true;
    };

    const restartActivePlaybackForControls = async () => {
      if (this.activePlaybackOwner !== renderOwner || !this.activePlayer) {
        return;
      }

      const restartSlotIndex = this.activePlayer.getCurrentSlotIndex();
      const wasLoopingBar = isLoopingBar;
      const wasLoopingAll = isLoopingAll;
      const restartBarIndex = barIndexForSlot(block, restartSlotIndex);

      this.stopActivePlayer(renderOwner);
      if (wasLoopingAll) {
        await startLoopAll(restartSlotIndex, true, false);
      } else if (wasLoopingBar) {
        await startLoopBar(restartBarIndex, restartSlotIndex, true, false);
      } else {
        await startPlayback(restartSlotIndex, true, false);
      }
    };

    const openMuteMenu = (event: MouseEvent) => {
      const menu = new Menu();
      const playbackInstruments = getPlaybackInstruments(block);

      playbackInstruments.forEach((instrument) => {
        menu.addItem((item) => {
          item
            .setTitle(instrument.label)
            .setChecked(mutedInstrumentIds.has(instrument.id))
            .onClick(() => {
              if (mutedInstrumentIds.has(instrument.id)) {
                mutedInstrumentIds.delete(instrument.id);
              } else {
                mutedInstrumentIds.add(instrument.id);
              }
              updateHeader();
              void restartActivePlaybackForControls();
            });
        });
      });

      menu.addSeparator();
      menu.addItem((item) => {
        item
          .setTitle("Unmute all")
          .setIcon("volume-2")
          .setDisabled(mutedInstrumentIds.size === 0)
          .onClick(() => {
            mutedInstrumentIds.clear();
            updateHeader();
            void restartActivePlaybackForControls();
          });
      });
      menu.showAtMouseEvent(event);
    };

    const openMetronomeMenu = (event: MouseEvent) => {
      const menu = new Menu();

      METRONOME_MODE_OPTIONS.forEach((option) => {
        menu.addItem((item) => {
          item
            .setTitle(option.label)
            .setChecked(metronomeMode === option.value)
            .onClick(() => {
              metronomeMode = option.value;
              updateHeader();
              void restartActivePlaybackForControls();
            });
        });
      });

      menu.addSeparator();
      COUNT_IN_MODE_OPTIONS.forEach((option) => {
        menu.addItem((item) => {
          item
            .setTitle(`Count-in: ${option.label}`)
            .setChecked(countInMode === option.value)
            .onClick(() => {
              countInMode = option.value;
              updateHeader();
              void restartActivePlaybackForControls();
            });
        });
      });

      menu.showAtMouseEvent(event);
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
          void startLoopAll(undefined, false, false);
        } else if (wasLooping) {
          void startLoopBar(barIndex, undefined, false, false);
        } else {
          void startPlayback(slotIndex, false, false);
        }
      }, PLAYBACK_RESTART_DEBOUNCE_MS);
    };

    const persistEditedBlock = async (
      options: { requireEditAvailability?: boolean; rememberRestoreSession?: boolean } = {}
    ) => {
      const requireEditAvailability = options.requireEditAvailability ?? true;
      const rememberRestoreSession = options.rememberRestoreSession ?? true;

      if (requireEditAvailability) {
        const editAvailability = getCurrentEditAvailability();
        if (!editAvailability.ok) {
          return;
        }
      }

      if (!hasPendingWriteback && serializeDrumBlock(block, { mode: "authoring" }) === sourceBody) {
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
        hasPendingWriteback = false;
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
          const session = rememberRestoreSession ? gridEditor?.getSessionState() : null;
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
        parseWarnings = parseDrumBlockWithWarnings(nextBody).warnings;
        renderParseWarnings();
        hasPendingWriteback = false;
      } else if (failure) {
        new Notice(formatWritebackFailure(failure));
      }
    };

    const scheduleWriteback = () => {
      hasPendingWriteback = true;

      if (writebackTimer !== null) {
        window.clearTimeout(writebackTimer);
        writebackTimer = null;
      }

      if (gridEditor) {
        return;
      }

      writebackTimer = window.setTimeout(() => {
        writebackTimer = null;
        void persistEditedBlock();
      }, WRITEBACK_DEBOUNCE_MS);
    };

    const flushPendingWriteback = (options: { requireEditAvailability?: boolean; rememberRestoreSession?: boolean } = {}) => {
      if (writebackTimer !== null) {
        window.clearTimeout(writebackTimer);
        writebackTimer = null;
      }

      if (!hasPendingWriteback) {
        return;
      }

      void persistEditedBlock(options);
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
      parseWarnings = parseDrumBlockWithWarnings(serializeDrumBlock(block, { mode: "authoring" })).warnings;
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
        void this.previewSlot(block, slot, renderOwner, root);
      }
    };

    const enterEditMode = (
      session?: GridEditorSessionState,
      options: { showUnavailableNotice?: boolean } = {}
    ): boolean => {
      const editAvailability = getCurrentEditAvailability();
      if (gridEditor || !editAvailability.ok || block.slots.length === 0) {
        if (!editAvailability.ok && options.showUnavailableNotice !== false) {
          new Notice(editAvailability.reason);
        }
        return false;
      }

      stopLocalPlayback();
      this.stopActivePreview(renderOwner);
      selectedBarIndex = clampBarIndex(block, session?.selectedBarIndex ?? selectedBarIndex);
      editSelectedSlotIndex = selectedSlotIndexFromSession(session) ?? editSelectedSlotIndex;
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
            void this.previewSlot(previewBlock, slot, renderOwner, root);
          }
        },
        onSelectBar: (barIndex) => selectBar(barIndex, false),
        confirmAction: (message) => confirmWithModal(this.app, message)
      });

      renderBarSelectors();
      applyEditHighlight();
      return true;
    };

    const exitEditMode = (options: { clearRestoreSession?: boolean } = {}) => {
      gridEditor?.destroy();
      gridEditor = null;
      selectEditSlot(null);
      clearBarSelectors();
      root.removeClass("is-editing");
      editButton.removeClass("is-playing");
      editRoot.hidden = true;
      flushPendingWriteback({
        requireEditAvailability: false,
        rememberRestoreSession: false
      });
      updateHeader();

      if (options.clearRestoreSession === false) {
        return;
      }

      const section = ctx.getSectionInfo(el);
      if (section) {
        this.editRestoreSessions.delete(this.getEditSessionKey(ctx.sourcePath, section.lineStart));
      }
    };

    const refreshModeAvailability = (): boolean => {
      const editAvailability = getCurrentEditAvailability();

      if (gridEditor && !editAvailability.ok) {
        exitEditMode({ clearRestoreSession: false });
      }

      updateHeader();
      return editAvailability.ok;
    };

    const clearModeRefreshTimer = () => {
      if (modeRefreshTimer !== null) {
        window.clearTimeout(modeRefreshTimer);
        modeRefreshTimer = null;
      }
    };

    const queueModeAvailabilityRefresh = (attempt = 0) => {
      clearModeRefreshTimer();
      updateHeader();

      if (modeRefreshFrame !== null) {
        window.cancelAnimationFrame(modeRefreshFrame);
      }

      modeRefreshFrame = window.requestAnimationFrame(() => {
        modeRefreshFrame = null;
        const isAvailable = refreshModeAvailability();

        if (isAvailable || attempt >= EDIT_RESTORE_MAX_ATTEMPTS) {
          return;
        }

        clearModeRefreshTimer();
        modeRefreshTimer = window.setTimeout(() => {
          modeRefreshTimer = null;
          queueModeAvailabilityRefresh(attempt + 1);
        }, EDIT_RESTORE_RETRY_MS);
      });
    };

    const clearEditRestoreTimer = () => {
      if (editRestoreTimer !== null) {
        window.clearTimeout(editRestoreTimer);
        editRestoreTimer = null;
      }
    };

    const restoreEditModeWhenAvailable = (session: GridEditorSessionState, attempt = 0) => {
      clearEditRestoreTimer();

      if (gridEditor) {
        return;
      }

      const restoredEditMode = enterEditMode(session, { showUnavailableNotice: false });
      updateHeader();

      if (restoredEditMode || attempt >= EDIT_RESTORE_MAX_ATTEMPTS) {
        return;
      }

      editRestoreTimer = window.setTimeout(() => {
        editRestoreTimer = null;
        restoreEditModeWhenAvailable(session, attempt + 1);
      }, EDIT_RESTORE_RETRY_MS);
    };

    updateHeader();
    renderFirstRunTip();
    renderParseWarnings();
    renderScore();
    queueModeAvailabilityRefresh();
    child.registerEvent(this.app.workspace.on("layout-change", () => queueModeAvailabilityRefresh()));
    child.registerEvent(this.app.workspace.on("active-leaf-change", () => queueModeAvailabilityRefresh()));
    child.registerDomEvent(window, "scroll", () => queueModeAvailabilityRefresh(), {
      capture: true,
      passive: true
    });

    const visibilityObserver =
      "IntersectionObserver" in window
        ? new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
              queueModeAvailabilityRefresh();
            }
          })
        : null;
    visibilityObserver?.observe(root);

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
      visibilityObserver?.disconnect();
      observer.disconnect();
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
        resizeTimer = null;
      }
      flushPendingWriteback({
        requireEditAvailability: false,
        rememberRestoreSession: false
      });
      if (playbackRestartTimer !== null) {
        window.clearTimeout(playbackRestartTimer);
        playbackRestartTimer = null;
      }
      if (modeRefreshFrame !== null) {
        window.cancelAnimationFrame(modeRefreshFrame);
        modeRefreshFrame = null;
      }
      clearModeRefreshTimer();
      clearEditRestoreTimer();
      gridEditor?.destroy();
      this.stopActivePlayer(renderOwner);
      this.stopActivePreview(renderOwner);
    });

    playButton.addEventListener("click", () => {
      void startPlayback(0, true);
    });

    stopButton.addEventListener("click", () => {
      stopLocalPlayback();
    });

    loopButton.addEventListener("click", () => {
      if (isLoopingBar) {
        stopLocalPlayback();
        return;
      }

      void startLoopBar(barIndexForSlot(block, currentSlotIndex), undefined, true);
    });

    loopAllButton.addEventListener("click", () => {
      if (isLoopingAll) {
        stopLocalPlayback();
        return;
      }

      void startLoopAll(0, true);
    });

    speedSelect.addEventListener("change", () => {
      playbackSpeedPercent = Number(speedSelect.value);
      updateHeader();
      void restartActivePlaybackForControls();
    });

    metronomeButton.addEventListener("click", openMetronomeMenu);
    muteButton.addEventListener("click", openMuteMenu);

    editButton.addEventListener("click", () => {
      if (gridEditor) {
        exitEditMode();
      } else {
        enterEditMode();
      }
    });

    createButton.addEventListener("click", openCreateFirstBarModal);

    if (shouldRestoreEdit && restored) {
      selectedBarIndex = clampBarIndex(block, restored.selectedBarIndex);
      selectEditSlot(restored.selectedSlotIndex);
      restoreEditModeWhenAvailable(restored.session);
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

  private markDrumNotationWrappers(el: HTMLElement): void {
    const codeBlockWrapper = el.closest(".el-pre");
    if (codeBlockWrapper instanceof HTMLElement) {
      codeBlockWrapper.addClass("drum-notation-code-block");
      const previous = codeBlockWrapper.previousElementSibling;
      if (previous instanceof HTMLElement && previous.matches(".el-p")) {
        previous.addClass("drum-notation-before-code-block");
      }
    }

    const livePreviewWrapper = el.closest(".cm-embed-block.cm-preview-code-block");
    if (livePreviewWrapper instanceof HTMLElement) {
      livePreviewWrapper.addClass("drum-notation-preview-code-block");
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

    return this.getWriteAvailability(el, ctx, section);
  }

  private getCreateAvailability(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    section: ReturnType<MarkdownPostProcessorContext["getSectionInfo"]>,
    block: DrumBlock
  ): EditAvailability {
    if (block.bars.length > 0) {
      return { ok: false, reason: "This drums block already has a bar." };
    }

    return this.getWriteAvailability(el, ctx, section);
  }

  private getWriteAvailability(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    section: ReturnType<MarkdownPostProcessorContext["getSectionInfo"]>
  ): EditAvailability {
    if (el.closest(".internal-embed, .markdown-embed")) {
      return { ok: false, reason: "This block is embedded from another note. Open that note to edit." };
    }

    if (!this.isReadingViewRender(el, ctx.sourcePath)) {
      return { ok: false, reason: "Visual editing is available in Reading view. Live Preview editing is planned." };
    }

    if (!this.getSourceFile(ctx.sourcePath)) {
      return { ok: false, reason: "Could not locate the source note for this drums block." };
    }

    if (!section) {
      return { ok: false, reason: "Could not locate the source drums block." };
    }

    const status = getRenderedDrumsBlockEditStatus(section.text);
    if (!status.ok) {
      return { ok: false, reason: formatEditAvailabilityFailure(status.reason) };
    }

    return { ok: true };
  }

  private isReadingViewRender(el: HTMLElement, sourcePath: string): boolean {
    const containingLeaf = this.app.workspace.getLeavesOfType("markdown").find((leaf) => {
      const view = leaf.view;

      return view instanceof MarkdownView && view.containerEl.contains(el);
    });

    if (containingLeaf?.view instanceof MarkdownView) {
      return containingLeaf.view.getMode() === "preview";
    }

    if (el.closest(".markdown-source-view")) {
      return false;
    }

    if (el.closest(".markdown-preview-view, .markdown-reading-view")) {
      return true;
    }

    return this.app.workspace.getLeavesOfType("markdown").some((leaf) => {
      const view = leaf.view;

      return view instanceof MarkdownView && view.file?.path === sourcePath && view.getMode() === "preview";
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

  private async previewSlot(block: DrumBlock, slot: DrumSlot, owner: symbol, legendContainer?: HTMLElement): Promise<void> {
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

    if (block.showHighlight && legendContainer) {
      setLegendInstrumentHighlight(
        legendContainer,
        "preview",
        slot.hits.map((hit) => hit.instrument.id)
      );
      const legendTimer = window.setTimeout(() => {
        clearLegendInstrumentHighlight(legendContainer, "preview");
      }, getLegendHighlightDurationMs(block, slot));
      this.activePreviewLegendReset = () => {
        window.clearTimeout(legendTimer);
        clearLegendInstrumentHighlight(legendContainer, "preview");
      };
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
    this.activePreviewLegendReset?.();
    this.activePreviewLegendReset = null;
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

  private async recoverAudioContext(): Promise<boolean> {
    return recoverAudioContext({
      get: () => this.audioContext,
      set: (context) => {
        this.audioContext = context;
      },
      create: () => new AudioContext()
    });
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
  state: RenderState,
  legendContainer: HTMLElement,
  getSpeedPercent: () => number
): { clearCursor: () => void; moveCursor: (slotIndex: number) => void } {
  let highlightedNote: SVGGElement | null = null;
  let legendTimer: number | null = null;

  const clearPlaybackLegendHighlight = () => {
    if (legendTimer !== null) {
      window.clearTimeout(legendTimer);
      legendTimer = null;
    }
    clearLegendInstrumentHighlight(legendContainer, "playback");
  };

  const flashPlaybackLegendHighlight = (slot: DrumSlot | undefined) => {
    clearPlaybackLegendHighlight();

    if (!block.showHighlight || !slot || slot.hits.length === 0) {
      return;
    }

    setLegendInstrumentHighlight(
      legendContainer,
      "playback",
      slot.hits.map((hit) => hit.instrument.id)
    );
    legendTimer = window.setTimeout(
      clearPlaybackLegendHighlight,
      getLegendHighlightDurationMs(block, slot, getSpeedPercent())
    );
  };

  const clearCursor = () => {
    state.cursor?.removeClass("is-active");
    state.cursor?.removeAttribute("style");
    highlightedNote?.classList.remove("is-playing");
    highlightedNote = null;
    clearPlaybackLegendHighlight();
  };

  const moveCursor = (slotIndex: number) => {
    const cursorPosition = state.cursorPositions[slotIndex];

    if (block.showHighlight) {
      highlightedNote?.classList.remove("is-playing");
      highlightedNote = state.noteElements[slotIndex] ?? null;
      highlightedNote?.classList.add("is-playing");
      flashPlaybackLegendHighlight(block.slots[slotIndex]);
    } else {
      clearPlaybackLegendHighlight();
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
    state.cursor.setCssProps({
      "--drum-cursor-height": `${Math.round(cursorPosition.height)}px`,
      "--drum-cursor-left": `${Math.round(cursorPosition.x)}px`,
      "--drum-cursor-top": `${Math.round(cursorPosition.y)}px`
    });
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

function clampSlotToRange(slotIndex: number, startSlot: number, endSlot: number): number {
  if (endSlot <= startSlot) {
    return startSlot;
  }

  return Math.min(endSlot - 1, Math.max(startSlot, Math.round(slotIndex)));
}

function formatTempo(tempo: number): string {
  return Number.isInteger(tempo) ? String(tempo) : tempo.toFixed(1);
}

const PLAYBACK_SPEED_TEMP_OPTION_ATTR = "data-drum-speed-temporary";

function populatePlaybackSpeedOptions(select: HTMLSelectElement): void {
  for (const speed of getPlaybackSpeedOptionValues()) {
    select.createEl("option", { text: `${speed}%`, value: String(speed) });
  }
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

function formatCreationFailure(reason: ReplaceDrumsBlockFailure): string {
  switch (reason) {
    case "nested-or-indented-fence":
      return "Could not create first bar because nested drums blocks are read-only.";
    case "stale-body":
      return "Could not create first bar because the note changed while the setup window was open.";
    case "not-drums-fence":
    case "missing-closing-fence":
    case "invalid-section":
      return "Could not create first bar because the source drums fence could not be identified safely.";
  }
}

function makeInitialEditSession(body: string): RestoredEditSession {
  return {
    body,
    session: {
      selectedBarIndex: 0,
      selectedCell: null,
      undoStack: [],
      redoStack: [],
      extraInstrumentIds: []
    },
    selectedSlotIndex: null,
    selectedBarIndex: 0,
    playback: {
      wasPlaying: false,
      wasLooping: false,
      wasLoopingAll: false,
      slotIndex: 0,
      barIndex: 0
    }
  };
}

interface DrumSetupModalOptions {
  mode: "command" | "first-bar";
  initialValues: DrumSetupValues;
  onSubmit: (values: DrumSetupValues) => Promise<boolean>;
}

class DrumSetupModal extends Modal {
  private submitting = false;

  constructor(
    app: App,
    private readonly options: DrumSetupModalOptions
  ) {
    super(app);
  }

  onOpen(): void {
    const isFirstBar = this.options.mode === "first-bar";
    this.titleEl.setText(isFirstBar ? "Create first bar" : "Create drum notation");
    this.contentEl.empty();
    this.contentEl.addClass("drum-notation__setup-modal");

    let titleInput!: HTMLInputElement;
    let tempoInput!: HTMLInputElement;
    let numeratorInput!: HTMLInputElement;
    let denominatorInput!: HTMLSelectElement;
    let gridInput!: HTMLSelectElement;

    new Setting(this.contentEl).setName("Title").addText((text) => {
      titleInput = text.inputEl;
      text.setValue(this.options.initialValues.title).setPlaceholder(DEFAULT_DRUM_SETUP_VALUES.title);
    });

    new Setting(this.contentEl).setName("Tempo").addText((text) => {
      tempoInput = text.inputEl;
      tempoInput.type = "number";
      tempoInput.min = "30";
      tempoInput.max = "260";
      tempoInput.step = "1";
      tempoInput.inputMode = "numeric";
      tempoInput.addClass("drum-notation__setup-number");
      text.setValue(String(this.options.initialValues.tempo));
    });

    const timeSetting = new Setting(this.contentEl).setName("Time");
    timeSetting.addText((text) => {
      numeratorInput = text.inputEl;
      numeratorInput.type = "number";
      numeratorInput.min = "1";
      numeratorInput.max = "32";
      numeratorInput.step = "1";
      numeratorInput.inputMode = "numeric";
      numeratorInput.addClass("drum-notation__setup-number");
      text.setValue(String(this.options.initialValues.timeNumerator));
    });
    timeSetting.controlEl.createSpan({ cls: "drum-notation__setup-divider", text: "/" });
    timeSetting.addDropdown((dropdown) => {
      denominatorInput = dropdown.selectEl;
      dropdown
        .addOptions({
          "2": "2",
          "4": "4",
          "8": "8",
          "16": "16",
          "32": "32"
        })
        .setValue(String(this.options.initialValues.timeDenominator));
    });

    new Setting(this.contentEl).setName("Grid").addDropdown((dropdown) => {
      gridInput = dropdown.selectEl;
      dropdown.addOptions({ "16": "16", "32": "32" }).setValue(String(this.options.initialValues.grid));
    });

    const summary = this.contentEl.createEl("div", {
      cls: "drum-notation__setup-summary",
      attr: { "aria-live": "polite" }
    });
    const buttons = this.contentEl.createEl("div", { cls: "drum-notation__confirm-buttons" });
    const cancelButton = buttons.createEl("button", { text: "Cancel", attr: { type: "button" } });
    const submitButton = buttons.createEl("button", {
      cls: "mod-cta",
      text: isFirstBar ? "Create bar" : "Create notation",
      attr: { type: "button" }
    });
    const formControls = [titleInput, tempoInput, numeratorInput, denominatorInput, gridInput];

    const readValues = (): DrumSetupValues => ({
      title: titleInput.value,
      tempo: Number(tempoInput.value),
      timeNumerator: Number(numeratorInput.value),
      timeDenominator: getSetupTimeDenominator(denominatorInput.value),
      grid: Number(gridInput.value) === 32 ? 32 : 16
    });

    const updateState = () => {
      const values = readValues();
      const valid = isValidDrumSetupValues(values);

      summary.setText(
        valid
          ? `${values.timeNumerator}/${values.timeDenominator} · Grid ${values.grid} · ${getDrumSetupSlotCount(values)} slots`
          : "Enter a tempo from 30 to 260 and a time numerator from 1 to 32."
      );
      submitButton.disabled = this.submitting || !valid;
    };

    const setSubmitting = (submitting: boolean) => {
      this.submitting = submitting;
      formControls.forEach((control) => {
        control.disabled = submitting;
      });
      cancelButton.disabled = submitting;
      updateState();
    };

    const submit = async () => {
      const values = readValues();

      if (this.submitting || !isValidDrumSetupValues(values)) {
        return;
      }

      setSubmitting(true);
      try {
        const completed = await this.options.onSubmit(values);
        if (completed) {
          this.close();
          return;
        }
      } catch (error) {
        new Notice(`Could not create drum notation: ${error instanceof Error ? error.message : String(error)}`);
      }
      setSubmitting(false);
    };

    formControls.forEach((control) => control.addEventListener("input", updateState));
    denominatorInput.addEventListener("change", updateState);
    gridInput.addEventListener("change", updateState);
    cancelButton.addEventListener("click", () => this.close());
    submitButton.addEventListener("click", () => {
      void submit();
    });
    this.modalEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        void submit();
      }
    });

    updateState();
    window.setTimeout(() => {
      titleInput.focus();
      titleInput.select();
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function confirmWithModal(app: App, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    new DrumConfirmModal(app, message, resolve).open();
  });
}

function selectedSlotIndexFromSession(session: GridEditorSessionState | undefined): number | null {
  const selectedCell = session?.selectedCell;

  if (!selectedCell || selectedCell.kind === "instrument-row") {
    return null;
  }

  return selectedCell.slotIndex;
}

function formatParseWarning(warning: ParseWarning): string {
  const location = warning.column !== undefined ? `line ${warning.line}, column ${warning.column}` : `line ${warning.line}`;

  return `${location}: ${warning.message}`;
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
