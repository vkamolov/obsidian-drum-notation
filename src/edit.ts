import { DRUM_KIT, getHitChar, normalizePattern } from "./kit";
import { getSlotsPerBar, hasSystemRhythmOverrides, isValidBeamGrouping } from "./music";
import { finalizeDrumBlock, parseDrumBlock } from "./parser";
import { getBarDurationQuarter, getWrittenBeatQuarter } from "./rhythm";
import { serializeDrumBlock } from "./serializer";
import {
  DrumArticulation,
  DrumBarClipboardPayload,
  DrumBlock,
  DrumBlockHeader,
  DrumHit,
  DrumInstrument,
  DrumRowInput,
  DrumStickingInput,
  DrumSystem,
  GridResolution,
  MAX_MEASURE_REPEAT_COUNT,
  MeasureRepeat,
  MeasureRepeatInput,
  StickingHand
} from "./types";

// Pure, DOM-free editing layer over the parsed model. Every helper takes a
// block and returns a NEW block; none mutate their input and none touch the
// renderer, player, or Obsidian. They are used by visual editors and any other
// model-level write path.
//
// Note identity is positional: a hit is uniquely addressed by its global
// (slot index, instrument id). Because the canonical artifact is text, there is
// nowhere to persist a generated id, so identity is derived from position on
// every parse and survives the save -> reload cycle by construction.

export function hitKey(slotIndex: number, instrumentId: string): string {
  return `${slotIndex}:${instrumentId}`;
}

export function findHit(block: DrumBlock, slotIndex: number, instrumentId: string): DrumHit | undefined {
  const slot = block.slots.find((candidate) => candidate.index === slotIndex);

  return slot?.hits.find((hit) => hit.instrument.id === instrumentId);
}

export function findSticking(block: DrumBlock, slotIndex: number): StickingHand | undefined {
  return block.slots.find((candidate) => candidate.index === slotIndex)?.sticking;
}

// --- Header / setting edits -------------------------------------------------
// These mirror the parser's own clamping so an edited value re-parses to the
// same thing. Tempo and grid remain header-only edits. Meter changes rebuild
// the timeline because written-beat tuplets are deliberately meter-relative.

export function setTempo(block: DrumBlock, tempo: number): DrumBlock {
  return { ...block, tempo: Math.min(260, Math.max(30, Math.round(tempo))) };
}

export function setRepeatCount(block: DrumBlock, count: number): DrumBlock {
  return { ...block, repeatCount: Math.min(64, Math.max(1, Math.round(count))) };
}

export function setGrid(block: DrumBlock, grid: GridResolution): DrumBlock {
  return { ...block, gridResolution: grid === 32 ? 32 : 16 };
}

export type TimeSignatureEditResult =
  | { ok: true; block: DrumBlock }
  | { ok: false; block: DrumBlock; message: string };

export function setTimeSignature(
  block: DrumBlock,
  numerator: number,
  denominator: number
): TimeSignatureEditResult {
  if (hasSystemRhythmOverrides(block)) {
    return {
      ok: false,
      block,
      message: "Edit system-level Time and Grouping declarations in the notation text."
    };
  }

  const timeSignature = `${Math.max(1, Math.round(numerator))}/${Math.max(1, Math.round(denominator))}`;
  const writtenBeatQuarter = getWrittenBeatQuarter(timeSignature);
  const barDurationQuarter = getBarDurationQuarter(timeSignature);
  const beamGrouping = block.beamGrouping && isValidBeamGrouping(timeSignature, block.beamGrouping)
    ? [...block.beamGrouping]
    : undefined;
  let relativeTupletOverflow = false;
  const systems = block.systems.map((system) => ({
    ...system,
    timeSignature,
    ...(beamGrouping ? { beamGrouping: [...beamGrouping] } : { beamGrouping: undefined }),
    bars: system.bars.map((bar) => {
      let startQuarter = 0;
      let containsRelativeTuplet = false;
      const rhythmRegions = bar.rhythmRegions.map((region) => {
        const relativeSpan = region.kind === "tuplet" &&
          region.tupletSpan?.kind === "written-beats"
          ? region.tupletSpan
          : undefined;
        const durationQuarter = relativeSpan
          ? relativeSpan.beats * writtenBeatQuarter
          : region.durationQuarter;
        const nextRegion = {
          ...region,
          startQuarter,
          durationQuarter,
          spanWrittenBeats: durationQuarter / writtenBeatQuarter
        };

        containsRelativeTuplet ||= relativeSpan !== undefined;
        startQuarter += durationQuarter;
        return nextRegion;
      });

      if (containsRelativeTuplet && startQuarter > barDurationQuarter + Number.EPSILON) {
        relativeTupletOverflow = true;
      }

      return {
        ...bar,
        timeSignature,
        durationQuarter: startQuarter,
        rhythmRegions
      };
    })
  }));

  if (relativeTupletOverflow) {
    return {
      ok: false,
      block,
      message: `Cannot change Time to ${timeSignature}: a written-beat tuplet would extend beyond the bar.`
    };
  }

  const bars = systems.reduce<DrumBlock["bars"]>(
    (result, system) => result.concat(system.bars),
    []
  );
  const nextBlock: DrumBlock = {
    ...block,
    timeSignature,
    ...(beamGrouping ? { beamGrouping } : { beamGrouping: undefined }),
    systems,
    bars
  };

  return {
    ok: true,
    block: parseDrumBlock(serializeDrumBlock(nextBlock))
  };
}

