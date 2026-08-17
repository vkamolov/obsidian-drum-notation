import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("plugin metadata", () => {
  it("keeps the package and manifest descriptions aligned", () => {
    const packageJson = readJson("package.json");
    const manifest = readJson("manifest.json");
    const description = manifest.description;

    if (typeof description !== "string") {
      throw new Error("manifest description must be a string");
    }

    expect(packageJson.description).toBe(description);
    expect(description).toBe(
      "Create, hear, edit, and organize drum notation for practice, lessons, songs, and gigs, with playback, loops, and tempo tools.",
    );
    expect(description).toBe(description.trim());
    expect(description.length).toBeLessThanOrEqual(250);
    expect(description).toMatch(/[.!?]$/);
    expect(description).not.toMatch(/^Drum Notation\b/i);
    expect(description).not.toMatch(/^This plugin\b/i);
  });
});
