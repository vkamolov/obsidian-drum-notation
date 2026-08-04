import { getArticulation, getVelocity, INSTRUMENTS_BY_ALIAS, isRest, isSupportedHitChar } from "./kit";
import { getSlotsPerBar } from "./music";
import {
  analyzeTupletPattern,
  buildPlainRhythmRegions,
  containsTupletLikeSyntax,
  flattenTupletSyntax,
  getRegionEndQuarter,
  rhythmSignature
} from "./rhythm";
import {
  DEFAULT_GRID_RESOLUTION,
  DEFAULT_LEGEND_MODE,
  DEFAULT_REPEAT_COUNT,
  DEFAULT_SHOW_CURSOR,
  DEFAULT_SHOW_HIGHLIGHT,
  DEFAULT_SHOW_RESTS,
  DEFAULT_TEMPO,
  DEFAULT_TIME_SIGNATURE,
  DEFAULT_VOICING,
  DrumBar,
  DrumBlock,
  DrumBlockHeader,
  DrumHit,
  DrumInstrument,
  DrumRow,
  DrumRowInput,
  DrumRhythmRegion,
  DrumSlot,
  DrumStickingInput,
  DrumSystem,
  DrumSystemSettings,
  GridResolution,
  LegendMode,
  MAX_MEASURE_REPEAT_COUNT,
  MeasureRepeatInput,
  ParseResult,
  ParseWarning,
  ParseWarningCode,
  StickingHand
} from "./types";
import { normalizeLabel } from "./util";

interface BarSnapshotRow {
  label: string;
  instrument: DrumInstrument;
  pattern: string;
}

interface BarSnapshot {
  rows: BarSnapshotRow[];
  stickingPattern?: string;
  width: number;
  timeSignature: string;
}

interface ResolvedSystemSettings extends DrumSystemSettings {
  sourceSectionIndex: number;
}

interface ParsedDrumRowInput extends DrumRowInput {
  lineNumber: number;
  generatedSegments?: ReadonlySet<number>;
  segmentLineNumbers?: ReadonlyMap<number, number>;
}

interface ParsedDrumStickingInput extends DrumStickingInput {
  lineNumber: number;
  generatedSegments?: ReadonlySet<number>;
  segmentLineNumbers?: ReadonlyMap<number, number>;
}

interface RowLengthWarningEntry {
  label: string;
  patterns: string[];
  lineNumber: number;
  kind: "row" | "sticking";
  generatedSegments?: ReadonlySet<number>;
  segmentLineNumbers?: ReadonlyMap<number, number>;
}

interface PreparedRhythmSections {
  rhythmSections: Array<Array<DrumRhythmRegion[] | undefined>>;
  tupletSourceSegments: Array<ReadonlySet<number>>;
  containsTupletSyntax: boolean;
}

const STICKING_LABELS = new Set(["st", "stick", "sticking", "hands"]);
const SETTING_KEYS = new Set([
  "title",
  "author",
  "comment",
  "tempo",
  "bpm",
  "time",
  "timesignature",
  "meter",
  "grouping",
  "voicing",
  "count",
  "repeat",
  "repeats",
  "cursor",
  "playbackcursor",
  "highlight",
  "notehighlight",
  "playbackhighlight",
  "rests",
  "legend",
  "instrumentlegend",
  "kitlegend",
  "colorlegend",
  "grid",
  "subdivision",
  "resolution"
]);
const DIAGNOSTIC_SETTING_KEYS = new Set([
  "tempo",
  "bpm",
  "time",
  "timesignature",
  "meter",
  "grouping",
  "voicing",
  "repeat",
  "repeats",
  "cursor",
  "playbackcursor",
  "highlight",
  "notehighlight",
  "playbackhighlight",
  "rests",
  "legend",
  "instrumentlegend",
  "kitlegend",
  "colorlegend",
  "grid",
  "subdivision",
  "resolution"
]);
const REMOVED_SETTING_KEYS = new Set(["engraving"]);
const TRUE_BOOLEAN_VALUES = new Set(["on", "true", "yes", "y", "1", "show", "visible"]);
const FALSE_BOOLEAN_VALUES = new Set(["off", "false", "no", "n", "0", "hide", "hidden"]);
const USED_LEGEND_VALUES = new Set(["on", "true", "yes", "y", "1", "show", "visible", "used", "current", "present"]);
const ALL_LEGEND_VALUES = new Set(["all", "full", "kit", "complete", "supported", "everything"]);
const OFF_LEGEND_VALUES = new Set(["off", "false", "no", "n", "0", "hide", "hidden", "none"]);

export function parseDrumBlock(source: string): DrumBlock {
  return parseDrumBlockInternal(source, false).block;
}

export function parseDrumBlockWithWarnings(source: string): ParseResult {
  return parseDrumBlockInternal(source, true);
}

