import {
  CountInCadence,
  PracticeRunMetrics,
  PracticeRunSummary,
  PracticeTarget,
  RepetitionGoalConfig,
  RepetitionGoalProgress
} from "./types";
import { MAX_TEMPO_RAMP_BPM, MIN_TEMPO_RAMP_BPM } from "./tempo-ramp";

export const DEFAULT_COUNT_IN_CADENCE: CountInCadence = "transport-start";
export const DEFAULT_REPETITION_GOAL_PASSES = 8;
export const MIN_REPETITION_GOAL_PASSES = 1;
export const MAX_REPETITION_GOAL_PASSES = 999;
export const TAP_TEMPO_RESET_MS = 2500;
export const TAP_TEMPO_MAX_INTERVALS = 5;

export interface PracticeClock {
  wallNowMs(): number;
  monotonicNowMs(): number;
}

export interface TapTempoState {
  tapTimesMs: number[];
  bpm: number | null;
}

export interface PracticeLogEntryContext {
  sourcePath: string;
  blockTitle: string;
  note?: string;
}

export interface FormattedPracticeLogEntry {
  date: string;
  markdown: string;
}

interface PracticeLogDateSection {
  date: string;
  content: string[];
}

export type PracticeLogPathResult =
  | { ok: true; path: string }
  | { ok: false; message: string };

export function createPracticeClock(): PracticeClock {
  const hasMonotonicClock = typeof performance !== "undefined" &&
    Number.isFinite(performance.timeOrigin) &&
    typeof performance.now === "function";

  return {
    wallNowMs: () => Date.now(),
    monotonicNowMs: () => hasMonotonicClock
      ? performance.timeOrigin + performance.now()
      : Date.now()
  };
}

export function normalizeCountInCadence(value: unknown): CountInCadence {
  return value === "every-pass" ? "every-pass" : DEFAULT_COUNT_IN_CADENCE;
}

export function normalizeExactTempoBpm(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(MAX_TEMPO_RAMP_BPM, Math.max(MIN_TEMPO_RAMP_BPM, Math.round(value)));
}

export function normalizePracticeTarget(
  target: PracticeTarget | null | undefined,
  barCount: number
): PracticeTarget | null {
  if (!target || barCount <= 0) return null;
  if (target.kind === "whole-notation") return { kind: "whole-notation" };
  if (target.kind === "current-bar") {
    return Number.isInteger(target.barIndex) && target.barIndex >= 0 && target.barIndex < barCount
      ? { kind: "current-bar", barIndex: target.barIndex }
      : null;
  }

  const barIndexes = [...new Set(target.barIndexes)]
    .filter((barIndex) => Number.isInteger(barIndex) && barIndex >= 0 && barIndex < barCount)
    .sort((left, right) => left - right);
  return barIndexes.length > 0 ? { kind: "selected-bars", barIndexes } : null;
}

export function normalizePracticeTargetValues(target: PracticeTarget): PracticeTarget {
  if (target.kind === "selected-bars") {
    return {
      kind: "selected-bars",
      barIndexes: [...new Set(target.barIndexes)]
        .filter((barIndex) => Number.isInteger(barIndex) && barIndex >= 0)
        .sort((left, right) => left - right)
    };
  }
  if (target.kind === "current-bar") {
    return { kind: "current-bar", barIndex: Math.max(0, Math.round(target.barIndex)) };
  }
  return { kind: "whole-notation" };
}

export function clonePracticeTarget(target: PracticeTarget): PracticeTarget {
  return target.kind === "selected-bars"
    ? { kind: "selected-bars", barIndexes: [...target.barIndexes] }
    : { ...target };
}

export function practiceTargetsEqual(left: PracticeTarget, right: PracticeTarget): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "whole-notation" && right.kind === "whole-notation") return true;
  if (left.kind === "current-bar" && right.kind === "current-bar") {
    return left.barIndex === right.barIndex;
  }
  return left.kind === "selected-bars" && right.kind === "selected-bars" &&
    arraysEqual(left.barIndexes, right.barIndexes);
}

