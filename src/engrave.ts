import { Beam, Dot, Element as VexFlowElement, Formatter, GraceNote, GraceNoteGroup, Modifier, Parenthesis, Renderer, RepeatNote, Stave, StaveNote, Stem, Tickable, TimeSignature, Tuplet, Voice } from "vexflow/bravura";
import { DRUM_KIT } from "./kit";
import {
  compareVexKeys,
  durationForGridSpan,
  getBeatValue,
  getGridSpanToNextHit,
  getSlotVisualDurationSeconds,
  getSlotsPerBeat,
  largestPowerOfTwoAtMost
} from "./music";
import { MeasureRepeatProgress } from "./repeat-progress";
import { allocateBarWidths } from "./spacing";
import { CursorPosition, DrumBar, DrumBlock, DrumHit, DrumInstrument, DrumSlot, GridResolution, MeasureRepeat, ScoreRenderResult, StickingHand } from "./types";

export type LegendHighlightSource = "playback" | "preview";

const LEGEND_HIGHLIGHT_MIN_MS = 90;
const LEGEND_HIGHLIGHT_MAX_MS = 320;

interface NotationLayout {
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
  chokeGap: number;
  chokePlusSize: number;
  chokeStrokeWidth: number;
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
  halfOpenHatLineExtension: number;
  footSplashCirclePadding: number;
  footSplashStrokeWidth: number;
  noteHitTargetPadding: number;
  graceSlurGap: number;
  graceSlurCp1: number;
  graceSlurCp2: number;
  tupletFontSize: number;
  tupletFontWeight: string;
  measureRepeatCountGap: number;
  measureRepeatCountFontSize: number;
  measureRepeatCountFontWeight: string;
  stickingLaneGap: number;
  stickingFontSize: number;
  stickingFontWeight: string;
}

interface VisualBarNotes {
  notes: Tickable[];
  hitNotes: StaveNote[];
  noteSlots: DrumSlot[];
  cursorNotes: Tickable[];
  cursorSlots: DrumSlot[];
  beams: Beam[];
  tuplets: Tuplet[];
}

interface VisualBarEntry {
  bar: DrumBar;
  repeatedBars: DrumBar[];
  repeatCount: number;
}

interface PendingHitTarget {
  note: StaveNote | undefined;
  slot: DrumSlot;
}

interface GraceSlurAnchor {
  graceNotes: GraceNote[];
  mainNoteheadIndex: number;
  color?: string;
}

const graceSlurAnchors = new WeakMap<StaveNote, GraceSlurAnchor[]>();