function parseDrumBlockInternal(source: string, collectWarnings: boolean): ParseResult {
  const metadata: string[] = [];
  const warnings: ParseWarning[] = [];
  const rowSections: ParsedDrumRowInput[][] = [];
  const stickingSections: Array<ParsedDrumStickingInput | undefined> = [];
  const repeatSections: Array<Array<MeasureRepeatInput | undefined>> = [];
  const subtitleSections: Array<string | undefined> = [];
  const systemSettingsSections: DrumSystemSettings[] = [];
  let currentRows: ParsedDrumRowInput[] = [];
  let currentSticking: ParsedDrumStickingInput | undefined;
  let currentRepeats: Array<MeasureRepeatInput | undefined> = [];
  let currentSubtitle: string | undefined;
  const barHistory: BarSnapshot[] = [];
  let tempo = DEFAULT_TEMPO;
  let repeatCount = DEFAULT_REPEAT_COUNT;
  let showCursor = DEFAULT_SHOW_CURSOR;
  let showHighlight = DEFAULT_SHOW_HIGHLIGHT;
  let showRests = DEFAULT_SHOW_RESTS;
  let voicing = DEFAULT_VOICING;
  let legendMode = DEFAULT_LEGEND_MODE;
  let gridResolution = DEFAULT_GRID_RESOLUTION;
  const warn = (line: number, code: ParseWarningCode, message: string, column?: number) => {
    if (!collectWarnings) {
      return;
    }

    warnings.push({
      code,
      message,
      line,
      ...(column !== undefined ? { column } : {})
    });
  };
  const resolvedSystemSettings = resolveSystemSettings(source, warn);
  const mainSettings = resolvedSystemSettings[0] ?? { timeSignature: DEFAULT_TIME_SIGNATURE };
  let sourceSectionIndex = 0;

  const pushCurrentBar = () => {
    if (currentRows.length === 0 && !currentSticking) {
      currentSubtitle = undefined;
      currentRepeats = [];
      return;
    }

    syncRepeatMarkers(currentRows, currentSticking, currentRepeats);
    rowSections.push(currentRows);
    stickingSections.push(currentSticking);
    repeatSections.push(currentRepeats);
    subtitleSections.push(currentSubtitle);
    const settings = resolvedSystemSettings[sourceSectionIndex] ?? mainSettings;
    systemSettingsSections.push(cloneSystemSettings(settings));
    barHistory.push(...snapshotBars(currentRows, currentSticking, settings.timeSignature));
    currentRows = [];
    currentSticking = undefined;
    currentRepeats = [];
    currentSubtitle = undefined;
  };

  source.split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();
    const lineNumber = lineIndex + 1;

    if (line.length === 0) {
      return;
    }

    if (isBarSeparator(line)) {
      pushCurrentBar();
      sourceSectionIndex++;
      return;
    }

    const subtitle = parseSubtitleLine(line);

    if (subtitle !== null) {
      if (subtitle.length > 0) {
        currentSubtitle = subtitle;
      }

      return;
    }

    const removedSetting = parseRemovedSettingLine(line);

    if (removedSetting) {
      warn(lineNumber, "removed-setting", `${removedSetting.originalKey}: is preserved as metadata but no longer affects rendering.`);
      metadata.push(line);
      return;
    }

    const emptyKnownSetting = parseEmptyKnownSettingLine(line);

    if (emptyKnownSetting) {
      warn(lineNumber, "invalid-setting", `${emptyKnownSetting.originalKey}: has no value and is preserved as metadata.`);
      metadata.push(line);
      return;
    }

    const setting = parseSettingLine(line);

    if (setting) {
      if (setting.key === "tempo" || setting.key === "bpm") {
        const value = Number.parseInt(setting.value, 10);
        const nextTempo = clampTempo(value);

        if (!Number.isFinite(value)) {
          warn(lineNumber, "invalid-setting", `${setting.originalKey}: "${setting.value}" is not a valid tempo; using ${nextTempo} BPM.`);
        } else if (value !== nextTempo) {
          warn(lineNumber, "clamped-setting", `${setting.originalKey}: ${value} is outside the supported 30–260 BPM range; using ${nextTempo} BPM.`);
        }

        tempo = nextTempo;
      } else if (
        setting.key === "time" ||
        setting.key === "timesignature" ||
        setting.key === "meter" ||
        setting.key === "grouping"
      ) {
        // Time and Grouping are resolved per source system before row parsing.
      } else if (setting.key === "repeat" || setting.key === "repeats") {
        const parsedRepeat = parseRepeatSettingValue(setting.value);
        const nextRepeatCount = parseRepeatCount(setting.value);

        if (parsedRepeat === null) {
          warn(lineNumber, "invalid-setting", `${setting.originalKey}: "${setting.value}" is not a valid repeat count; using ${nextRepeatCount}.`);
        } else if (parsedRepeat !== nextRepeatCount) {
          warn(lineNumber, "clamped-setting", `${setting.originalKey}: ${parsedRepeat} is outside the supported 1–64 range; using ${nextRepeatCount}.`);
        }

        repeatCount = nextRepeatCount;
      } else if (setting.key === "cursor" || setting.key === "playbackcursor") {
        if (!isBooleanSettingValue(setting.value)) {
          warn(lineNumber, "invalid-setting", `${setting.originalKey}: "${setting.value}" is not a recognized on/off value; using ${DEFAULT_SHOW_CURSOR ? "on" : "off"}.`);
        }

        showCursor = parseBooleanSetting(setting.value, DEFAULT_SHOW_CURSOR);
      } else if (setting.key === "highlight" || setting.key === "notehighlight" || setting.key === "playbackhighlight") {
        if (!isBooleanSettingValue(setting.value)) {
          warn(lineNumber, "invalid-setting", `${setting.originalKey}: "${setting.value}" is not a recognized on/off value; using ${DEFAULT_SHOW_HIGHLIGHT ? "on" : "off"}.`);
        }

        showHighlight = parseBooleanSetting(setting.value, DEFAULT_SHOW_HIGHLIGHT);
      } else if (setting.key === "rests") {
        if (!isBooleanSettingValue(setting.value)) {
          warn(lineNumber, "invalid-setting", `${setting.originalKey}: "${setting.value}" is not a recognized on/off value; using ${DEFAULT_SHOW_RESTS ? "on" : "off"}.`);
        }

        showRests = parseBooleanSetting(setting.value, DEFAULT_SHOW_RESTS);
      } else if (setting.key === "voicing") {
        const normalized = normalizeLabel(setting.value);

        if (normalized !== "single" && normalized !== "split") {
          warn(lineNumber, "invalid-setting", `${setting.originalKey}: "${setting.value}" is not a recognized voicing mode; using ${DEFAULT_VOICING}.`);
          voicing = DEFAULT_VOICING;
        } else {
          voicing = normalized;
        }
      } else if (setting.key === "legend" || setting.key === "instrumentlegend" || setting.key === "kitlegend" || setting.key === "colorlegend") {
        if (!isLegendSettingValue(setting.value)) {
          warn(lineNumber, "invalid-setting", `${setting.originalKey}: "${setting.value}" is not a recognized legend mode; using ${DEFAULT_LEGEND_MODE}.`);
        }

        legendMode = parseLegendMode(setting.value);
      } else if (setting.key === "grid" || setting.key === "subdivision" || setting.key === "resolution") {
        const parsedGrid = parseGridSettingValue(setting.value);
        const nextGridResolution = parseGridResolution(setting.value);

        if (parsedGrid === null) {
          warn(lineNumber, "invalid-setting", `${setting.originalKey}: "${setting.value}" is not a valid grid value; using Grid ${nextGridResolution}.`);
        } else if (parsedGrid !== 16 && parsedGrid !== 32) {
          warn(lineNumber, "invalid-setting", `${setting.originalKey}: ${parsedGrid} is unsupported; using Grid ${nextGridResolution}.`);
        }

        gridResolution = parseGridResolution(setting.value);
      } else {
        metadata.push(`${setting.originalKey}: ${setting.value}`);
      }

      return;
    }

    const measureRepeat = parseMeasureRepeatLine(line);

    if (measureRepeat) {
      const settings = resolvedSystemSettings[sourceSectionIndex] ?? mainSettings;
      const repeatResult = appendMeasureRepeat(
        currentRows,
        currentSticking,
        currentRepeats,
        barHistory,
        measureRepeat,
        settings.timeSignature
      );

      if (repeatResult.status === "missing") {
        warn(lineNumber, "repeat-without-previous-bar", "Repeat notation needs a previous bar; this line is preserved as metadata.");
        metadata.push(line);
      } else if (repeatResult.status === "meter-mismatch") {
        warn(
          lineNumber,
          "repeat-meter-mismatch",
          `Repeat notation cannot copy the previous ${repeatResult.previousTimeSignature} bar into a ${settings.timeSignature} system; this line is preserved as metadata.`
        );
        metadata.push(line);
      } else {
        currentSticking = repeatResult.sticking;
      }

      return;
    }

    const sticking = parseStickingRowInput(line);

    if (sticking) {
      warnForUnsupportedStickingCharacters(line, lineNumber, warn);
      const parsedSticking = { ...sticking, lineNumber };
      currentSticking =
        currentRepeats.length > 0
          ? appendStickingAfterRepeat(currentRows, currentSticking, currentRepeats.length, parsedSticking)
          : parsedSticking;
      return;
    }

    const row = parseDrumRowInput(line);

    if (row) {
      warnForUnsupportedPatternCharacters(line, row.label, lineNumber, warn);
      const parsedRow = { ...row, lineNumber };

      if (currentRepeats.length > 0) {
        appendRowAfterRepeat(currentRows, currentSticking, currentRepeats.length, parsedRow);
      } else {
        currentRows.push(parsedRow);
      }
    } else {
      warnForUnparsedPipeLine(line, lineNumber, warn);
      metadata.push(line);
    }
  });

  pushCurrentBar();

  const preparedRhythms = prepareTupletRhythms(
    rowSections,
    stickingSections,
    systemSettingsSections,
    gridResolution,
    warn
  );

  warnForRowLengthMismatches(
    rowSections,
    stickingSections,
    systemSettingsSections,
    gridResolution,
    warn,
    preparedRhythms.tupletSourceSegments
  );
  const effectiveMainSettings = systemSettingsSections[0] ?? mainSettings;

  const block = finalizeDrumBlock(
    {
      tempo,
      timeSignature: effectiveMainSettings.timeSignature,
      ...(effectiveMainSettings.beamGrouping ? { beamGrouping: [...effectiveMainSettings.beamGrouping] } : {}),
      repeatCount,
      showCursor,
      showHighlight,
      showRests,
      voicing,
      legendMode,
      gridResolution,
      metadata
    },
    rowSections,
    repeatSections,
    stickingSections,
    subtitleSections,
    preparedRhythms.rhythmSections,
    preparedRhythms.containsTupletSyntax,
    systemSettingsSections
  );

  warnings.sort((left, right) =>
    left.line - right.line || (left.column ?? 0) - (right.column ?? 0)
  );

  return { block, warnings };
}

