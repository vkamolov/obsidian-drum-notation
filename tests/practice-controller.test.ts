import { describe, expect, it, vi } from "vitest";
import {
  CancellationGeneration,
  PracticeSessionController,
  PracticeSummarySaveCoordinator,
  getPracticeSummaryIdentity,
  type PracticeControllerState
} from "../src/practice-controller";
import type { AudioProgressSnapshot } from "../src/audio-progress";

function createState(): PracticeControllerState {
  return {
    tempoRamp: {
      config: {
        target: { kind: "whole-notation" },
        startBpm: 80,
        stepBpm: 5,
        passesPerStep: 2,
        ceilingBpm: 100,
        endBehavior: "stop"
      },
      progress: { completedPasses: 0, completed: false },
      armed: true
    },
    tempoRampRunMetrics: null,
    repetitionGoal: {
      config: null,
      progress: { completedPasses: 0, completed: false },
      armed: false,
      runMetrics: null
    },
    completedSummary: null,
    completedSummaryHandled: false
  };
}

function createHarness() {
  let state = createState();
  let progress: AudioProgressSnapshot | null = {
    contextId: 1,
    generation: 1,
    activeAudioMs: 0
  };
  const controller = new PracticeSessionController({
    state: {
      read: () => state,
      write: (next) => {
        state = next;
      }
    },
    clock: {
      audioProgress: () => progress,
      wallNowMs: () => 1_000,
      monotonicNowMs: () => 1_000
    },
    transport: { audioProgress: () => progress }
  });
  return {
    controller,
    getState: () => state,
    setState: (next: PracticeControllerState) => {
      state = next;
    },
    setProgress: (next: AudioProgressSnapshot | null) => {
      progress = next;
    }
  };
}

describe("PracticeSessionController", () => {
  it("coordinates run start, audio checkpoints, pass credit and completion", () => {
    const harness = createHarness();
    const listener = vi.fn();
    harness.controller.subscribe(listener);

    harness.controller.dispatch({ type: "start-or-resume", kind: "tempo-ramp", bpm: 80 });
    harness.setProgress({ contextId: 1, generation: 1, activeAudioMs: 1_250 });
    harness.controller.dispatch({
      type: "audio-progress",
      progress: { contextId: 1, generation: 1, activeAudioMs: 1_250 },
      bpm: 85,
      continuing: true
    });
    harness.controller.dispatch({ type: "record-pass", kind: "tempo-ramp", bpm: 85 });
    harness.controller.dispatch({
      type: "finish",
      kind: "tempo-ramp",
      target: { kind: "whole-notation" },
      requestedPasses: null,
      completed: true
    });

    expect(harness.getState().tempoRampRunMetrics).toMatchObject({
      elapsedActiveMs: 1_250,
      performedPasses: 1,
      endBpm: 85,
      status: "complete"
    });
    expect(harness.getState().completedSummary).toMatchObject({
      performedPasses: 1,
      elapsedActiveMs: 1_250,
      completed: true
    });
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("restores a paused anchor through the first progress event without borrowing another context", () => {
    const harness = createHarness();
    harness.controller.dispatch({ type: "start-or-resume", kind: "tempo-ramp", bpm: 80 });
    harness.controller.dispatch({ type: "settle" });
    harness.setProgress({ contextId: 2, generation: 3, activeAudioMs: 400 });

    harness.controller.dispatch({ type: "start-or-resume", kind: "tempo-ramp", bpm: 90 });
    harness.controller.dispatch({
      type: "audio-progress",
      progress: { contextId: 2, generation: 3, activeAudioMs: 400 },
      bpm: 90,
      continuing: false
    });

    expect(harness.getState().tempoRampRunMetrics).toMatchObject({
      elapsedActiveMs: 0,
      activeAudioAnchor: { contextId: 2, generation: 3, activeAudioMs: 400 },
      status: "running"
    });
  });

  it("coalesces concurrent saves and does not handle a replacement summary", async () => {
    const harness = createHarness();
    harness.controller.dispatch({ type: "start-or-resume", kind: "tempo-ramp", bpm: 80 });
    harness.controller.dispatch({
      type: "finish",
      kind: "tempo-ramp",
      target: { kind: "whole-notation" },
      requestedPasses: null,
      completed: false
    });
    const firstSummary = harness.getState().completedSummary!;
    let release: (() => void) | undefined;
    const save = vi.fn(() => new Promise<void>((resolve) => {
      release = resolve;
    }));

    const first = harness.controller.runSummaryAction("save", save);
    const duplicate = harness.controller.runSummaryAction("save", save);
    harness.setState({
      ...harness.getState(),
      completedSummary: { ...firstSummary, startedAtEpochMs: firstSummary.startedAtEpochMs + 1 },
      completedSummaryHandled: false
    });
    await Promise.resolve();
    release?.();
    await Promise.all([first, duplicate]);

    expect(save).toHaveBeenCalledTimes(1);
    expect(harness.getState().completedSummaryHandled).toBe(false);
    expect(getPracticeSummaryIdentity(harness.getState().completedSummary)).not.toBe(
      getPracticeSummaryIdentity(firstSummary)
    );
  });

  it("retains a failed summary for retry", async () => {
    const harness = createHarness();
    harness.controller.dispatch({ type: "start-or-resume", kind: "tempo-ramp", bpm: 80 });
    harness.controller.dispatch({
      type: "finish",
      kind: "tempo-ramp",
      target: { kind: "whole-notation" },
      requestedPasses: null,
      completed: false
    });

    await expect(harness.controller.runSummaryAction("save", async () => {
      throw new Error("disk full");
    })).rejects.toThrow("disk full");

    expect(harness.getState().completedSummary).not.toBeNull();
    expect(harness.getState().completedSummaryHandled).toBe(false);
  });

  it("invalidates transport generations and disposes subscriptions", () => {
    const generation = new CancellationGeneration();
    expect(generation.isCurrent(generation.current)).toBe(true);
    const previous = generation.current;
    generation.invalidate();
    expect(generation.isCurrent(previous)).toBe(false);

    const harness = createHarness();
    const listener = vi.fn();
    harness.controller.subscribe(listener);
    harness.controller.dispose();
    const notificationsAfterDisposal = listener.mock.calls.length;
    harness.controller.dispatch({ type: "record-pass", kind: "tempo-ramp", bpm: 90 });
    expect(listener).toHaveBeenCalledTimes(notificationsAfterDisposal);
    expect(harness.controller.lifecycleState).toBe("disposed");
  });

  it("coalesces the same summary across host views and allows retry after failure", async () => {
    const coordinator = new PracticeSummarySaveCoordinator();
    const summary = {
      kind: "repetition-goal" as const,
      target: { kind: "whole-notation" as const },
      startedAtEpochMs: 100,
      elapsedActiveMs: 1_000,
      startBpm: 80,
      endBpm: 80,
      performedPasses: 4,
      requestedPasses: 4,
      completed: true
    };
    let release: (() => void) | undefined;
    const write = vi.fn(() => new Promise<void>((resolve) => {
      release = resolve;
    }));

    const first = coordinator.save(summary, write);
    const duplicate = coordinator.save(summary, write);
    await Promise.resolve();
    release?.();
    await Promise.all([first, duplicate]);
    expect(write).toHaveBeenCalledTimes(1);

    await expect(coordinator.save(summary, async () => {
      throw new Error("write failed");
    })).rejects.toThrow("write failed");
    const retry = vi.fn(async () => undefined);
    await coordinator.save(summary, retry);
    expect(retry).toHaveBeenCalledOnce();
  });
});