export function formatPracticeTarget(target: PracticeTarget): string {
  if (target.kind === "whole-notation") return "Whole notation";
  if (target.kind === "current-bar") return `Bar ${target.barIndex + 1}`;

  const oneBased = target.barIndexes.map((barIndex) => barIndex + 1);
  if (oneBased.length === 0) return "Selected bars";
  const contiguous = oneBased.every((barIndex, index) => index === 0 || barIndex === oneBased[index - 1] + 1);
  if (contiguous && oneBased.length > 1) {
    return `Bars ${oneBased[0]}–${oneBased[oneBased.length - 1]}`;
  }
  if (oneBased.length === 1) return `Bar ${oneBased[0]}`;
  return `Bars ${oneBased.join(", ")}`;
}

export function createDefaultRepetitionGoalConfig(
  barCount: number,
  selectedBarIndexes: readonly number[],
  currentBarIndex: number
): RepetitionGoalConfig {
  const selectedTarget = normalizePracticeTarget(
    { kind: "selected-bars", barIndexes: [...selectedBarIndexes] },
    barCount
  );
  const currentTarget = normalizePracticeTarget(
    { kind: "current-bar", barIndex: currentBarIndex },
    barCount
  );
  return {
    target: selectedTarget ?? currentTarget ?? { kind: "whole-notation" },
    totalPasses: DEFAULT_REPETITION_GOAL_PASSES
  };
}

export function normalizeRepetitionGoalConfig(
  config: RepetitionGoalConfig | null | undefined,
  barCount?: number
): RepetitionGoalConfig | null {
  if (!config) return null;
  const target = barCount === undefined
    ? normalizePracticeTargetValues(config.target)
    : normalizePracticeTarget(config.target, barCount);
  if (!target) return null;
  return {
    target,
    totalPasses: clampInteger(config.totalPasses, MIN_REPETITION_GOAL_PASSES, MAX_REPETITION_GOAL_PASSES)
  };
}

export function normalizeRepetitionGoalProgress(
  config: RepetitionGoalConfig | null,
  progress: RepetitionGoalProgress | null | undefined
): RepetitionGoalProgress {
  if (!config) return { completedPasses: 0, completed: false };
  const completedPasses = clampInteger(progress?.completedPasses ?? 0, 0, config.totalPasses);
  return {
    completedPasses,
    completed: completedPasses >= config.totalPasses
  };
}

export function createPracticeRunMetrics(
  bpm: number,
  clock: PracticeClock
): PracticeRunMetrics {
  const normalizedBpm = normalizeExactTempoBpm(bpm) ?? MIN_TEMPO_RAMP_BPM;
  return {
    startedAtEpochMs: clock.wallNowMs(),
    elapsedActiveMs: 0,
    activeSinceClockMs: clock.monotonicNowMs(),
    startBpm: normalizedBpm,
    endBpm: normalizedBpm,
    performedPasses: 0,
    status: "running"
  };
}

export function resumePracticeRunMetrics(
  metrics: PracticeRunMetrics,
  bpm: number,
  clock: PracticeClock
): PracticeRunMetrics {
  const settled = settlePracticeRunMetrics(metrics, clock, "paused");
  return {
    ...settled,
    endBpm: normalizeExactTempoBpm(bpm) ?? settled.endBpm,
    activeSinceClockMs: clock.monotonicNowMs(),
    status: "running"
  };
}

export function settlePracticeRunMetrics(
  metrics: PracticeRunMetrics,
  clock: PracticeClock,
  status: PracticeRunMetrics["status"] = "paused"
): PracticeRunMetrics {
  const elapsed = metrics.activeSinceClockMs === null
    ? 0
    : Math.max(0, clock.monotonicNowMs() - metrics.activeSinceClockMs);
  return {
    ...metrics,
    elapsedActiveMs: metrics.elapsedActiveMs + elapsed,
    activeSinceClockMs: null,
    status
  };
}

export function recordPracticePass(
  metrics: PracticeRunMetrics,
  bpm: number
): PracticeRunMetrics {
  return {
    ...metrics,
    endBpm: normalizeExactTempoBpm(bpm) ?? metrics.endBpm,
    performedPasses: metrics.performedPasses + 1
  };
}