function resolveSystemSettings(
  source: string,
  warn: (line: number, code: ParseWarningCode, message: string, column?: number) => void
): ResolvedSystemSettings[] {
  interface SettingDeclaration {
    value: string;
    line: number;
    originalKey: string;
  }

  interface SourceSectionSettings {
    timeDeclarations: SettingDeclaration[];
    groupingDeclarations: SettingDeclaration[];
  }

  const sections: SourceSectionSettings[] = [{ timeDeclarations: [], groupingDeclarations: [] }];
  let sectionIndex = 0;
  let hasPlayableContent = false;

  source.split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();

    if (line.length === 0) {
      return;
    }

    if (isBarSeparator(line)) {
      sectionIndex++;
      sections[sectionIndex] = { timeDeclarations: [], groupingDeclarations: [] };
      hasPlayableContent = false;
      return;
    }

    const setting = parseSettingLine(line);

    if (setting && (
      setting.key === "time" ||
      setting.key === "timesignature" ||
      setting.key === "meter" ||
      setting.key === "grouping"
    )) {
      const declaration = {
        value: setting.value,
        line: lineIndex + 1,
        originalKey: setting.originalKey
      };

      if (hasPlayableContent) {
        warn(
          declaration.line,
          "late-system-setting",
          `${setting.originalKey}: applies to this entire system and following systems; place it immediately after Bar for clarity.`
        );
      }

      if (setting.key === "grouping") {
        sections[sectionIndex].groupingDeclarations.push(declaration);
      } else {
        sections[sectionIndex].timeDeclarations.push(declaration);
      }

      return;
    }

    if (parseMeasureRepeatLine(line) || parseStickingRowInput(line) || parseDrumRowInput(line)) {
      hasPlayableContent = true;
    }
  });

  let inherited: DrumSystemSettings = { timeSignature: DEFAULT_TIME_SIGNATURE };

  return sections.map((section, sourceSectionIndex): ResolvedSystemSettings => {
    let timeSignature = inherited.timeSignature;
    let beamGrouping = inherited.beamGrouping ? [...inherited.beamGrouping] : undefined;
    let hasValidTimeDeclaration = false;

    section.timeDeclarations.forEach((declaration) => {
      if (!isValidTimeSignatureSetting(declaration.value)) {
        warn(
          declaration.line,
          "invalid-setting",
          `${declaration.originalKey}: "${declaration.value}" is not a valid time signature; keeping ${timeSignature}.`
        );
        return;
      }

      timeSignature = parseTimeSignature(declaration.value);
      beamGrouping = undefined;
      hasValidTimeDeclaration = true;
    });

    const groupingDeclaration = section.groupingDeclarations[section.groupingDeclarations.length - 1];

    if (groupingDeclaration) {
      if (normalizeLabel(groupingDeclaration.value) === "auto") {
        beamGrouping = undefined;
      } else {
        const result = parseBeamGrouping(groupingDeclaration.value, timeSignature);

        if (result.error) {
          warn(
            groupingDeclaration.line,
            "invalid-setting",
            `${groupingDeclaration.originalKey}: ${result.error}`
          );
          beamGrouping = undefined;
        } else {
          beamGrouping = result.grouping;
        }
      }
    } else if (hasValidTimeDeclaration) {
      beamGrouping = undefined;
    }

    // Defensively drop model-derived grouping that cannot apply to the resolved meter.
    if (beamGrouping && parseBeamGrouping(beamGrouping.join("+"), timeSignature).error) {
      beamGrouping = undefined;
    }

    inherited = {
      timeSignature,
      ...(beamGrouping ? { beamGrouping: [...beamGrouping] } : {})
    };

    return {
      ...cloneSystemSettings(inherited),
      sourceSectionIndex
    };
  });
}

