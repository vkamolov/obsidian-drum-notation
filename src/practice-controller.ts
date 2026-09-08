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

export type PracticeLifecycleState = "active" | "draining" | "disposed";
export type PracticeControllerSnapshot = Readonly<PracticeControllerState> & { readonly lifecycle: PracticeLifecycleState };

export interface PracticeControllerStatePort {
  read(): PracticeControllerState;
  write(state: PracticeControllerState): undefined;
}

export interface PracticeTransportPort {
  audioProgress(): AudioProgressSnapshot | null;
}

export interface PracticePlayerPort {
  getAudioProgress(): AudioProgressSnapshot;
  stop(): void;
}

type TransportBinding = { player: PracticePlayerPort; contextId: number; generation: number };
type ControllerLifecycle =
  | { state: "active" }
  | { state: "draining"; destination: "active" | "disposed"; binding: TransportBinding | null; failed: boolean }
  | { state: "disposed" };

export class PracticeCheckpointError extends Error {
  constructor(port: "state.write" | "checkpoint") {
    super(`Practice ${port} must complete synchronously and return undefined.`);
    this.name = "PracticeCheckpointError";
  }
}

function requireSynchronousReturn(value: unknown, port: "state.write" | "checkpoint"): void {
  // The guard detects a contract violation; it cannot undo asynchronous work or make a faulty adapter safe.
  // Never inspect, stringify, invoke or await the returned value (including its .then property).
  if (value !== undefined) throw new PracticeCheckpointError(port);
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
  checkpoint?: (snapshot: PracticeControllerSnapshot) => undefined;
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
  private lifecycle: ControllerLifecycle = { state: "active" };
  private binding: TransportBinding | null = null;
  private confirmedState: PracticeControllerState;
  private checkpointFailed = false;

  constructor(private readonly options: PracticeSessionControllerOptions) {
    this.confirmedState = cloneState(options.state.read());
    this.observedSummaryIdentity = getPracticeSummaryIdentity(options.state.read().completedSummary);
    if (this.observedSummaryIdentity) {
      this.summaryRevision = 1;
    }
    this.unsubscribeLifecycle = options.lifecycle?.subscribe((event) => {
      if (event === "dispose") {
        this.dispose();
      } else {
        this.shutdown();
      }
    }) ?? null;
  }

  getSnapshot(): PracticeControllerSnapshot {
    const state = this.lifecycle.state === "disposed" || this.checkpointFailed
      ? this.confirmedState : this.options.state.read();
    return { ...cloneState(state), lifecycle: this.lifecycle.state };
  }

  get lifecycleState(): PracticeLifecycleState { return this.lifecycle.state; }
  get acceptsStarts(): boolean { return this.lifecycle.state === "active" && !this.checkpointFailed; }

  bindTransport(player: PracticePlayerPort): void {
    if (this.lifecycle.state !== "active" || this.checkpointFailed) return;
    const {contextId, generation} = player.getAudioProgress();
    this.binding = {player, contextId, generation};
  }

  acceptsAudioProgress(progress: AudioProgressSnapshot): boolean {
    const binding = this.lifecycle.state === "draining" ? this.lifecycle.binding : this.binding;
    return this.lifecycle.state !== "disposed" && !this.checkpointFailed && binding !== null &&
      binding.contextId === progress.contextId && binding.generation === progress.generation;
  }

  subscribe(listener: PracticeSessionListener): () => void {
    if (this.lifecycle.state === "disposed") {
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatch(command: PracticeSessionCommand): PracticeControllerSnapshot {
    if (this.lifecycle.state === "disposed" || this.checkpointFailed) {
      return this.getSnapshot();
    }
    if (command.type === "audio-progress" && this.binding && !this.acceptsAudioProgress(command.progress)) return this.getSnapshot();
    if (this.lifecycle.state === "draining") {
      switch (command.type) {
        case "audio-progress":
          if (!this.acceptsAudioProgress(command.progress)) return this.getSnapshot();
          break;
        case "record-pass": case "finish": case "settle": break;
        case "start-or-resume": case "summary-handled": case "summary-discarded":
          return this.getSnapshot();
      }
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
    return this.lifecycle.state === "active" && !this.checkpointFailed && generation === this.transportGeneration;
  }

  runSummaryAction(
    kind: "copy" | "save",
    action: (summary: PracticeRunSummary) => Promise<void>
  ): Promise<boolean> {
    const summary = this.options.state.read().completedSummary;
    const identity = getPracticeSummaryIdentity(summary);
    if (!summary || !identity || this.lifecycle.state !== "active" || this.checkpointFailed) {
      return Promise.resolve(false);
    }

    const revision = this.observeSummaryRevision();
    const operationKey = `${kind}:${identity}:${revision}`;
    const pending = this.pendingSummaryActions.get(operationKey);
    if (pending) {
      return pending;
    }

    const operation = Promise.resolve()
      .then(() => action(cloneSummary(summary)))
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

  dispose(settle = true): void {
    this.shutdown("disposed", settle);
  }

  /** Drains the captured player before publishing its final synchronous checkpoint. */
  shutdown(destination: "active" | "disposed" = "active", settle = true): PracticeControllerSnapshot {
    if (this.lifecycle.state === "disposed" || this.checkpointFailed && this.lifecycle.state !== "draining") return this.getSnapshot();
    if (this.lifecycle.state === "draining") {
      if (!this.lifecycle.failed && destination === "disposed") this.lifecycle.destination = "disposed";
      return this.getSnapshot();
    }
    if (destination === "active" && !this.binding) {
      const state = this.options.state.read();
      if (state.tempoRampRunMetrics?.status !== "running" && state.repetitionGoal.runMetrics?.status !== "running") {
        this.nextTransportGeneration();
        return this.getSnapshot();
      }
    }
    const drain: Extract<ControllerLifecycle, {state: "draining"}> = {
      state: "draining", destination, binding: settle ? this.binding : null, failed: false
    };
    this.lifecycle = drain;
    this.nextTransportGeneration();
    let stopped = false;
    try {
      this.notifyListeners();
      if (settle) {
        drain.binding?.player.stop();
        stopped = true;
        this.dispatch({type: "settle"});
        if (this.options.checkpoint) {
          requireSynchronousReturn(this.options.checkpoint(this.getSnapshot()), "checkpoint");
        }
      }
      this.confirmedState = cloneState(this.options.state.read());
    } catch (error) {
      drain.failed = true;
      this.checkpointFailed = true;
      throw error;
    } finally {
      // A writer can throw from a reached-boundary callback before player.stop reaches cancellation.
      try { if (settle && !stopped) drain.binding?.player.stop(); }
      finally {
        this.binding = null;
        this.lifecycle = {state: drain.destination};
        if (drain.destination === "disposed") {
          this.unsubscribeLifecycle?.();
          this.listeners.clear();
        } else {
          this.notifyListeners();
        }
      }
    }
    return this.getSnapshot();
  }

  private clockForTransport(): PracticeClock {
    const binding = this.lifecycle.state === "draining" ? this.lifecycle.binding : this.binding;
    if (binding) return {...this.options.clock, audioProgress: () => binding.player.getAudioProgress()};
    return this.options.transport
      ? { ...this.options.clock, audioProgress: () => this.options.transport?.audioProgress() ?? null }
      : this.options.clock;
  }

  private commit(state: PracticeControllerState): PracticeControllerSnapshot {
    try {
      requireSynchronousReturn(this.options.state.write(cloneState(state)), "state.write");
    } catch (error) {
      this.checkpointFailed = true;
      if (this.lifecycle.state === "draining") this.lifecycle.failed = true;
      throw error;
    }
    this.confirmedState = cloneState(state);
    this.observeSummaryRevision();
    this.notifyListeners();
    return this.getSnapshot();
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.getSnapshot()));
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
    const operation = Promise.resolve().then(write).finally(() => {
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
