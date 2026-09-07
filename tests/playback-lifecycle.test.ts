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