function cloneSystemSettings(settings: DrumSystemSettings): DrumSystemSettings {
  return {
    timeSignature: settings.timeSignature,
    ...(settings.beamGrouping ? { beamGrouping: [...settings.beamGrouping] } : {})
  };
}

// Assembles the structural model (systems -> bars -> rows -> slots) from a
// header plus per-system row inputs. parseDrumBlock builds the inputs from
// text; the editor builds them from an existing block. Routing both through
// one builder keeps slots, patterns, and bar widths consistent by construction.
export function finalizeDrumBlock(
  header: DrumBlockHeader,
  rowSections: DrumRowInput[][],
  repeatSections: Array<Array<MeasureRepeatInput | undefined>> = [],
  stickingSections: Array<DrumStickingInput | undefined> = [],
  subtitleSections: Array<string | undefined> = [],
  rhythmSections: Array<Array<DrumRhythmRegion[] | undefined>> = [],
  containsTupletSyntax = false,
  systemSettingsSections: DrumSystemSettings[] = []
): DrumBlock {
  const systems = buildSystems(
    header,
    rowSections,
    repeatSections,
    stickingSections,
    subtitleSections,
    rhythmSections,
    systemSettingsSections
  );
  const bars: DrumBar[] = [];
  const rows: DrumRow[] = [];
  const slots: DrumSlot[] = [];

  for (const system of systems) {
    for (const bar of system.bars) {
      bars.push(bar);
      rows.push(...bar.rows);
      slots.push(...bar.slots);
    }
  }

  return {
    ...header,
    systems,
    bars,
    rows,
    slots,
    containsTupletSyntax
  };
}

function isBarSeparator(line: string): boolean {
  return /^(new\s+)?(bar|measure)\b(\s+\d+)?\s*:?.*$/i.test(line);
}

function parseSubtitleLine(line: string): string | null {
  const match = /^subtitle\s*:\s*(.*)$/i.exec(line);

  return match ? match[1].trim() : null;
}

function parseMeasureRepeatLine(line: string): MeasureRepeatInput | null {
  const percentMatch = /^%(?:\s*x\s*(\d+))?$/i.exec(line);

  if (percentMatch) {
    return { type: 1, count: parseMeasureRepeatCount(percentMatch[1]) };
  }

  const textMatch = /^repeat(?:\s+(?:bar|measure|previous\s+(?:bar|measure)|1(?:[-\s]*(?:bar|measure))?|one(?:[-\s]*(?:bar|measure))?))?(?:\s*x\s*(\d+))?$/i.exec(line);

  if (!textMatch) {
    return null;
  }

  return { type: 1, count: parseMeasureRepeatCount(textMatch[1]) };
}

function parseSettingLine(line: string): { key: string; originalKey: string; value: string } | null {
  const match = /^([A-Za-z][A-Za-z\s-]*):\s*(.+)$/.exec(line);

  if (!match) {
    return null;
  }

  const originalKey = match[1].trim();
  const key = normalizeLabel(originalKey);
  const value = match[2].trim();

  if (!SETTING_KEYS.has(key)) {
    return null;
  }

  return { key, originalKey, value };
}

function parseRemovedSettingLine(line: string): { originalKey: string; value: string } | null {
  const match = /^([A-Za-z][A-Za-z\s-]*):\s*(.*)$/.exec(line);

  if (!match) {
    return null;
  }

  const originalKey = match[1].trim();

  if (!REMOVED_SETTING_KEYS.has(normalizeLabel(originalKey))) {
    return null;
  }

  return { originalKey, value: match[2].trim() };
}

