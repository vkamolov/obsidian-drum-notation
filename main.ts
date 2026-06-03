import { Editor, MarkdownPostProcessorContext, Notice, Plugin } from "obsidian";
import { Beam, Formatter, GraceNote, GraceNoteGroup, Modifier, Parenthesis, Renderer, Stave, StaveNote, Stem, TimeSignature, Tuplet, Voice } from "vexflow";

interface DrumBlock {
  tempo: number;
  timeSignature: string;
  repeatCount: number;
  showCursor: boolean;
  showHighlight: boolean;
  legendMode: LegendMode;
  engravingStyle: EngravingStyle;
  gridResolution: GridResolution;
  metadata: string[];
  systems: DrumSystem[];
  bars: DrumBar[];
  rows: DrumRow[];
  slots: DrumSlot[];
}

interface DrumSystem {
  bars: DrumBar[];
}

interface DrumBar {
  rows: DrumRow[];
  slots: DrumSlot[];
  startSlot: number;
}

interface PlaybackOptions {
  startSlot?: number;
  endSlot?: number;
  loop?: boolean;
  repeatCount?: number;
}

interface DrumRow {
  label: string;
  pattern: string;
  instrument: DrumInstrument;
}

interface DrumRowInput {
  label: string;
  patterns: string[];
  instrument: DrumInstrument;
}

interface DrumSlot {
  index: number;
  hits: DrumHit[];
}

interface ScoreRenderResult {
  cursorPositions: Array<CursorPosition | undefined>;
}

interface CursorPosition {
  x: number;
  y: number;
  height: number;
}

interface EngravingLayout {
  systemHeight: number;
  renderScale: number;
  staveY: number;
  staveX: number;
  staveRightPadding: number;
  staveLineSpacing?: number;
  verticalBarWidth?: number;
  barMinWidth: number;
  noteStartPadding: number;
  noteEndPadding: number;
  formatPadding: number;
  maxSlotFormatWidth: number;
  beamWidth: number;
  beamMaxSlope: number;
  strokeWidth: number;
  ledgerLineWidth: number;
  noteFontSize?: number;
  signatureFontSize?: number;
  accentGap: number;
  accentWidth: number;
  accentHeight: number;
  accentStrokeWidth: number;
  diddleWidth: number;
  diddleHeight: number;
  diddleThickness: number;
  diddleFill: string;
  diddleNoteheadClearance: number;
  buzzWidth: number;
  buzzHeight: number;
  buzzStrokeWidth: number;
  openHatRadius: number;
  openHatGap: number;
  openHatStrokeWidth: number;
}

interface VisualBarNotes {
  notes: StaveNote[];
  hitNotes: StaveNote[];
  noteSlots: DrumSlot[];
  beams: Beam[];
  tuplets: Tuplet[];
}

interface DrumHit {
  instrument: DrumInstrument;
  articulation: DrumArticulation;
  velocity: number;
}

interface DrumInstrument {
  id: string;
  label: string;
  aliases: string[];
  vexKey: string;
  midi: number;
  color: string;
  playback: DrumPlaybackKind;
}

type DrumPlaybackKind =
  | "kick"
  | "snare"
  | "tomHigh"
  | "tomMid"
  | "tomLow"
  | "hatClosed"
  | "hatOpen"
  | "hatFoot"
  | "ride"
  | "crash"
  | "cowbell"
  | "click";

type DrumArticulation = "normal" | "accent" | "ghost" | "flam" | "diddle" | "buzz";
type EngravingStyle = "tidy" | "classic";
type GridResolution = 16 | 32;
type LegendMode = "off" | "used" | "all";

const DEFAULT_TEMPO = 100;
const DEFAULT_TIME_SIGNATURE = "4/4";
const DEFAULT_REPEAT_COUNT = 1;
const DEFAULT_SHOW_CURSOR = true;
const DEFAULT_SHOW_HIGHLIGHT = true;
const DEFAULT_LEGEND_MODE: LegendMode = "off";
const DEFAULT_ENGRAVING_STYLE: EngravingStyle = "tidy";
const DEFAULT_GRID_RESOLUTION: GridResolution = 16;

const DEFAULT_TEMPLATE = `\`\`\`drums
Title: Basic rock groove
Tempo: 100
Time: 4/4
Count: 1 e & a 2 e & a 3 e & a 4 e & a
HH | x-x-x-x-x-x-x-x-
SD | ----o-------o---
BD | o-------o-o-----
\`\`\``;

const DRUM_KIT: DrumInstrument[] = [
  {
    id: "crash",
    label: "Crash",
    aliases: ["cr", "crash", "cc", "crash cymbal"],
    vexKey: "a/5/X",
    midi: 49,
    color: "#d97706",
    playback: "crash"
  },
  {
    id: "splash",
    label: "Splash",
    aliases: ["sp", "splash", "splash cymbal"],
    vexKey: "b/5/X",
    midi: 55,
    color: "#f59e0b",
    playback: "crash"
  },
  {
    id: "china",
    label: "China",
    aliases: ["chna", "china", "china cymbal"],
    vexKey: "c/6/X",
    midi: 52,
    color: "#ea580c",
    playback: "crash"
  },
  {
    id: "stack",
    label: "Stack",
    aliases: ["st", "stack", "stack cymbal"],
    vexKey: "d/6/X",
    midi: 52,
    color: "#c2410c",
    playback: "crash"
  },
  {
    id: "ride",
    label: "Ride",
    aliases: ["rd", "ride", "rc"],
    vexKey: "f/5/X",
    midi: 51,
    color: "#b45309",
    playback: "ride"
  },
  {
    id: "ride-bell",
    label: "Ride bell",
    aliases: ["rb", "bell", "ridebell", "ride bell"],
    vexKey: "e/5/X",
    midi: 53,
    color: "#92400e",
    playback: "cowbell"
  },
  {
    id: "open-hat",
    label: "Open hat",
    aliases: ["oh", "openhat", "open-hat", "open hh"],
    vexKey: "g/5/X",
    midi: 46,
    color: "#ca8a04",
    playback: "hatOpen"
  },
  {
    id: "closed-hat",
    label: "Hi-hat",
    aliases: ["hh", "ch", "close", "closed", "hat", "hihat", "hi-hat", "closedhat", "closed-hat"],
    vexKey: "g/5/X",
    midi: 42,
    color: "#eab308",
    playback: "hatClosed"
  },
  {
    id: "hi-hat-foot",
    label: "Hi-hat foot",
    aliases: ["hf", "hhf", "fh", "foot hat", "hat foot", "hi-hat foot", "hihat foot"],
    vexKey: "d/4/X",
    midi: 44,
    color: "#a16207",
    playback: "hatFoot"
  },
  {
    id: "snare",
    label: "Snare",
    aliases: ["sd", "sn", "snare"],
    vexKey: "c/5",
    midi: 38,
    color: "#2563eb",
    playback: "snare"
  },
  {
    id: "rim",
    label: "Rim",
    aliases: ["rs", "rim", "rimshot", "xstick", "cross", "crossstick", "cross-stick"],
    vexKey: "c/5/X",
    midi: 37,
    color: "#0891b2",
    playback: "click"
  },
  {
    id: "high-tom",
    label: "High rack tom",
    aliases: ["ht", "rt", "rt1", "t1", "tom1", "rack", "rack tom", "high tom", "high rack tom"],
    vexKey: "e/5",
    midi: 50,
    color: "#16a34a",
    playback: "tomHigh"
  },
  {
    id: "mid-tom",
    label: "Mid rack tom",
    aliases: ["mt", "rt2", "t2", "tom2", "mid tom", "mid rack tom"],
    vexKey: "d/5",
    midi: 47,
    color: "#15803d",
    playback: "tomMid"
  },
  {
    id: "low-tom",
    label: "Low rack tom",
    aliases: ["lt", "rt3", "t3", "tom3", "low tom", "low rack tom"],
    vexKey: "a/4",
    midi: 45,
    color: "#166534",
    playback: "tomLow"
  },
  {
    id: "floor-tom",
    label: "Floor tom",
    aliases: ["ft", "floor", "floor tom"],
    vexKey: "g/4",
    midi: 41,
    color: "#14532d",
    playback: "tomLow"
  },
  {
    id: "low-floor-tom",
    label: "Low floor tom",
    aliases: ["lft", "ft2", "low floor", "low floor tom"],
    vexKey: "e/4",
    midi: 43,
    color: "#052e16",
    playback: "tomLow"
  },
  {
    id: "kick",
    label: "Kick",
    aliases: ["bd", "kd", "kick", "bass", "bass drum"],
    vexKey: "f/4",
    midi: 36,
    color: "#dc2626",
    playback: "kick"
  },
  {
    id: "cowbell",
    label: "Cowbell",
    aliases: ["cb", "cowbell"],
    vexKey: "e/5/X",
    midi: 56,
    color: "#7c3aed",
    playback: "cowbell"
  }
];

