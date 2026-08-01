import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYGROUND_EXAMPLE_ID,
  getPlaygroundExample,
  PLAYGROUND_EXAMPLE_CATEGORIES,
  PLAYGROUND_EXAMPLES
} from "../web/src/examples";

describe("playground examples", () => {
  it("uses unique stable ids and known categories", () => {
    const categoryIds = new Set(PLAYGROUND_EXAMPLE_CATEGORIES.map((category) => category.id));
    const exampleIds = PLAYGROUND_EXAMPLES.map((example) => example.id);

    expect(new Set(exampleIds).size).toBe(exampleIds.length);
    for (const example of PLAYGROUND_EXAMPLES) {
      expect(example.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(categoryIds.has(example.category)).toBe(true);
      expect(example.source.trim()).not.toBe("");
    }
  });

  it("keeps every category populated in picker order", () => {
    const groupedNames = PLAYGROUND_EXAMPLE_CATEGORIES.map((category) => ({
      label: category.label,
      names: PLAYGROUND_EXAMPLES.filter((example) => example.category === category.id).map((example) => example.name)
    }));

    expect(groupedNames).toEqual([
      {
        label: "Getting started",
        names: ["Basic rock groove", "Groove with fill", "Syncopated funk", "Rests and off-beats"]
      },
      {
        label: "Meters and feels",
        names: ["6/8 ballad", "7/8 groove", "9/8 groove", "12/8 blues shuffle"]
      },
      {
        label: "Tuplets",
        names: ["Triplet fill", "Triplet shuffle", "Partial-beat tuplets", "Mixed tuplets", "Multi-beat tuplets"]
      },
      {
        label: "Notation features",
        names: [
          "Sticking lane",
          "System subtitles",
          "One-bar repeat",
          "Counted repeat",
          "Articulations",
          "Open and half-open hats"
        ]
      },
      {
        label: "Sounds and advanced examples",
        names: ["Cymbal synth test", "32nd-note fill", "Full kit legend"]
      }
    ]);
  });

  it("resolves the default example by stable id", () => {
    expect(getPlaygroundExample(DEFAULT_PLAYGROUND_EXAMPLE_ID)?.name).toBe("Basic rock groove");
    expect(getPlaygroundExample("missing-example")).toBeUndefined();
  });
});
