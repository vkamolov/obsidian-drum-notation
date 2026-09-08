import { afterEach, describe, expect, it, vi } from "vitest";
import { DrumPlayer } from "../src/player";
import { parseDrumBlock } from "../src/parser";
import { PlaybackEnvironment } from "./helpers/playback-environment";

function setup(options: ConstructorParameters<typeof DrumPlayer>[4] = {}) {
  const environment = new PlaybackEnvironment();
  vi.stubGlobal("window", environment.window);
  const ended = vi.fn(), slot = vi.fn();
  const player = new DrumPlayer(environment.context, parseDrumBlock("Tempo: 120\nTime: 1/4\nHH | xxxx"), ended, slot, options, () => environment.backend);
  return {environment, player, ended, slot};
}
afterEach(() => vi.unstubAllGlobals());

describe("playback behavior with independent clocks", () => {
  it("prepares the full current pass on the audio timeline", async () => {
    const {environment, player} = setup(); await player.play();
    expect(environment.scheduled.map(event => event.time)).toEqual([10.08, 10.205, 10.33, 10.455]);
    environment.advanceClocks(300);
    expect(environment.audioTime).toBe(10);
    expect(environment.scheduled.every(event => event.submittedAt === 10)).toBe(true);
    player.stop();
  });
  it("starts notation after its complete count-in", async () => {
    const {environment, player} = setup({countInMode: "2-bars"}); await player.play();
    const notes = environment.scheduled.filter(event => event.hits.some(hit => hit.instrument.id === "closed-hat"));
    expect(notes[0].time).toBeCloseTo(11.08);
    player.stop();
  });
  it("stops prepared audio and detaches pending notifications", async () => {
    const {environment, player, ended, slot} = setup({loop: true}); await player.play();
    player.stop();
    expect(environment.timers.size).toBe(0);
    environment.runUntil(100);
    expect(environment.stop).toHaveBeenCalledTimes(1);
    expect(ended).not.toHaveBeenCalled();
    expect(slot).not.toHaveBeenCalled();
  });
});

describe("audio-time reconciliation", () => {
  it("re-arms an early wake and credits the boundary exactly once", async () => {
    const complete = vi.fn(), start = vi.fn();
    const {environment, player} = setup({onPassComplete: complete, onPassStart: start});
    await player.play();
    expect(start).not.toHaveBeenCalled();
    environment.advanceClocks(1000); environment.deliverNext();
    expect(complete).not.toHaveBeenCalled();
    expect(environment.timers.size).toBe(1);
    environment.runUntil(10.59);
    expect(start).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(player.getAudioProgress().activeAudioMs).toBeCloseTo(500);
  });
  it("continues short loops with future passes prepared before their first sound", async () => {
    const {environment, player} = setup({loop: true}); await player.play();
    environment.runUntil(12);
    expect(environment.scheduled.length).toBeGreaterThan(12);
    expect(environment.scheduled.every(event => event.submittedAt <= event.time)).toBe(true);
    expect(environment.timers.size).toBe(1);
    player.stop();
  });
  it("pauses a missed continuation without submitting any overdue audio", async () => {
    const interrupted = vi.fn(), complete = vi.fn();
    const {environment, player} = setup({loop: true, onInterrupted: interrupted, onPassComplete: complete});
    await player.play();
    environment.advanceAudio(2); environment.advanceClocks(2000); environment.deliverNext();
    expect(interrupted).toHaveBeenCalledWith("missed-deadline", expect.any(Object));
    expect(environment.scheduled).toHaveLength(4);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(player.getAudioProgress().activeAudioMs).toBeCloseTo(500);
  });
  it("settles only performed history when a delayed suspension notification arrives", async () => {
    const interrupted = vi.fn(), complete = vi.fn();
    const {environment, player} = setup({loop: true, onInterrupted: interrupted, onPassComplete: complete});
    await player.play(); environment.runUntil(10.3);
    environment.setState("suspended", false);
    environment.advanceClocks(60000); environment.deliverNext();
    environment.notifyState();
    expect(interrupted).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
    expect(player.getAudioProgress().activeAudioMs).toBeCloseTo(220);
    expect(environment.timers.size).toBe(0);
  });
  it("credits a completed pass before closing a frozen generation", async () => {
    const complete = vi.fn();
    const {environment, player} = setup({loop: true, onPassComplete: complete});
    await player.play(); environment.runUntil(10.3);
    environment.advanceAudio(0.3); environment.setState("suspended");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(player.getAudioProgress().activeAudioMs).toBeCloseTo(520);
  });
  it("suppresses hidden visuals while continuing audio and pass accounting", async () => {
    const environment = new PlaybackEnvironment(), document = new EventTarget();
    Object.assign(document, {visibilityState: "hidden", defaultView: environment.window});
    vi.stubGlobal("window", environment.window);
    const slot = vi.fn(), complete = vi.fn();
    const player = new DrumPlayer(environment.context, parseDrumBlock("Tempo: 120\nTime: 1/4\nHH | xxxx"), vi.fn(), slot,
      {loop: true, ownerDocument: document as unknown as Document, onPassComplete: complete}, () => environment.backend);
    await player.play(); environment.runUntil(11);
    expect(slot).not.toHaveBeenCalled(); expect(complete).toHaveBeenCalledTimes(1);
    Object.assign(document, {visibilityState: "visible"}); document.dispatchEvent(new Event("visibilitychange"));
    environment.runUntil(11.2); expect(slot).toHaveBeenCalled(); player.stop();
  });
  it("includes count-in and intentional silence while excluding startup and suspension", async () => {
    const {environment, player} = setup({countInMode: "1-bar", metronomeMode: "metronome-only", gapClickMode: "1-on-1-off"});
    await player.play(); environment.runUntil(10.03);
    expect(player.getAudioProgress().activeAudioMs).toBe(0);
    environment.runUntil(10.83); expect(player.getAudioProgress().activeAudioMs).toBeCloseTo(750);
    environment.setState("closed"); environment.advanceClocks(30000);
    expect(player.getAudioProgress().activeAudioMs).toBeCloseTo(750);
  });
  it("ignores a backend start that completes after Stop", async () => {
    const {environment, player} = setup(); let finish!: () => void;
    environment.start.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const starting = player.play(); player.stop(); finish(); await starting;
    expect(environment.scheduled).toHaveLength(0); expect(environment.timers.size).toBe(0);
  });
  it.each([10, 100, 1000])("bounds retained work after %i passes", async passes => {
    const {environment, player} = setup({loop: true}); await player.play();
    environment.runUntil(10.08 + passes * 0.5);
    const retained = player as unknown as { notifications: unknown[]; scheduledOccurrences: unknown[]; activeIntervals: unknown[] };
    expect(retained.notifications.length).toBeLessThan(20);
    expect(retained.scheduledOccurrences.length).toBeLessThan(5);
    expect(retained.activeIntervals.length).toBeLessThan(5);
    expect(environment.timers.size).toBe(1);
    player.stop();
    expect(retained.notifications).toHaveLength(0); expect(retained.scheduledOccurrences).toHaveLength(0);
  });
});