function normalizeResponsiveScoreSvg(surface: HTMLElement, width: number, height: number): void {
  const svg = surface.querySelector<SVGSVGElement>("svg");

  surface.style.removeProperty("width");
  surface.style.removeProperty("height");
  surface.setCssProps({
    "--drum-system-w": String(width),
    "--drum-system-h": String(height)
  });

  if (!svg) {
    return;
  }

  if (!svg.hasAttribute("viewBox")) {
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.removeAttribute("style");
}

export function renderVexflowScore(block: DrumBlock, container: HTMLElement): ScoreRenderResult {
  container.empty();

  const cssWidth = getScoreWidth(container);
  const layout = getNotationLayout();
  const width = cssWidth / layout.renderScale;
  const height = layout.systemHeight;
  const cursorPositions: Array<ScoreRenderResult["cursorPositions"][number]> = [];
  const barRegions: ScoreRenderResult["barRegions"] = [];

  container.setCssProps({ "--drum-score-min-height": `${Math.max(height, block.systems.length * height)}px` });

  let previousBarAnchors: Array<{ note: Tickable; cursorPosition: CursorPosition } | undefined> = [];

  block.systems.forEach((scoreSystem, systemIndex) => {
    const system = container.createEl("div", { cls: "drum-notation__system" });

    if (scoreSystem.subtitle) {
      system.createEl("div", {
        cls: "drum-notation__system-subtitle",
        text: scoreSystem.subtitle,
        attr: { "aria-label": `Notation section: ${scoreSystem.subtitle}` }
      });
    }

    const scoreSurface = system.createEl("div", { cls: "drum-notation__system-score" });

    const renderer = new Renderer(scoreSurface, Renderer.Backends.SVG);

    renderer.resize(cssWidth, height);

    const context = renderer.getContext();
    context.scale(layout.renderScale, layout.renderScale);

    normalizeResponsiveScoreSvg(scoreSurface, cssWidth, height);

    context.setFillStyle("currentColor");
    context.setStrokeStyle("currentColor");
    context.setLineWidth(layout.strokeWidth);

    const visualBars = getVisualBarEntries(scoreSystem.bars);
    const staveX = layout.staveX;
    const staveWidth = width - layout.staveX - layout.staveRightPadding;
    const headerProbe = createScoreStave(0, staveWidth, true, block, systemIndex, layout);
    const firstBarHeaderWidth = headerProbe.getModifierXShift();
    const barWidths = allocateBarWidths(
      visualBars.map((entry) => entry.bar.slots.length),
      staveWidth,
      firstBarHeaderWidth,
      layout.barMinWidth
    );
    const systemTop = system.offsetTop + scoreSurface.offsetTop;

    let currentX = staveX;
    const pendingHitTargets: PendingHitTarget[] = [];

    visualBars.forEach((entry, barIndex) => {
      const bar = entry.bar;
      const isFirstBarInSystem = barIndex === 0;
      const barWidth = barWidths[barIndex] ?? 0;
      const stave = createScoreStave(currentX, barWidth, isFirstBarInSystem, block, systemIndex, layout);

      stave.setContext(context).draw();
      stave.setNoteStartX(stave.getNoteStartX() + layout.noteStartPadding);

      const barIndexes = entry.repeatedBars.map((repeatedBar) => block.bars.indexOf(repeatedBar)).filter((index) => index >= 0);
      const firstBarIndex = barIndexes[0] ?? block.bars.indexOf(bar);
      const staveTop = stave.getYForLine(0);
      const staveBottom = stave.getYForLine(stave.getNumLines() - 1);
      const hitPadding = 8;

      if (firstBarIndex >= 0) {
        barRegions.push({
          barIndex: firstBarIndex,
          barIndexes: barIndexes.length > 0 ? barIndexes : [firstBarIndex],
          startSlot: bar.startSlot,
          endSlot: bar.startSlot + bar.slots.length,
          x: currentX * layout.renderScale,
          y: systemTop + (staveTop - hitPadding) * layout.renderScale,
          width: barWidth * layout.renderScale,
          height: (staveBottom - staveTop + hitPadding * 2) * layout.renderScale
        });
      }

      const visualBar = buildVisualBarNotes(bar.slots, bar.measureRepeat, block.timeSignature, block.gridResolution, block.legendMode !== "off");
      const notes = visualBar.notes;
      notes.forEach((note) => {
        if (layout.noteFontSize !== undefined) {
          note.setFontSize(layout.noteFontSize);

          if (note instanceof StaveNote) {
            note.noteHeads.forEach((noteHead) => {
              noteHead.setFontSize(layout.noteFontSize);
            });
          }
        }

        note.setStyle({ fillStyle: "currentColor", strokeStyle: "currentColor", lineWidth: layout.strokeWidth });

        if (note instanceof StaveNote) {
          note.setLedgerLineStyle({ fillStyle: "currentColor", strokeStyle: "currentColor", lineWidth: layout.ledgerLineWidth });
        }
      });
      const voice = new Voice({
        numBeats: Math.max(1, Math.ceil(bar.slots.length / getSlotsPerBeat(block.timeSignature, block.gridResolution))),
        beatValue: getBeatValue(block.timeSignature)
      }).setStrict(false);

      voice.addTickables(notes);
      const barHeaderWidth = isFirstBarInSystem ? firstBarHeaderWidth : 0;
      const availableFormatWidth = Math.max(24, barWidth - barHeaderWidth - layout.formatPadding - layout.noteStartPadding - layout.noteEndPadding);
      const slotScaledFormatWidth = Math.max(24, bar.slots.length * layout.maxSlotFormatWidth);
      const formatWidth = Math.min(availableFormatWidth, slotScaledFormatWidth);
      new Formatter().joinVoices([voice]).format([voice], formatWidth);
      voice.draw(context, stave);
      markDragGraceBeams(system);
      if (bar.measureRepeat && entry.repeatCount > 1) {
        drawMeasureRepeatCount(
          system,
          stave,
          visualBar.notes[0],
          entry.repeatCount,
          barIndexes,
          layout
        );
      }
      visualBar.beams.forEach((beam) => {
        beam.renderOptions.beamWidth = layout.beamWidth;
        beam.renderOptions.maxSlope = layout.beamMaxSlope;
        beam.renderOptions.minSlope = -layout.beamMaxSlope;
        beam.renderOptions.slopeIterations = 12;
        beam.setStyle({ fillStyle: "currentColor", strokeStyle: "currentColor", lineWidth: layout.strokeWidth });
        beam.setContext(context).draw();
      });
      visualBar.tuplets.forEach((tuplet) => {
        slimTupletText(tuplet, layout);
        tuplet.setStyle({ fillStyle: "currentColor", strokeStyle: "currentColor", lineWidth: layout.strokeWidth });
        tuplet.setContext(context).draw();
      });
      drawGraceNoteSlurs(system, visualBar.hitNotes, layout, block.legendMode !== "off");
      drawHatOpennessMarks(system, visualBar.hitNotes, visualBar.noteSlots, layout);
      drawFootSplashMarks(system, visualBar.hitNotes, visualBar.noteSlots, layout);
      drawAccentMarks(system, visualBar.hitNotes, visualBar.noteSlots, layout);
      drawChokeMarks(system, visualBar.hitNotes, visualBar.noteSlots, layout);
      drawDiddleMarks(system, visualBar.hitNotes, visualBar.noteSlots, layout);
      drawBuzzRollMarks(system, visualBar.hitNotes, visualBar.noteSlots, layout);
      drawStickingMarks(system, stave, visualBar.cursorNotes, visualBar.cursorSlots, layout, !!bar.measureRepeat);
      visualBar.noteSlots.forEach((slot, noteIndex) => {
        const note = visualBar.hitNotes[noteIndex];

        tagRenderedNoteSlot(system, note, slot);
        pendingHitTargets.push({ note, slot });
      });
      visualBar.cursorSlots.forEach((slot, noteIndex) => {
        const note = visualBar.cursorNotes[noteIndex];

        tagRenderedNoteSlot(system, note, slot);
      });

      const cursorHeight = (stave.getYForLine(stave.getNumLines() - 1) - stave.getYForLine(0)) * layout.renderScale;
      const cursorY = systemTop + stave.getYForLine(0) * layout.renderScale;
      const currentBarAnchors: Array<{ note: Tickable; cursorPosition: CursorPosition } | undefined> = [];

      visualBar.cursorSlots.forEach((slot, noteIndex) => {
        const note = visualBar.cursorNotes[noteIndex];
        const x = note instanceof StaveNote ? note.getNoteHeadBeginX() : note.getAbsoluteX();
        const cursorPosition = {
          x: x * layout.renderScale,
          y: cursorY,
          height: cursorHeight
        };

        cursorPositions[slot.index] = cursorPosition;
        currentBarAnchors[slot.index - bar.startSlot] = { note, cursorPosition };
      });

      if (bar.measureRepeat) {
        entry.repeatedBars.forEach((repeatedBar) => {
          repeatedBar.slots.forEach((slot, localIndex) => {
            const anchor = previousBarAnchors[localIndex];

            if (!anchor) {
              return;
            }

            cursorPositions[slot.index] = anchor.cursorPosition;
            tagRenderedNoteSlot(system, anchor.note, slot);
          });
        });
      } else {
        previousBarAnchors = currentBarAnchors;
      }

      currentX += barWidth;
    });

    pendingHitTargets.forEach(({ note, slot }) => {
      drawNoteHitTargets(system, note, slot, layout);
    });
    normalizeResponsiveScoreSvg(scoreSurface, cssWidth, height);
  });

  return { cursorPositions, barRegions };
}

function createScoreStave(
  x: number,
  width: number,
  includeSystemHeader: boolean,
  block: DrumBlock,
  systemIndex: number,
  layout: NotationLayout
): Stave {
  const stave = new Stave(x, layout.staveY, width, {
    leftBar: includeSystemHeader,
    rightBar: true,
    ...(layout.staveLineSpacing !== undefined ? { spacingBetweenLinesPx: layout.staveLineSpacing } : {}),
    ...(layout.verticalBarWidth !== undefined ? { verticalBarWidth: layout.verticalBarWidth } : {})
  });
  stave.setStyle({ fillStyle: "currentColor", strokeStyle: "currentColor", lineWidth: layout.strokeWidth });
  stave.setDefaultLedgerLineStyle({ fillStyle: "currentColor", strokeStyle: "currentColor", lineWidth: layout.ledgerLineWidth });

  if (!includeSystemHeader) {
    return stave;
  }

  stave.addClef("percussion", "small");

  if (systemIndex === 0) {
    const timeSignature = new TimeSignature(block.timeSignature, 6);

    if (layout.signatureFontSize !== undefined) {
      slimTimeSignature(timeSignature, block.timeSignature, layout.signatureFontSize);
    }

    stave.addModifier(timeSignature);
  }

  return stave;
}

function getVisualBarEntries(bars: DrumBar[]): VisualBarEntry[] {
  const entries: VisualBarEntry[] = [];

  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index];

    if (!bar.measureRepeat) {
      entries.push({ bar, repeatedBars: [bar], repeatCount: 1 });
      continue;
    }

    const repeatCount = Math.max(1, Math.min(bar.measureRepeatCount ?? 1, countMeasureRepeatRun(bars, index)));

    entries.push({
      bar,
      repeatedBars: bars.slice(index, index + repeatCount),
      repeatCount
    });
    index += repeatCount - 1;
  }

  return entries;
}