const INSTRUMENTS_BY_ALIAS = new Map<string, DrumInstrument>(
  DRUM_KIT.flatMap((instrument) => [
    [normalizeLabel(instrument.label), instrument] as [string, DrumInstrument],
    ...instrument.aliases.map((alias): [string, DrumInstrument] => [normalizeLabel(alias), instrument])
  ])
);

export default class DrumNotationPlugin extends Plugin {
  private activePlayer: DrumPlayer | null = null;
  private activePlaybackReset: (() => void) | null = null;
  private activePreview: DrumSynth | null = null;
  private activePreviewTimer: number | null = null;

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
  }

  private renderDrumNotation(source: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext): void {
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

    let cursorPositions: Array<CursorPosition | undefined> = [];
    let noteElements: Array<SVGGElement | undefined> = [];
    let highlightedNote: SVGGElement | null = null;
    let cursor: HTMLElement | null = null;
    let currentSlotIndex = 0;
    let isLoopingBar = false;

    try {
      cursorPositions = renderVexflowScore(block, notation).cursorPositions;
      if (block.legendMode !== "off") {
        colorRenderedNoteheads(block, notation);
      }
      if (block.showCursor) {
        cursor = notation.createEl("div", { cls: "drum-notation__cursor" });
      }
      noteElements = makeRenderedNotesInteractive(block, notation, (slot) => {
        currentSlotIndex = slot.index;
        void this.previewSlot(block, slot);
      });
      renderInstrumentLegend(block, root);
    } catch (error) {
      notation.empty();
      notation.createEl("pre", {
        cls: "drum-notation__error",
        text: error instanceof Error ? error.message : String(error)
      });
    }

    playButton.addEventListener("click", () => {
      this.stopActivePlayer();
      const clearCursor = () => {
        cursor?.removeClass("is-active");
        cursor?.removeAttribute("style");
        highlightedNote?.classList.remove("is-playing");
        highlightedNote = null;
      };
      const moveCursor = (slotIndex: number) => {
        const cursorPosition = cursorPositions[slotIndex];

        if (block.showHighlight) {
          highlightedNote?.classList.remove("is-playing");
          highlightedNote = noteElements[slotIndex] ?? null;
          highlightedNote?.classList.add("is-playing");
        }

        currentSlotIndex = slotIndex;
        if (!cursor || cursorPosition === undefined) {
          return;
        }

        cursor.addClass("is-active");
        cursor.style.height = `${Math.round(cursorPosition.height)}px`;
        cursor.style.left = `${Math.round(cursorPosition.x)}px`;
        cursor.style.top = `${Math.round(cursorPosition.y)}px`;
      };

      isLoopingBar = false;
      this.activePlayer = new DrumPlayer(block, () => {
        playButton.removeClass("is-playing");
        loopButton.removeClass("is-playing");
        clearCursor();
        this.activePlayer = null;
        this.activePlaybackReset = null;
      }, moveCursor, { repeatCount: block.repeatCount });
      this.activePlaybackReset = () => {
        playButton.removeClass("is-playing");
        loopButton.removeClass("is-playing");
        isLoopingBar = false;
        clearCursor();
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
      const clearCursor = () => {
        cursor?.removeClass("is-active");
        cursor?.removeAttribute("style");
        highlightedNote?.classList.remove("is-playing");
        highlightedNote = null;
      };
      const moveCursor = (slotIndex: number) => {
        const cursorPosition = cursorPositions[slotIndex];

        if (block.showHighlight) {
          highlightedNote?.classList.remove("is-playing");
          highlightedNote = noteElements[slotIndex] ?? null;
          highlightedNote?.classList.add("is-playing");
        }

        currentSlotIndex = slotIndex;
        if (!cursor || cursorPosition === undefined) {
          return;
        }

        cursor.addClass("is-active");
        cursor.style.height = `${Math.round(cursorPosition.height)}px`;
        cursor.style.left = `${Math.round(cursorPosition.x)}px`;
        cursor.style.top = `${Math.round(cursorPosition.y)}px`;
      };

      isLoopingBar = true;
      loopButton.addClass("is-playing");
      playButton.removeClass("is-playing");
      this.activePlayer = new DrumPlayer(block, () => {
        loopButton.removeClass("is-playing");
        clearCursor();
        isLoopingBar = false;
        this.activePlayer = null;
        this.activePlaybackReset = null;
      }, moveCursor, {
        startSlot: barRange.startSlot,
        endSlot: barRange.endSlot,
        loop: true
      });
      this.activePlaybackReset = () => {
        loopButton.removeClass("is-playing");
        playButton.removeClass("is-playing");
        clearCursor();
        isLoopingBar = false;
      };
      void this.activePlayer.play();
    });

    this.register(() => {
      this.stopActivePlayer();
      this.stopActivePreview();
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

    this.activePreview = new DrumSynth();
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
}

function parseDrumBlock(source: string): DrumBlock {
  const metadata: string[] = [];
  const rowSections: DrumRowInput[][] = [];
  let currentRows: DrumRowInput[] = [];
  let tempo = DEFAULT_TEMPO;
  let timeSignature = DEFAULT_TIME_SIGNATURE;
  let repeatCount = DEFAULT_REPEAT_COUNT;
  let showCursor = DEFAULT_SHOW_CURSOR;
  let showHighlight = DEFAULT_SHOW_HIGHLIGHT;
  let legendMode = DEFAULT_LEGEND_MODE;
  let engravingStyle = DEFAULT_ENGRAVING_STYLE;
  let gridResolution = DEFAULT_GRID_RESOLUTION;

  const pushCurrentBar = () => {
    if (currentRows.length === 0) {
      return;
    }

    rowSections.push(currentRows);
    currentRows = [];
  };

  source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .forEach((line) => {
      if (isBarSeparator(line)) {
        pushCurrentBar();
        return;
      }

      const setting = parseSettingLine(line);

      if (setting) {
        if (setting.key === "tempo" || setting.key === "bpm") {
          tempo = clampTempo(Number.parseInt(setting.value, 10));
        } else if (setting.key === "time" || setting.key === "timesignature" || setting.key === "meter") {
          timeSignature = parseTimeSignature(setting.value);
        } else if (setting.key === "repeat" || setting.key === "repeats") {
          repeatCount = parseRepeatCount(setting.value);
        } else if (setting.key === "cursor" || setting.key === "playbackcursor") {
          showCursor = parseBooleanSetting(setting.value, DEFAULT_SHOW_CURSOR);
        } else if (setting.key === "highlight" || setting.key === "notehighlight" || setting.key === "playbackhighlight") {
          showHighlight = parseBooleanSetting(setting.value, DEFAULT_SHOW_HIGHLIGHT);
        } else if (setting.key === "legend" || setting.key === "instrumentlegend" || setting.key === "kitlegend" || setting.key === "colorlegend") {
          legendMode = parseLegendMode(setting.value);
        } else if (setting.key === "engraving" || setting.key === "style" || setting.key === "renderstyle") {
          engravingStyle = parseEngravingStyle(setting.value);
        } else if (setting.key === "grid" || setting.key === "subdivision" || setting.key === "resolution") {
          gridResolution = parseGridResolution(setting.value);
        } else {
          metadata.push(`${setting.originalKey}: ${setting.value}`);
        }

        return;
      }

      const row = parseDrumRowInput(line);

      if (row) {
        currentRows.push(row);
      } else {
        metadata.push(line);
      }
    });

  pushCurrentBar();

  const systems = buildSystems(rowSections);
  const bars = systems.flatMap((system) => system.bars);
  const rows = bars.flatMap((bar) => bar.rows);

  return {
    tempo,
    timeSignature,
    repeatCount,
    showCursor,
    showHighlight,
    legendMode,
    engravingStyle,
    gridResolution,
    metadata,
    systems,
    bars,
    rows,
    slots: bars.flatMap((bar) => bar.slots)
  };
}

function isBarSeparator(line: string): boolean {
  return /^(new\s+)?(bar|measure)\b(\s+\d+)?\s*:?.*$/i.test(line);
}

function parseSettingLine(line: string): { key: string; originalKey: string; value: string } | null {
  const match = /^([A-Za-z][A-Za-z\s-]*):\s*(.+)$/.exec(line);

  if (!match) {
    return null;
  }

  const originalKey = match[1].trim();
  const key = normalizeLabel(originalKey);
  const value = match[2].trim();
  const settingKeys = new Set(["title", "author", "comment", "tempo", "bpm", "time", "timesignature", "meter", "count", "repeat", "repeats", "cursor", "playbackcursor", "highlight", "notehighlight", "playbackhighlight", "legend", "instrumentlegend", "kitlegend", "colorlegend", "engraving", "style", "renderstyle", "grid", "subdivision", "resolution"]);

  if (!settingKeys.has(key)) {
    return null;
  }

  return { key, originalKey, value };
}

function parseDrumRowInput(line: string): DrumRowInput | null {
  const dividerIndex = line.indexOf("|");

  if (dividerIndex <= 0) {
    return null;
  }

  const label = line.slice(0, dividerIndex).trim();
  const instrument = INSTRUMENTS_BY_ALIAS.get(normalizeLabel(label));
  const patterns = line
    .slice(dividerIndex + 1)
    .split("|")
    .map((pattern) => pattern.replace(/\s+/g, "").trim())
    .filter((pattern) => pattern.length > 0);

  if (!label || !instrument || patterns.length === 0) {
    return null;
  }

  return { label, patterns, instrument };
}

function buildSystems(rowSections: DrumRowInput[][]): DrumSystem[] {
  let startSlot = 0;

  return rowSections.map((rowInputs) => {
    const segmentCount = Math.max(1, ...rowInputs.map((row) => row.patterns.length));
    const bars = Array.from({ length: segmentCount }, (_, segmentIndex) => {
      const rows = buildRowsForSegment(rowInputs, segmentIndex);
      const slots = buildSlots(rows, startSlot);
      const bar = { rows, slots, startSlot };
      startSlot += slots.length;

      return bar;
    });

    return { bars };
  });
}

function buildRowsForSegment(rowInputs: DrumRowInput[], segmentIndex: number): DrumRow[] {
  return rowInputs
    .map((row): DrumRow | null => {
      const pattern = row.patterns[segmentIndex];

      if (!pattern) {
        return null;
      }

      return {
        label: row.label,
        pattern,
        instrument: row.instrument
      };
    })
    .filter((row): row is DrumRow => row !== null);
}

function buildSlots(rows: DrumRow[], startSlot: number): DrumSlot[] {
  const slotCount = Math.max(0, ...rows.map((row) => row.pattern.length));

  return Array.from({ length: slotCount }, (_, index) => {
    const hits = rows
      .map((row): DrumHit | null => {
        const value = row.pattern[index] ?? "-";

        if (isRest(value)) {
          return null;
        }

        return {
          instrument: row.instrument,
          articulation: getArticulation(value),
          velocity: getVelocity(value)
        };
      })
      .filter((hit): hit is DrumHit => hit !== null);

    return { index: startSlot + index, hits };
  });
}

function renderVexflowScore(block: DrumBlock, container: HTMLElement): ScoreRenderResult {
  container.empty();

  const cssWidth = getScoreWidth(container);
  const layout = getEngravingLayout(block.engravingStyle);
  const width = cssWidth / layout.renderScale;
  const height = layout.systemHeight;
  const useTidyStyle = block.engravingStyle === "tidy";
  const cursorPositions: Array<CursorPosition | undefined> = [];

  container.style.width = "100%";
  container.style.minHeight = `${Math.max(height, block.systems.length * height)}px`;

  block.systems.forEach((scoreSystem, systemIndex) => {
    const system = container.createEl("div", { cls: "drum-notation__system" });
    system.style.height = `${height}px`;

    const renderer = new Renderer(system, Renderer.Backends.SVG);

    renderer.resize(cssWidth, height);

    const context = renderer.getContext();
    context.scale(layout.renderScale, layout.renderScale);

    if (useTidyStyle) {
      context.setFillStyle("currentColor");
      context.setStrokeStyle("currentColor");
      context.setLineWidth(layout.strokeWidth);
    }

    const systemSlots = scoreSystem.bars.flatMap((bar) => bar.slots);
    const totalSlots = Math.max(1, systemSlots.length);
    const staveX = layout.staveX;
    const staveWidth = width - layout.staveX - layout.staveRightPadding;
    const systemTop = systemIndex * height;

    let currentX = staveX;

    scoreSystem.bars.forEach((bar, barIndex) => {
      const isFirstBarInSystem = barIndex === 0;
      const isLastBarInSystem = barIndex === scoreSystem.bars.length - 1;
      const rawBarWidth = (bar.slots.length / totalSlots) * staveWidth;
      const barWidth = isLastBarInSystem ? staveX + staveWidth - currentX : Math.max(layout.barMinWidth, rawBarWidth);
      const stave = new Stave(currentX, layout.staveY, barWidth, {
        leftBar: isFirstBarInSystem,
        rightBar: true,
        ...(layout.staveLineSpacing !== undefined ? { spacingBetweenLinesPx: layout.staveLineSpacing } : {}),
        ...(layout.verticalBarWidth !== undefined ? { verticalBarWidth: layout.verticalBarWidth } : {})
      });
      if (useTidyStyle) {
        stave.setStyle({ fillStyle: "currentColor", strokeStyle: "currentColor", lineWidth: layout.strokeWidth });
        stave.setDefaultLedgerLineStyle({ fillStyle: "currentColor", strokeStyle: "currentColor", lineWidth: layout.ledgerLineWidth });
      }

      if (isFirstBarInSystem) {
        stave.addClef("percussion", useTidyStyle ? "small" : undefined);

        if (systemIndex === 0) {
          const timeSignature = new TimeSignature(block.timeSignature, useTidyStyle ? 6 : undefined);

          if (useTidyStyle && layout.signatureFontSize !== undefined) {
            slimTimeSignature(timeSignature, block.timeSignature, layout.signatureFontSize);
          }

          stave.addModifier(timeSignature);
        }
      }

      stave.setContext(context).draw();
      stave.setNoteStartX(stave.getNoteStartX() + layout.noteStartPadding);

      const visualBar = buildVisualBarNotes(bar.slots, block.timeSignature, block.gridResolution, block.legendMode !== "off");
      const notes = visualBar.notes;
      if (useTidyStyle) {
        notes.forEach((note) => {
          if (layout.noteFontSize !== undefined) {
            note.setFontSize(layout.noteFontSize);
            note.noteHeads.forEach((noteHead) => {
              noteHead.setFontSize(layout.noteFontSize);
            });
          }

          note.setStyle({ fillStyle: "currentColor", strokeStyle: "currentColor", lineWidth: layout.strokeWidth });
          note.setLedgerLineStyle({ fillStyle: "currentColor", strokeStyle: "currentColor", lineWidth: layout.ledgerLineWidth });
        });
      }
      const voice = new Voice({
        numBeats: Math.max(1, Math.ceil(bar.slots.length / getSlotsPerBeat(block.timeSignature, block.gridResolution))),
        beatValue: getBeatValue(block.timeSignature)
      }).setStrict(false);

      voice.addTickables(notes);
      const availableFormatWidth = Math.max(24, barWidth - stave.getModifierXShift() - layout.formatPadding - layout.noteStartPadding - layout.noteEndPadding);
      const slotScaledFormatWidth = Math.max(24, bar.slots.length * layout.maxSlotFormatWidth);
      const formatWidth = Math.min(availableFormatWidth, slotScaledFormatWidth);
      new Formatter().joinVoices([voice]).format([voice], formatWidth);
      voice.draw(context, stave);
      visualBar.beams.forEach((beam) => {
        beam.renderOptions.beamWidth = layout.beamWidth;
        beam.renderOptions.maxSlope = layout.beamMaxSlope;
        beam.renderOptions.minSlope = -layout.beamMaxSlope;
        beam.renderOptions.slopeIterations = 12;
        if (useTidyStyle) {
          beam.setStyle({ fillStyle: "currentColor", strokeStyle: "currentColor", lineWidth: layout.strokeWidth });
        }
        beam.setContext(context).draw();
      });
      visualBar.tuplets.forEach((tuplet) => {
        if (useTidyStyle) {
          tuplet.setStyle({ fillStyle: "currentColor", strokeStyle: "currentColor", lineWidth: layout.strokeWidth });
        }
        tuplet.setContext(context).draw();
      });
      drawOpenHatMarks(system, visualBar.hitNotes, visualBar.noteSlots, layout);
      drawAccentMarks(system, visualBar.hitNotes, visualBar.noteSlots, layout);
      drawDiddleMarks(system, visualBar.hitNotes, visualBar.noteSlots, layout);
      drawBuzzRollMarks(system, visualBar.hitNotes, visualBar.noteSlots, layout);

      const cursorHeight = (stave.getYForLine(stave.getNumLines() - 1) - stave.getYForLine(0)) * layout.renderScale;
      const cursorY = systemTop + stave.getYForLine(0) * layout.renderScale;

      visualBar.noteSlots.forEach((slot, noteIndex) => {
        cursorPositions[slot.index] = {
          x: visualBar.hitNotes[noteIndex].getNoteHeadBeginX() * layout.renderScale,
          y: cursorY,
          height: cursorHeight
        };
      });

      currentX += barWidth;
    });
  });

  return { cursorPositions };
}

function renderInstrumentLegend(block: DrumBlock, root: HTMLElement): void {
  if (block.legendMode === "off") {
    return;
  }

  const instruments = getLegendInstruments(block);

  if (instruments.length === 0) {
    return;
  }

  const legend = root.createEl("div", { cls: "drum-notation__legend" });

  instruments.forEach((instrument) => {
    const item = legend.createEl("div", { cls: "drum-notation__legend-item" });
    const swatch = item.createEl("span", { cls: "drum-notation__legend-swatch" });
    const code = item.createEl("code", {
      cls: "drum-notation__legend-code",
      text: getPreferredInstrumentCode(instrument)
    });

    swatch.style.backgroundColor = instrument.color;
    item.createEl("span", {
      cls: "drum-notation__legend-label",
      text: instrument.label
    });
    code.setAttr("aria-label", `Notation row label ${code.textContent ?? ""}`);
  });
}

function getLegendInstruments(block: DrumBlock): DrumInstrument[] {
  if (block.legendMode === "all") {
    return DRUM_KIT;
  }

  const usedInstrumentIds = new Set(block.rows.map((row) => row.instrument.id));

  return DRUM_KIT.filter((instrument) => usedInstrumentIds.has(instrument.id));
}

function getPreferredInstrumentCode(instrument: DrumInstrument): string {
  const alias = instrument.aliases[0] ?? instrument.id;

  return alias.toUpperCase();
}

function colorRenderedNoteheads(block: DrumBlock, container: HTMLElement): void {
  const noteGroups = Array.from(container.querySelectorAll<SVGGElement>("svg .vf-stavenote"));
  let groupIndex = 0;

  block.slots.forEach((slot) => {
    if (slot.hits.length === 0) {
      return;
    }

    const group = noteGroups[groupIndex];
    groupIndex += 1;

    if (!group) {
      return;
    }

    group.classList.add("drum-notation__colored-note");
    const noteheadGroups = Array.from(group.querySelectorAll<SVGGElement>(".vf-notehead"));
    const coloredHits = getUniqueHitsForRenderedNoteheads(slot.hits);
    const fallbackColor = coloredHits[0]?.instrument.color;

    if (fallbackColor) {
      group.style.setProperty("--drum-notehead-color", fallbackColor);
      colorSvgShape(group, fallbackColor);
      restoreNonNoteheadInk(group);
    }

    coloredHits.forEach((hit, hitIndex) => {
      const noteheadGroup = noteheadGroups[hitIndex];

      if (!noteheadGroup) {
        return;
      }

      colorSvgShape(noteheadGroup, hit.instrument.color);
    });
  });
}

function getUniqueHitsForRenderedNoteheads(hits: DrumHit[]): DrumHit[] {
  const hitsByVexKey = new Map<string, DrumHit>();

  hits.forEach((hit) => {
    if (!hitsByVexKey.has(hit.instrument.vexKey)) {
      hitsByVexKey.set(hit.instrument.vexKey, hit);
    }
  });

  return Array.from(hitsByVexKey.values()).sort((left, right) => compareVexKeys(left.instrument.vexKey, right.instrument.vexKey));
}

function colorSvgShape(element: SVGElement, color: string): void {
  const shapes = [element, ...Array.from(element.querySelectorAll<SVGElement>("path, text, line, polygon, polyline, ellipse, circle"))];

  shapes.forEach((shape) => {
    shape.style.fill = color;
    shape.style.stroke = color;
  });
}

function restoreNonNoteheadInk(group: SVGGElement): void {
  group
    .querySelectorAll<SVGElement>(
      ".vf-stem, .vf-stem *, .vf-flag, .vf-flag *, .vf-modifiers, .vf-modifiers *, .vf-gracenote, .vf-gracenote *, .vf-parenthesis, .vf-parenthesis *"
    )
    .forEach((shape) => {
      shape.style.fill = "currentColor";
      shape.style.stroke = "currentColor";
    });
}

function getScoreWidth(container: HTMLElement): number {
  const parentWidth = container.parentElement?.clientWidth ?? container.clientWidth;

  return Math.max(320, Math.floor((parentWidth || 720) - 16));
}

function drawOpenHatMarks(system: HTMLElement, notes: StaveNote[], noteSlots: DrumSlot[], layout: EngravingLayout): void {
  const svg = system.querySelector<SVGSVGElement>("svg");

  if (!svg) {
    return;
  }

  noteSlots.forEach((slot, noteIndex) => {
    if (!slot.hits.some((hit) => hit.instrument.id === "open-hat")) {
      return;
    }

    const note = notes[noteIndex];

    if (!note) {
      return;
    }

    const stemTopY = note.getStemExtents().topY;
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    const x = note.getStemX();
    const y = stemTopY - layout.openHatGap - layout.openHatRadius;

    circle.classList.add("drum-notation__open-hat");
    circle.setAttribute("cx", String(x));
    circle.setAttribute("cy", String(y));
    circle.setAttribute("r", String(layout.openHatRadius));
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", "currentColor");
    circle.setAttribute("stroke-width", String(layout.openHatStrokeWidth));
    svg.appendChild(circle);
  });
}

function drawAccentMarks(system: HTMLElement, notes: StaveNote[], noteSlots: DrumSlot[], layout: EngravingLayout): void {
  const svg = system.querySelector<SVGSVGElement>("svg");

  if (!svg) {
    return;
  }

  noteSlots.forEach((slot, noteIndex) => {
    if (!slot.hits.some((hit) => hit.articulation === "accent")) {
      return;
    }

    const note = notes[noteIndex];

    if (!note) {
      return;
    }

    const stemTopY = note.getStemExtents().topY;
    const x = note.getStemX() - layout.accentWidth * 0.45;
    const y = stemTopY - layout.accentGap;
    const halfHeight = layout.accentHeight / 2;
    const accent = document.createElementNS("http://www.w3.org/2000/svg", "polyline");

    accent.classList.add("drum-notation__accent");
    accent.setAttribute("points", `${x},${y - halfHeight} ${x + layout.accentWidth},${y} ${x},${y + halfHeight}`);
    accent.setAttribute("fill", "none");
    accent.setAttribute("stroke", "currentColor");
    accent.setAttribute("stroke-width", String(layout.accentStrokeWidth));
    accent.setAttribute("stroke-linecap", "round");
    accent.setAttribute("stroke-linejoin", "round");
    svg.appendChild(accent);
  });
}

function drawDiddleMarks(system: HTMLElement, notes: StaveNote[], noteSlots: DrumSlot[], layout: EngravingLayout): void {
  const svg = system.querySelector<SVGSVGElement>("svg");

  if (!svg) {
    return;
  }

  noteSlots.forEach((slot, noteIndex) => {
    if (!slot.hits.some((hit) => hit.articulation === "diddle")) {
      return;
    }

    const note = notes[noteIndex];

    if (!note) {
      return;
    }

    const stem = note.getStem();

    if (!stem) {
      return;
    }

    const stemMiddleY = getStemMarkMiddleY(note, layout.diddleHeight, layout.diddleThickness, layout.diddleNoteheadClearance);
    const stemX = note.getStemX();
    const diddle = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    const leftX = stemX - layout.diddleWidth / 2;
    const rightX = stemX + layout.diddleWidth / 2;
    const leftY = stemMiddleY + layout.diddleHeight / 2;
    const rightY = stemMiddleY - layout.diddleHeight / 2;
    const halfThickness = layout.diddleThickness / 2;

    diddle.classList.add("drum-notation__diddle");
    diddle.setAttribute(
      "points",
      `${leftX},${leftY - halfThickness} ${rightX},${rightY - halfThickness} ${rightX},${rightY + halfThickness} ${leftX},${leftY + halfThickness}`
    );
    diddle.setAttribute("fill", layout.diddleFill);
    diddle.setAttribute("stroke", layout.diddleFill);
    diddle.setAttribute("stroke-width", "0");
    svg.appendChild(diddle);
  });
}

function drawBuzzRollMarks(
  system: HTMLElement,
  notes: StaveNote[],
  noteSlots: DrumSlot[],
  layout: EngravingLayout
): void {
  const svg = system.querySelector<SVGSVGElement>("svg");

  if (!svg) {
    return;
  }

  noteSlots.forEach((slot, noteIndex) => {
    if (!slot.hits.some((hit) => hit.articulation === "buzz")) {
      return;
    }

    const note = notes[noteIndex];

    if (!note) {
      return;
    }

    const stem = note.getStem();

    if (!stem) {
      return;
    }

    const stemMiddleY = getStemMarkMiddleY(note, layout.diddleHeight, layout.diddleThickness, layout.diddleNoteheadClearance);
    const stemX = note.getStemX();
    const buzz = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const leftX = stemX - layout.buzzWidth / 2;
    const rightX = stemX + layout.buzzWidth / 2;
    const buzzCenterY = stemMiddleY;
    const buzzTopY = buzzCenterY - layout.buzzHeight / 2;
    const buzzBottomY = buzzCenterY + layout.buzzHeight / 2;
    const segments: Array<[number, number, number, number]> = [
      [leftX, buzzTopY, rightX, buzzTopY],
      [rightX, buzzTopY, leftX, buzzBottomY],
      [leftX, buzzBottomY, rightX, buzzBottomY]
    ];

    buzz.classList.add("drum-notation__buzz");
    buzz.setAttribute("data-drum-anchor-y", String(stemMiddleY));
    buzz.setAttribute("data-drum-center-y", String(buzzCenterY));
    segments.forEach(([x1, y1, x2, y2]) => {
      const segment = document.createElementNS("http://www.w3.org/2000/svg", "line");

      segment.setAttribute("x1", String(x1));
      segment.setAttribute("y1", String(y1));
      segment.setAttribute("x2", String(x2));
      segment.setAttribute("y2", String(y2));
      segment.setAttribute("stroke", "currentColor");
      segment.setAttribute("stroke-width", String(layout.buzzStrokeWidth));
      segment.setAttribute("stroke-linecap", "round");
      segment.setAttribute("stroke-linejoin", "round");
      buzz.appendChild(segment);
    });
    svg.appendChild(buzz);
  });
}

function getStemMarkMiddleY(note: StaveNote, markHeight: number, markThickness: number, noteheadClearance: number): number {
  const { topY, baseY } = note.getStemExtents();
  const noteheadTopY = Math.min(...note.getYs());
  const defaultMiddleY = topY + (baseY - topY) * 0.56;
  const lowerEdgeOffset = markHeight / 2 + markThickness / 2;
  const lowestAllowedMiddleY = noteheadTopY - noteheadClearance - lowerEdgeOffset;

  return Math.min(defaultMiddleY, lowestAllowedMiddleY);
}

function getEngravingLayout(style: EngravingStyle): EngravingLayout {
  if (style === "classic") {
    return {
      systemHeight: 180,
      renderScale: 1,
      staveY: 36,
      staveX: 16,
      staveRightPadding: 16,
      barMinWidth: 80,
      noteStartPadding: 0,
      noteEndPadding: 0,
      formatPadding: 28,
      maxSlotFormatWidth: Number.POSITIVE_INFINITY,
      beamWidth: 5,
      beamMaxSlope: 0.25,
      strokeWidth: 1,
      ledgerLineWidth: 1,
      noteFontSize: undefined,
      signatureFontSize: undefined,
      accentGap: 13,
      accentWidth: 11,
      accentHeight: 7,
      accentStrokeWidth: 1,
      diddleWidth: 12,
      diddleHeight: 7,
      diddleThickness: 4.2,
      diddleFill: "#000000",
      diddleNoteheadClearance: 7,
      buzzWidth: 10,
      buzzHeight: 13,
      buzzStrokeWidth: 1.6,
      openHatRadius: 4,
      openHatGap: 8,
      openHatStrokeWidth: 1.2
    };
  }

  return {
    systemHeight: 112,
    renderScale: 0.9,
    staveY: 30,
    staveX: 16,
    staveRightPadding: 18,
    staveLineSpacing: 8.8,
    verticalBarWidth: 0.9,
    barMinWidth: 84,
    noteStartPadding: 8,
    noteEndPadding: 10,
    formatPadding: 24,
    maxSlotFormatWidth: 20,
    beamWidth: 2.6,
    beamMaxSlope: 0.06,
    strokeWidth: 0.68,
    ledgerLineWidth: 0.68,
    noteFontSize: 25,
    signatureFontSize: 22,
    accentGap: 15,
    accentWidth: 10,
    accentHeight: 6,
    accentStrokeWidth: 0.72,
    diddleWidth: 11,
    diddleHeight: 6,
    diddleThickness: 3.4,
    diddleFill: "rgb(77, 79, 102)",
    diddleNoteheadClearance: 6,
    buzzWidth: 8,
    buzzHeight: 10,
    buzzStrokeWidth: 1.05,
    openHatRadius: 3.4,
    openHatGap: 7,
    openHatStrokeWidth: 0.85
  };
}

function slimTimeSignature(timeSignature: TimeSignature, timeSpec: string, fontSize: number): void {
  const signatureParts = timeSignature as unknown as {
    topText?: { setFontSize: (size: number) => unknown };
    botText?: { setFontSize: (size: number) => unknown };
  };

  signatureParts.topText?.setFontSize(fontSize);
  signatureParts.botText?.setFontSize(fontSize);
  timeSignature.setTimeSig(timeSpec);
}

function buildVisualBarNotes(
  slots: DrumSlot[],
  timeSignature: string,
  gridResolution: GridResolution,
  colorNoteheads: boolean
): VisualBarNotes {
  if (gridResolution === 32) {
    return buildGrid32VisualBarNotes(slots, timeSignature, colorNoteheads);
  }

  const notes: StaveNote[] = [];
  const hitNotes: StaveNote[] = [];
  const noteSlots: DrumSlot[] = [];
  const beams: Beam[] = [];
  const tuplets: Tuplet[] = [];
  const slotsPerBeat = getSlotsPerBeat(timeSignature, gridResolution);
  const beatValue = getBeatValue(timeSignature);

  for (let start = 0; start < slots.length; start += slotsPerBeat) {
    const beatSlots = slots.slice(start, start + slotsPerBeat);
    const hitSlots = beatSlots.filter((slot) => slot.hits.length > 0);

    if (hitSlots.length === 0) {
      notes.push(makeStaveNote({ index: -1, hits: [] }, durationForDenominator(beatValue)));
      continue;
    }

    const duration = durationForSubdivision(beatValue, hitSlots.length);
    const beatNotes = hitSlots.map((slot) => makeStaveNote(slot, duration, colorNoteheads));

    notes.push(...beatNotes);
    hitNotes.push(...beatNotes);
    noteSlots.push(...hitSlots);

    if (shouldBeamSubdivision(hitSlots.length, duration)) {
      beams.push(new Beam(beatNotes));
    }

    if (hitSlots.length === 3) {
      tuplets.push(new Tuplet(beatNotes, { numNotes: 3, notesOccupied: 2, bracketed: false }));
    } else if (hitSlots.length === 6) {
      tuplets.push(new Tuplet(beatNotes, { numNotes: 6, notesOccupied: 4, bracketed: false }));
    }
  }

  return { notes, hitNotes, noteSlots, beams, tuplets };
}

function buildGrid32VisualBarNotes(slots: DrumSlot[], timeSignature: string, colorNoteheads: boolean): VisualBarNotes {
  const notes: StaveNote[] = [];
  const hitNotes: StaveNote[] = [];
  const noteSlots: DrumSlot[] = [];
  const beams: Beam[] = [];
  const tuplets: Tuplet[] = [];
  const slotsPerBeat = getSlotsPerBeat(timeSignature, 32);

  for (let start = 0; start < slots.length; start += slotsPerBeat) {
    const beatSlots = slots.slice(start, start + slotsPerBeat);
    const hitIndexes = beatSlots
      .map((slot, index) => (slot.hits.length > 0 ? index : -1))
      .filter((index) => index >= 0);
    let cursor = 0;
    let beamGroup: StaveNote[] = [];

    const finishBeamGroup = () => {
      if (beamGroup.length > 1) {
        beams.push(new Beam(beamGroup));
      }

      beamGroup = [];
    };

    if (hitIndexes.length === 0) {
      appendHiddenGridRests(notes, beatSlots.length, 32);
      continue;
    }

    hitIndexes.forEach((hitIndex, indexInBeat) => {
      if (hitIndex > cursor) {
        finishBeamGroup();
        appendHiddenGridRests(notes, hitIndex - cursor, 32);
      }

      const slot = beatSlots[hitIndex];
      const nextHitIndex = hitIndexes[indexInBeat + 1] ?? beatSlots.length;
      const span = nextHitIndex - hitIndex;
      const supportedSpan = isPowerOfTwo(span) ? span : 1;
      const duration = durationForGridSpan(32, supportedSpan);
      const note = makeStaveNote(slot, duration, colorNoteheads);

      notes.push(note);
      hitNotes.push(note);
      noteSlots.push(slot);
      beamGroup.push(note);
      cursor = hitIndex + supportedSpan;

      if (supportedSpan !== span) {
        finishBeamGroup();
        appendHiddenGridRests(notes, span - supportedSpan, 32);
        cursor = nextHitIndex;
      }
    });

    finishBeamGroup();

    if (cursor < beatSlots.length) {
      appendHiddenGridRests(notes, beatSlots.length - cursor, 32);
    }
  }

  return { notes, hitNotes, noteSlots, beams, tuplets };
}

function appendHiddenGridRests(notes: StaveNote[], span: number, gridResolution: GridResolution): void {
  let remaining = span;

  while (remaining > 0) {
    const restSpan = largestPowerOfTwoAtMost(remaining);

    notes.push(makeStaveNote({ index: -1, hits: [] }, durationForGridSpan(gridResolution, restSpan)));
    remaining -= restSpan;
  }
}

function durationForGridSpan(gridResolution: GridResolution, span: number): string {
  return durationForDenominator(gridResolution / Math.max(1, span));
}

function largestPowerOfTwoAtMost(value: number): number {
  let power = 1;

  while (power * 2 <= value) {
    power *= 2;
  }

  return power;
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function durationForSubdivision(beatValue: number, noteCount: number): string {
  if (noteCount === 3) {
    return durationForDenominator(beatValue * 2);
  }

  if (noteCount === 6) {
    return durationForDenominator(beatValue * 4);
  }

  return durationForDenominator(beatValue * Math.max(1, noteCount));
}

function durationForDenominator(denominator: number): string {
  const rounded = Math.max(1, Math.round(denominator));

  if (rounded <= 1) {
    return "1";
  }

  if (rounded <= 2) {
    return "2";
  }

  if (rounded <= 4) {
    return "4";
  }

  if (rounded <= 8) {
    return "8";
  }

  if (rounded <= 16) {
    return "16";
  }

  return "32";
}

function shouldBeamSubdivision(noteCount: number, duration: string): boolean {
  return noteCount > 1 && duration !== "4" && duration !== "2" && duration !== "1";
}

function makeRenderedNotesInteractive(
  block: DrumBlock,
  container: HTMLElement,
  onPreview: (slot: DrumSlot) => void
): Array<SVGGElement | undefined> {
  const noteGroups = Array.from(container.querySelectorAll<SVGGElement>("svg .vf-stavenote"));
  const noteElements: Array<SVGGElement | undefined> = [];
  let groupIndex = 0;

  block.slots.forEach((slot) => {
    if (slot.hits.length === 0) {
      return;
    }

    const group = noteGroups[groupIndex];
    groupIndex += 1;

    if (!group) {
      return;
    }

    noteElements[slot.index] = group;

    const instrumentList = slot.hits.map((hit) => hit.instrument.label).join(", ");

    group.classList.add("drum-notation__interactive-note");
    group.setAttribute("tabindex", "0");
    group.setAttribute("role", "button");
    group.setAttribute("aria-label", `Preview ${instrumentList} at slot ${slot.index + 1}`);
    group.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onPreview(slot);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onPreview(slot);
      }
    });
  });

  return noteElements;
}

function makeStaveNote(slot: DrumSlot, duration = "16", colorNoteheads = false): StaveNote {
  if (slot.hits.length === 0) {
    const rest = new StaveNote({
      keys: ["b/4"],
      duration: `${duration}r`,
      clef: "percussion",
      stemDirection: Stem.UP
    });

    rest.renderOptions.draw = false;

    return rest;
  }

  const keys = Array.from(new Set(slot.hits.map((hit) => hit.instrument.vexKey))).sort(compareVexKeys);

  const note = new StaveNote({
    keys,
    duration,
    clef: "percussion",
    stemDirection: Stem.UP
  });

  if (colorNoteheads) {
    applyLegendNoteheadColors(note, slot.hits);
  }

  applyHitModifiers(note, slot.hits);

  return note;
}

function applyLegendNoteheadColors(note: StaveNote, hits: DrumHit[]): void {
  const keys = note.getKeys();

  keys.forEach((key, keyIndex) => {
    const hit = hits.find((candidate) => candidate.instrument.vexKey === key);

    if (!hit) {
      return;
    }

    note.setKeyStyle(keyIndex, {
      fillStyle: hit.instrument.color,
      strokeStyle: hit.instrument.color
    });
  });
}

function applyHitModifiers(note: StaveNote, hits: DrumHit[]): void {
  addGhostParentheses(note, hits);
  addFlamGraceNotes(note, hits);
}

function addGhostParentheses(note: StaveNote, hits: DrumHit[]): void {
  hits
    .filter((hit) => hit.articulation === "ghost")
    .forEach((hit) => {
      const noteheadIndex = note.getKeys().findIndex((key) => key === hit.instrument.vexKey);

      if (noteheadIndex < 0) {
        return;
      }

      note.addModifier(new Parenthesis(Modifier.Position.LEFT), noteheadIndex);
      note.addModifier(new Parenthesis(Modifier.Position.RIGHT), noteheadIndex);
    });
}

function addFlamGraceNotes(note: StaveNote, hits: DrumHit[]): void {
  hits
    .filter((hit) => hit.articulation === "flam")
    .forEach((hit) => {
      const noteheadIndex = note.getKeys().findIndex((key) => key === hit.instrument.vexKey);

      if (noteheadIndex < 0) {
        return;
      }

      const graceNote = new GraceNote({
        keys: [hit.instrument.vexKey],
        duration: "8",
        clef: "percussion",
        stemDirection: Stem.UP,
        slash: false
      });

      note.addModifier(new GraceNoteGroup([graceNote], true), noteheadIndex);
    });
}

function compareVexKeys(left: string, right: string): number {
  return vexKeyRank(left) - vexKeyRank(right);
}

function vexKeyRank(key: string): number {
  const [pitch, octave = "4"] = key.split("/");
  const pitchRanks: Record<string, number> = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };

  return Number.parseInt(octave, 10) * 7 + (pitchRanks[pitch.toLowerCase()] ?? 0);
}

