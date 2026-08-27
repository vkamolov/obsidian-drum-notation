import {
  DrumBlock,
  PracticeTarget,
  PracticeSelection,
  TempoRampConfig,
  TempoRampProgress
} from "./types";

export const MIN_TEMPO_RAMP_BPM = 30;
export const MAX_TEMPO_RAMP_BPM = 260;
export const MIN_TEMPO_RAMP_STEP_BPM = 1;
export const MAX_TEMPO_RAMP_STEP_BPM = 50;
export const MIN_TEMPO_RAMP_PASSES = 1;
export const MAX_TEMPO_RAMP_PASSES = 32;
export const DEFAULT_TEMPO_RAMP_STEP_BPM = 5;
export const DEFAULT_TEMPO_RAMP_PASSES = 4;
export const DEFAULT_TEMPO_RAMP_SPAN_BPM = 20;

export interface TempoRampSessionState {
  config: TempoRampConfig | null;
  progress: TempoRampProgress;
  armed: boolean;
}

export function createDefaultTempoRampConfig(
  block: DrumBlock,
  effectiveTempoBpm: number,
  selection: PracticeSelection,
  currentBarIndex: number
): TempoRampConfig {
  let startBpm = clampInteger(effectiveTempoBpm, MIN_TEMPO_RAMP_BPM, MAX_TEMPO_RAMP_BPM);
  let ceilingBpm = Math.min(MAX_TEMPO_RAMP_BPM, startBpm + DEFAULT_TEMPO_RAMP_SPAN_BPM);

  if (ceilingBpm <= startBpm) {
    startBpm = Math.max(MIN_TEMPO_RAMP_BPM, ceilingBpm - DEFAULT_TEMPO_RAMP_SPAN_BPM);
  }

  const selectedBars = normalizeBarIndexes(selection.barIndexes, block.bars.length);
  const target: PracticeTarget = selectedBars.length > 0
    ? { kind: "selected-bars", barIndexes: selectedBars }
    : {
        kind: "current-bar",
        barIndex: clampInteger(currentBarIndex, 0, Math.max(0, block.bars.length - 1))
      };

  return {
    target,
    startBpm,
    stepBpm: DEFAULT_TEMPO_RAMP_STEP_BPM,
    passesPerStep: DEFAULT_TEMPO_RAMP_PASSES,
    ceilingBpm,
    endBehavior: "hold"
  };
}

export function normalizeTempoRampConfig(
  config: TempoRampConfig | null | undefined,
  block: DrumBlock
): TempoRampConfig | null {
  const normalizedValues = normalizeTempoRampConfigValues(config);
  if (!normalizedValues || block.bars.length === 0) {
    return null;
  }

  const target = normalizeTempoRampTarget(normalizedValues.target, block.bars.length);
  if (!target) {
    return null;
  }

  return { ...normalizedValues, target };
}

export function normalizeTempoRampConfigValues(
  config: TempoRampConfig | null | undefined
): TempoRampConfig | null {
  if (!config) return null;

  const startBpm = clampInteger(config.startBpm, MIN_TEMPO_RAMP_BPM, MAX_TEMPO_RAMP_BPM);
  const ceilingBpm = clampInteger(config.ceilingBpm, MIN_TEMPO_RAMP_BPM, MAX_TEMPO_RAMP_BPM);
  if (ceilingBpm <= startBpm) {
    return null;
  }

  return {
    target: normalizeTempoRampTargetValues(config.target),
    startBpm,
    stepBpm: clampInteger(
      config.stepBpm,
      MIN_TEMPO_RAMP_STEP_BPM,
      MAX_TEMPO_RAMP_STEP_BPM
    ),
    passesPerStep: clampInteger(
      config.passesPerStep,
      MIN_TEMPO_RAMP_PASSES,
      MAX_TEMPO_RAMP_PASSES
    ),
    ceilingBpm,
    endBehavior: config.endBehavior === "stop" ? "stop" : "hold"
  };
}

export function isValidTempoRampConfigValues(config: TempoRampConfig): boolean {
  return Number.isInteger(config.startBpm) &&
    config.startBpm >= MIN_TEMPO_RAMP_BPM &&
    config.startBpm <= MAX_TEMPO_RAMP_BPM &&
    Number.isInteger(config.ceilingBpm) &&
    config.ceilingBpm >= MIN_TEMPO_RAMP_BPM &&
    config.ceilingBpm <= MAX_TEMPO_RAMP_BPM &&
    config.ceilingBpm > config.startBpm &&
    Number.isInteger(config.stepBpm) &&
    config.stepBpm >= MIN_TEMPO_RAMP_STEP_BPM &&
    config.stepBpm <= MAX_TEMPO_RAMP_STEP_BPM &&
    Number.isInteger(config.passesPerStep) &&
    config.passesPerStep >= MIN_TEMPO_RAMP_PASSES &&
    config.passesPerStep <= MAX_TEMPO_RAMP_PASSES;
}