function countMeasureRepeatRun(bars: DrumBar[], startIndex: number): number {
  let count = 0;

  for (let index = startIndex; index < bars.length; index++) {
    if (!bars[index].measureRepeat) {
      break;
    }

    count++;
  }

  return count;
}

export function renderInstrumentLegend(block: DrumBlock, root: HTMLElement): void {
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

    item.dataset.instrumentId = instrument.id;
    swatch.setCssProps({ "--drum-legend-color": instrument.color });
    item.createEl("span", {
      cls: "drum-notation__legend-label",
      text: instrument.label
    });
    code.setAttr("aria-label", `Notation row label ${code.textContent ?? ""}`);
  });
}

export function setLegendInstrumentHighlight(
  container: HTMLElement,
  source: LegendHighlightSource,
  instrumentIds: Iterable<string>
): void {
  const className = getLegendHighlightClass(source);
  const activeIds = new Set(instrumentIds);

  container
    .querySelectorAll<HTMLElement>(".drum-notation__legend-item")
    .forEach((item) => {
      const instrumentId = item.dataset.instrumentId;
      item.classList.toggle(className, Boolean(instrumentId && activeIds.has(instrumentId)));
    });
}

export function clearLegendInstrumentHighlight(container: HTMLElement, source: LegendHighlightSource): void {
  const className = getLegendHighlightClass(source);

  container
    .querySelectorAll<HTMLElement>(`.drum-notation__legend-item.${className}`)
    .forEach((item) => item.classList.remove(className));
}

export function getLegendHighlightDurationMs(block: DrumBlock, slot: DrumSlot, speedPercent = 100): number {
  const durationMs = getSlotVisualDurationSeconds(block, slot, speedPercent) * 1000;

  return Math.round(
    Math.min(LEGEND_HIGHLIGHT_MAX_MS, Math.max(LEGEND_HIGHLIGHT_MIN_MS, durationMs))
  );
}

function getLegendHighlightClass(source: LegendHighlightSource): string {
  return source === "playback" ? "is-playing" : "is-previewing";
}

