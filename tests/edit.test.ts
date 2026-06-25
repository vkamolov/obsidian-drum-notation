import { describe, expect, it } from "vitest";
import { INSTRUMENTS_BY_ALIAS } from "../src/kit";
import { parseDrumBlock } from "../src/parser";
import { serializeDrumBlock } from "../src/serializer";
import {
  applyArticulation,
  clearHit,
  clearSticking,
  clearBarRepeat,
  deleteBar,
  duplicateBar,
  duplicateBarToNextSystem,
  findHit,
  findSticking,
  hitKey,
  insertBarAfter,
  removeHit,
  setGrid,
  setBarRepeat,
  setHit,
  setInstrument,
  setSticking,
  setTempo,
  setTimeSignature,
  toggleHit
} from "../src/edit";

const instrument = (alias: string) => INSTRUMENTS_BY_ALIAS.get(alias)!;
const HH = instrument("hh");
const SD = instrument("sd");
const BD = instrument("bd");
const CC = instrument("cc");

describe("note identity", () => {
  it("addresses a hit by composite (slot, instrument) key", () => {
    const block = parseDrumBlock("HH | x-x-");
    expect(hitKey(0, HH.id)).toBe("0:closed-hat");
    expect(findHit(block, 0, HH.id)).toBeTruthy();
    expect(findHit(block, 1, HH.id)).toBeUndefined();
  });
});

