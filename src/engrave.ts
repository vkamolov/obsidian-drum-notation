import { Beam, Formatter, GraceNote, GraceNoteGroup, Modifier, Parenthesis, Renderer, Stave, StaveNote, Stem, TimeSignature, Tuplet, Voice } from "vexflow";
import { DRUM_KIT } from "./kit";
import {
  compareVexKeys,
  durationForDenominator,
  durationForGridSpan,
  durationForSubdivision,
  getBeatValue,
  getSlotsPerBeat,
  isPowerOfTwo,
  largestPowerOfTwoAtMost,
  shouldBeamSubdivision
} from "./music";
import { DrumBlock, DrumHit, DrumInstrument, DrumSlot, EngravingStyle, GridResolution, ScoreRenderResult } from "./types";

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

export function renderVexflowScore(block: DrumBlock, container: HTMLElement): ScoreRenderResult {
  container.empty();

  const cssWidth = getScoreWidth(container);
  const layout = getEngravingLayout(block.engravingStyle);
  const width = cssWidth / layout.renderScale;
  const height = layout.systemHeight;
  const useTidyStyle = block.engravingStyle === "tidy";
  const cursorPositions: Array<ScoreRenderResult["cursorPositions"][number]> = [];

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
    const systemNoteSlots: DrumSlot[] = [];

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

      systemNoteSlots.push(...visualBar.noteSlots);

      currentX += barWidth;
    });

    // Stamp each rendered hit notehead group with its source slot index. Within a
    // system the drawn StaveNote groups appear in creation order (rests are not
    // drawn), so this is a 1:1 map that downstream passes can use by lookup rather
    // than re-deriving the order by counting.
    const renderedGroups = Array.from(system.querySelectorAll<SVGGElement>(".vf-stavenote"));
    systemNoteSlots.forEach((slot, noteIndex) => {
      renderedGroups[noteIndex]?.setAttribute("data-slot-index", String(slot.index));
    });
  });

  return { cursorPositions };
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

export function colorRenderedNoteheads(block: DrumBlock, container: HTMLElement): void {
  const slotByIndex = new Map(block.slots.map((slot) => [slot.index, slot] as const));

  container.querySelectorAll<SVGGElement>("svg [data-slot-index]").forEach((group) => {
    const slot = slotByIndex.get(Number(group.dataset.slotIndex));

    if (!slot || slot.hits.length === 0) {
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
  // NOTE: VexFlow does not expose the time-signature glyph text objects publicly,
  // so we reach into topText/botText to shrink the font. The optional chaining
  // means a future VexFlow that renames these will silently skip the slimming
  // rather than throw — revisit this if the tidy time signature stops shrinking.
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

function makeRenderedNotesInteractive(
  block: DrumBlock,
  container: HTMLElement,
  onPreview: (slot: DrumSlot) => void
): Array<SVGGElement | undefined> {
  const slotByIndex = new Map(block.slots.map((slot) => [slot.index, slot] as const));
  const noteElements: Array<SVGGElement | undefined> = [];

  container.querySelectorAll<SVGGElement>("svg [data-slot-index]").forEach((group) => {
    const slot = slotByIndex.get(Number(group.dataset.slotIndex));

    if (!slot || slot.hits.length === 0) {
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

export { makeRenderedNotesInteractive };