export function updateMeasureRepeatProgress(
  container: HTMLElement,
  progress: MeasureRepeatProgress | null
): void {
  container
    .querySelectorAll<SVGTextElement>(".drum-notation__measure-repeat-count")
    .forEach((label) => {
      const groupStartBarIndex = Number.parseInt(label.dataset.repeatStartBarIndex ?? "", 10);
      const totalRepeats = Number.parseInt(label.dataset.repeatTotal ?? "", 10);

      if (!Number.isFinite(groupStartBarIndex) || !Number.isFinite(totalRepeats)) {
        return;
      }

      const isActive = progress?.groupStartBarIndex === groupStartBarIndex;

      label.textContent = isActive
        ? `${progress.currentRepeat}/${progress.totalRepeats}`
        : `x${totalRepeats}`;
      label.classList.toggle("is-active", isActive);
      label.setAttribute(
        "aria-label",
        isActive
          ? `Repeat ${progress.currentRepeat} of ${progress.totalRepeats}`
          : `Repeat previous bar ${totalRepeats} times`
      );
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

export function colorRenderedNoteheads(block: DrumBlock, container: HTMLElement): void {
  const slotByIndex = new Map(block.slots.map((slot) => [slot.index, slot] as const));

  container.querySelectorAll<SVGGElement>("svg [data-slot-index]").forEach((group) => {
    const slot = slotByIndex.get(Number(group.dataset.slotIndex));

    if (!slot || slot.hits.length === 0) {
      return;
    }

    group.classList.add("drum-notation__colored-note");
    const noteheadGroups = getMainRenderedNoteheadGroups(group);
    const coloredHits = getUniqueHitsForRenderedNoteheads(slot.hits);
    const fallbackColor = coloredHits[0]?.instrument.color;

    if (fallbackColor) {
      group.style.setProperty("--drum-notehead-color", fallbackColor);
      colorSvgShape(group, fallbackColor);
      restoreNonNoteheadInk(group);
    }

    const hasTaggedColors = restoreTaggedInstrumentColors(group);

    if (hasTaggedColors) {
      return;
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

// VexFlow's Element.getSVGElement() resolves ids through the global document,
// which fails when the score renders in another window (Obsidian PDF export,
// pop-out windows) and silently disables note tagging and legend coloring
// there. Resolve ids through the document that owns the rendered score.
function getRenderedSvgElement(scope: HTMLElement | SVGElement, element: VexFlowElement | undefined): SVGElement | null {
  if (!element) {
    return null;
  }

  const rendered = scope.ownerDocument.getElementById(`vf-${String(element.getAttribute("id"))}`);

  return (rendered as SVGElement | null) ?? element.getSVGElement() ?? null;
}

function tagRenderedNoteSlot(scope: HTMLElement, note: Tickable | undefined, slot: DrumSlot): void {
  const noteElement = getRenderedSvgElement(scope, note);

  if (!noteElement) {
    return;
  }

  const existing = (noteElement.getAttribute("data-slot-indices") ?? "")
    .split(/\s+/)
    .filter((value) => value.length > 0);
  const slotIndex = String(slot.index);

  if (!existing.includes(slotIndex)) {
    existing.push(slotIndex);
  }

  noteElement.setAttribute("data-slot-indices", existing.join(" "));

  if (!noteElement.hasAttribute("data-slot-index")) {
    noteElement.setAttribute("data-slot-index", slotIndex);
  }

  if (note instanceof StaveNote) {
    tagRenderedNoteheadColors(scope, note, slot);
  }
}

function tagRenderedNoteheadColors(scope: HTMLElement, note: StaveNote, slot: DrumSlot): void {
  const keys = note.getKeys();

  keys.forEach((key, keyIndex) => {
    const hit = slot.hits.find((candidate) => candidate.instrument.vexKey === key);
    const noteheadElement = getRenderedSvgElement(scope, note.noteHeads[keyIndex]);

    if (!hit || !noteheadElement) {
      return;
    }

    noteheadElement.setAttribute("data-drum-color", hit.instrument.color);
  });
}

function drawNoteHitTargets(system: HTMLElement, note: StaveNote | undefined, slot: DrumSlot, layout: NotationLayout): void {
  const svg = system.querySelector<SVGSVGElement>("svg");

  if (!svg || !note) {
    return;
  }

  note.noteHeads.forEach((noteHead) => {
    const box = noteHead.getBoundingBox();
    const target = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "rect");
    const padding = layout.noteHitTargetPadding;

    target.classList.add("drum-notation__hit-target");
    target.setAttribute("data-preview-slot-index", String(slot.index));
    target.setAttribute("x", String(box.getX() - padding));
    target.setAttribute("y", String(box.getY() - padding));
    target.setAttribute("width", String(box.getW() + padding * 2));
    target.setAttribute("height", String(box.getH() + padding * 2));
    target.setAttribute("fill", "transparent");
    target.setAttribute("stroke", "none");
    svg.appendChild(target);
  });
}

function getMainRenderedNoteheadGroups(group: SVGGElement): SVGGElement[] {
  return Array.from(group.querySelectorAll<SVGGElement>(".vf-notehead")).filter((notehead) => !isInGraceNoteGroup(notehead));
}

function isInGraceNoteGroup(element: Element): boolean {
  return element.closest(".vf-gracenote") !== null;
}

function colorSvgShape(element: SVGElement, color: string): void {
  const shapes = [element, ...Array.from(element.querySelectorAll<SVGElement>("path, text, line, polygon, polyline, ellipse, circle"))];

  shapes.forEach((shape) => {
    shape.setAttribute("fill", color);
    shape.setAttribute("stroke", color);
  });
}

function restoreNonNoteheadInk(group: SVGGElement): void {
  group
    .querySelectorAll<SVGElement>(
      ".vf-stem, .vf-stem *, .vf-flag, .vf-flag *, .vf-modifiers, .vf-modifiers *, .vf-gracenote, .vf-gracenote *, .vf-parenthesis, .vf-parenthesis *"
    )
    .forEach((shape) => {
      shape.style.removeProperty("fill");
      shape.style.removeProperty("stroke");
      shape.setAttribute("fill", "currentColor");
      shape.setAttribute("stroke", "currentColor");
    });
}

function restoreTaggedInstrumentColors(group: SVGGElement): boolean {
  let restored = false;

  group.querySelectorAll<SVGElement>("[data-drum-color]").forEach((element) => {
    const color = element.getAttribute("data-drum-color");

    if (!color) {
      return;
    }

    colorSvgShape(element, color);
    restored = true;
  });

  return restored;
}

function getScoreWidth(container: HTMLElement): number {
  const parentWidth = container.parentElement?.clientWidth ?? container.clientWidth;

  return Math.max(320, Math.floor((parentWidth || 720) - 16));
}

function drawHatOpennessMarks(system: HTMLElement, notes: StaveNote[], noteSlots: DrumSlot[], layout: NotationLayout): void {
  const svg = system.querySelector<SVGSVGElement>("svg");

  if (!svg) {
    return;
  }

  noteSlots.forEach((slot, noteIndex) => {
    const hasOpenHat = slot.hits.some((hit) => hit.instrument.id === "open-hat");
    const hasHalfOpenHat = slot.hits.some((hit) => hit.instrument.id === "half-open-hat");

    if (!hasOpenHat && !hasHalfOpenHat) {
      return;
    }

    const note = notes[noteIndex];

    if (!note) {
      return;
    }

    const stemTopY = note.getStemExtents().topY;
    const circle = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "circle");
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

    if (hasHalfOpenHat) {
      const line = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "line");

      line.classList.add("drum-notation__half-open-hat-line");
      line.setAttribute("x1", String(x));
      line.setAttribute("y1", String(y - layout.openHatRadius - layout.halfOpenHatLineExtension));
      line.setAttribute("x2", String(x));
      line.setAttribute("y2", String(y + layout.openHatRadius + layout.halfOpenHatLineExtension));
      line.setAttribute("stroke", "currentColor");
      line.setAttribute("stroke-width", String(layout.openHatStrokeWidth));
      line.setAttribute("stroke-linecap", "round");
      svg.appendChild(line);
    }
  });
}

function drawFootSplashMarks(system: HTMLElement, notes: StaveNote[], noteSlots: DrumSlot[], layout: NotationLayout): void {
  const svg = system.querySelector<SVGSVGElement>("svg");

  if (!svg) {
    return;
  }

  noteSlots.forEach((slot, noteIndex) => {
    const splashHit = slot.hits.find((hit) => hit.instrument.id === "hi-hat-foot-splash");

    if (!splashHit) {
      return;
    }

    const note = notes[noteIndex];
    const noteheadIndex = note?.getKeys().findIndex((key) => key === splashHit.instrument.vexKey) ?? -1;
    const notehead = noteheadIndex >= 0 ? note?.noteHeads[noteheadIndex] : undefined;

    if (!notehead) {
      return;
    }

    const box = notehead.getBoundingBox();
    const radius = Math.max(box.getW(), box.getH()) / 2 + layout.footSplashCirclePadding;
    const circle = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "circle");

    circle.classList.add("drum-notation__foot-splash");
    circle.setAttribute("cx", String(box.getX() + box.getW() / 2));
    circle.setAttribute("cy", String(box.getY() + box.getH() / 2));
    circle.setAttribute("r", String(radius));
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", "currentColor");
    circle.setAttribute("stroke-width", String(layout.footSplashStrokeWidth));
    circle.setAttribute("pointer-events", "none");
    svg.appendChild(circle);
  });
}

function drawAccentMarks(system: HTMLElement, notes: StaveNote[], noteSlots: DrumSlot[], layout: NotationLayout): void {
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
    const accent = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "polyline");

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

function drawChokeMarks(system: HTMLElement, notes: StaveNote[], noteSlots: DrumSlot[], layout: NotationLayout): void {
  const svg = system.querySelector<SVGSVGElement>("svg");

  if (!svg) {
    return;
  }

  noteSlots.forEach((slot, noteIndex) => {
    const chokeHits = slot.hits.filter((hit) => hit.articulation === "choke");

    if (chokeHits.length === 0) {
      return;
    }

    const note = notes[noteIndex];

    chokeHits.forEach((hit) => {
      const noteheadIndex = note?.getKeys().findIndex((key) => key === hit.instrument.vexKey) ?? -1;
      const notehead = noteheadIndex >= 0 ? note?.noteHeads[noteheadIndex] : undefined;

      if (!notehead) {
        return;
      }

      const box = notehead.getBoundingBox();
      const centerX = box.getX() + box.getW() / 2;
      const centerY = box.getY() - layout.chokeGap;
      const halfSize = layout.chokePlusSize / 2;
      const plus = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "g");
      const segments: Array<[number, number, number, number]> = [
        [centerX - halfSize, centerY, centerX + halfSize, centerY],
        [centerX, centerY - halfSize, centerX, centerY + halfSize]
      ];

      plus.classList.add("drum-notation__choke");
      plus.setAttribute("pointer-events", "none");
      segments.forEach(([x1, y1, x2, y2]) => {
        const segment = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "line");

        segment.setAttribute("x1", String(x1));
        segment.setAttribute("y1", String(y1));
        segment.setAttribute("x2", String(x2));
        segment.setAttribute("y2", String(y2));
        segment.setAttribute("stroke", "currentColor");
        segment.setAttribute("stroke-width", String(layout.chokeStrokeWidth));
        segment.setAttribute("stroke-linecap", "round");
        plus.appendChild(segment);
      });
      svg.appendChild(plus);
    });
  });
}

function drawDiddleMarks(system: HTMLElement, notes: StaveNote[], noteSlots: DrumSlot[], layout: NotationLayout): void {
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
    const diddle = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "polygon");
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
  layout: NotationLayout
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
    const buzz = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "g");
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
      const segment = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "line");

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