// --- Hit edits --------------------------------------------------------------

export function toggleHit(
  block: DrumBlock,
  slotIndex: number,
  instrument: DrumInstrument,
  articulation: DrumArticulation = "normal"
): DrumBlock {
  const existing = findHit(block, slotIndex, instrument.id);

  return existing ? clearHit(block, slotIndex, instrument) : setHit(block, slotIndex, instrument, articulation);
}

export function setHit(
  block: DrumBlock,
  slotIndex: number,
  instrument: DrumInstrument,
  articulation: DrumArticulation = "normal"
): DrumBlock {
  return withHitChar(block, slotIndex, instrument, getHitChar(instrument, articulation));
}

export function clearHit(block: DrumBlock, slotIndex: number, instrument: DrumInstrument): DrumBlock {
  return removeHit(block, slotIndex, instrument);
}

export function removeHit(block: DrumBlock, slotIndex: number, instrument: DrumInstrument): DrumBlock {
  return withHitChar(block, slotIndex, instrument, null);
}

export function applyArticulation(
  block: DrumBlock,
  slotIndex: number,
  instrument: DrumInstrument,
  articulation: DrumArticulation
): DrumBlock {
  return withHitChar(block, slotIndex, instrument, getHitChar(instrument, articulation));
}

export function applyArticulationToInstrumentInBar(
  block: DrumBlock,
  barIndex: number,
  instrument: DrumInstrument,
  articulation: DrumArticulation
): DrumBlock {
  const views = block.systems.map(toSystemView);
  const location = locateBar(views, barIndex);

  if (!location) {
    return block;
  }

  const view = views[location.system];
  const row = view.rows.find((candidate) => candidate.instrument.id === instrument.id);
  const pattern = row?.patterns[location.bar];

  if (!row || pattern === undefined || !patternHasHits(pattern)) {
    return block;
  }

  const hitChar = getHitChar(instrument, articulation);
  const nextPattern = replacePatternHits(pattern, hitChar);

  if (nextPattern === pattern) {
    return block;
  }

  row.patterns[location.bar] = nextPattern;

  return rebuildBlock(block, views);
}

export function clearInstrumentInBar(block: DrumBlock, barIndex: number, instrument: DrumInstrument): DrumBlock {
  const views = block.systems.map(toSystemView);
  const location = locateBar(views, barIndex);

  if (!location) {
    return block;
  }

  const view = views[location.system];
  const row = view.rows.find((candidate) => candidate.instrument.id === instrument.id);
  const pattern = row?.patterns[location.bar];

  if (!row || pattern === undefined || !patternHasHits(pattern)) {
    return block;
  }

  row.patterns[location.bar] = "-".repeat(view.bars[location.bar].width);
  trimEmptyInstrumentRowSegments(view, row);

  if (row.patterns.length === 0) {
    view.rows = view.rows.filter((candidate) => candidate !== row);
  }

  return rebuildBlock(block, views);
}

export function setInstrument(
  block: DrumBlock,
  slotIndex: number,
  fromInstrument: DrumInstrument,
  toInstrument: DrumInstrument
): DrumBlock {
  const hit = findHit(block, slotIndex, fromInstrument.id);

  if (!hit) {
    return block;
  }

  const cleared = withHitChar(block, slotIndex, fromInstrument, null);

  return withHitChar(cleared, slotIndex, toInstrument, getHitChar(toInstrument, hit.articulation));
}

// --- Sticking edits ---------------------------------------------------------

export function setSticking(block: DrumBlock, slotIndex: number, hand: StickingHand): DrumBlock {
  return withStickingChar(block, slotIndex, getStickingChar(hand));
}

export function clearSticking(block: DrumBlock, slotIndex: number): DrumBlock {
  return withStickingChar(block, slotIndex, "-");
}