describe("hit edits", () => {
  it("setHit adds or updates a hit without mutating the input", () => {
    const block = parseDrumBlock("CC | ----");
    const added = setHit(block, 1, CC, "choke");

    expect(findHit(added, 1, CC.id)?.articulation).toBe("choke");
    expect(findHit(block, 1, CC.id)).toBeUndefined();
    expect(serializeDrumBlock(added)).toBe("CC | -c--");

    const accented = setHit(added, 1, CC, "accent");
    expect(findHit(accented, 1, CC.id)?.articulation).toBe("accent");
    expect(serializeDrumBlock(accented)).toBe("CC | -X--");
    expect(serializeDrumBlock(parseDrumBlock(serializeDrumBlock(accented)))).toBe("CC | -X--");
  });

  it("clearHit removes a hit through the explicit visual-edit helper", () => {
    const block = parseDrumBlock("HH | x-x-");
    const cleared = clearHit(block, 2, HH);

    expect(findHit(cleared, 2, HH.id)).toBeUndefined();
    expect(serializeDrumBlock(cleared)).toBe("HH | x---");
  });

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

describe("sticking edits", () => {
  it("setSticking and clearSticking edit the annotation lane without changing hits", () => {
    const block = parseDrumBlock("HH | x---\nSD | --o-");
    const withRight = setSticking(block, 0, "right");
    const withLeft = setSticking(withRight, 2, "left");
    const withBoth = setSticking(withLeft, 3, "both");
    const cleared = clearSticking(withBoth, 0);

    expect(findSticking(withBoth, 0)).toBe("right");
    expect(findSticking(withBoth, 2)).toBe("left");
    expect(findSticking(withBoth, 3)).toBe("both");
    expect(findHit(withBoth, 0, HH.id)).toBeTruthy();
    expect(findHit(withBoth, 2, SD.id)).toBeTruthy();
    expect(serializeDrumBlock(withBoth)).toBe("ST | R-LB\nHH | x---\nSD | --o-");
    expect(serializeDrumBlock(cleared)).toBe("ST | --LB\nHH | x---\nSD | --o-");
  });

  it("removes the sticking row when the last sticking mark is cleared", () => {
    const block = parseDrumBlock("ST | R---\nHH | x---");
    const cleared = clearSticking(block, 0);

    expect(findSticking(cleared, 0)).toBeUndefined();
    expect(serializeDrumBlock(cleared)).toBe("HH | x---");
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

describe("bar edits", () => {
  it("insertBarAfter adds an empty bar sized from the current time and grid", () => {
    const block = parseDrumBlock("HH | x--- | --x-\nSD | ---- | --o-");
    const edited = insertBarAfter(block, 0);

    expect(edited.systems).toHaveLength(1);
    expect(edited.bars).toHaveLength(3);
    expect(edited.bars.map((bar) => bar.slots.length)).toEqual([4, 16, 4]);
    expect(serializeDrumBlock(edited)).toBe(
      "HH | x--- | ---------------- | --x-\nSD | ---- | ---------------- | --o-"
    );
  });

  it("insertBarAfter can place an empty bar in a new system", () => {
    const block = parseDrumBlock("HH | x---\nSD | --o-");
    const edited = insertBarAfter(block, 0, "new-system");

    expect(edited.systems).toHaveLength(2);
    expect(serializeDrumBlock(edited)).toBe(
      "HH | x---\nSD | --o-\nBar\nHH | ----------------\nSD | ----------------"
    );
  });

  it("insertBarAfter uses 32 slots for empty bars when Grid is 32", () => {
    const block = parseDrumBlock("Grid: 32\nHH | x---");
    const edited = insertBarAfter(block, 0);

    expect(edited.bars.map((bar) => bar.slots.length)).toEqual([4, 32]);
    expect(serializeDrumBlock(edited)).toBe(`Grid: 32
HH | x--- | --------------------------------`);
  });

  it("duplicateBar copies a bar in the same system", () => {
    const block = parseDrumBlock("ST | R--- | --L-\nHH | x--- | --x-\nSD | ---- | --o-");
    const edited = duplicateBar(block, 1);

    expect(edited.systems).toHaveLength(1);
    expect(edited.bars).toHaveLength(3);
    expect(serializeDrumBlock(edited)).toBe("ST | R--- | --L- | --L-\nHH | x--- | --x- | --x-\nSD | ---- | --o- | --o-");
  });

  it("duplicateBar can place the copy in a new system", () => {
    const block = parseDrumBlock("HH | x--- | --x-\nSD | ---- | --o-");
    const edited = duplicateBar(block, 1, "new-system");

    expect(edited.systems).toHaveLength(2);
    expect(serializeDrumBlock(edited)).toBe("HH | x--- | --x-\nSD | ---- | --o-\nBar\nHH | --x-\nSD | --o-");
  });

  it("duplicateBarToNextSystem creates an untitled next system when none exists", () => {
    const block = parseDrumBlock("HH | x--- | --x-\nSD | ---- | --o-");
    const edited = duplicateBarToNextSystem(block, 1);

    expect(edited.systems).toHaveLength(2);
    expect(edited.systems[1].subtitle).toBeUndefined();
    expect(serializeDrumBlock(edited)).toBe("HH | x--- | --x-\nSD | ---- | --o-\nBar\nHH | --x-\nSD | --o-");
  });

  it("duplicateBarToNextSystem appends to the existing next system and preserves its subtitle", () => {
    const block = parseDrumBlock(`Subtitle: Groove
HH | x--- | --x-
SD | ---- | --o-
Bar
Subtitle: Fill
BD | o---`);
    const edited = duplicateBarToNextSystem(block, 1);

    expect(edited.systems).toHaveLength(2);
    expect(edited.systems[1].subtitle).toBe("Fill");
    expect(serializeDrumBlock(edited)).toBe(`Subtitle: Groove
HH | x--- | --x-
SD | ---- | --o-
Bar
Subtitle: Fill
BD | o---
HH | ---- | --x-
SD | ---- | --o-`);
  });

  it("duplicateBarToNextSystem preserves copied sticking and articulations", () => {
    const block = parseDrumBlock(`ST | R--- | --L-
HH | X--- | --x-
SD | ---- | --o-
Bar
BD | o---`);
    const edited = duplicateBarToNextSystem(block, 0);
    const copiedStart = edited.bars[3].startSlot;

    expect(findSticking(edited, copiedStart)).toBe("right");
    expect(findHit(edited, copiedStart, HH.id)?.articulation).toBe("accent");
    expect(serializeDrumBlock(parseDrumBlock(serializeDrumBlock(edited)))).toBe(serializeDrumBlock(edited));
  });

  it("duplicateBarToNextSystem copies a repeat bar as a normal editable bar", () => {
    const block = parseDrumBlock("HH | x---\n%x3");
    const edited = duplicateBarToNextSystem(block, 1);

    expect(edited.systems).toHaveLength(2);
    expect(edited.systems[1].bars[0].measureRepeat).toBeUndefined();
    expect(findHit(edited, edited.systems[1].bars[0].startSlot, HH.id)).toBeTruthy();
    expect(serializeDrumBlock(parseDrumBlock(serializeDrumBlock(edited)))).toBe(serializeDrumBlock(edited));
  });

  it("deleteBar removes a bar and drops empty systems", () => {
    const block = parseDrumBlock("HH | x---\nBar\nSD | --o-");
    const edited = deleteBar(block, 0);

    expect(edited.systems).toHaveLength(1);
    expect(edited.bars).toHaveLength(1);
    expect(serializeDrumBlock(edited)).toBe("SD | --o-");
  });

  it("bar edits are no-ops for missing bar indexes", () => {
    const block = parseDrumBlock("HH | x---");

    expect(insertBarAfter(block, 99)).toEqual(block);
    expect(duplicateBar(block, -1)).toEqual(block);
    expect(deleteBar(block, 3)).toEqual(block);
  });

  it("preserves measure-repeat notation when editing a source bar", () => {
    const block = parseDrumBlock("ST | R---\nHH | x---\n%x3");
    const edited = setSticking(setHit(block, 2, HH), 2, "left");

    expect(findHit(edited, 6, HH.id)).toBeTruthy();
    expect(findHit(edited, 10, HH.id)).toBeTruthy();
    expect(findHit(edited, 14, HH.id)).toBeTruthy();
    expect(findSticking(edited, 10)).toBe("left");
    expect(serializeDrumBlock(edited)).toBe("ST | R-L-\nHH | x-x-\n%x3");
  });

  it("bar edits remain serialize round-trip stable", () => {
    const block = parseDrumBlock("Title: Bar edit\nHH | x--- | --x-\nSD | ---- | --o-");
    const edited = deleteBar(duplicateBar(insertBarAfter(block, 0), 2), 1);
    const text = serializeDrumBlock(edited);

    expect(serializeDrumBlock(parseDrumBlock(text))).toBe(text);
  });

  it("preserves subtitles through same-system edits and leaves new systems untitled", () => {
    const block = parseDrumBlock(`Subtitle: Groove
ST | R---
HH | x---
Bar
Subtitle: Fill
SD | oooo`);
    const withHitEdit = setHit(block, 2, HH);
    const sameSystemCopy = duplicateBar(withHitEdit, 0);
    const withNewSystem = insertBarAfter(sameSystemCopy, 1, "new-system");

    expect(withNewSystem.systems.map((system) => system.subtitle)).toEqual([
      "Groove",
      undefined,
      "Fill"
    ]);
    expect(serializeDrumBlock(withNewSystem)).toContain(`Subtitle: Groove
ST | R--- | R---
HH | x-x- | x-x-
Bar
HH | ----------------
Bar
Subtitle: Fill
SD | oooo`);
  });

  it("preserves subtitles through sticking, articulation, and repeat edits", () => {
    const block = parseDrumBlock(`Subtitle: Practice
ST | R--- | ----
HH | x--- | ----
SD | --o- | ----`);
    const withSticking = setSticking(block, 1, "left");
    const withAccent = applyArticulation(withSticking, 0, HH, "accent");
    const withRepeat = setBarRepeat(withAccent, 1);

    expect(withRepeat.systems[0].subtitle).toBe("Practice");
    expect(serializeDrumBlock(withRepeat)).toBe(`Subtitle: Practice
ST | RL--
HH | X---
SD | --o-
%`);
  });

  it("removes a subtitle when its final system bar is deleted", () => {
    const block = parseDrumBlock(`Subtitle: Intro
HH | x---
Bar
Subtitle: Fill
SD | oooo`);
    const edited = deleteBar(block, 0);

    expect(edited.systems).toHaveLength(1);
    expect(edited.systems[0].subtitle).toBe("Fill");
    expect(serializeDrumBlock(edited)).toBe(`Subtitle: Fill
SD | oooo`);
  });

  it("setBarRepeat marks a bar as a one-bar repeat of the previous bar", () => {
    const block = parseDrumBlock("HH | x--- | ----\nSD | ---- | --o-");
    const edited = setBarRepeat(block, 1);

    expect(edited.bars[1].measureRepeat).toBe(1);
    expect(findHit(edited, 4, HH.id)).toBeTruthy();
    expect(findHit(edited, 6, SD.id)).toBeUndefined();
    expect(serializeDrumBlock(edited)).toBe("HH | x---\nSD | ----\n%");
  });

  it("setBarRepeat can repeat across a system boundary", () => {
    const block = parseDrumBlock("HH | x---\nBar\nHH | ----");
    const edited = setBarRepeat(block, 1);

    expect(edited.systems).toHaveLength(2);
    expect(edited.bars[1].measureRepeat).toBe(1);
    expect(serializeDrumBlock(edited)).toBe("HH | x---\nBar\n%");
  });

  it("setBarRepeat is a no-op for the first or missing bar", () => {
    const block = parseDrumBlock("HH | x---");

    expect(setBarRepeat(block, 0)).toEqual(block);
    expect(setBarRepeat(block, 4)).toEqual(block);
  });

  it("clearBarRepeat turns a repeat bar back into an editable copied bar", () => {
    const block = parseDrumBlock("HH | x---\n%x2");
    const edited = clearBarRepeat(block, 1);

    expect(edited.bars[1].measureRepeat).toBeUndefined();
    expect(edited.bars[2].measureRepeat).toBe(1);
    expect(serializeDrumBlock(edited)).toBe("HH | x--- | x---\n%");
  });

  it("repeat toggle edits remain serialize round-trip stable", () => {
    const block = parseDrumBlock("Title: Repeat toggle\nHH | x--- | ----\nSD | ---- | --o-");
    const text = serializeDrumBlock(clearBarRepeat(setBarRepeat(block, 1), 1));

    expect(serializeDrumBlock(parseDrumBlock(text))).toBe(text);
  });
});
