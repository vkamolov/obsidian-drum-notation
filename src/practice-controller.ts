import type { AudioProgressSnapshot } from "./audio-progress";
import type { RepetitionGoalSessionState } from "./practice";
import {
  checkpointPracticeRunMetrics,
  createPracticeRunMetrics,
  createPracticeRunSummary,
  recordPracticePass,
  resumePracticeRunMetrics,
  settlePracticeRunMetrics,
  type PracticeClock
} from "./practice-session";
import { cloneTempoRampConfig, type TempoRampSessionState } from "./tempo-ramp";
import type { PracticeRunMetrics, PracticeRunSummary, PracticeTarget } from "./types";

export interface PracticeControllerState {
  tempoRamp: TempoRampSessionState;
  tempoRampRunMetrics: PracticeRunMetrics | null;
  repetitionGoal: RepetitionGoalSessionState;
  completedSummary: PracticeRunSummary | null;
  completedSummaryHandled: boolean;
}

export type PracticeControllerSnapshot = Readonly<PracticeControllerState>;

export interface PracticeControllerStatePort {
  read(): PracticeControllerState;
  write(state: PracticeControllerState): void;
}

export interface PracticeTransportPort {
  audioProgress(): AudioProgressSnapshot | null;
  cancel?(): void;
}

export interface PracticeLifecyclePort {
  subscribe(listener: (event: "pause" | "dispose") => void): () => void;
}

export type PracticeSessionCommand =
  | { type: "start-or-resume"; kind: PracticeRunSummary["kind"]; bpm: number }
  | { type: "audio-progress"; progress: AudioProgressSnapshot; bpm: number; continuing: boolean }
  | { type: "settle"; status?: PracticeRunMetrics["status"] }
  | {
      type: "finish";
      kind: PracticeRunSummary["kind"];
      target: PracticeTarget;
      requestedPasses: number | null;
      completed: boolean;
    }
  | { type: "record-pass"; kind: PracticeRunSummary["kind"]; bpm: number }
  | { type: "summary-handled"; identity?: string; revision?: number }
  | { type: "summary-discarded"; identity?: string; revision?: number };

export type PracticeSessionListener = (snapshot: PracticeControllerSnapshot) => void;

export interface PracticeSessionControllerOptions {
  state: PracticeControllerStatePort;
  clock: PracticeClock;
  transport?: PracticeTransportPort;
  lifecycle?: PracticeLifecyclePort;
}

/**
 * DOM-free coordination for the state transitions shared by the playground and
 * Obsidian adapters. The state port keeps host storage outside this module.
 */
export class PracticeSessionController {
  private readonly listeners = new Set<PracticeSessionListener>();
  private readonly pendingSummaryActions = new Map<string, Promise<boolean>>();
  private readonly unsubscribeLifecycle: (() => void) | null;
  private transportGeneration = 0;
  private observedSummaryIdentity: string | null;
  private summaryRevision = 0;
  private disposed = false;

  constructor(private readonly options: PracticeSessionControllerOptions) {
    this.observedSummaryIdentity = getPracticeSummaryIdentity(options.state.read().completedSummary);
    if (this.observedSummaryIdentity) {
      this.summaryRevision = 1;
    }
    this.unsubscribeLifecycle = options.lifecycle?.subscribe((event) => {
      if (event === "dispose") {
        this.dispose();
      } else {
        this.dispatch({ type: "settle" });
      }
    }) ?? null;
  }

  getSnapshot(): PracticeControllerSnapshot {
    return cloneState(this.options.state.read());
  }

