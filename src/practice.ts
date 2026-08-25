import {
  ClickSubdivision,
  CountInMode,
  DrumBlock,
  GapClickMode,
  MetronomeMode,
  PracticeSelection,
  ScoreBarRegion
} from "./types";
import {
  DEFAULT_CLICK_SUBDIVISION,
  DEFAULT_GAP_CLICK_MODE,
  normalizeClickSubdivision,
  normalizeGapClickMode
} from "./playback";
import {
  TempoRampSessionState,
  cloneTempoRampConfig,
  normalizeTempoRampConfigValues,
  normalizeTempoRampProgress,
  tempoRampConfigsEqual
} from "./tempo-ramp";

export interface DrumTransportSession {
  body: string;
  speedPercent: number;
  metronomeMode: MetronomeMode;
  countInMode: CountInMode;
  clickSubdivision: ClickSubdivision;
  gapClickMode: GapClickMode;
  mutedInstrumentIds: string[];
  selection: PracticeSelection;
  selectionModeOpen: boolean;
  currentBarIndex: number;
  tempoRamp: TempoRampSessionState;
}

export type DrumTransportSessionListener = (session: DrumTransportSession) => void;

export interface PracticeControllerCandidate<T> {
  value: T;
  isPlaying: boolean;
  isInActiveView: boolean;
  isVisible: boolean;
  isLastInteracted: boolean;
}

export interface PracticeControllerResolution<T> {
  value: T | null;
  ambiguous: boolean;
}

interface StoredTransportSession {
  session: DrumTransportSession;
}

export function normalizePracticeBarIndexes(
  barIndexes: readonly number[],
  barCount: number
): number[] {
  const normalized = new Set<number>();

  barIndexes.forEach((barIndex) => {
    if (Number.isInteger(barIndex) && barIndex >= 0 && barIndex < barCount) {
      normalized.add(barIndex);
    }
  });

  return [...normalized].sort((left, right) => left - right);
}

export function normalizePracticeSelection(
  selection: PracticeSelection,
  barCount: number
): PracticeSelection {
  return {
    barIndexes: normalizePracticeBarIndexes(selection.barIndexes, barCount)
  };
}

export function isPracticeRegionSelected(
  selection: PracticeSelection,
  region: Pick<ScoreBarRegion, "barIndexes">
): boolean {
  if (region.barIndexes.length === 0) {
    return false;
  }

  const selected = new Set(selection.barIndexes);
  return region.barIndexes.every((barIndex) => selected.has(barIndex));
}

export function togglePracticeRegion(
  selection: PracticeSelection,
  region: Pick<ScoreBarRegion, "barIndexes">,
  barCount: number
): PracticeSelection {
  const selected = new Set(normalizePracticeBarIndexes(selection.barIndexes, barCount));
  const regionIndexes = normalizePracticeBarIndexes(region.barIndexes, barCount);
  const remove = regionIndexes.length > 0 && regionIndexes.every((barIndex) => selected.has(barIndex));

  regionIndexes.forEach((barIndex) => {
    if (remove) {
      selected.delete(barIndex);
    } else {
      selected.add(barIndex);
    }
  });

  return {
    barIndexes: [...selected].sort((left, right) => left - right)
  };
}

export function hasCompatiblePracticeStructure(previous: DrumBlock, next: DrumBlock): boolean {
  return (
    previous.bars.length === next.bars.length &&
    previous.bars.every((bar, index) => {
      const nextBar = next.bars[index];
      return (
        nextBar !== undefined &&
        bar.slots.length === nextBar.slots.length &&
        bar.timeSignature === nextBar.timeSignature
      );
    })
  );
}

export function resolvePracticeControllerTarget<T>(
  candidates: readonly PracticeControllerCandidate<T>[]
): PracticeControllerResolution<T> {
  const activeViewCandidates = candidates.filter((candidate) => candidate.isInActiveView);
  const activePlaying = activeViewCandidates.find((candidate) => candidate.isPlaying);
  if (activePlaying) {
    return { value: activePlaying.value, ambiguous: false };
  }

  const activeLastInteracted = activeViewCandidates.find((candidate) => candidate.isLastInteracted);
  if (activeLastInteracted) {
    return { value: activeLastInteracted.value, ambiguous: false };
  }

  const visibleInActiveView = activeViewCandidates.filter((candidate) => candidate.isVisible);
  if (visibleInActiveView.length === 1) {
    return { value: visibleInActiveView[0].value, ambiguous: false };
  }

  const globalLastInteracted = candidates.find((candidate) => candidate.isLastInteracted);
  if (globalLastInteracted) {
    return { value: globalLastInteracted.value, ambiguous: false };
  }

  return {
    value: null,
    ambiguous: visibleInActiveView.length > 1
  };
}

