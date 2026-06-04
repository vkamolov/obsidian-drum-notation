import { describe, expect, it } from "vitest";
import { INSTRUMENTS_BY_ALIAS } from "../src/kit";
import { parseDrumBlock } from "../src/parser";
import { serializeDrumBlock } from "../src/serializer";
import {
  applyArticulation,
  findHit,
  hitKey,
  removeHit,
  setGrid,
  setInstrument,
  setTempo,
  setTimeSignature,
  toggleHit
} from "../src/edit";

const instrument = (alias: string) => INSTRUMENTS_BY_ALIAS.get(alias)!;
const HH = instrument("hh");
const SD = instrument("sd");
const BD = instrument("bd");

describe("note identity", () => {
  it("addresses a hit by composite (slot, instrument) key", () => {
    const block = parseDrumBlock("HH | x-x-");
    expect(hitKey(0, HH.id)).toBe("0:closed-hat");
    expect(findHit(block, 0, HH.id)).toBeTruthy();
    expect(findHit(block, 1, HH.id)).toBeUndefined();
  });
});

describe("hit edits", () => {
  it("toggleHit adds and removes a hit without mutating the input", () => {
    const block = parseDrumBlock("HH | x-x-");
    const added = toggleHit(block, 1, HH);

    expect(findHit(added, 1, HH.id)).toBeTruthy();
    expect(findHit(block, 1, HH.id)).toBeUndefined(); // original untouched
    expect(serializeDrumBlock(added)).toBe("HH | xxx-");

    const removed = toggleHit(added, 1, HH);
    expect(findHit(removed, 1, HH.id)).toBeUndefined();
    expect(serializeDrumBlock(removed)).toBe("HH | x-x-");
  });

  it("removeHit on an absent hit is a no-op", () => {
    const block = parseDrumBlock("HH | x-x-");
    expect(removeHit(block, 1, HH)).toEqual(block);
  });

  it("toggleHit can stack a hit onto an existing slot", () => {
    const block = parseDrumBlock("HH | x-x-x-x-x-x-x-x-\nBD | o-------o-------");
    const added = toggleHit(block, 4, BD);

    expect(findHit(added, 4, BD.id)).toBeTruthy();
    expect(findHit(added, 4, HH.id)).toBeTruthy();
    expect(serializeDrumBlock(added)).toContain("BD | o---o---o-------");
  });

  it("applyArticulation changes the articulation of an existing hit", () => {
    const block = parseDrumBlock("SD | ---o");
    const accented = applyArticulation(block, 3, SD, "accent");

    expect(findHit(accented, 3, SD.id)?.articulation).toBe("accent");
    expect(serializeDrumBlock(accented)).toBe("SD | ---O");
  });

  it("setInstrument moves a hit to another voice, keeping articulation", () => {
    const block = parseDrumBlock("SD | ---g");
    const moved = setInstrument(block, 3, SD, HH);

    expect(findHit(moved, 3, SD.id)).toBeUndefined();
    expect(findHit(moved, 3, HH.id)?.articulation).toBe("ghost");
  });

  it("edited blocks remain serialize round-trip stable", () => {
    const block = toggleHit(parseDrumBlock("HH | x-x-\nSD | ----"), 1, SD);
    const text = serializeDrumBlock(block);
    expect(serializeDrumBlock(parseDrumBlock(text))).toBe(text);
  });
});

describe("setting edits", () => {
  const block = parseDrumBlock("HH | x-x-");

  it("setTempo clamps to the supported range", () => {
    expect(setTempo(block, 140).tempo).toBe(140);
    expect(setTempo(block, 5).tempo).toBe(30);
    expect(setTempo(block, 999).tempo).toBe(260);
  });

  it("setGrid normalizes to 16 or 32", () => {
    expect(setGrid(block, 32).gridResolution).toBe(32);
  });

  it("setTimeSignature formats the meter", () => {
    expect(setTimeSignature(block, 6, 8).timeSignature).toBe("6/8");
  });

  it("setting edits survive a serialize round-trip", () => {
    const edited = setTempo(setGrid(block, 32), 90);
    const text = serializeDrumBlock(edited);
    const reparsed = parseDrumBlock(text);
    expect(reparsed.tempo).toBe(90);
    expect(reparsed.gridResolution).toBe(32);
  });
});
