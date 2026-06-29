import { describe, expect, it } from "vitest";
import {
  getAllowedArticulations,
  getArticulation,
  getArticulationForKey,
  getVelocity,
  INSTRUMENTS_BY_ALIAS,
  isArticulationAllowed,
  isRest
} from "../src/kit";

describe("getArticulation", () => {
  it("maps accent characters", () => {
    for (const char of ["O", "X", "!", "#", ">"]) {
      expect(getArticulation(char)).toBe("accent");
    }
  });

  it("maps the remaining articulation characters", () => {
    expect(getArticulation("g")).toBe("ghost");
    expect(getArticulation("f")).toBe("flam");
    expect(getArticulation("r")).toBe("drag");
    expect(getArticulation("d")).toBe("diddle");
    expect(getArticulation("z")).toBe("buzz");
    expect(getArticulation("Z")).toBe("buzz");
    expect(getArticulation("c")).toBe("choke");
  });

  it("treats anything else as a normal hit", () => {
    expect(getArticulation("x")).toBe("normal");
    expect(getArticulation("o")).toBe("normal");
    expect(getArticulation("?")).toBe("normal");
  });
});

describe("getVelocity", () => {
  it("derives velocity from the articulation table", () => {
    expect(getVelocity("O")).toBe(1);
    expect(getVelocity("g")).toBe(0.4);
    expect(getVelocity("z")).toBe(0.68);
    expect(getVelocity("f")).toBe(0.75);
    expect(getVelocity("r")).toBe(0.75);
    expect(getVelocity("d")).toBe(0.75);
    expect(getVelocity("c")).toBe(0.9);
    expect(getVelocity("x")).toBe(0.75);
  });
});

describe("getArticulationForKey", () => {
  it("maps explicit notation shortcut keys and rejects unsupported keys", () => {
    expect(getArticulationForKey("x")).toBe("normal");
    expect(getArticulationForKey("o")).toBe("normal");
    expect(getArticulationForKey("X")).toBe("accent");
    expect(getArticulationForKey("O")).toBe("accent");
    expect(getArticulationForKey("g")).toBe("ghost");
    expect(getArticulationForKey("f")).toBe("flam");
    expect(getArticulationForKey("r")).toBe("drag");
    expect(getArticulationForKey("d")).toBe("diddle");
    expect(getArticulationForKey("z")).toBe("buzz");
    expect(getArticulationForKey("c")).toBe("choke");
    expect(getArticulationForKey("?")).toBeNull();
  });
});

describe("isRest", () => {
  it("recognizes rest characters", () => {
    for (const char of ["-", ".", "_", " "]) {
      expect(isRest(char)).toBe(true);
    }
  });

  it("rejects hit characters", () => {
    for (const char of ["x", "o", "O", "g"]) {
      expect(isRest(char)).toBe(false);
    }
  });
});

describe("INSTRUMENTS_BY_ALIAS", () => {
  it("resolves labels and aliases to the same instrument", () => {
    expect(INSTRUMENTS_BY_ALIAS.get("bd")?.id).toBe("kick");
    expect(INSTRUMENTS_BY_ALIAS.get("bass")?.id).toBe("kick");
    expect(INSTRUMENTS_BY_ALIAS.get("kick")?.id).toBe("kick");
    expect(INSTRUMENTS_BY_ALIAS.get("bd2")?.id).toBe("second-kick");
    expect(INSTRUMENTS_BY_ALIAS.get("secondbassdrum")?.id).toBe("second-kick");
    expect(INSTRUMENTS_BY_ALIAS.get("hh")?.id).toBe("closed-hat");
    expect(INSTRUMENTS_BY_ALIAS.get("ho")?.id).toBe("half-open-hat");
    expect(INSTRUMENTS_BY_ALIAS.get("hho")?.id).toBe("half-open-hat");
    expect(INSTRUMENTS_BY_ALIAS.get("hfs")?.id).toBe("hi-hat-foot-splash");
    expect(INSTRUMENTS_BY_ALIAS.get("hihatsplash")?.id).toBe("hi-hat-foot-splash");
    expect(INSTRUMENTS_BY_ALIAS.get("sd")?.id).toBe("snare");
    expect(INSTRUMENTS_BY_ALIAS.get("rb")?.id).toBe("ride-bell");
    expect(INSTRUMENTS_BY_ALIAS.get("bell")?.id).toBe("ride-bell");
    expect(INSTRUMENTS_BY_ALIAS.get("ridebell")?.id).toBe("ride-bell");
  });

  it("returns undefined for unknown labels", () => {
    expect(INSTRUMENTS_BY_ALIAS.get("zzz")).toBeUndefined();
  });

  it("keeps ride bell and cowbell on distinct playback voices", () => {
    expect(INSTRUMENTS_BY_ALIAS.get("rb")?.playback).toBe("rideBell");
    expect(INSTRUMENTS_BY_ALIAS.get("bell")?.playback).toBe("rideBell");
    expect(INSTRUMENTS_BY_ALIAS.get("ridebell")?.playback).toBe("rideBell");
    expect(INSTRUMENTS_BY_ALIAS.get("cb")?.playback).toBe("cowbell");
  });

  it("renders ride bell as a diamond on the ride line", () => {
    expect(INSTRUMENTS_BY_ALIAS.get("rd")?.vexKey).toBe("f/5/X");
    expect(INSTRUMENTS_BY_ALIAS.get("rb")?.vexKey).toBe("f/5/d2");
    expect(INSTRUMENTS_BY_ALIAS.get("cb")?.vexKey).toBe("e/5/X");
  });
});

describe("getAllowedArticulations", () => {
  const instrument = (alias: string) => INSTRUMENTS_BY_ALIAS.get(alias)!;

  it("returns useful visual-edit choices by instrument family", () => {
    expect(getAllowedArticulations(instrument("cc"))).toEqual(["normal", "accent", "choke"]);
    expect(getAllowedArticulations(instrument("sd"))).toEqual(["normal", "accent", "ghost", "flam", "drag", "diddle", "buzz"]);
    expect(getAllowedArticulations(instrument("ft"))).toEqual(["normal", "accent", "flam", "drag", "diddle"]);
    expect(getAllowedArticulations(instrument("bd"))).toEqual(["normal", "accent", "flam"]);
    expect(getAllowedArticulations(instrument("bd2"))).toEqual(["normal", "accent", "flam"]);
    expect(getAllowedArticulations(instrument("hh"))).toEqual(["normal", "accent"]);
    expect(getAllowedArticulations(instrument("hfs"))).toEqual(["normal", "accent"]);
  });

  it("keeps less common cross-notehead voices on the default choices", () => {
    expect(getAllowedArticulations(instrument("rs"))).toEqual(["normal", "accent"]);
    expect(getAllowedArticulations(instrument("cb"))).toEqual(["normal", "accent"]);
    expect(isArticulationAllowed(instrument("cc"), "choke")).toBe(true);
    expect(isArticulationAllowed(instrument("hh"), "choke")).toBe(false);
  });
});