function parseEmptyKnownSettingLine(line: string): { originalKey: string } | null {
  const match = /^([A-Za-z][A-Za-z\s-]*):\s*$/.exec(line);

  if (!match) {
    return null;
  }

  const originalKey = match[1].trim();

  if (!DIAGNOSTIC_SETTING_KEYS.has(normalizeLabel(originalKey))) {
    return null;
  }

  return { originalKey };
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

function parseStickingRowInput(line: string): DrumStickingInput | null {
  const dividerIndex = line.indexOf("|");

  if (dividerIndex <= 0) {
    return null;
  }

  const label = line.slice(0, dividerIndex).trim();

  if (!STICKING_LABELS.has(normalizeLabel(label))) {
    return null;
  }

  const patterns = line
    .slice(dividerIndex + 1)
    .split("|")
    .map((pattern) => pattern.replace(/\s+/g, "").trim())
    .filter((pattern) => pattern.length > 0);

  if (!label || patterns.length === 0) {
    return null;
  }

  return { label, patterns };
}

function warnForUnparsedPipeLine(
  line: string,
  lineNumber: number,
  warn: (line: number, code: ParseWarningCode, message: string, column?: number) => void
): void {
  const dividerIndex = line.indexOf("|");

  if (dividerIndex <= 0) {
    return;
  }

  const label = line.slice(0, dividerIndex).trim();

  if (!label || label.includes(":")) {
    return;
  }

  const normalizedLabel = normalizeLabel(label);
  const isKnownInstrument = INSTRUMENTS_BY_ALIAS.has(normalizedLabel);
  const isKnownSticking = STICKING_LABELS.has(normalizedLabel);
  const patterns = line
    .slice(dividerIndex + 1)
    .split("|")
    .map((pattern) => pattern.replace(/\s+/g, "").trim())
    .filter((pattern) => pattern.length > 0);

  if ((isKnownInstrument || isKnownSticking) && patterns.length === 0) {
    warn(lineNumber, "empty-row", `${label} row has no usable pattern and is preserved as metadata.`, dividerIndex + 1);
    return;
  }

  if (!isKnownInstrument && !isKnownSticking) {
    warn(lineNumber, "unknown-row-label", `Unrecognized instrument row "${label}" is preserved as metadata.`, 1);
  }
}

function warnForUnsupportedPatternCharacters(
  line: string,
  label: string,
  lineNumber: number,
  warn: (line: number, code: ParseWarningCode, message: string, column?: number) => void
): void {
  warnForUnsupportedRowCharacters(line, lineNumber, (char) => !isSupportedHitChar(char), (char, column) => {
    warn(lineNumber, "unsupported-pattern-character", `${label} row contains unsupported character "${char}"; it will play as a normal hit.`, column);
  });
}

function warnForUnsupportedStickingCharacters(
  line: string,
  lineNumber: number,
  warn: (line: number, code: ParseWarningCode, message: string, column?: number) => void
): void {
  warnForUnsupportedRowCharacters(line, lineNumber, isUnsupportedStickingChar, (char, column) => {
    warn(lineNumber, "unsupported-sticking-character", `Sticking row contains unsupported character "${char}"; it will be treated as a rest.`, column);
  });
}

function warnForUnsupportedRowCharacters(
  line: string,
  lineNumber: number,
  isUnsupported: (char: string) => boolean,
  emit: (char: string, column: number) => void
): void {
  const dividerIndex = line.indexOf("|");

  if (dividerIndex < 0) {
    return;
  }

  const seen = new Set<string>();
  const containsTupletSyntax = containsTupletLikeSyntax(line.slice(dividerIndex + 1));

  for (let index = dividerIndex + 1; index < line.length; index++) {
    const char = line[index];

    if (containsTupletSyntax && /[0-9()/@]/.test(char)) {
      continue;
    }

    if (char === "|" || /\s/.test(char) || seen.has(char) || !isUnsupported(char)) {
      continue;
    }

    seen.add(char);
    emit(char, index + 1);
  }
}

function prepareTupletRhythms(
  rowSections: ParsedDrumRowInput[][],
  stickingSections: Array<ParsedDrumStickingInput | undefined>,
  systemSettingsSections: DrumSystemSettings[],
  gridResolution: GridResolution,
  warn: (line: number, code: ParseWarningCode, message: string, column?: number) => void
): PreparedRhythmSections {
  const rhythmSections: Array<Array<DrumRhythmRegion[] | undefined>> = [];
  const tupletSourceSegments: Array<ReadonlySet<number>> = [];
  let containsTupletSyntax = false;

  rowSections.forEach((rows, systemIndex) => {
    const timeSignature = systemSettingsSections[systemIndex]?.timeSignature ?? DEFAULT_TIME_SIGNATURE;
    const sticking = stickingSections[systemIndex];
    const segmentCount = Math.max(
      0,
      ...rows.map((row) => row.patterns.length),
      sticking?.patterns.length ?? 0
    );
    const systemRhythms: Array<DrumRhythmRegion[] | undefined> = [];
    const sourceSegments = new Set<number>();

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      const entries = [
        ...rows
          .filter((row) => row.patterns[segmentIndex] !== undefined)
          .map((row) => ({
            kind: "row" as const,
            pattern: row.patterns[segmentIndex],
            line: row.segmentLineNumbers?.get(segmentIndex) ?? row.lineNumber,
            assign: (pattern: string) => {
              row.patterns[segmentIndex] = pattern;
            }
          })),
        ...(sticking?.patterns[segmentIndex] !== undefined
          ? [{
              kind: "sticking" as const,
              pattern: sticking.patterns[segmentIndex],
              line: sticking.segmentLineNumbers?.get(segmentIndex) ?? sticking.lineNumber,
              assign: (pattern: string) => {
                sticking.patterns[segmentIndex] = pattern;
              }
            }]
          : [])
      ];
      const analyses = entries.map((entry) => ({
        entry,
        analysis: analyzeTupletPattern(entry.pattern, timeSignature, gridResolution)
      }));
      const segmentContainsTupletSyntax = analyses.some(({ analysis }) => analysis.containsTupletSyntax);

      if (!segmentContainsTupletSyntax) {
        analyses.forEach(({ entry }) => {
          if (entry.kind === "sticking") {
            entry.assign(normalizeStickingPattern(entry.pattern));
          }
        });
        continue;
      }

      containsTupletSyntax = true;
      sourceSegments.add(segmentIndex);
      analyses.forEach(({ entry, analysis }) => {
        analysis.issues.forEach((issue) => {
          warn(
            entry.line,
            issue.code,
            `${entry.kind === "sticking" ? "Sticking row" : "Row"} bar ${segmentIndex + 1}: ${issue.message}`
          );
        });
      });

      const validAnalyses = analyses.filter(({ analysis }) => analysis.issues.length === 0);
      const expectedSignature = validAnalyses[0]
        ? rhythmSignature(validAnalyses[0].analysis.regions)
        : null;
      const mismatches = expectedSignature === null
        ? []
        : validAnalyses.filter(
            ({ analysis }) => rhythmSignature(analysis.regions) !== expectedSignature
          );

      mismatches.forEach(({ entry }) => {
        warn(
          entry.line,
          "tuplet-mismatch",
          `${entry.kind === "sticking" ? "Sticking row" : "Row"} bar ${segmentIndex + 1} does not match the tuplet structure or duration form declared by the other rows; use the same written-beat or @ duration syntax across rows. Using plain-grid fallback for this bar.`
        );
      });

      const invalid = validAnalyses.length !== analyses.length || mismatches.length > 0;

      if (invalid) {
        analyses.forEach(({ entry }) => {
          const flattened = flattenTupletSyntax(entry.pattern);
          entry.assign(entry.kind === "sticking" ? normalizeStickingPattern(flattened) : flattened);
        });
        continue;
      }

      analyses.forEach(({ entry, analysis }) => {
        entry.assign(
          entry.kind === "sticking"
            ? normalizeStickingPattern(analysis.decodedPattern)
            : analysis.decodedPattern
        );
      });
      systemRhythms[segmentIndex] = validAnalyses[0].analysis.regions.map((region) => ({
        ...region
      }));
    }

    rhythmSections[systemIndex] = systemRhythms;
    tupletSourceSegments[systemIndex] = sourceSegments;
  });

  return {
    rhythmSections,
    tupletSourceSegments,
    containsTupletSyntax
  };
}

function isUnsupportedStickingChar(char: string): boolean {
  return !isRest(char) && !["R", "r", "L", "l", "B", "b"].includes(char);
}