// --- Internal rebuild -------------------------------------------------------
// The model is redundant (rows carry pattern strings, slots carry hits), so an
// edit must keep both in sync. Rather than patch the structure in place, we
// drop back to the row-input form, change one character, and rebuild through
// the parser's own builder. That guarantees patterns, slots, and bar widths
// stay mutually consistent — the same invariant a fresh parse provides.

interface RowView {
  instrument: DrumInstrument;
  label: string;
  patterns: string[]; // one entry per leading bar the instrument spans
}

interface RowSnapshot {
  instrument: DrumInstrument;
  label: string;
  pattern: string;
}

interface BarSnapshot {
  rows: RowSnapshot[];
  stickingPattern?: string;
}

interface BarView {
  width: number;
  start: number;
  stickingPattern?: string;
  measureRepeat?: MeasureRepeat;
  measureRepeatCount?: number;
}

interface SystemView {
  bars: BarView[];
  rows: RowView[];
  subtitle?: string;
}

export type BarPlacement = "same-system" | "new-system";

export type PasteBarClipboardResult =
  | {
      ok: true;
      block: DrumBlock;
    }
  | {
      ok: false;
      reason: "missing-target" | "incompatible" | "invalid-payload";
    };

export function captureBarClipboardPayload(block: DrumBlock, barIndex: number): DrumBarClipboardPayload | null {
  const views = block.systems.map(toSystemView);
  const location = locateBar(views, barIndex);

  if (!location) {
    return null;
  }

  const view = views[location.system];
  const bar = view.bars[location.bar];
  const sourceBar = block.bars[barIndex];
  const snapshot = snapshotBar(view, location.bar);
  const stickingPattern =
    snapshot.stickingPattern && /[RLB]/.test(snapshot.stickingPattern) ? snapshot.stickingPattern : undefined;

  return {
    kind: "drum-notation-bar",
    version: 1,
    timeSignature: sourceBar?.timeSignature ?? block.timeSignature,
    gridResolution: block.gridResolution,
    width: bar.width,
    rows: snapshot.rows
      .filter((row) => patternHasHits(row.pattern))
      .map((row) => ({
        instrumentId: row.instrument.id,
        label: row.label,
        pattern: normalizePattern(row.instrument, row.pattern)
      })),
    ...(stickingPattern ? { stickingPattern: normalizeStickingPattern(stickingPattern) } : {})
  };
}

export function barHasMeaningfulContent(block: DrumBlock, barIndex: number): boolean {
  const bar = block.bars[barIndex];

  return !!bar && (bar.measureRepeat !== undefined || bar.slots.some((slot) => slot.hits.length > 0 || !!slot.sticking));
}

export function pasteBarClipboardPayload(
  block: DrumBlock,
  barIndex: number,
  payload: DrumBarClipboardPayload
): PasteBarClipboardResult {
  const views = block.systems.map(toSystemView);
  const location = locateBar(views, barIndex);

  if (!location) {
    return { ok: false, reason: "missing-target" };
  }

  const view = views[location.system];
  const targetBar = view.bars[location.bar];
  const targetTimeSignature = block.bars[barIndex]?.timeSignature ?? block.timeSignature;

  if (
    payload.kind !== "drum-notation-bar" ||
    payload.version !== 1 ||
    payload.timeSignature !== targetTimeSignature ||
    payload.gridResolution !== block.gridResolution ||
    payload.width !== targetBar.width
  ) {
    return { ok: false, reason: "incompatible" };
  }

  const rows: RowSnapshot[] = [];
  for (const payloadRow of payload.rows) {
    const instrument = DRUM_KIT.find((candidate) => candidate.id === payloadRow.instrumentId);

    if (!instrument || Array.from(payloadRow.pattern).length !== payload.width) {
      return { ok: false, reason: "invalid-payload" };
    }

    rows.push({
      instrument,
      label: payloadRow.label,
      pattern: normalizePattern(instrument, payloadRow.pattern)
    });
  }

  if (payload.stickingPattern !== undefined && Array.from(payload.stickingPattern).length !== payload.width) {
    return { ok: false, reason: "invalid-payload" };
  }

  delete targetBar.measureRepeat;
  delete targetBar.measureRepeatCount;
  replaceBarWithSnapshot(view, location.bar, {
    rows,
    ...(payload.stickingPattern && /[RLB]/i.test(payload.stickingPattern)
      ? { stickingPattern: normalizeStickingPattern(payload.stickingPattern) }
      : {})
  });
  view.rows.forEach((row) => trimEmptyInstrumentRowSegments(view, row));
  view.rows = view.rows.filter((row) => row.patterns.length > 0);

  return { ok: true, block: rebuildBlock(block, views) };
}