export class DrumTransportSessionStore {
  private readonly entries = new Map<string, StoredTransportSession>();
  private readonly listeners = new Map<string, Set<DrumTransportSessionListener>>();

  constructor(private readonly maximumEntries = 50) {}

  get(key: string, body: string): DrumTransportSession | null {
    const stored = this.entries.get(key);
    if (!stored || stored.session.body !== body) {
      return null;
    }

    this.touch(key, stored);
    return cloneSession(stored.session);
  }

  set(key: string, session: DrumTransportSession): void {
    const normalized = normalizeSession(session);
    const stored = this.entries.get(key);

    if (stored && sessionsEqual(stored.session, normalized)) {
      this.touch(key, stored);
      return;
    }

    const replacement = { session: normalized };
    this.entries.delete(key);
    this.entries.set(key, replacement);
    this.evictOldestEntries();
    this.listeners.get(key)?.forEach((listener) => listener(cloneSession(normalized)));
  }

  migrate(key: string, previousBody: string, session: DrumTransportSession): boolean {
    const stored = this.entries.get(key);
    if (!stored || stored.session.body !== previousBody) {
      return false;
    }

    this.set(key, session);
    return true;
  }

  subscribe(key: string, listener: DrumTransportSessionListener): () => void {
    const listeners = this.listeners.get(key) ?? new Set<DrumTransportSessionListener>();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      const current = this.listeners.get(key);
      current?.delete(listener);
      if (current?.size === 0) {
        this.listeners.delete(key);
      }
    };
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.listeners.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private touch(key: string, stored: StoredTransportSession): void {
    this.entries.delete(key);
    this.entries.set(key, stored);
  }

  private evictOldestEntries(): void {
    while (this.entries.size > this.maximumEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      this.entries.delete(oldestKey);
    }
  }
}

function normalizeSession(session: DrumTransportSession): DrumTransportSession {
  const tempoRampConfig = normalizeTempoRampConfigValues(session.tempoRamp?.config);
  return {
    ...session,
    clickSubdivision: normalizeClickSubdivision(session.clickSubdivision ?? DEFAULT_CLICK_SUBDIVISION),
    gapClickMode: normalizeGapClickMode(session.gapClickMode ?? DEFAULT_GAP_CLICK_MODE),
    mutedInstrumentIds: [...new Set(session.mutedInstrumentIds)].sort(),
    selection: {
      barIndexes: [...new Set(session.selection.barIndexes)].sort((left, right) => left - right)
    },
    currentBarIndex: Math.max(0, Math.round(session.currentBarIndex)),
    tempoRamp: {
      config: tempoRampConfig,
      progress: normalizeTempoRampProgress(tempoRampConfig, session.tempoRamp?.progress),
      armed: Boolean(session.tempoRamp?.armed && tempoRampConfig)
    }
  };
}

function cloneSession(session: DrumTransportSession): DrumTransportSession {
  return {
    ...session,
    mutedInstrumentIds: [...session.mutedInstrumentIds],
    selection: { barIndexes: [...session.selection.barIndexes] },
    tempoRamp: {
      config: cloneTempoRampConfig(session.tempoRamp.config),
      progress: { ...session.tempoRamp.progress },
      armed: session.tempoRamp.armed
    }
  };
}

function sessionsEqual(left: DrumTransportSession, right: DrumTransportSession): boolean {
  return (
    left.body === right.body &&
    left.speedPercent === right.speedPercent &&
    left.metronomeMode === right.metronomeMode &&
    left.countInMode === right.countInMode &&
    left.clickSubdivision === right.clickSubdivision &&
    left.gapClickMode === right.gapClickMode &&
    left.selectionModeOpen === right.selectionModeOpen &&
    left.currentBarIndex === right.currentBarIndex &&
    left.tempoRamp.armed === right.tempoRamp.armed &&
    left.tempoRamp.progress.completedPasses === right.tempoRamp.progress.completedPasses &&
    left.tempoRamp.progress.completed === right.tempoRamp.progress.completed &&
    tempoRampConfigsEqual(left.tempoRamp.config, right.tempoRamp.config) &&
    arraysEqual(left.mutedInstrumentIds, right.mutedInstrumentIds) &&
    arraysEqual(left.selection.barIndexes, right.selection.barIndexes)
  );
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
