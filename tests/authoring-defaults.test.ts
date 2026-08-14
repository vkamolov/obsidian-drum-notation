import { describe, expect, it } from "vitest";
import {
  DEFAULT_DRUM_AUTHORING_DEFAULTS,
  formatAuthoringGrouping,
  getExplicitAuthoringHeaderKeys,
  normalizeDrumAuthoringDefaults,
  parseAuthoringGrouping
} from "../src/authoring-defaults";

describe("drum authoring defaults", () => {
  it("normalizes missing and malformed saved settings to portable defaults", () => {
    expect(normalizeDrumAuthoringDefaults(null)).toEqual(DEFAULT_DRUM_AUTHORING_DEFAULTS);
    expect(normalizeDrumAuthoringDefaults({
      title: "  Practice  ",
      tempo: 999,
      timeSignature: "7/8",
      beamGrouping: [2, 2, 3],
      gridResolution: 32,
      voicing: "split",
      repeatCount: 0,
      showCursor: true,
      showHighlight: false,
      showRests: false,
      legendMode: "used"
    })).toEqual({
      title: "Practice",
      tempo: 260,
      timeSignature: "7/8",
      beamGrouping: [2, 2, 3],
      gridResolution: 32,
      voicing: "split",
      repeatCount: 1,
      showCursor: true,
      showHighlight: false,
      showRests: false,
      legendMode: "used"
    });
  });

  it("drops a saved grouping that is invalid for its meter", () => {
    expect(normalizeDrumAuthoringDefaults({
      timeSignature: "4/4",
      beamGrouping: [2, 2]
    }).beamGrouping).toBeUndefined();
  });

  it("parses and formats setting grouping values", () => {
    expect(parseAuthoringGrouping("2 + 2 + 3", "7/8")).toEqual([2, 2, 3]);
    expect(parseAuthoringGrouping("auto", "7/8")).toBeUndefined();
    expect(parseAuthoringGrouping("3+3", "7/8")).toBeNull();
    expect(formatAuthoringGrouping([3, 2, 2])).toBe("3+2+2");
    expect(formatAuthoringGrouping(undefined)).toBe("auto");
  });

  it("detects explicit supported headers and aliases without treating metadata as defaults", () => {
    expect([...getExplicitAuthoringHeaderKeys(`Title: Groove
BPM: 88
Meter: 7/8
Grouping: auto
Playback cursor: off
Note highlight: on
Instrument legend: used
Subdivision: 32
Author: Sam`)]).toEqual([
      "title",
      "tempo",
      "timeSignature",
      "beamGrouping",
      "showCursor",
      "showHighlight",
      "legendMode",
      "gridResolution"
    ]);
  });
});