function withHitChar(
  block: DrumBlock,
  slotIndex: number,
  instrument: DrumInstrument,
  char: string | null
): DrumBlock {
  const views = block.systems.map(toSystemView);
  const location = locate(views, slotIndex);

  if (!location) {
    return block;
  }

  const view = views[location.system];
  let row = view.rows.find((candidate) => candidate.instrument.id === instrument.id);

  if (!row) {
    // Removing a hit that does not exist is a no-op; only adds create a row.
    if (char === null) {
      return block;
    }

    row = { instrument, label: defaultLabel(instrument), patterns: [] };
    view.rows.push(row);
  }

  // A row spans a leading prefix of its system's bars. Adding a hit to a later
  // bar than the row currently reaches fills the intervening bars with rests so
  // the prefix stays contiguous (the only shape the text format can express).
  while (row.patterns.length <= location.bar) {
    row.patterns.push("-".repeat(view.bars[row.patterns.length].width));
  }

  row.patterns[location.bar] = setChar(row.patterns[location.bar], location.local, char ?? "-");

  return rebuildBlock(block, views);
}

function withStickingChar(block: DrumBlock, slotIndex: number, char: "R" | "L" | "B" | "-"): DrumBlock {
  const views = block.systems.map(toSystemView);
  const location = locate(views, slotIndex);

  if (!location) {
    return block;
  }

  const view = views[location.system];
  const current = view.bars[location.bar].stickingPattern?.[location.local] ?? "-";

  if (current === char) {
    return block;
  }

  while (view.bars.length > 0 && view.bars.length <= location.bar) {
    view.bars.push({ width: getSlotsPerBar(block.timeSignature, block.gridResolution), start: 0 });
  }

  for (let index = 0; index <= location.bar; index++) {
    if (view.bars[index].stickingPattern === undefined) {
      view.bars[index].stickingPattern = "-".repeat(view.bars[index].width);
    }
  }

  view.bars[location.bar].stickingPattern = setChar(view.bars[location.bar].stickingPattern ?? "", location.local, char);
  compactStickingPatterns(view);

  return rebuildBlock(block, views);
}

// --- Bar edits --------------------------------------------------------------

export function insertBarAfter(block: DrumBlock, barIndex: number, placement: BarPlacement = "same-system"): DrumBlock {
  const views = block.systems.map(toSystemView);
  const location = locateBar(views, barIndex);

  if (!location) {
    return block;
  }

  const sourceView = views[location.system];
  const emptyBar = emptyBarForBlock(block);
  const restPattern = "-".repeat(emptyBar.width);
  const hasSticking = systemHasSticking(sourceView);

  if (placement === "new-system") {
    views.splice(location.system + 1, 0, {
      bars: [{ ...emptyBar, ...(hasSticking ? { stickingPattern: restPattern } : {}) }],
      rows: rowsForBar(sourceView, location.bar).map((row) => ({
        instrument: row.instrument,
        label: row.label,
        patterns: [restPattern]
      }))
    });
  } else {
    insertPatternsIntoSystem(
      sourceView,
      location.bar + 1,
      { ...emptyBar, ...(hasSticking ? { stickingPattern: restPattern } : {}) },
      rowsForBar(sourceView, location.bar),
      (row) => restPattern
    );
  }

  return rebuildBlock(block, views);
}

export function splitSystemAfterBar(block: DrumBlock, barIndex: number): DrumBlock {
  const views = block.systems.map(toSystemView);
  const location = locateBar(views, barIndex);

  if (!location) {
    return block;
  }

  const sourceView = views[location.system];
  const splitIndex = location.bar + 1;

  if (splitIndex >= sourceView.bars.length) {
    return insertBarAfter(block, barIndex, "new-system");
  }

  const nextView: SystemView = {
    bars: sourceView.bars.splice(splitIndex),
    rows: []
  };

  sourceView.rows.forEach((row) => {
    const movedPatterns = row.patterns.splice(splitIndex);

    if (movedPatterns.length > 0) {
      nextView.rows.push({
        instrument: row.instrument,
        label: row.label,
        patterns: movedPatterns
      });
    }
  });
  sourceView.rows = sourceView.rows.filter((row) => row.patterns.length > 0);
  views.splice(location.system + 1, 0, nextView);

  return rebuildBlock(block, views);
}