function warnForRowLengthMismatches(
  rowSections: ParsedDrumRowInput[][],
  stickingSections: Array<ParsedDrumStickingInput | undefined>,
  systemSettingsSections: DrumSystemSettings[],
  gridResolution: GridResolution,
  warn: (line: number, code: ParseWarningCode, message: string, column?: number) => void,
  skippedSegments: Array<ReadonlySet<number>> = []
): void {
  rowSections.forEach((rows, systemIndex) => {
    const timeSignature = systemSettingsSections[systemIndex]?.timeSignature ?? DEFAULT_TIME_SIGNATURE;
    const expectedSlots = getSlotsPerBar(timeSignature, gridResolution);
    const nearFullThreshold = Math.floor(expectedSlots * 0.75);
    const sticking = stickingSections[systemIndex];
    const entries: RowLengthWarningEntry[] = rows.map((row): RowLengthWarningEntry => ({
      label: row.label,
      patterns: row.patterns,
      lineNumber: row.lineNumber,
      kind: "row",
      generatedSegments: row.generatedSegments,
      segmentLineNumbers: row.segmentLineNumbers
    }));

    if (sticking) {
      entries.push({
        label: sticking.label,
        patterns: sticking.patterns,
        lineNumber: sticking.lineNumber,
        kind: "sticking",
        generatedSegments: sticking.generatedSegments,
        segmentLineNumbers: sticking.segmentLineNumbers
      });
    }

    const segmentCount = Math.max(0, ...entries.map((entry) => entry.patterns.length));

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      if (skippedSegments[systemIndex]?.has(segmentIndex)) {
        continue;
      }

      const presentEntries = entries
        .map((entry) => {
          const pattern = entry.patterns[segmentIndex];

          if (pattern === undefined || entry.generatedSegments?.has(segmentIndex)) {
            return null;
          }

          return {
            ...entry,
            pattern,
            length: pattern.length
          };
        })
        .filter((entry): entry is RowLengthWarningEntry & { pattern: string; length: number } => entry !== null);
      const hasExpectedLengthEntry = presentEntries.some((entry) => entry.length === expectedSlots);

      presentEntries.forEach((entry) => {
        if (entry.length === expectedSlots) {
          return;
        }

        if (entry.length < nearFullThreshold && !hasExpectedLengthEntry) {
          return;
        }

        const effect =
          entry.length > expectedSlots
            ? "Extra slots extend the bar and can change playback feel."
            : "Missing slots are treated as rests when another row sets the bar length.";
        const label = entry.kind === "sticking" ? "Sticking row" : `${entry.label} row`;

        warn(
          entry.segmentLineNumbers?.get(segmentIndex) ?? entry.lineNumber,
          "row-length-mismatch",
          `${label} bar ${segmentIndex + 1} has ${entry.length} slots; Time ${timeSignature} + Grid ${gridResolution} expects ${expectedSlots}. ${effect}`
        );
      });
    }
  });
}

function buildSystems(
  header: DrumBlockHeader,
  rowSections: DrumRowInput[][],
  repeatSections: Array<Array<MeasureRepeatInput | undefined>>,
  stickingSections: Array<DrumStickingInput | undefined>,
  subtitleSections: Array<string | undefined>,
  rhythmSections: Array<Array<DrumRhythmRegion[] | undefined>>,
  systemSettingsSections: DrumSystemSettings[]
): DrumSystem[] {
  let startSlot = 0;
  let startQuarter = 0;

  return rowSections.map((rowInputs, systemIndex) => {
    const settings = systemSettingsSections[systemIndex] ?? header;
    const timeSignature = settings.timeSignature;
    const beamGrouping = settings.beamGrouping && !parseBeamGrouping(settings.beamGrouping.join("+"), timeSignature).error
      ? [...settings.beamGrouping]
      : undefined;
    const stickingInput = stickingSections[systemIndex];
    const segmentCount = Math.max(1, getSegmentCount(rowInputs, stickingInput));
    const bars = Array.from({ length: segmentCount }, (_, segmentIndex) => {
      const rows = buildRowsForSegment(rowInputs, segmentIndex);
      const stickingPattern = stickingInput?.patterns[segmentIndex];
      const positionCount = Math.max(
        0,
        ...rows.map((row) => row.pattern.length),
        stickingPattern?.length ?? 0
      );
      const rhythmRegions =
        rhythmSections[systemIndex]?.[segmentIndex]?.map((region) => ({ ...region })) ??
        buildPlainRhythmRegions(positionCount, timeSignature, header.gridResolution);
      const durationQuarter = rhythmRegions.length > 0
        ? Math.max(...rhythmRegions.map(getRegionEndQuarter))
        : 0;
      const slots = buildSlots(rows, startSlot, startQuarter, rhythmRegions, stickingPattern);
      const measureRepeat = repeatSections[systemIndex]?.[segmentIndex];
      const bar = {
        timeSignature,
        rows,
        slots,
        startSlot,
        startQuarter,
        durationQuarter,
        rhythmRegions,
        ...(stickingPattern !== undefined ? { stickingPattern } : {}),
        ...(measureRepeat ? { measureRepeat: measureRepeat.type } : {}),
        ...(measureRepeat && measureRepeat.count > 1 ? { measureRepeatCount: measureRepeat.count } : {})
      };
      startSlot += slots.length;
      startQuarter += durationQuarter;

      return bar;
    });

    const subtitle = subtitleSections[systemIndex]?.trim();

    return {
      timeSignature,
      ...(beamGrouping ? { beamGrouping } : {}),
      bars,
      ...(subtitle ? { subtitle } : {})
    };
  });
}

type AppendMeasureRepeatResult =
  | { status: "ok"; sticking: ParsedDrumStickingInput | undefined }
  | { status: "missing" }
  | { status: "meter-mismatch"; previousTimeSignature: string };

function appendMeasureRepeat(
  currentRows: ParsedDrumRowInput[],
  currentSticking: ParsedDrumStickingInput | undefined,
  currentRepeats: Array<MeasureRepeatInput | undefined>,
  barHistory: BarSnapshot[],
  measureRepeat: MeasureRepeatInput,
  timeSignature: string
): AppendMeasureRepeatResult {
  syncRepeatMarkers(currentRows, currentSticking, currentRepeats);

  const previousBars = [...barHistory, ...snapshotBars(currentRows, currentSticking, timeSignature)];
  const previousBar = previousBars[previousBars.length - 1];

  if (!previousBar) {
    return { status: "missing" };
  }

  if (previousBar.timeSignature !== timeSignature) {
    return {
      status: "meter-mismatch",
      previousTimeSignature: previousBar.timeSignature
    };
  }

  let nextSticking = currentSticking;

  for (let index = 0; index < measureRepeat.count; index++) {
    nextSticking = appendSnapshotBar(currentRows, nextSticking, previousBar);
    currentRepeats.push({
      type: measureRepeat.type,
      count: index === 0 ? measureRepeat.count : 1
    });
  }

  return { status: "ok", sticking: nextSticking };
}