export function normalizePracticeRunMetrics(value: PracticeRunMetrics | null | undefined): PracticeRunMetrics | null {
  if (!value) return null;
  const startBpm = normalizeExactTempoBpm(value.startBpm) ?? MIN_TEMPO_RAMP_BPM;
  return {
    startedAtEpochMs: Math.max(0, finiteNumber(value.startedAtEpochMs)),
    elapsedActiveMs: Math.max(0, finiteNumber(value.elapsedActiveMs)),
    activeSinceClockMs: value.activeSinceClockMs === null
      ? null
      : Math.max(0, finiteNumber(value.activeSinceClockMs)),
    startBpm,
    endBpm: normalizeExactTempoBpm(value.endBpm) ?? startBpm,
    performedPasses: Math.max(0, Math.round(finiteNumber(value.performedPasses))),
    status: value.status === "running" || value.status === "complete" ? value.status : "paused"
  };
}

export function createPracticeRunSummary(
  kind: PracticeRunSummary["kind"],
  target: PracticeTarget,
  metrics: PracticeRunMetrics,
  requestedPasses: number | null,
  completed: boolean,
  clock: PracticeClock
): PracticeRunSummary {
  const settled = settlePracticeRunMetrics(metrics, clock, "complete");
  return {
    kind,
    target: clonePracticeTarget(target),
    startedAtEpochMs: settled.startedAtEpochMs,
    elapsedActiveMs: settled.elapsedActiveMs,
    startBpm: settled.startBpm,
    endBpm: settled.endBpm,
    performedPasses: settled.performedPasses,
    requestedPasses,
    completed
  };
}

export function createTapTempoState(): TapTempoState {
  return { tapTimesMs: [], bpm: null };
}

export function recordTapTempo(state: TapTempoState, nowMs: number): TapTempoState {
  const now = finiteNumber(nowMs);
  const previous = state.tapTimesMs[state.tapTimesMs.length - 1];
  const reset = previous !== undefined && (now <= previous || now - previous > TAP_TEMPO_RESET_MS);
  const tapTimesMs = [...(reset ? [] : state.tapTimesMs), now].slice(-(TAP_TEMPO_MAX_INTERVALS + 1));
  if (tapTimesMs.length < 2) return { tapTimesMs, bpm: null };

  const minimumInterval = 60000 / MAX_TEMPO_RAMP_BPM;
  const maximumInterval = 60000 / MIN_TEMPO_RAMP_BPM;
  const intervals = tapTimesMs
    .slice(1)
    .map((time, index) => time - tapTimesMs[index])
    .filter((interval) => interval >= minimumInterval && interval <= maximumInterval)
    .slice(-TAP_TEMPO_MAX_INTERVALS);
  if (intervals.length === 0) return { tapTimesMs, bpm: null };
  const averageInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
  const measured = averageInterval > 0 ? Math.round(60000 / averageInterval) : 0;
  return {
    tapTimesMs,
    bpm: measured >= MIN_TEMPO_RAMP_BPM && measured <= MAX_TEMPO_RAMP_BPM ? measured : null
  };
}