function getTitle(block: DrumBlock): string {
  const title = block.metadata.find((line) => normalizeLabel(line.split(":")[0] ?? "") === "title");

  if (!title) {
    return "Drum notation";
  }

  return title.slice(title.indexOf(":") + 1).trim() || "Drum notation";
}

function parseTimeSignature(value: string): string {
  const match = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(value);

  if (!match) {
    return DEFAULT_TIME_SIGNATURE;
  }

  return `${match[1]}/${match[2]}`;
}

function parseRepeatCount(value: string): number {
  const match = /(\d+)/.exec(value);

  if (!match) {
    return DEFAULT_REPEAT_COUNT;
  }

  return Math.min(64, Math.max(1, Number.parseInt(match[1], 10)));
}

function parseBooleanSetting(value: string, fallback: boolean): boolean {
  const normalized = normalizeLabel(value);

  if (["on", "true", "yes", "y", "1", "show", "visible"].includes(normalized)) {
    return true;
  }

  if (["off", "false", "no", "n", "0", "hide", "hidden"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseLegendMode(value: string): LegendMode {
  const normalized = normalizeLabel(value);

  if (["on", "true", "yes", "y", "1", "show", "visible", "used", "current", "present"].includes(normalized)) {
    return "used";
  }

  if (["all", "full", "kit", "complete", "supported", "everything"].includes(normalized)) {
    return "all";
  }

  if (["off", "false", "no", "n", "0", "hide", "hidden", "none"].includes(normalized)) {
    return "off";
  }

  return DEFAULT_LEGEND_MODE;
}

function parseEngravingStyle(value: string): EngravingStyle {
  const normalized = normalizeLabel(value);

  if (["classic", "legacy", "old", "original", "rollback", "default"].includes(normalized)) {
    return "classic";
  }

  if (["tidy", "neat", "compact", "abc", "abcstyle", "modern"].includes(normalized)) {
    return "tidy";
  }

  return DEFAULT_ENGRAVING_STYLE;
}

function parseGridResolution(value: string): GridResolution {
  const match = /(\d+)/.exec(value);

  if (!match) {
    return DEFAULT_GRID_RESOLUTION;
  }

  return Number.parseInt(match[1], 10) === 32 ? 32 : 16;
}

function getBarRange(block: DrumBlock, slotIndex: number): { startSlot: number; endSlot: number } {
  const declaredBar = block.bars.find((bar) => slotIndex >= bar.startSlot && slotIndex < bar.startSlot + bar.slots.length);

  if (declaredBar) {
    return {
      startSlot: declaredBar.startSlot,
      endSlot: declaredBar.startSlot + declaredBar.slots.length
    };
  }

  const slotsPerBar = getSlotsPerBar(block.timeSignature, block.gridResolution);
  const startSlot = Math.floor(slotIndex / slotsPerBar) * slotsPerBar;

  return {
    startSlot,
    endSlot: Math.min(block.slots.length, startSlot + slotsPerBar)
  };
}

function getSlotsPerBar(timeSignature: string, gridResolution: GridResolution = DEFAULT_GRID_RESOLUTION): number {
  const match = /^(\d+)\/(\d+)$/.exec(timeSignature);

  if (!match) {
    return 16;
  }

  const beats = Number.parseInt(match[1], 10);
  const beatValue = Number.parseInt(match[2], 10);
  const slots = beats * (gridResolution / beatValue);

  return Math.max(1, Math.round(slots));
}

function getSlotsPerBeat(timeSignature: string, gridResolution: GridResolution = DEFAULT_GRID_RESOLUTION): number {
  const beatValue = getBeatValue(timeSignature);

  return Math.max(1, Math.round(gridResolution / beatValue));
}

function getBeatValue(timeSignature: string): number {
  const match = /^\d+\/(\d+)$/.exec(timeSignature);

  if (!match) {
    return 4;
  }

  return Math.max(1, Number.parseInt(match[1], 10));
}

function getSecondsPerSlot(block: DrumBlock): number {
  return 60 / block.tempo / (block.gridResolution / 4);
}

function getSlotVisualDurationSeconds(block: DrumBlock, targetSlot: DrumSlot): number {
  const bar = block.bars.find((candidate) => candidate.slots.some((slot) => slot.index === targetSlot.index));

  if (!bar) {
    return getSecondsPerSlot(block);
  }

  const slotsPerBeat = getSlotsPerBeat(block.timeSignature, block.gridResolution);
  const localIndex = targetSlot.index - bar.startSlot;
  const beatStart = Math.floor(localIndex / slotsPerBeat) * slotsPerBeat;
  const beatSlots = bar.slots.slice(beatStart, beatStart + slotsPerBeat);
  const indexInBeat = beatSlots.findIndex((slot) => slot.index === targetSlot.index);

  if (indexInBeat < 0 || targetSlot.hits.length === 0) {
    return getSecondsPerSlot(block);
  }

  if (block.gridResolution === 32) {
    const hitIndexes = beatSlots
      .map((slot, index) => (slot.hits.length > 0 ? index : -1))
      .filter((index) => index >= 0);
    const hitPosition = hitIndexes.indexOf(indexInBeat);
    const nextHitIndex = hitIndexes[hitPosition + 1] ?? beatSlots.length;
    const span = nextHitIndex - indexInBeat;
    const supportedSpan = isPowerOfTwo(span) ? span : 1;

    return Math.max(getSecondsPerSlot(block), supportedSpan * getSecondsPerSlot(block));
  }

  const hitCount = beatSlots.filter((slot) => slot.hits.length > 0).length;

  if (hitCount <= 0) {
    return getSecondsPerSlot(block);
  }

  return Math.max(getSecondsPerSlot(block), (slotsPerBeat / hitCount) * getSecondsPerSlot(block));
}

function clampTempo(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TEMPO;
  }

  return Math.min(260, Math.max(30, value));
}

function getVelocity(value: string): number {
  if (getArticulation(value) === "accent") {
    return 1;
  }

  if (getArticulation(value) === "ghost") {
    return 0.4;
  }

  if (getArticulation(value) === "buzz") {
    return 0.68;
  }

  return 0.75;
}

function getArticulation(value: string): DrumArticulation {
  if (value === "z" || value === "Z") {
    return "buzz";
  }

  if (value === "O" || value === "X" || value === "!" || value === "#" || value === ">") {
    return "accent";
  }

  if (value === "g") {
    return "ghost";
  }

  if (value === "f") {
    return "flam";
  }

  if (value === "d") {
    return "diddle";
  }

  return "normal";
}

function isRest(value: string): boolean {
  return value === "-" || value === "." || value === "_" || value === " ";
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

class DrumSynth {
  private audioContext: AudioContext | null = null;

  get currentTime(): number {
    return this.requireContext().currentTime;
  }

  async start(): Promise<void> {
    this.audioContext = new AudioContext();
    await this.audioContext.resume();
  }

  stop(): void {
    if (this.audioContext && this.audioContext.state !== "closed") {
      void this.audioContext.close();
    }

    this.audioContext = null;
  }

  scheduleHits(hits: DrumHit[], time: number, slotDuration = 0, noteDuration = slotDuration): void {
    hits.forEach((hit) => this.scheduleHit(hit, time, slotDuration, noteDuration));
  }

  scheduleHit(hit: DrumHit, time: number, slotDuration = 0, noteDuration = slotDuration): void {
    if (!this.audioContext) {
      return;
    }

    if (hit.articulation === "flam") {
      this.scheduleInstrument(hit.instrument.playback, Math.max(0, time - 0.035), hit.velocity * 0.45);
    }

    if (hit.articulation === "diddle") {
      this.scheduleInstrument(hit.instrument.playback, time, hit.velocity);
      this.scheduleInstrument(hit.instrument.playback, time + Math.max(0.025, slotDuration / 2), hit.velocity * 0.92);
      return;
    }

    if (hit.articulation === "buzz" && hit.instrument.playback === "snare") {
      this.scheduleBuzzRoll(time, Math.max(slotDuration, noteDuration), hit.velocity);
      return;
    }

    this.scheduleInstrument(hit.instrument.playback, time, hit.velocity);
  }

  private scheduleInstrument(playback: DrumPlaybackKind, time: number, velocity: number): void {
    switch (playback) {
      case "kick":
        this.scheduleKick(time, velocity);
        break;
      case "snare":
        this.scheduleSnare(time, velocity);
        break;
      case "tomHigh":
        this.scheduleTom(time, 190, velocity);
        break;
      case "tomMid":
        this.scheduleTom(time, 145, velocity);
        break;
      case "tomLow":
        this.scheduleTom(time, 105, velocity);
        break;
      case "hatClosed":
        this.scheduleNoise(time, 0.045, 7000, velocity * 0.55);
        break;
      case "hatOpen":
        this.scheduleNoise(time, 0.24, 6200, velocity * 0.5);
        break;
      case "hatFoot":
        this.scheduleNoise(time, 0.08, 5200, velocity * 0.35);
        this.scheduleClick(time, velocity * 0.25);
        break;
      case "ride":
        this.scheduleMetal(time, 0.38, 1800, velocity * 0.35);
        break;
      case "crash":
        this.scheduleNoise(time, 0.8, 4200, velocity * 0.55);
        this.scheduleMetal(time, 0.8, 900, velocity * 0.35);
        break;
      case "cowbell":
        this.scheduleCowbell(time, velocity);
        break;
      case "click":
        this.scheduleClick(time, velocity);
        break;
    }
  }

  private scheduleKick(time: number, velocity: number): void {
    const context = this.requireContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(150, time);
    oscillator.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    gain.gain.setValueAtTime(velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start(time);
    oscillator.stop(time + 0.18);
  }

  private scheduleSnare(time: number, velocity: number): void {
    this.scheduleSnareBody(time, velocity);
    this.scheduleSnareWires(time, velocity);
    this.scheduleTone(time, 0.035, 240, velocity * 0.22, "triangle");
  }

  private scheduleBuzzRoll(time: number, duration: number, velocity: number): void {
    const context = this.requireContext();
    const clippedDuration = Math.max(0.06, Math.min(3, duration));
    const bufferSize = Math.max(1, Math.floor(context.sampleRate * clippedDuration));
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i += 1) {
      const progress = i / bufferSize;
      const tremor = 0.72 + Math.sin(progress * Math.PI * 2 * clippedDuration * 42) * 0.28;
      data[i] = (Math.random() * 2 - 1) * tremor;
    }

    const source = context.createBufferSource();
    const bandpass = context.createBiquadFilter();
    const highpass = context.createBiquadFilter();
    const gain = context.createGain();
    const attack = Math.min(0.018, clippedDuration * 0.18);
    const releaseStart = Math.max(time + attack, time + clippedDuration - Math.min(0.055, clippedDuration * 0.35));

    source.buffer = buffer;
    bandpass.type = "bandpass";
    bandpass.frequency.setValueAtTime(1850, time);
    bandpass.Q.setValueAtTime(0.75, time);
    highpass.type = "highpass";
    highpass.frequency.setValueAtTime(520, time);
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(velocity * 0.62, time + attack);
    gain.gain.setValueAtTime(velocity * 0.55, releaseStart);
    gain.gain.exponentialRampToValueAtTime(0.001, time + clippedDuration);

    source.connect(bandpass).connect(highpass).connect(gain).connect(context.destination);
    source.start(time);
    source.stop(time + clippedDuration + 0.02);
  }

  private scheduleSnareBody(time: number, velocity: number): void {
    const context = this.requireContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(245, time);
    oscillator.frequency.exponentialRampToValueAtTime(175, time + 0.09);
    gain.gain.setValueAtTime(velocity * 0.34, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start(time);
    oscillator.stop(time + 0.14);
  }

  private scheduleSnareWires(time: number, velocity: number): void {
    const context = this.requireContext();
    const duration = 0.22;
    const bufferSize = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = context.createBufferSource();
    const bandpass = context.createBiquadFilter();
    const highpass = context.createBiquadFilter();
    const gain = context.createGain();

    source.buffer = buffer;
    bandpass.type = "bandpass";
    bandpass.frequency.setValueAtTime(1800, time);
    bandpass.Q.setValueAtTime(0.9, time);
    highpass.type = "highpass";
    highpass.frequency.setValueAtTime(650, time);
    gain.gain.setValueAtTime(velocity * 0.95, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    source.connect(bandpass).connect(highpass).connect(gain).connect(context.destination);
    source.start(time);
    source.stop(time + duration + 0.02);
  }

  private scheduleTom(time: number, frequency: number, velocity: number): void {
    const context = this.requireContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, time);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.62, time + 0.18);
    gain.gain.setValueAtTime(velocity * 0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start(time);
    oscillator.stop(time + 0.3);
  }

  private scheduleCowbell(time: number, velocity: number): void {
    this.scheduleTone(time, 0.18, 540, velocity * 0.35, "square");
    this.scheduleTone(time, 0.16, 800, velocity * 0.25, "square");
  }

  private scheduleClick(time: number, velocity: number): void {
    this.scheduleTone(time, 0.045, 1800, velocity * 0.35, "triangle");
  }

  private scheduleMetal(time: number, duration: number, frequency: number, velocity: number): void {
    this.scheduleTone(time, duration, frequency, velocity, "square");
    this.scheduleTone(time, duration * 0.8, frequency * 1.36, velocity * 0.55, "square");
  }

  private scheduleTone(
    time: number,
    duration: number,
    frequency: number,
    velocity: number,
    type: OscillatorType
  ): void {
    const context = this.requireContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    gain.gain.setValueAtTime(velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.02);
  }

  private scheduleNoise(time: number, duration: number, frequency: number, velocity: number): void {
    const context = this.requireContext();
    const bufferSize = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    source.buffer = buffer;
    filter.type = "highpass";
    filter.frequency.setValueAtTime(frequency, time);
    gain.gain.setValueAtTime(velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    source.connect(filter).connect(gain).connect(context.destination);
    source.start(time);
    source.stop(time + duration + 0.02);
  }

  private requireContext(): AudioContext {
    if (!this.audioContext) {
      throw new Error("Audio context is not ready.");
    }

    return this.audioContext;
  }
}

class DrumPlayer {
  private synth: DrumSynth | null = null;
  private timers: number[] = [];
  private stopped = false;
  private secondsPerSlot = 0;
  private playbackStartTime = 0;
  private playStartSlot = 0;
  private playEndSlot = 0;
  private playSlots: DrumSlot[] = [];
  private passDurationSeconds = 0;

  constructor(
    private readonly block: DrumBlock,
    private readonly onEnded: () => void,
    private readonly onSlotChange: (slotIndex: number) => void,
    private readonly options: PlaybackOptions = {}
  ) {}

  async play(): Promise<void> {
    this.synth = new DrumSynth();
    await this.synth.start();

    this.playStartSlot = this.options.startSlot ?? 0;
    this.playEndSlot = Math.min(this.options.endSlot ?? this.block.slots.length, this.block.slots.length);
    this.playSlots = this.block.slots.slice(this.playStartSlot, this.playEndSlot);
    this.secondsPerSlot = getSecondsPerSlot(this.block);
    this.passDurationSeconds = this.playSlots.length * this.secondsPerSlot;
    this.playbackStartTime = this.synth.currentTime + 0.08;

    if (this.playSlots.length === 0) {
      this.stop();
      this.onEnded();
      return;
    }

    this.schedulePass(0);
  }

  private schedulePass(passIndex: number): void {
    if (!this.synth || this.stopped) {
      return;
    }

    const repeatCount = this.options.loop ? Number.POSITIVE_INFINITY : this.options.repeatCount ?? DEFAULT_REPEAT_COUNT;
    const passStartTime = this.playbackStartTime + passIndex * this.passDurationSeconds;

    this.playSlots.forEach((slot) => {
      const slotTime = passStartTime + (slot.index - this.playStartSlot) * this.secondsPerSlot;
      if (slot.hits.length > 0) {
        this.timers.push(
          window.setTimeout(() => {
            if (!this.stopped) {
              this.onSlotChange(slot.index);
            }
          }, Math.max(0, (slotTime - this.synth!.currentTime) * 1000))
        );
      }
      this.synth?.scheduleHits(slot.hits, slotTime, this.secondsPerSlot, getSlotVisualDurationSeconds(this.block, slot));
    });

    this.timers.push(
      window.setTimeout(() => {
        if (this.stopped) {
          return;
        }

        if (this.options.loop || passIndex + 1 < repeatCount) {
          this.schedulePass(passIndex + 1);
        } else {
          this.stop();
          this.onEnded();
        }
      }, Math.max(0, (passStartTime + this.passDurationSeconds - this.synth.currentTime) * 1000))
    );
  }

  stop(): void {
    this.stopped = true;
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers = [];

    this.synth?.stop();
    this.synth = null;
  }
}