function appendRowAfterRepeat(
  currentRows: ParsedDrumRowInput[],
  currentSticking: ParsedDrumStickingInput | undefined,
  targetBarIndex: number,
  source: ParsedDrumRowInput
): void {
  const widths = getBarWidths(currentRows, currentSticking);
  let target = currentRows.find((candidate) => candidate.instrument.id === source.instrument.id);

  if (!target) {
    target = {
      label: source.label,
      patterns: [],
      instrument: source.instrument,
      lineNumber: source.lineNumber
    };
    currentRows.push(target);
  }

  while (target.patterns.length < targetBarIndex) {
    const segmentIndex = target.patterns.length;
    const reference = getReferencePattern(currentRows, currentSticking, segmentIndex);

    target.patterns.push(
      reference
        ? makeRestPattern(reference)
        : "-".repeat(widths[segmentIndex] ?? patternPositionCount(source.patterns[0] ?? ""))
    );
    markGeneratedSegment(target, target.patterns.length - 1);
  }

  source.patterns.forEach((pattern) => {
    const segmentIndex = target.patterns.length;

    target.patterns.push(pattern);
    markSourceSegment(target, segmentIndex, source.lineNumber);
  });
}

function appendStickingAfterRepeat(
  currentRows: ParsedDrumRowInput[],
  currentSticking: ParsedDrumStickingInput | undefined,
  targetBarIndex: number,
  source: ParsedDrumStickingInput
): ParsedDrumStickingInput {
  const widths = getBarWidths(currentRows, currentSticking);
  const target = currentSticking ?? {
    label: source.label,
    patterns: [],
    lineNumber: source.lineNumber
  };

  while (target.patterns.length < targetBarIndex) {
    const segmentIndex = target.patterns.length;
    const reference = getReferencePattern(currentRows, currentSticking, segmentIndex);

    target.patterns.push(
      reference
        ? makeRestPattern(reference)
        : "-".repeat(widths[segmentIndex] ?? patternPositionCount(source.patterns[0] ?? ""))
    );
    markGeneratedSegment(target, target.patterns.length - 1);
  }

  source.patterns.forEach((pattern) => {
    const segmentIndex = target.patterns.length;

    target.patterns.push(pattern);
    markSourceSegment(target, segmentIndex, source.lineNumber);
  });

  return target;
}

function appendSnapshotBar(
  currentRows: ParsedDrumRowInput[],
  currentSticking: ParsedDrumStickingInput | undefined,
  snapshot: BarSnapshot
): ParsedDrumStickingInput | undefined {
  const targetBarIndex = getSegmentCount(currentRows, currentSticking);
  const widths = getBarWidths(currentRows, currentSticking);

  snapshot.rows.forEach((snapshotRow) => {
    let row = currentRows.find((candidate) => candidate.instrument.id === snapshotRow.instrument.id);

    if (!row) {
      row = {
        label: snapshotRow.label,
        patterns: [],
        instrument: snapshotRow.instrument,
        lineNumber: 0
      };
      currentRows.push(row);
    }

    while (row.patterns.length < targetBarIndex) {
      const segmentIndex = row.patterns.length;
      const reference = getReferencePattern(currentRows, currentSticking, segmentIndex);

      row.patterns.push(
        reference
          ? makeRestPattern(reference)
          : "-".repeat(widths[segmentIndex] ?? snapshot.width)
      );
      markGeneratedSegment(row, row.patterns.length - 1);
    }

    row.patterns.push(snapshotRow.pattern);
    markGeneratedSegment(row, row.patterns.length - 1);
  });

  if (snapshot.stickingPattern !== undefined) {
    const nextSticking = currentSticking ?? { label: "ST", patterns: [], lineNumber: 0 };

    while (nextSticking.patterns.length < targetBarIndex) {
      const segmentIndex = nextSticking.patterns.length;
      const reference = getReferencePattern(currentRows, nextSticking, segmentIndex);

      nextSticking.patterns.push(
        reference
          ? makeRestPattern(reference)
          : "-".repeat(widths[segmentIndex] ?? snapshot.width)
      );
      markGeneratedSegment(nextSticking, nextSticking.patterns.length - 1);
    }

    nextSticking.patterns.push(snapshot.stickingPattern);
    markGeneratedSegment(nextSticking, nextSticking.patterns.length - 1);
    return nextSticking;
  }

  return currentSticking;
}

function markGeneratedSegment(target: DrumRowInput | DrumStickingInput, segmentIndex: number): void {
  const candidate = target as (DrumRowInput | DrumStickingInput) & { generatedSegments?: Set<number> };
  const generatedSegments = candidate.generatedSegments ?? new Set<number>();

  generatedSegments.add(segmentIndex);
  candidate.generatedSegments = generatedSegments;
}

function markSourceSegment(
  target: ParsedDrumRowInput | ParsedDrumStickingInput,
  segmentIndex: number,
  lineNumber: number
): void {
  const segmentLineNumbers = new Map(target.segmentLineNumbers ?? []);

  segmentLineNumbers.set(segmentIndex, lineNumber);
  target.segmentLineNumbers = segmentLineNumbers;
}

function syncRepeatMarkers(
  rows: DrumRowInput[],
  sticking: DrumStickingInput | undefined,
  repeats: Array<MeasureRepeatInput | undefined>
): void {
  const segmentCount = getSegmentCount(rows, sticking);

  while (repeats.length < segmentCount) {
    repeats.push(undefined);
  }
}

function parseMeasureRepeatCount(value: string | undefined): number {
  const count = value ? Number.parseInt(value, 10) : 1;

  if (!Number.isFinite(count)) {
    return 1;
  }

  return Math.min(MAX_MEASURE_REPEAT_COUNT, Math.max(1, count));
}

function snapshotBars(
  rows: DrumRowInput[],
  sticking: DrumStickingInput | undefined,
  timeSignature: string
): BarSnapshot[] {
  const segmentCount = getSegmentCount(rows, sticking);
  const widths = getBarWidths(rows, sticking);

  return Array.from({ length: segmentCount }, (_, segmentIndex) => ({
    rows: rows
      .map((row): BarSnapshotRow | null => {
        const pattern = row.patterns[segmentIndex];

        if (!pattern) {
          return null;
        }

        return { label: row.label, instrument: row.instrument, pattern };
      })
      .filter((row): row is BarSnapshotRow => row !== null),
    ...(sticking?.patterns[segmentIndex] !== undefined ? { stickingPattern: sticking.patterns[segmentIndex] } : {}),
    width: widths[segmentIndex] ?? 0,
    timeSignature
  }));
}