function drawGraceNoteSlurs(system: HTMLElement, notes: StaveNote[], layout: NotationLayout, colorNoteheads: boolean): void {
  const svg = system.querySelector<SVGSVGElement>("svg");

  if (!svg) {
    return;
  }

  notes.forEach((note) => {
    const anchors = graceSlurAnchors.get(note);

    if (!anchors) {
      return;
    }

    anchors.forEach((anchor) => {
      const graceNotehead = anchor.graceNotes[0]?.noteHeads[0];
      const mainNotehead = note.noteHeads[anchor.mainNoteheadIndex];
      const color = colorNoteheads ? anchor.color : undefined;

      if (!graceNotehead || !mainNotehead) {
        return;
      }

      if (color) {
        colorGraceNoteElements(svg, anchor.graceNotes, color);
      }

      const graceBox = graceNotehead.getBoundingBox();
      const mainBox = mainNotehead.getBoundingBox();
      const startX = graceBox.getX() + graceBox.getW() * 0.35;
      const endX = mainBox.getX() + mainBox.getW() * 0.45;
      const baseY = Math.max(graceBox.getY() + graceBox.getH(), mainBox.getY() + mainBox.getH()) + layout.graceSlurGap;
      const cpX = (startX + endX) / 2;
      const topY = baseY + layout.graceSlurCp1;
      const bottomY = baseY + layout.graceSlurCp2;
      const slur = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");

      slur.classList.add("drum-notation__grace-slur");
      slur.setAttribute("d", `M ${startX} ${baseY} Q ${cpX} ${topY} ${endX} ${baseY} Q ${cpX} ${bottomY} ${startX} ${baseY} Z`);
      slur.setAttribute("fill", color ?? "currentColor");
      slur.setAttribute("stroke", "none");
      slur.setAttribute("pointer-events", "none");

      if (color) {
        slur.setAttribute("data-drum-color", color);
        slur.setAttribute("fill", color);
      }

      svg.appendChild(slur);
    });
  });
}