export function normalizeTempoRampProgress(
  config: TempoRampConfig | null,
  progress: TempoRampProgress | null | undefined
): TempoRampProgress {
  if (!config) {
    return { completedPasses: 0, completed: false };
  }

  const completionPasses = getTempoRampCompletionPasses(config);
  const completedPasses = clampInteger(progress?.completedPasses ?? 0, 0, completionPasses);
  const completed = config.endBehavior === "stop" && Boolean(progress?.completed) && completedPasses >= completionPasses;

  return { completedPasses, completed };
}

export function getTempoRampCompletionPasses(config: TempoRampConfig): number {
  const increments = Math.ceil((config.ceilingBpm - config.startBpm) / config.stepBpm);
  return (increments + 1) * config.passesPerStep;
}

export function getTempoRampTempoBpm(config: TempoRampConfig, completedPasses: number): number {
  const stepIndex = Math.floor(Math.max(0, completedPasses) / config.passesPerStep);
  return Math.min(config.ceilingBpm, config.startBpm + stepIndex * config.stepBpm);
}

export function getTempoRampPassInStep(config: TempoRampConfig, completedPasses: number): number {
  if (getTempoRampTempoBpm(config, completedPasses) >= config.ceilingBpm) {
    const firstCeilingPass = getFirstCeilingPassIndex(config);
    return Math.min(config.passesPerStep, Math.max(0, completedPasses - firstCeilingPass) + 1);
  }

  return Math.max(0, completedPasses) % config.passesPerStep + 1;
}

export function advanceTempoRampProgress(
  config: TempoRampConfig,
  completedPassesBeforePass: number
): TempoRampProgress {
  const completionPasses = getTempoRampCompletionPasses(config);
  const completedPasses = Math.min(completionPasses, Math.max(0, completedPassesBeforePass) + 1);
  return {
    completedPasses,
    completed: config.endBehavior === "stop" && completedPasses >= completionPasses
  };
}

export function shouldStopTempoRampAfterPass(
  config: TempoRampConfig,
  completedPassesBeforePass: number
): boolean {
  return config.endBehavior === "stop" &&
    completedPassesBeforePass + 1 >= getTempoRampCompletionPasses(config);
}

export function getTempoRampPreview(config: TempoRampConfig): number[] {
  const values: number[] = [];
  let bpm = config.startBpm;

  while (bpm < config.ceilingBpm) {
    values.push(bpm);
    bpm = Math.min(config.ceilingBpm, bpm + config.stepBpm);
  }
  values.push(config.ceilingBpm);

  return values;
}

export function cloneTempoRampConfig(config: TempoRampConfig | null): TempoRampConfig | null {
  if (!config) return null;
  return {
    ...config,
    target: cloneTempoRampTarget(config.target)
  };
}

export function tempoRampConfigsEqual(
  left: TempoRampConfig | null,
  right: TempoRampConfig | null
): boolean {
  if (left === null || right === null) return left === right;
  if (
    left.startBpm !== right.startBpm ||
    left.stepBpm !== right.stepBpm ||
    left.passesPerStep !== right.passesPerStep ||
    left.ceilingBpm !== right.ceilingBpm ||
    left.endBehavior !== right.endBehavior ||
    left.target.kind !== right.target.kind
  ) {
    return false;
  }

  if (left.target.kind === "current-bar" && right.target.kind === "current-bar") {
    return left.target.barIndex === right.target.barIndex;
  }
  if (left.target.kind === "selected-bars" && right.target.kind === "selected-bars") {
    return arraysEqual(left.target.barIndexes, right.target.barIndexes);
  }
  return left.target.kind === "whole-notation" && right.target.kind === "whole-notation";
}

export function isMaterialTempoRampSessionChange(
  previous: TempoRampSessionState,
  next: TempoRampSessionState
): boolean {
  return !tempoRampConfigsEqual(previous.config, next.config) ||
    previous.armed !== next.armed ||
    next.progress.completedPasses < previous.progress.completedPasses ||
    (previous.progress.completed && !next.progress.completed);
}

function normalizeTempoRampTarget(target: PracticeTarget, barCount: number): PracticeTarget | null {
  if (target.kind === "whole-notation") {
    return { kind: "whole-notation" };
  }
  if (target.kind === "current-bar") {
    if (!Number.isInteger(target.barIndex) || target.barIndex < 0 || target.barIndex >= barCount) {
      return null;
    }
    return { kind: "current-bar", barIndex: target.barIndex };
  }

  const barIndexes = normalizeBarIndexes(target.barIndexes, barCount);
  return barIndexes.length > 0 ? { kind: "selected-bars", barIndexes } : null;
}

function cloneTempoRampTarget(target: PracticeTarget): PracticeTarget {
  if (target.kind === "selected-bars") {
    return { kind: "selected-bars", barIndexes: [...target.barIndexes] };
  }
  return { ...target };
}

function normalizeTempoRampTargetValues(target: PracticeTarget): PracticeTarget {
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

function getFirstCeilingPassIndex(config: TempoRampConfig): number {
  return Math.ceil((config.ceilingBpm - config.startBpm) / config.stepBpm) * config.passesPerStep;
}

function normalizeBarIndexes(barIndexes: readonly number[], barCount: number): number[] {
  return [...new Set(barIndexes)]
    .filter((barIndex) => Number.isInteger(barIndex) && barIndex >= 0 && barIndex < barCount)
    .sort((left, right) => left - right);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
