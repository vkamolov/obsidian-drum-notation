import { describe, expect, it } from "vitest";
import { getArticulation, getVelocity, INSTRUMENTS_BY_ALIAS, isRest } from "../src/kit";

describe("getArticulation", () => {
  it("maps accent characters", () => {
    for (const char of ["O", "X", "!", "#", ">"]) {
      expect(getArticulation(char)).toBe("accent");
    }
  });

  it("maps the remaining articulation characters", () => {
    expect(getArticulation("g")).toBe("ghost");
    expect(getArticulation("f")).toBe("flam");
    expect(getArticulation("d")).toBe("diddle");
    expect(getArticulation("z")).toBe("buzz");
    expect(getArticulation("Z")).toBe("buzz");
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
    expect(getVelocity("d")).toBe(0.75);
    expect(getVelocity("x")).toBe(0.75);
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
    expect(INSTRUMENTS_BY_ALIAS.get("hh")?.id).toBe("closed-hat");
    expect(INSTRUMENTS_BY_ALIAS.get("ho")?.id).toBe("half-open-hat");
    expect(INSTRUMENTS_BY_ALIAS.get("hho")?.id).toBe("half-open-hat");
    expect(INSTRUMENTS_BY_ALIAS.get("sd")?.id).toBe("snare");
  });

  it("returns undefined for unknown labels", () => {
    expect(INSTRUMENTS_BY_ALIAS.get("zzz")).toBeUndefined();
  });
});