function colorGraceNoteElements(scope: HTMLElement | SVGElement, graceNotes: GraceNote[], color: string): void {
  graceNotes.forEach((graceNote) => {
    const graceElement = getRenderedSvgElement(scope, graceNote);

    if (!graceElement) {
      return;
    }

    graceElement.setAttribute("data-drum-color", color);
    colorSvgShape(graceElement, color);
  });
}

function markDragGraceBeams(system: HTMLElement): void {
  system.querySelectorAll<SVGGElement>(".vf-stavenote > .vf-notehead > .vf-beam").forEach((beam) => {
    beam.classList.add("drum-notation__drag-grace-beam");
  });
}

function drawStickingMarks(
  system: HTMLElement,
  stave: Stave,
  notes: Tickable[],
  slots: DrumSlot[],
  layout: NotationLayout,
  isMeasureRepeat: boolean
): void {
  if (isMeasureRepeat) {
    return;
  }

  const svg = system.querySelector<SVGSVGElement>("svg");

  if (!svg) {
    return;
  }

  const y = stave.getYForLine(stave.getNumLines() - 1) + layout.stickingLaneGap;

  slots.forEach((slot, index) => {
    if (!slot.sticking) {
      return;
    }

    const note = notes[index];

    if (!note) {
      return;
    }

    const x = getStickingAnchorX(note);
    const label = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "text");

    label.classList.add("drum-notation__sticking");
    label.setAttribute("x", String(x));
    label.setAttribute("y", String(y));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", String(layout.stickingFontSize));
    label.setAttribute("font-weight", layout.stickingFontWeight);
    label.setAttribute("pointer-events", "none");
    label.textContent = getStickingLabel(slot.sticking);
    svg.appendChild(label);
  });
}