function getSegmentCount(rows: DrumRowInput[], sticking?: DrumStickingInput): number {
  return Math.max(0, ...rows.map((row) => row.patterns.length), sticking?.patterns.length ?? 0);
}

function getBarWidths(rows: DrumRowInput[], sticking?: DrumStickingInput): number[] {
  const segmentCount = getSegmentCount(rows, sticking);

  return Array.from({ length: segmentCount }, (_, segmentIndex) =>
    Math.max(
      0,
      ...rows.map((row) => patternPositionCount(row.patterns[segmentIndex] ?? "")),
      patternPositionCount(sticking?.patterns[segmentIndex] ?? "")
    )
  );
}

function patternPositionCount(pattern: string): number {
  return Array.from(flattenTupletSyntax(pattern)).length;
}

function getReferencePattern(
  rows: DrumRowInput[],
  sticking: DrumStickingInput | undefined,
  segmentIndex: number
): string | undefined {
  return rows.find((row) => row.patterns[segmentIndex] !== undefined)?.patterns[segmentIndex] ??
    sticking?.patterns[segmentIndex];
}

function makeRestPattern(pattern: string): string {
  return Array.from(pattern)
    .map((char) => /[0-9()/]/.test(char) ? char : "-")
    .join("");
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

function buildSlots(
  rows: DrumRow[],
  startSlot: number,
  barStartQuarter: number,
  rhythmRegions: DrumRhythmRegion[],
  stickingPattern?: string
): DrumSlot[] {
  const slotCount = Math.max(0, ...rows.map((row) => row.pattern.length), stickingPattern?.length ?? 0);

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
    const sticking = getSticking(stickingPattern?.[index] ?? "-");
    const regionIndex = rhythmRegions.findIndex(
      (region) =>
        index >= region.startPosition &&
        index < region.startPosition + region.positionCount
    );
    const region = rhythmRegions[Math.max(0, regionIndex)];
    const positionInRegion = region ? index - region.startPosition : 0;
    const positionDuration = region && region.positionCount > 0
      ? region.durationQuarter / region.positionCount
      : 4 / 16;

    return {
      index: startSlot + index,
      hits,
      startQuarter:
        barStartQuarter +
        (region?.startQuarter ?? index * positionDuration) +
        positionInRegion * positionDuration,
      durationQuarter: positionDuration,
      regionIndex: Math.max(0, regionIndex),
      ...(sticking ? { sticking } : {})
    };
  });
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

function getSticking(value: string): StickingHand | undefined {
  if (value === "R") {
    return "right";
  }

  if (value === "L") {
    return "left";
  }

  if (value === "B") {
    return "both";
  }

  return undefined;
}

export function getTitle(block: DrumBlock): string {
  const title = block.metadata.find((line) => normalizeLabel(line.split(":")[0] ?? "") === "title");

  if (!title) {
    return "Drum notation";
  }

  return title.slice(title.indexOf(":") + 1).trim() || "Drum notation";
}

function isValidTimeSignatureSetting(value: string): boolean {
  return /^(\d{1,2})\s*\/\s*(\d{1,2})$/.test(value);
}

function parseTimeSignature(value: string): string {
  const match = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(value);

  if (!match) {
    return DEFAULT_TIME_SIGNATURE;
  }

  return `${match[1]}/${match[2]}`;
}

function parseBeamGrouping(
  value: string,
  timeSignature: string
): { grouping?: number[]; error?: string } {
  if (!/^\d+(?:\s*\+\s*\d+)*$/.test(value)) {
    return {
      error: `"${value}" must contain positive whole numbers joined with +, such as 2+2+3; using normal meter grouping.`
    };
  }

  const grouping = value.split("+").map((part) => Number.parseInt(part.trim(), 10));

  if (grouping.some((group) => group <= 0)) {
    return {
      error: `"${value}" must contain only positive group sizes; using normal meter grouping.`
    };
  }

  const match = /^(\d+)\/(\d+)$/.exec(timeSignature);
  const numerator = match ? Number.parseInt(match[1], 10) : 4;
  const denominator = match ? Number.parseInt(match[2], 10) : 4;

  if (denominator !== 8 && denominator !== 16) {
    return {
      error: `is supported only for /8 and /16 meters; Time ${timeSignature} uses /${denominator}. Using normal meter grouping.`
    };
  }

  const total = grouping.reduce((sum, group) => sum + group, 0);

  if (total !== numerator) {
    return {
      error: `"${value}" totals ${total}, but Time ${timeSignature} requires ${numerator}; using normal meter grouping.`
    };
  }

  return { grouping };
}

function parseRepeatSettingValue(value: string): number | null {
  const match = /(\d+)/.exec(value);

  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function parseRepeatCount(value: string): number {
  const count = parseRepeatSettingValue(value);

  if (count === null) {
    return DEFAULT_REPEAT_COUNT;
  }

  return Math.min(64, Math.max(1, count));
}

function isBooleanSettingValue(value: string): boolean {
  const normalized = normalizeLabel(value);

  return TRUE_BOOLEAN_VALUES.has(normalized) || FALSE_BOOLEAN_VALUES.has(normalized);
}

function parseBooleanSetting(value: string, fallback: boolean): boolean {
  const normalized = normalizeLabel(value);

  if (TRUE_BOOLEAN_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_BOOLEAN_VALUES.has(normalized)) {
    return false;
  }

  return fallback;
}

function isLegendSettingValue(value: string): boolean {
  const normalized = normalizeLabel(value);

  return USED_LEGEND_VALUES.has(normalized) || ALL_LEGEND_VALUES.has(normalized) || OFF_LEGEND_VALUES.has(normalized);
}

function parseLegendMode(value: string): LegendMode {
  const normalized = normalizeLabel(value);

  if (USED_LEGEND_VALUES.has(normalized)) {
    return "used";
  }

  if (ALL_LEGEND_VALUES.has(normalized)) {
    return "all";
  }

  if (OFF_LEGEND_VALUES.has(normalized)) {
    return "off";
  }

  return DEFAULT_LEGEND_MODE;
}

function parseGridSettingValue(value: string): number | null {
  const match = /(\d+)/.exec(value);

  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function parseGridResolution(value: string): GridResolution {
  const parsedGrid = parseGridSettingValue(value);

  if (parsedGrid === null) {
    return DEFAULT_GRID_RESOLUTION;
  }

  return parsedGrid === 32 ? 32 : 16;
}

function clampTempo(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TEMPO;
  }

  return Math.min(260, Math.max(30, value));
}
