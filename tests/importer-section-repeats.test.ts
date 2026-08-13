import { describe, expect, it } from "vitest";
import { parseDrumBlockWithWarnings } from "../src/parser";
import { serializeDrumBlock } from "../src/serializer";
import { validateDrumNotation } from "../src/validation";

const supportedCases = [
  {
    name: "same-system section repeat",
    source: `HH [ x--- | -x-- ]
SD [ ---- | --o- ]`,
    range: { startBarIndex: 0, endBarIndex: 1 }
  },
  {
    name: "cross-system section repeat",
    source: `HH | x--- [ -x--
SD | ---- [ --o-
Bar
HH | --x- ] ---x
SD | ---- ] o---`,
    range: { startBarIndex: 1, endBarIndex: 2 }
  },
  {
    name: "compact measure repeats inside a section",
    source: `HH [ x---
SD [ --o-
%x3
HH | --x- ]
SD | o--- ]`,
    range: { startBarIndex: 0, endBarIndex: 4 }
  },
  {
    name: "explicit expansion where a measure-repeat boundary was observed",
    source: `HH [ x--- | x--- ]
SD [ --o- | --o- ]`,
    range: { startBarIndex: 0, endBarIndex: 1 }
  }
];

describe("importer 0.2 section-repeat conformance", () => {
  it.each(supportedCases)("validates and normalizes $name", ({ source, range }) => {
    const result = validateDrumNotation(source);
    const parsed = parseDrumBlockWithWarnings(result.normalized);

    expect(result.status).toBe("clean");
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(parsed.block.sectionRepeats).toEqual([range]);
    expect(serializeDrumBlock(parsed.block)).toBe(result.normalized);
  });

  it.each([
    ["unmatched", "HH [ x--- | -x--", "invalid-section-repeat"],
    ["empty", "HH [ ] x---", "invalid-section-repeat"],
    ["nested or overlapping", "HH [ x--- [ -x-- ] --x- ]", "invalid-section-repeat"],
    ["adjacent", "HH [ x--- ] [ -x-- ]", "invalid-section-repeat"],
    ["conflicting rows", "HH [ x--- | -x-- ] --x-\nSD | ---- [ --o- | ---- ]", "section-repeat-mismatch"]
  ])("keeps %s navigation out of the playable roadmap", (_name, source, warningCode) => {
    const parsed = parseDrumBlockWithWarnings(source);

    expect(parsed.block.sectionRepeats).toEqual([]);
    expect(parsed.warnings.some((warning) => warning.code === warningCode)).toBe(true);
  });
});
