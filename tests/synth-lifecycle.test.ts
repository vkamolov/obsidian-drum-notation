import { describe, expect, it } from "vitest";
import { DrumSynth } from "../src/synth";
import { DRUM_KIT } from "../src/kit";
import { synthContext } from "./helpers/synth-context";

function instrument(kind: string) { return DRUM_KIT.find(item => item.playback === kind)!; }

describe("synth voice ownership", () => {
  it("cancels sources prepared for the future without closing the shared context", async () => {
    const mock = synthContext(), synth = new DrumSynth(mock.context, () => 0.5);
    await synth.start();
    synth.scheduleHits([{instrument: instrument("snare"), articulation: "normal", velocity: 0.7}], 20);
    expect(mock.sources.length).toBeGreaterThan(0);
    synth.stop(); synth.stop();
    for (const source of mock.sources) expect(source.stop).toHaveBeenLastCalledWith();
    expect(mock.raw.state).toBe("running");
  });
});

describe("completed voice cleanup", () => {
  it("removes ended voices from stop ownership and releases private chains", async () => {
    const mock = synthContext(), synth = new DrumSynth(mock.context, () => 0.5);
    await synth.start();
    synth.scheduleHits([{instrument: instrument("snare"), articulation: "normal", velocity: 0.7}], 20);
    for (const source of mock.sources) source.end();
    for (const source of mock.sources) {
      expect(source.listeners.size).toBe(0);
      expect(source.disconnect).toHaveBeenCalledTimes(1);
      source.stop.mockClear();
    }
    synth.stop();
    for (const source of mock.sources) expect(source.stop).not.toHaveBeenCalled();
  });
  it("keeps the shared cymbal chain until all six oscillators end", async () => {
    const mock = synthContext(), synth = new DrumSynth(mock.context, () => 0.5);
    await synth.start();
    synth.scheduleHits([{instrument: instrument("crash"), articulation: "normal", velocity: 0.7}], 20);
    const oscillators = mock.sources.slice(-6);
    const sharedFilter = oscillators[0].connect.mock.calls[0][0];
    for (const oscillator of oscillators.slice(0, 5)) oscillator.end();
    expect(sharedFilter.disconnect).not.toHaveBeenCalled();
    oscillators[5].end();
    expect(sharedFilter.disconnect).toHaveBeenCalledTimes(1);
    synth.stop();
    expect(sharedFilter.disconnect).toHaveBeenCalledTimes(1);
  });
  it("does not recreate a master gain after Stop wins an asynchronous start", async () => {
    const mock = synthContext();
    let resume!: () => void;
    Object.assign(mock.raw, {state: "suspended", resume: () => new Promise<void>(resolve => {resume = resolve;})});
    const synth = new DrumSynth(mock.context);
    const starting = synth.start(); synth.stop(); resume(); await starting;
    expect(mock.raw.createGain).not.toHaveBeenCalled();
  });
});