export function duplicateBar(block: DrumBlock, barIndex: number, placement: BarPlacement = "same-system"): DrumBlock {
  const views = block.systems.map(toSystemView);
  const location = locateBar(views, barIndex);

  if (!location) {
    return block;
  }

  const sourceView = views[location.system];
  const sourceBar = sourceView.bars[location.bar];
  const sourceRows = rowsForBar(sourceView, location.bar);
  const normalCopy = {
    ...emptyBarLike(sourceBar),
    ...(sourceBar.stickingPattern !== undefined ? { stickingPattern: sourceBar.stickingPattern } : {})
  };

  if (placement === "new-system") {
    views.splice(location.system + 1, 0, {
      bars: [normalCopy],
      rows: sourceRows.map((row) => ({
        instrument: row.instrument,
        label: row.label,
        patterns: [row.patterns[location.bar]]
      }))
    });
  } else {
    insertPatternsIntoSystem(sourceView, location.bar + 1, normalCopy, sourceRows, (row) => row.patterns[location.bar]);
  }

  return rebuildBlock(block, views);
}

export function duplicateBarToNextSystem(block: DrumBlock, barIndex: number): DrumBlock {
  const views = block.systems.map(toSystemView);
  const location = locateBar(views, barIndex);

  if (!location) {
    return block;
  }

  const sourceView = views[location.system];
  const sourceBar = sourceView.bars[location.bar];
  const snapshot = snapshotBar(sourceView, location.bar);
  const normalCopy = {
    ...emptyBarLike(sourceBar),
    ...(snapshot.stickingPattern !== undefined ? { stickingPattern: snapshot.stickingPattern } : {})
  };
  const nextView = views[location.system + 1];

  if (nextView) {
    appendSnapshotAsBar(nextView, normalCopy, snapshot);
  } else {
    views.splice(location.system + 1, 0, {
      bars: [normalCopy],
      rows: snapshot.rows.map((row) => ({
        instrument: row.instrument,
        label: row.label,
        patterns: [row.pattern]
      }))
    });
  }

  return rebuildBlock(block, views);
}

export function deleteBar(block: DrumBlock, barIndex: number): DrumBlock {
  const views = block.systems.map(toSystemView);
  const location = locateBar(views, barIndex);

  if (!location) {
    return block;
  }

  const view = views[location.system];
  const repeatGroup = locateRepeatGroup(view, location.bar);

  if (repeatGroup) {
    removeBarsFromSystem(view, repeatGroup.start, repeatGroup.count);
  } else {
    removeBarsFromSystem(view, location.bar, 1);
  }

  if (view.bars.length === 0) {
    views.splice(location.system, 1);
  }

  return rebuildBlock(block, views);
}

export function setBarRepeat(block: DrumBlock, barIndex: number): DrumBlock {
  const views = block.systems.map(toSystemView);
  const location = locateBar(views, barIndex);
  const previousLocation = locateBar(views, barIndex - 1);

  if (!location || !previousLocation) {
    return block;
  }

  syncMeasureRepeatCopies(views);

  const view = views[location.system];
  const snapshot = snapshotBar(views[previousLocation.system], previousLocation.bar);
  view.bars[location.bar] = {
    ...emptyBarLike(view.bars[location.bar]),
    measureRepeat: 1
  };
  replaceBarWithSnapshot(view, location.bar, snapshot);

  return rebuildBlock(block, views);
}

export function insertRepeatBarAfter(block: DrumBlock, barIndex: number, count = 1): DrumBlock {
  const views = block.systems.map(toSystemView);
  const location = locateBar(views, barIndex);

  if (!location) {
    return block;
  }

  const requestedCount = Number.isFinite(count) ? Math.round(count) : 1;
  const repeatCount = Math.min(MAX_MEASURE_REPEAT_COUNT, Math.max(1, requestedCount));
  const view = views[location.system];
  const sourceBar = view.bars[location.bar];
  const sourceRows = rowsForBar(view, location.bar);
  const snapshot = snapshotBar(view, location.bar);

  for (let index = 0; index < repeatCount; index++) {
    insertPatternsIntoSystem(
      view,
      location.bar + index + 1,
      {
        ...emptyBarLike(sourceBar),
        ...(snapshot.stickingPattern !== undefined ? { stickingPattern: snapshot.stickingPattern } : {}),
        measureRepeat: 1,
        ...(index === 0 && repeatCount > 1 ? { measureRepeatCount: repeatCount } : {})
      },
      sourceRows,
      (row) => row.patterns[location.bar]
    );
  }

  return rebuildBlock(block, views);
}

export function getBarRepeatGroupCount(block: DrumBlock, barIndex: number): number {
  return getBarRepeatGroupRange(block, barIndex)?.count ?? 0;
}