  subscribe(listener: PracticeSessionListener): () => void {
    if (this.disposed) {
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatch(command: PracticeSessionCommand): PracticeControllerSnapshot {
    if (this.disposed) {
      return this.getSnapshot();
    }

    const current = this.options.state.read();
    let next = cloneState(current);
    if (command.type === "start-or-resume") {
      next = updateRun(next, command.kind, (metrics) => metrics
        ? resumePracticeRunMetrics(metrics, command.bpm, this.clockForTransport())
        : createPracticeRunMetrics(command.bpm, this.clockForTransport()));
    } else if (command.type === "audio-progress") {
      const clock = { ...this.options.clock, audioProgress: () => command.progress };
      const update = (metrics: PracticeRunMetrics) => command.continuing
        ? checkpointPracticeRunMetrics(metrics, command.progress)
        : resumePracticeRunMetrics(metrics, command.bpm, clock);
      if (next.tempoRamp.armed && next.tempoRampRunMetrics) {
        next.tempoRampRunMetrics = update(next.tempoRampRunMetrics);
      }
      if (next.repetitionGoal.armed && next.repetitionGoal.runMetrics) {
        next.repetitionGoal = {
          ...next.repetitionGoal,
          runMetrics: update(next.repetitionGoal.runMetrics)
        };
      }
    } else if (command.type === "settle") {
      const status = command.status ?? "paused";
      if (next.tempoRamp.armed && next.tempoRampRunMetrics?.status === "running") {
        next.tempoRampRunMetrics = settlePracticeRunMetrics(
          next.tempoRampRunMetrics,
          this.clockForTransport(),
          status
        );
      }
      if (next.repetitionGoal.armed && next.repetitionGoal.runMetrics?.status === "running") {
        next.repetitionGoal = {
          ...next.repetitionGoal,
          runMetrics: settlePracticeRunMetrics(
            next.repetitionGoal.runMetrics,
            this.clockForTransport(),
            status
          )
        };
      }
    } else if (command.type === "record-pass") {
      next = updateRun(next, command.kind, (metrics) => metrics
        ? recordPracticePass(metrics, command.bpm)
        : null);
    } else if (command.type === "finish") {
      const metrics = getRunMetrics(next, command.kind);
      if (metrics) {
        next.completedSummary = createPracticeRunSummary(
          command.kind,
          command.target,
          metrics,
          command.requestedPasses,
          command.completed,
          this.clockForTransport()
        );
        next.completedSummaryHandled = false;
        next = updateRun(next, command.kind, (value) => value
          ? settlePracticeRunMetrics(value, this.clockForTransport(), "complete")
          : null);
        if (command.kind === "repetition-goal") {
          next.repetitionGoal = { ...next.repetitionGoal, armed: false };
        }
      }
    } else if (command.type === "summary-handled") {
      const revisionMatches = command.revision === undefined || command.revision === this.observeSummaryRevision();
      if (revisionMatches && (!command.identity || command.identity === getPracticeSummaryIdentity(next.completedSummary))) {
        next.completedSummaryHandled = next.completedSummary !== null;
      }
    } else if (command.type === "summary-discarded") {
      const revisionMatches = command.revision === undefined || command.revision === this.observeSummaryRevision();
      if (revisionMatches && (!command.identity || command.identity === getPracticeSummaryIdentity(next.completedSummary))) {
        next.completedSummary = null;
        next.completedSummaryHandled = false;
      }
    }

    return this.commit(next);
  }

  nextTransportGeneration(): number {
    this.transportGeneration += 1;
    return this.transportGeneration;
  }

  get currentTransportGeneration(): number {
    return this.transportGeneration;
  }

  isCurrentTransportGeneration(generation: number): boolean {
    return !this.disposed && generation === this.transportGeneration;
  }

  runSummaryAction(
    kind: "copy" | "save",
    action: (summary: PracticeRunSummary) => Promise<void>
  ): Promise<boolean> {
    const summary = this.options.state.read().completedSummary;
    const identity = getPracticeSummaryIdentity(summary);
    if (!summary || !identity || this.disposed) {
      return Promise.resolve(false);
    }

    const revision = this.observeSummaryRevision();
    const operationKey = `${kind}:${identity}:${revision}`;
    const pending = this.pendingSummaryActions.get(operationKey);
    if (pending) {
      return pending;
    }

    const operation = action(cloneSummary(summary))
      .then(() => {
        this.dispatch({ type: "summary-handled", identity, revision });
        return true;
      })
      .finally(() => {
        if (this.pendingSummaryActions.get(operationKey) === operation) {
          this.pendingSummaryActions.delete(operationKey);
        }
      });
    this.pendingSummaryActions.set(operationKey, operation);
    return operation;
  }

  dispose(): void {
    if (this.disposed) return;
    this.dispatch({ type: "settle" });
    this.disposed = true;
    this.nextTransportGeneration();
    this.options.transport?.cancel?.();
    this.unsubscribeLifecycle?.();
    this.listeners.clear();
  }

  private clockForTransport(): PracticeClock {
    return this.options.transport
      ? { ...this.options.clock, audioProgress: () => this.options.transport?.audioProgress() ?? null }
      : this.options.clock;
  }

  private commit(state: PracticeControllerState): PracticeControllerSnapshot {
    this.options.state.write(cloneState(state));
    this.observeSummaryRevision();
    const snapshot = cloneState(state);
    this.listeners.forEach((listener) => listener(snapshot));
    return snapshot;
  }

  private observeSummaryRevision(): number {
    const identity = getPracticeSummaryIdentity(this.options.state.read().completedSummary);
    if (identity !== this.observedSummaryIdentity) {
      this.observedSummaryIdentity = identity;
      this.summaryRevision += 1;
    }
    return this.summaryRevision;
  }
}

export class CancellationGeneration {
  private value = 0;

  invalidate(): number {
    this.value += 1;
    return this.value;
  }

  get current(): number {
    return this.value;
  }

  isCurrent(generation: number): boolean {
    return generation === this.value;
  }
}

/** Coalesces the same summary across multiple host views while a write is in flight. */
export class PracticeSummarySaveCoordinator {
  private readonly pending = new Map<string, Promise<void>>();

  save(summary: PracticeRunSummary, write: () => Promise<void>): Promise<void> {
    const identity = getPracticeSummaryIdentity(summary);
    if (!identity) {
      return Promise.reject(new Error("A practice summary is required."));
    }
    const existing = this.pending.get(identity);
    if (existing) {
      return existing;
    }
    const operation = write().finally(() => {
      if (this.pending.get(identity) === operation) {
        this.pending.delete(identity);
      }
    });
    this.pending.set(identity, operation);
    return operation;
  }
}

export function getPracticeSummaryIdentity(summary: PracticeRunSummary | null): string | null {
  if (!summary) return null;
  const target = summary.target.kind === "selected-bars"
    ? `${summary.target.kind}:${summary.target.barIndexes.join(",")}`
    : summary.target.kind === "current-bar"
      ? `${summary.target.kind}:${summary.target.barIndex}`
      : summary.target.kind;
  return [
    summary.kind,
    target,
    summary.startedAtEpochMs,
    summary.elapsedActiveMs,
    summary.startBpm,
    summary.endBpm,
    summary.performedPasses,
    summary.requestedPasses ?? "open",
    summary.completed ? "complete" : "early"
  ].join("|");
}

function updateRun(
  state: PracticeControllerState,
  kind: PracticeRunSummary["kind"],
  update: (metrics: PracticeRunMetrics | null) => PracticeRunMetrics | null
): PracticeControllerState {
  if (kind === "tempo-ramp") {
    return { ...state, tempoRampRunMetrics: update(state.tempoRampRunMetrics) };
  }
  return {
    ...state,
    repetitionGoal: {
      ...state.repetitionGoal,
      runMetrics: update(state.repetitionGoal.runMetrics)
    }
  };
}

function getRunMetrics(
  state: PracticeControllerState,
  kind: PracticeRunSummary["kind"]
): PracticeRunMetrics | null {
  return kind === "tempo-ramp" ? state.tempoRampRunMetrics : state.repetitionGoal.runMetrics;
}

function cloneMetrics(metrics: PracticeRunMetrics | null): PracticeRunMetrics | null {
  return metrics
    ? {
        ...metrics,
        activeAudioAnchor: metrics.activeAudioAnchor ? { ...metrics.activeAudioAnchor } : null
      }
    : null;
}

function cloneSummary(summary: PracticeRunSummary): PracticeRunSummary {
  return {
    ...summary,
    target: summary.target.kind === "selected-bars"
      ? { kind: "selected-bars", barIndexes: [...summary.target.barIndexes] }
      : { ...summary.target }
  };
}

function cloneState(state: PracticeControllerState): PracticeControllerState {
  return {
    tempoRamp: {
      config: cloneTempoRampConfig(state.tempoRamp.config),
      progress: { ...state.tempoRamp.progress },
      armed: state.tempoRamp.armed
    },
    tempoRampRunMetrics: cloneMetrics(state.tempoRampRunMetrics),
    repetitionGoal: {
      config: state.repetitionGoal.config
        ? {
            ...state.repetitionGoal.config,
            target: state.repetitionGoal.config.target.kind === "selected-bars"
              ? {
                  kind: "selected-bars",
                  barIndexes: [...state.repetitionGoal.config.target.barIndexes]
                }
              : { ...state.repetitionGoal.config.target }
          }
        : null,
      progress: { ...state.repetitionGoal.progress },
      armed: state.repetitionGoal.armed,
      runMetrics: cloneMetrics(state.repetitionGoal.runMetrics)
    },
    completedSummary: state.completedSummary ? cloneSummary(state.completedSummary) : null,
    completedSummaryHandled: state.completedSummaryHandled
  };
}