function getStickingAnchorX(note: Tickable): number {
  if (note instanceof StaveNote && note.noteHeads.length > 0) {
    const boxes = note.noteHeads.map((noteHead) => noteHead.getBoundingBox());
    const left = Math.min(...boxes.map((box) => box.getX()));
    const right = Math.max(...boxes.map((box) => box.getX() + box.getW()));

    return (left + right) / 2;
  }

  return note.getAbsoluteX();
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

function getStemMarkMiddleY(note: StaveNote, markHeight: number, markThickness: number, noteheadClearance: number): number {
  const { topY, baseY } = note.getStemExtents();
  const noteheadTopY = Math.min(...note.getYs());
  const defaultMiddleY = topY + (baseY - topY) * 0.56;
  const lowerEdgeOffset = markHeight / 2 + markThickness / 2;
  const lowestAllowedMiddleY = noteheadTopY - noteheadClearance - lowerEdgeOffset;

  return Math.min(defaultMiddleY, lowestAllowedMiddleY);
}

function getNotationLayout(): NotationLayout {
  return {
    systemHeight: 122,
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
    chokeGap: 9,
    chokePlusSize: 7,
    chokeStrokeWidth: 0.95,
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
    openHatStrokeWidth: 0.85,
    halfOpenHatLineExtension: 2.4,
    footSplashCirclePadding: 2.1,
    footSplashStrokeWidth: 0.85,
    noteHitTargetPadding: 3,
    graceSlurGap: 3.2,
    graceSlurCp1: 5.6,
    graceSlurCp2: 8.3,
    tupletFontSize: 12,
    tupletFontWeight: "400",
    measureRepeatCountGap: 8,
    measureRepeatCountFontSize: 11,
    measureRepeatCountFontWeight: "700",
    stickingLaneGap: 34,
    stickingFontSize: 10,
    stickingFontWeight: "600"
  };
}

function slimTupletText(tuplet: Tuplet, layout: NotationLayout): void {
  const tupletParts = tuplet as Tuplet & {
    textElement?: {
      setFontSize: (size: number) => unknown;
      fontWeight?: string;
    };
  };

  tupletParts.textElement?.setFontSize(layout.tupletFontSize);

  if (tupletParts.textElement) {
    tupletParts.textElement.fontWeight = layout.tupletFontWeight;
  }
}

function slimTimeSignature(timeSignature: TimeSignature, timeSpec: string, fontSize: number): void {
  // NOTE: VexFlow does not expose the time-signature glyph text objects publicly,
  // so we reach into topText/botText to shrink the font. The optional chaining
  // means a future VexFlow that renames these will silently skip the slimming
  // rather than throw; revisit this if the time signature stops shrinking.
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
  measureRepeat: MeasureRepeat | undefined,
  timeSignature: string,
  gridResolution: GridResolution,
  colorNoteheads: boolean
): VisualBarNotes {
  if (measureRepeat) {
    return buildMeasureRepeatVisualBarNotes(measureRepeat);
  }

  return buildGridVisualBarNotes(slots, timeSignature, gridResolution, colorNoteheads);
}

function buildMeasureRepeatVisualBarNotes(measureRepeat: MeasureRepeat): VisualBarNotes {
  const note = new RepeatNote(String(measureRepeat), { duration: "1" }, { line: 2 });

  note.setCenterAlignment(true);

  return {
    notes: [note],
    hitNotes: [],
    noteSlots: [],
    cursorNotes: [],
    cursorSlots: [],
    beams: [],
    tuplets: []
  };
}

function drawMeasureRepeatCount(
  system: HTMLElement,
  stave: Stave,
  note: Tickable | undefined,
  count: number,
  barIndexes: number[],
  layout: NotationLayout
): void {
  const svg = system.querySelector<SVGSVGElement>("svg");

  if (!svg || !note) {
    return;
  }

  const label = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "text");

  label.classList.add("drum-notation__measure-repeat-count");
  label.textContent = `x${count}`;
  label.setAttribute("x", String(note.getAbsoluteX()));
  label.setAttribute("y", String(stave.getYForLine(0) - layout.measureRepeatCountGap));
  label.setAttribute("fill", "currentColor");
  label.setAttribute("stroke", "none");
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("font-size", String(layout.measureRepeatCountFontSize));
  label.setAttribute("font-weight", layout.measureRepeatCountFontWeight);
  label.dataset.repeatStartBarIndex = String(barIndexes[0]);
  label.dataset.repeatBarIndexes = barIndexes.join(" ");
  label.dataset.repeatTotal = String(count);
  label.setAttribute("aria-label", `Repeat previous bar ${count} times`);
  svg.appendChild(label);
}

function buildGridVisualBarNotes(
  slots: DrumSlot[],
  timeSignature: string,
  gridResolution: GridResolution,
  colorNoteheads: boolean
): VisualBarNotes {
  const notes: Tickable[] = [];
  const hitNotes: StaveNote[] = [];
  const noteSlots: DrumSlot[] = [];
  const beams: Beam[] = [];
  const tuplets: Tuplet[] = [];
  const slotsPerBeat = getSlotsPerBeat(timeSignature, gridResolution);

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
      appendHiddenGridRests(notes, beatSlots.length, gridResolution);
      continue;
    }

    hitIndexes.forEach((hitIndex, indexInBeat) => {
      if (hitIndex > cursor) {
        finishBeamGroup();
        appendHiddenGridRests(notes, hitIndex - cursor, gridResolution);
      }

      const slot = beatSlots[hitIndex];
      const nextHitIndex = hitIndexes[indexInBeat + 1] ?? beatSlots.length;
      const span = getGridSpanToNextHit(hitIndex, nextHitIndex, beatSlots.length, gridResolution);
      const note = makeStaveNote(slot, span.duration, colorNoteheads, span.dots);

      notes.push(note);
      hitNotes.push(note);
      noteSlots.push(slot);
      beamGroup.push(note);
      cursor = hitIndex + span.supportedSpan;

      if (span.supportedSpan !== nextHitIndex - hitIndex) {
        finishBeamGroup();
        appendHiddenGridRests(notes, nextHitIndex - hitIndex - span.supportedSpan, gridResolution);
        cursor = nextHitIndex;
      }
    });

    finishBeamGroup();

    if (cursor < beatSlots.length) {
      appendHiddenGridRests(notes, beatSlots.length - cursor, gridResolution);
    }
  }

  return { notes, hitNotes, noteSlots, cursorNotes: hitNotes, cursorSlots: noteSlots, beams, tuplets };
}