export function getBarRepeatGroupRange(
  block: DrumBlock,
  barIndex: number
): { startIndex: number; count: number } | null {
  const views = block.systems.map(toSystemView);
  const location = locateBar(views, barIndex);

  if (!location) {
    return null;
  }

  const group = locateRepeatGroup(views[location.system], location.bar);

  if (!group) {
    return null;
  }

  return {
    startIndex: barIndex - (location.bar - group.start),
    count: group.count
  };
}

export function resizeBarRepeatGroup(block: DrumBlock, barIndex: number, count: number): DrumBlock {
  const views = block.systems.map(toSystemView);
  const location = locateBar(views, barIndex);

  if (!location) {
    return block;
  }

  const view = views[location.system];
  const group = locateRepeatGroup(view, location.bar);

  if (!group) {
    return block;
  }

  const requestedCount = Number.isFinite(count) ? Math.round(count) : group.count;
  const repeatCount = Math.min(MAX_MEASURE_REPEAT_COUNT, Math.max(1, requestedCount));

  if (repeatCount === group.count) {
    return block;
  }

  syncMeasureRepeatCopies(views);

  if (repeatCount < group.count) {
    removeBarsFromSystem(view, group.start + repeatCount, group.count - repeatCount);
  } else {
    const sourceBar = view.bars[group.start];
    const sourceRows = rowsForBar(view, group.start);
    const snapshot = snapshotBar(view, group.start);

    for (let index = group.count; index < repeatCount; index++) {
      insertPatternsIntoSystem(
        view,
        group.start + index,
        {
          ...emptyBarLike(sourceBar),
          ...(snapshot.stickingPattern !== undefined ? { stickingPattern: snapshot.stickingPattern } : {}),
          measureRepeat: 1
        },
        sourceRows,
        (row) => row.patterns[group.start]
      );
    }
  }

  for (let index = 0; index < repeatCount; index++) {
    const bar = view.bars[group.start + index];

    bar.measureRepeat = 1;
    if (index === 0 && repeatCount > 1) {
      bar.measureRepeatCount = repeatCount;
    } else {
      delete bar.measureRepeatCount;
    }
  }

  return rebuildBlock(block, views);
}

export function clearBarRepeat(block: DrumBlock, barIndex: number): DrumBlock {
  const views = block.systems.map(toSystemView);
  const location = locateBar(views, barIndex);

  if (!location) {
    return block;
  }

  const view = views[location.system];
  const group = locateRepeatGroup(view, location.bar);

  if (!group) {
    return block;
  }

  syncMeasureRepeatCopies(views);

  const bar = view.bars[group.start];
  delete bar.measureRepeat;
  delete bar.measureRepeatCount;
  removeBarsFromSystem(view, group.start + 1, group.count - 1);

  return rebuildBlock(block, views);
}

function locate(
  views: SystemView[],
  slotIndex: number
): { system: number; bar: number; local: number } | null {
  for (let system = 0; system < views.length; system++) {
    const bars = views[system].bars;

    for (let bar = 0; bar < bars.length; bar++) {
      if (slotIndex >= bars[bar].start && slotIndex < bars[bar].start + bars[bar].width) {
        return { system, bar, local: slotIndex - bars[bar].start };
      }
    }
  }

  return null;
}

function toSystemView(system: DrumSystem): SystemView {
  const bars = system.bars.map((bar) => ({
    width: bar.slots.length,
    start: bar.startSlot,
    ...(bar.stickingPattern !== undefined ? { stickingPattern: bar.stickingPattern } : {}),
    ...(bar.measureRepeat ? { measureRepeat: bar.measureRepeat } : {}),
    ...(bar.measureRepeatCount ? { measureRepeatCount: bar.measureRepeatCount } : {})
  }));
  const order: string[] = [];
  const byId = new Map<string, RowView>();

  for (const bar of system.bars) {
    for (const row of bar.rows) {
      let view = byId.get(row.instrument.id);

      if (!view) {
        view = { instrument: row.instrument, label: row.label, patterns: [] };
        byId.set(row.instrument.id, view);
        order.push(row.instrument.id);
      }

      view.patterns.push(normalizePattern(row.instrument, row.pattern));
    }
  }

  const rows: RowView[] = [];
  order.forEach((id) => {
    const row = byId.get(id);

    if (row) {
      rows.push(row);
    }
  });

  return {
    bars,
    rows,
    ...(system.subtitle ? { subtitle: system.subtitle } : {})
  };
}

function toRowSection(view: SystemView): DrumRowInput[] {
  return view.rows.map((row) => ({
    label: row.label,
    patterns: row.patterns,
    instrument: row.instrument
  }));
}

function toStickingSection(view: SystemView): DrumStickingInput | undefined {
  if (!systemHasSticking(view)) {
    return undefined;
  }

  return {
    label: "ST",
    patterns: view.bars.map((bar) => normalizeStickingPattern(bar.stickingPattern ?? "-".repeat(bar.width)))
  };
}

