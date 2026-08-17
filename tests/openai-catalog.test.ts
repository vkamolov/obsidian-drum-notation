import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openAiSkillAgentYaml, validateOpenAiCatalogMetadata } from "../tools/openai-catalog.mjs";

type Metadata = {
  interface: {
    shortDescription: string;
    defaultPrompt: string[];
  };
  skillInterface: {
    shortDescription: string;
  };
};

function metadata(): Metadata {
  return JSON.parse(readFileSync("agent-plugin/drum-notation-importer/metadata.json", "utf8"));
}

describe("OpenAI final-directory metadata", () => {
  it("accepts canonical metadata and emits the supported skill-agent shape", () => {
    const canonical = metadata();
    expect(() => validateOpenAiCatalogMetadata(canonical)).not.toThrow();
    expect(openAiSkillAgentYaml(canonical)).toBe(
      "interface:\n" +
      "  display_name: \"Import Drum Score\"\n" +
      "  short_description: \"Transcribe printed drum score\"\n" +
      "  default_prompt: \"Use $import-drum-score to transcribe this printed drum score, validate it, and include the import report.\"\n" +
      "policy:\n" +
      "  allow_implicit_invocation: true\n",
    );
  });

  it("uses the stricter 30-character final short-description limit", () => {
    const changed = structuredClone(metadata());
    changed.interface.shortDescription = "x".repeat(31);
    expect(() => validateOpenAiCatalogMetadata(changed)).toThrow(/30 characters/);
  });

  it("rejects overlong, duplicated, multiline, and mention starter prompts", () => {
    const overlong = structuredClone(metadata());
    overlong.interface.defaultPrompt = ["x".repeat(129)];
    expect(() => validateOpenAiCatalogMetadata(overlong)).toThrow(/128 characters/);

    const duplicate = structuredClone(metadata());
    duplicate.interface.defaultPrompt = ["Read this score", "  READ   THIS   SCORE  "];
    expect(() => validateOpenAiCatalogMetadata(duplicate)).toThrow(/unique/);

    const multiline = structuredClone(metadata());
    multiline.interface.defaultPrompt = ["Read this\nscore"];
    expect(() => validateOpenAiCatalogMetadata(multiline)).toThrow(/one line/);

    const mention = structuredClone(metadata());
    mention.interface.defaultPrompt = ["Use @drums for this score"];
    expect(() => validateOpenAiCatalogMetadata(mention)).toThrow(/@mention/);
  });

  it("also keeps the skill-level short description within the final limit", () => {
    const changed = structuredClone(metadata());
    changed.skillInterface.shortDescription = "Transcribe printed drum notation";
    expect(() => validateOpenAiCatalogMetadata(changed)).toThrow(/30 characters/);
  });
});