export function formatActiveSessionTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${twoDigits(seconds)}s`;
}

export function formatPracticeSummaryMarkdown(
  summary: PracticeRunSummary,
  context: PracticeLogEntryContext
): FormattedPracticeLogEntry {
  const startedAt = new Date(summary.startedAtEpochMs);
  const date = formatLocalDate(startedAt);
  const time = `${twoDigits(startedAt.getHours())}:${twoDigits(startedAt.getMinutes())}`;
  const pathWithoutExtension = collapseInlineText(context.sourcePath).replace(/\.md$/i, "");
  const source = `[[${escapeWikiLink(pathWithoutExtension)}]]`;
  const blockTitle = escapeMarkdownInline(collapseInlineText(context.blockTitle) || "Drum notation");
  const passes = summary.requestedPasses === null
    ? `${summary.performedPasses} ${summary.performedPasses === 1 ? "pass" : "passes"}`
    : `${summary.performedPasses}/${summary.requestedPasses} passes`;
  const tempo = summary.startBpm === summary.endBpm
    ? `${summary.startBpm} BPM`
    : `${summary.startBpm} → ${summary.endBpm} BPM`;
  let markdown = `- ${time} — ${source} — ${blockTitle} — ${formatPracticeTarget(summary.target)} — ${passes} — ${tempo} — ${formatActiveSessionTime(summary.elapsedActiveMs)}`;
  const note = collapseInlineText(context.note ?? "");
  if (note) markdown += `\n  - Note: ${escapeMarkdownInline(note)}`;
  return { date, markdown };
}

export function insertPracticeLogEntry(
  current: string,
  date: string,
  entryMarkdown: string
): string {
  const normalized = current.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  const lines = normalized ? normalized.split("\n") : [];
  const entryLines = trimBlankLines(entryMarkdown.replace(/\r\n?/g, "\n").split("\n"));
  const firstDateHeadingIndex = lines.findIndex((line) => parsePracticeLogDateHeading(line) !== null);

  if (firstDateHeadingIndex < 0) {
    return joinPracticeLogBlocks([
      trimBlankLines(lines),
      [`## ${date}`, "", ...entryLines]
    ]);
  }

  let datedHistoryEnd = lines.length;
  for (let index = firstDateHeadingIndex + 1; index < lines.length; index++) {
    if (/^#{1,2}\s/.test(lines[index]) && parsePracticeLogDateHeading(lines[index]) === null) {
      datedHistoryEnd = index;
      break;
    }
  }

  const sections: PracticeLogDateSection[] = [];
  const datedLines = lines.slice(firstDateHeadingIndex, datedHistoryEnd);
  for (let index = 0; index < datedLines.length;) {
    const sectionDate = parsePracticeLogDateHeading(datedLines[index]);
    if (sectionDate === null) {
      index += 1;
      continue;
    }
    let nextHeadingIndex = index + 1;
    while (
      nextHeadingIndex < datedLines.length &&
      parsePracticeLogDateHeading(datedLines[nextHeadingIndex]) === null
    ) {
      nextHeadingIndex += 1;
    }
    sections.push({
      date: sectionDate,
      content: trimBlankLines(datedLines.slice(index + 1, nextHeadingIndex))
    });
    index = nextHeadingIndex;
  }

  const matchingSections = sections.filter((section) => section.date === date);
  const retainedSections = sections.filter((section) => section.date !== date);
  const previousContent: string[] = [];
  for (const section of matchingSections) {
    if (previousContent.length > 0 && section.content.length > 0) previousContent.push("");
    previousContent.push(...section.content);
  }
  retainedSections.push({
    date,
    content: [
      ...entryLines,
      ...(previousContent.length > 0 ? ["", ...previousContent] : [])
    ]
  });
  retainedSections.sort((left, right) => {
    if (left.date === right.date) return 0;
    return left.date > right.date ? -1 : 1;
  });

  const datedBlocks = retainedSections.map((section) => [
    `## ${section.date}`,
    "",
    ...section.content
  ]);
  return joinPracticeLogBlocks([
    trimBlankLines(lines.slice(0, firstDateHeadingIndex)),
    ...datedBlocks,
    trimBlankLines(lines.slice(datedHistoryEnd))
  ]);
}

function parsePracticeLogDateHeading(line: string): string | null {
  const match = /^## (\d{4}-\d{2}-\d{2})$/.exec(line);
  return match?.[1] ?? null;
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start += 1;
  while (end > start && lines[end - 1] === "") end -= 1;
  return lines.slice(start, end);
}

function joinPracticeLogBlocks(blocks: string[][]): string {
  const content = blocks
    .filter((block) => block.length > 0)
    .map((block) => block.join("\n"))
    .join("\n\n");
  return content ? `${content}\n` : "";
}

export function normalizePracticeLogPath(value: string): PracticeLogPathResult {
  let path = value.trim().replace(/\\/g, "/");
  if (!path) return { ok: false, message: "Practice log note cannot be empty." };
  if (path.startsWith("/") || /^[A-Za-z]:\//.test(path)) {
    return { ok: false, message: "Practice log note must be vault-relative." };
  }
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..") || path.endsWith("/")) {
    return { ok: false, message: "Practice log note contains an invalid path segment." };
  }
  if (parts.some((part) => /[\0:*?"<>|]/.test(part))) {
    return { ok: false, message: "Practice log note contains invalid filename characters." };
  }
  if (!/\.md$/i.test(path)) path += ".md";
  return { ok: true, path };
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

function twoDigits(value: number): string {
  return value >= 0 && value < 10 ? `0${value}` : `${value}`;
}

function collapseInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeMarkdownInline(value: string): string {
  return value.replace(/([\\`*_{}[\]<>#])/g, "\\$1");
}

function escapeWikiLink(value: string): string {
  return value.replace(/([\\[\]|])/g, "\\$1");
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