function toRepeatSection(view: SystemView): Array<MeasureRepeatInput | undefined> {
  return view.bars.map((bar) =>
    bar.measureRepeat
      ? {
          type: bar.measureRepeat,
          count: bar.measureRepeatCount ?? 1
        }
      : undefined
  );
}

function rebuildBlock(block: DrumBlock, views: SystemView[]): DrumBlock {
  // Mixed-meter blocks are text-authored in this release. Every grid/bar edit
  // eventually rebuilds through this function, so fail closed here as well as
  // in the UI instead of accidentally flattening per-system rhythm settings.
  if (hasSystemRhythmOverrides(block)) {
    return block;
  }

  syncMeasureRepeatCopies(views);
  views.forEach(compactStickingPatterns);

  return finalizeDrumBlock(
    headerOf(block),
    views.map(toRowSection),
    views.map(toRepeatSection),
    views.map(toStickingSection),
    views.map((view) => view.subtitle)
  );
}

function syncMeasureRepeatCopies(views: SystemView[]): void {
  let previousSnapshot: BarSnapshot | null = null;

  for (const view of views) {
    for (let barIndex = 0; barIndex < view.bars.length; barIndex++) {
      const bar = view.bars[barIndex];

      if (bar.measureRepeat && previousSnapshot) {
        applySnapshotToBar(view, barIndex, previousSnapshot);
      }

      previousSnapshot = snapshotBar(view, barIndex);
    }
  }
}

function snapshotBar(view: SystemView, barIndex: number): BarSnapshot {
  return {
    rows: view.rows
      .map((row): RowSnapshot | null => {
        const pattern = row.patterns[barIndex];

        return pattern === undefined ? null : { instrument: row.instrument, label: row.label, pattern };
      })
      .filter((row): row is RowSnapshot => row !== null),
    ...(view.bars[barIndex].stickingPattern !== undefined ? { stickingPattern: view.bars[barIndex].stickingPattern } : {})
  };
}

function applySnapshotToBar(view: SystemView, barIndex: number, snapshot: BarSnapshot): void {
  snapshot.rows.forEach((snapshotRow) => {
    let row = view.rows.find((candidate) => candidate.instrument.id === snapshotRow.instrument.id);

    if (!row) {
      row = {
        instrument: snapshotRow.instrument,
        label: snapshotRow.label,
        patterns: []
      };
      view.rows.push(row);
    }

    while (row.patterns.length < barIndex) {
      row.patterns.push("-".repeat(view.bars[row.patterns.length].width));
    }

    row.patterns[barIndex] = snapshotRow.pattern;
  });

  if (snapshot.stickingPattern !== undefined) {
    view.bars[barIndex].stickingPattern = snapshot.stickingPattern;
  } else {
    delete view.bars[barIndex].stickingPattern;
  }
}

function replaceBarWithSnapshot(view: SystemView, barIndex: number, snapshot: BarSnapshot): void {
  const snapshotIds = new Set(snapshot.rows.map((row) => row.instrument.id));

  view.rows.forEach((row) => {
    if (!snapshotIds.has(row.instrument.id) && row.patterns.length > barIndex) {
      row.patterns[barIndex] = "-".repeat(view.bars[barIndex].width);
    }
  });
  applySnapshotToBar(view, barIndex, snapshot);
}

function locateBar(views: SystemView[], barIndex: number): { system: number; bar: number } | null {
  let current = 0;

  for (let system = 0; system < views.length; system++) {
    for (let bar = 0; bar < views[system].bars.length; bar++) {
      if (current === barIndex) {
        return { system, bar };
      }

      current++;
    }
  }

  return null;
}

function locateRepeatGroup(view: SystemView, barIndex: number): { start: number; count: number } | null {
  for (let index = 0; index < view.bars.length; index++) {
    const bar = view.bars[index];

    if (!bar.measureRepeat) {
      continue;
    }

    let runCount = 0;
    for (let runIndex = index; runIndex < view.bars.length && view.bars[runIndex].measureRepeat; runIndex++) {
      runCount++;
    }

    const count = Math.max(1, Math.min(bar.measureRepeatCount ?? 1, runCount));
    if (barIndex >= index && barIndex < index + count) {
      return { start: index, count };
    }

    index += count - 1;
  }

  return null;
}

function rowsForBar(view: SystemView, barIndex: number): RowView[] {
  return view.rows.filter((row) => row.patterns[barIndex] !== undefined);
}

function emptyBarLike(bar: BarView): BarView {
  return { width: bar.width, start: 0 };
}