describe("grace preparation deadlines", () => {
  it.each(["-r------", "-f------", "r-------"])("accounts for grace strokes after leading rests: %s", async pattern => {
    const environment = new PlaybackEnvironment();
    vi.stubGlobal("window", environment.window);
    const interrupted = vi.fn();
    const player = new DrumPlayer(environment.context, parseDrumBlock(`Tempo: 240\nTime: 1/4\nGrid: 32\nSD | ${pattern}`), vi.fn(), vi.fn(), {loop: true, onInterrupted: interrupted}, () => environment.backend);
    await player.play();
    // First continuation is eagerly prepared; the next starts at 10.58.
    player.reconcile();
    const count = environment.sourceStarts.length;
    environment.audioTime = pattern === "-f------" ? 10.578 : 10.57;
    player.reconcile();
    expect(interrupted).toHaveBeenCalledWith("missed-deadline", expect.any(Object));
    expect(environment.sourceStarts).toHaveLength(count);
    expect(environment.sourceStarts.every(source => source.submittedAt <= source.time)).toBe(true);
  });
  it("submits the independently calculated drag strokes when on time", async () => {
    const environment = new PlaybackEnvironment(); vi.stubGlobal("window", environment.window);
    const player = new DrumPlayer(environment.context, parseDrumBlock("Tempo: 240\nTime: 1/4\nGrid: 32\nSD | -r------"), vi.fn(), vi.fn(), {loop: true}, () => environment.backend);
    await player.play(); environment.runUntil(10.3);
    expect(environment.sourceStarts.some(source => Math.abs(source.time - 10.55625) < 1e-8)).toBe(true);
    expect(environment.sourceStarts.some(source => Math.abs(source.time - 10.58325) < 1e-8)).toBe(true);
    expect(environment.sourceStarts.every(source => source.submittedAt <= source.time)).toBe(true);
    player.stop();
  });
});

it.each([{mutedInstrumentIds: new Set(["snare"])}, {metronomeMode: "metronome-only" as const}])("does not impose a grace deadline for inaudible hits (%j)", async options => {
  const environment = new PlaybackEnvironment(); vi.stubGlobal("window", environment.window);
  const interrupted = vi.fn();
  const player = new DrumPlayer(environment.context, parseDrumBlock("Tempo: 240\nTime: 1/4\nGrid: 32\nSD | -r------"), vi.fn(), vi.fn(), {loop: true, ...options, onInterrupted: interrupted}, () => environment.backend);
  await player.play(); player.reconcile(); environment.audioTime = 10.57; player.reconcile();
  expect(interrupted).not.toHaveBeenCalled();
  environment.audioTime = 20; player.reconcile(); expect(interrupted).toHaveBeenCalledWith("missed-deadline", expect.any(Object));
});