function appendHiddenGridRests(notes: Tickable[], span: number, gridResolution: GridResolution): void {
  let remaining = span;

  while (remaining > 0) {
    const restSpan = largestPowerOfTwoAtMost(remaining);

    notes.push(makeStaveNote({ index: -1, hits: [] }, durationForGridSpan(gridResolution, restSpan)));
    remaining -= restSpan;
  }
}

function makeRenderedNotesInteractive(
  block: DrumBlock,
  container: HTMLElement,
  onPreview: (slot: DrumSlot) => void
): Array<SVGGElement | undefined> {
  const slotByIndex = new Map(block.slots.map((slot) => [slot.index, slot] as const));
  const noteElements: Array<SVGGElement | undefined> = [];

  container.querySelectorAll<SVGGElement>("svg [data-slot-index], svg [data-slot-indices]").forEach((group) => {
    const slotIndexes = getRenderedSlotIndexes(group);
    const slots = slotIndexes
      .map((slotIndex) => slotByIndex.get(slotIndex))
      .filter((slot): slot is DrumSlot => slot !== undefined && slot.hits.length > 0);
    const slot = slots[0];

    if (!slot) {
      return;
    }

    slots.forEach((candidate) => {
      noteElements[candidate.index] = group;
    });

    const instrumentList = slot.hits.map((hit) => hit.instrument.label).join(", ");

    group.classList.add("drum-notation__interactive-note");
    group.setAttribute("tabindex", "0");
    group.setAttribute("role", "button");
    group.setAttribute("aria-label", `Preview ${instrumentList} at slot ${slot.index + 1}`);
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onPreview(slot);
      }
    });
  });

  container.querySelectorAll<SVGRectElement>("svg .drum-notation__hit-target[data-preview-slot-index]").forEach((target) => {
    const slot = slotByIndex.get(Number(target.dataset.previewSlotIndex));

    if (!slot || slot.hits.length === 0) {
      return;
    }

    target.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onPreview(slot);
    });
  });

  return noteElements;
}

function getRenderedSlotIndexes(group: SVGGElement): number[] {
  const source = group.getAttribute("data-slot-indices") ?? group.getAttribute("data-slot-index") ?? "";

  return source
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value));
}

function makeStaveNote(slot: DrumSlot, duration = "16", colorNoteheads = false, dots = 0): StaveNote {
  if (slot.hits.length === 0) {
    const rest = new StaveNote({
      keys: ["b/4"],
      duration: `${duration}r`,
      clef: "percussion",
      stemDirection: Stem.UP
    });

    attachDots(rest, dots);
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

  attachDots(note, dots);

  if (colorNoteheads) {
    applyLegendNoteheadColors(note, slot.hits);
  }

  applyHitModifiers(note, slot.hits, colorNoteheads);

  return note;
}

function attachDots(note: StaveNote, dots: number): void {
  for (let index = 0; index < dots; index++) {
    Dot.buildAndAttach([note], { all: true });
  }
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

function applyHitModifiers(note: StaveNote, hits: DrumHit[], colorNoteheads: boolean): void {
  addGhostParentheses(note, hits);
  addGraceNoteOrnaments(note, hits, colorNoteheads);
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

function addGraceNoteOrnaments(note: StaveNote, hits: DrumHit[], colorNoteheads: boolean): void {
  hits
    .filter((hit) => hit.articulation === "flam" || hit.articulation === "drag")
    .forEach((hit) => {
      const noteheadIndex = note.getKeys().findIndex((key) => key === hit.instrument.vexKey);

      if (noteheadIndex < 0) {
        return;
      }

      const isDrag = hit.articulation === "drag";
      const graceNotes = Array.from(
        { length: isDrag ? 2 : 1 },
        () =>
          new GraceNote({
            keys: [hit.instrument.vexKey],
            duration: isDrag ? "16" : "8",
            clef: "percussion",
            stemDirection: Stem.UP,
            slash: false
          })
      );
      const graceGroup = new GraceNoteGroup(graceNotes, false);
      const color = colorNoteheads ? hit.instrument.color : undefined;

      if (color) {
        graceNotes.forEach((graceNote) => {
          graceNote.setKeyStyle(0, {
            fillStyle: color,
            strokeStyle: color
          });
        });
      }

      if (isDrag) {
        graceGroup.beamNotes();
      }

      note.addModifier(graceGroup, noteheadIndex);
      rememberGraceSlur(note, graceNotes, noteheadIndex, color);
    });
}

function rememberGraceSlur(note: StaveNote, graceNotes: GraceNote[], mainNoteheadIndex: number, color?: string): void {
  const anchors = graceSlurAnchors.get(note) ?? [];

  anchors.push({ graceNotes, mainNoteheadIndex, color });
  graceSlurAnchors.set(note, anchors);
}

export { makeRenderedNotesInteractive };