function emptyBarForBlock(block: DrumBlock): BarView {
  return { width: getSlotsPerBar(block.timeSignature, block.gridResolution), start: 0 };
}

function insertPatternsIntoSystem(
  view: SystemView,
  insertIndex: number,
  bar: BarView,
  sourceRows: RowView[],
  patternForRow: (row: RowView) => string
): void {
  const sourceIds = new Set(sourceRows.map((row) => row.instrument.id));

  view.bars.splice(insertIndex, 0, bar);
  view.rows.forEach((row) => {
    if (sourceIds.has(row.instrument.id)) {
      row.patterns.splice(insertIndex, 0, patternForRow(row));
    } else if (row.patterns.length > insertIndex) {
      row.patterns.splice(insertIndex, 0, "-".repeat(bar.width));
    }
  });
}

function removeBarsFromSystem(view: SystemView, startIndex: number, count: number): void {
  if (count <= 0) {
    return;
  }

  view.bars.splice(startIndex, count);
  view.rows.forEach((row) => {
    if (row.patterns.length > startIndex) {
      row.patterns.splice(startIndex, count);
    }
  });
  view.rows = view.rows.filter((row) => row.patterns.length > 0);
}

function appendSnapshotAsBar(view: SystemView, bar: BarView, snapshot: BarSnapshot): void {
  const insertIndex = view.bars.length;

  view.bars.push(bar);
  snapshot.rows.forEach((snapshotRow) => {
    let row = view.rows.find((candidate) => candidate.instrument.id === snapshotRow.instrument.id);

    if (!row) {
      row = {
        instrument: snapshotRow.instrument,
        label: snapshotRow.label,
        patterns: []
      };
      view.rows.push(row);
    }

    while (row.patterns.length < insertIndex) {
      row.patterns.push("-".repeat(view.bars[row.patterns.length].width));
    }

    row.patterns[insertIndex] = snapshotRow.pattern;
  });

  if (snapshot.stickingPattern !== undefined) {
    view.bars[insertIndex].stickingPattern = snapshot.stickingPattern;
  }
}

function systemHasSticking(view: SystemView): boolean {
  return view.bars.some((bar) => bar.stickingPattern !== undefined && /[RLB]/.test(bar.stickingPattern));
}

function compactStickingPatterns(view: SystemView): void {
  if (!systemHasSticking(view)) {
    view.bars.forEach((bar) => {
      delete bar.stickingPattern;
    });
  }
}

function normalizeStickingPattern(pattern: string): string {
  return Array.from(pattern)
    .map((char) => {
      if (char === "R" || char === "r") {
        return "R";
      }

      if (char === "L" || char === "l") {
        return "L";
      }

      if (char === "B" || char === "b") {
        return "B";
      }

      return "-";
    })
    .join("");
}

function getStickingChar(hand: StickingHand): "R" | "L" | "B" {
  if (hand === "left") {
    return "L";
  }

  if (hand === "both") {
    return "B";
  }

  return "R";
}

function setChar(pattern: string, index: number, char: string): string {
  const length = Math.max(pattern.length, index + 1);
  let result = "";

  for (let charIndex = 0; charIndex < length; charIndex++) {
    if (charIndex === index) {
      result += char;
    } else {
      result += pattern[charIndex] ?? "-";
    }
  }

  return result;
}

function patternHasHits(pattern: string): boolean {
  return Array.from(pattern).some((char) => char !== "-");
}

function replacePatternHits(pattern: string, hitChar: string): string {
  return Array.from(pattern)
    .map((char) => (char === "-" ? "-" : hitChar))
    .join("");
}

function trimEmptyInstrumentRowSegments(view: SystemView, row: RowView): void {
  while (row.patterns.length > 0 && !patternHasHits(row.patterns[row.patterns.length - 1])) {
    row.patterns.pop();
  }
}

// The first alias is the conventional short code (hh, sd, bd…); upper-casing it
// matches the kit's documented row labels and re-parses to the same instrument.
function defaultLabel(instrument: DrumInstrument): string {
  return (instrument.aliases[0] ?? instrument.label).toUpperCase();
}

function headerOf(block: DrumBlock): DrumBlockHeader {
  const { tempo, timeSignature, beamGrouping, voicing, repeatCount, showCursor, showHighlight, showRests, legendMode, gridResolution, metadata } = block;

  return {
    tempo,
    timeSignature,
    ...(beamGrouping ? { beamGrouping: [...beamGrouping] } : {}),
    voicing,
    repeatCount,
    showCursor,
    showHighlight,
    showRests,
    legendMode,
    gridResolution,
    metadata
  };
}
