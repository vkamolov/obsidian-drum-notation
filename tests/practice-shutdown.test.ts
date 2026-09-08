import { afterEach, describe, expect, it, vi } from "vitest";
import { PracticeSessionController, type PracticeControllerState } from "../src/practice-controller";
import { DrumPlayer } from "../src/player";
import { parseDrumBlock } from "../src/parser";
import { PlaybackEnvironment } from "./helpers/playback-environment";

function harness(checkpoint: () => unknown = () => undefined, writeResult: () => unknown = () => undefined, passLimit = 1) {
  let state: PracticeControllerState = {
    tempoRamp: {config: null, progress: {completedPasses: 0, completed: false}, armed: false}, tempoRampRunMetrics: null,
    repetitionGoal: {config: null, progress: {completedPasses: 0, completed: false}, armed: true, runMetrics: null}, completedSummary: null, completedSummaryHandled: false
  };
  let active: DrumPlayer | null = null;
  const environment = new PlaybackEnvironment(); vi.stubGlobal("window", environment.window);
  const controller = new PracticeSessionController({
    state: {read: () => state, write: next => { const result = writeResult(); state = next; return result as undefined; }},
    clock: {wallNowMs: () => environment.wallTime, monotonicNowMs: () => environment.monotonicTime, audioProgress: () => active?.getAudioProgress() ?? null},
    checkpoint: checkpoint as () => undefined
  });
  let first = true;
  const player = new DrumPlayer(environment.context, parseDrumBlock("Tempo: 120\nTime: 1/4\nSD | x---"), () => {
    active = null;
    controller.dispatch({type: "finish", kind: "repetition-goal", target: {kind: "whole-notation"}, requestedPasses: passLimit, completed: true});
  }, vi.fn(), {
    passLimit,
    onAudioProgress: progress => { if (controller.acceptsAudioProgress(progress)) { controller.dispatch({type: "audio-progress", progress, bpm: 120, continuing: !first}); first = false; } },
    onPassComplete: () => controller.dispatch({type: "record-pass", kind: "repetition-goal", bpm: 120})
  }, () => environment.backend);
  active = player; controller.bindTransport(player);
  return {controller, player, environment, start: async () => {controller.dispatch({type: "start-or-resume", kind: "repetition-goal", bpm: 120}); await player.play();}};
}
afterEach(() => vi.unstubAllGlobals());

describe("synchronous shutdown", () => {
  it("drains a delayed completion before losing the active pointer", async () => {
    const checkpoint = vi.fn(), h = harness(checkpoint); await h.start();
    h.environment.audioTime = 10.59;
    h.controller.dispose(); h.controller.dispose();
    expect(h.controller.getSnapshot().completedSummary).toMatchObject({completed: true, performedPasses: 1, elapsedActiveMs: 500});
    expect(h.controller.getSnapshot().repetitionGoal.runMetrics?.status).toBe("complete");
    expect(checkpoint).toHaveBeenCalledOnce(); expect(h.environment.stop).toHaveBeenCalledOnce();
    expect(h.environment.timers.size).toBe(0);
  });
  it("drains multiple reached prepared passes in order exactly once", async () => {
    const h = harness(undefined, undefined, 3); await h.start();
    h.environment.runUntil(10.6);
    h.environment.audioTime = 11.59; h.controller.dispose(); h.controller.dispose();
    expect(h.controller.getSnapshot().completedSummary).toMatchObject({completed: true, performedPasses: 3, elapsedActiveMs: 1500});
  });
  it("checkpoints before microtasks and preserves paused accounting through repeated cached cycles", async () => {
    const checkpoint = vi.fn(), h = harness(checkpoint); await h.start(); h.environment.audioTime = 10.28;
    h.controller.shutdown();
    expect(checkpoint).toHaveBeenCalledOnce();
    const elapsed = h.controller.getSnapshot().repetitionGoal.runMetrics!.elapsedActiveMs;
    expect(elapsed).toBeCloseTo(200);
    await Promise.resolve(); h.environment.advanceClocks(60000); h.controller.shutdown();
    expect(checkpoint).toHaveBeenCalledOnce();
    expect(h.controller.getSnapshot().repetitionGoal.runMetrics!.elapsedActiveMs).toBe(elapsed);
    expect(h.controller.lifecycleState).toBe("active");
  });
  it("allows reentrant disposal to upgrade a drain and blocks starts", async () => {
    const h = harness(); await h.start();
    h.controller.subscribe(snapshot => {
      if (snapshot.lifecycle === "draining") { h.controller.dispose(); h.controller.dispatch({type: "start-or-resume", kind: "repetition-goal", bpm: 300}); }
    });
    h.controller.shutdown(); expect(h.controller.lifecycleState).toBe("disposed");
    expect(h.controller.getSnapshot().repetitionGoal.runMetrics?.endBpm).toBe(120);
  });
  it("passive disposal cannot stop the owner", async () => {
    const h = harness(); await h.start(); h.controller.dispose(false);
    expect(h.environment.stop).not.toHaveBeenCalled(); h.player.stop();
  });
  it.each([null, false, 1, "value", {}, Promise.resolve()])("rejects invalid checkpoint returns without inspecting them: %s", async result => {
    const h = harness(() => result); await h.start();
    expect(() => h.controller.shutdown()).toThrow("Practice checkpoint must complete synchronously and return undefined.");
    expect(h.environment.stop).toHaveBeenCalledOnce(); expect(h.environment.timers.size).toBe(0);
  });
  it("never reads returned getters or invokes methods, including reentrant thenables", async () => {
    const accessed = vi.fn(() => { throw new Error("must not run"); });
    const result = Object.defineProperties({}, {then: {get: accessed}, toString: {get: accessed}, [Symbol.toPrimitive]: {get: accessed}});
    const h = harness(() => result); await h.start();
    expect(() => h.controller.dispose()).toThrow("Practice checkpoint"); expect(accessed).not.toHaveBeenCalled();
    expect(h.controller.lifecycleState).toBe("disposed");
  });
  it("leaves rejection observation to the controlled test promise", async () => {
    const rejected = Promise.reject(new Error("adapter failure")); const observed = rejected.catch(error => error.message);
    const h = harness(() => rejected); await h.start();
    expect(() => h.controller.shutdown()).toThrow("Practice checkpoint"); expect(await observed).toBe("adapter failure");
  });
  it("cleans up a throwing checkpoint", async () => {
    const h = harness(() => { throw new Error("write failed"); }); await h.start();
    expect(() => h.controller.dispose()).toThrow("write failed"); expect(h.environment.timers.size).toBe(0);
    expect(h.controller.lifecycleState).toBe("disposed");
  });
  it("retains the last confirmed state if a state writer violates its contract during the drain", async () => {
    let failing = false;
    const h = harness(undefined, () => failing ? {} : undefined); await h.start();
    const before = h.controller.getSnapshot().repetitionGoal.runMetrics;
    failing = true; h.environment.audioTime = 10.3;
    expect(() => h.controller.dispose()).toThrow("Practice state.write");
    expect(h.controller.getSnapshot().repetitionGoal.runMetrics).toEqual(before);
    expect(h.environment.stop).toHaveBeenCalledOnce();
  });
});
