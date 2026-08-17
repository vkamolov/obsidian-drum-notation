import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readRepoFile = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

describe("importer recognition guidance", () => {
  it("keeps the observation and row re-observation workflow in the packaged skill", () => {
    const skill = readRepoFile("agent-plugin/drum-notation-importer/skills/import-drum-score/SKILL.md");
    const reference = readRepoFile("agent-plugin/drum-notation-importer/skills/import-drum-score/references/notation-reference.md");
    const validator = readRepoFile("agent-plugin/drum-notation-importer/skills/import-drum-score/scripts/validate-drum-notation.mjs");

    expect(skill).toContain("Observe before mapping");
    expect(skill).toContain("ask and stop before emitting provisional notation");
    expect(skill).toContain("never pad merely to clear the warning");
    expect(skill).toContain("row-length-reobserved");
    expect(skill).toContain("locate the five staff lines");
    expect(skill).toContain("ledger through the notehead");
    expect(skill).toContain("ledger immediately below it");
    expect(skill).toContain("Do not invent numeric measurements");
    expect(skill).toContain("require a focused crop containing the notehead and surrounding staff");
    expect(skill).toContain("recurring hi-hat pattern cannot override a distinct vertical cluster");
    expect(skill).toContain("cymbal-position-convention");
    expect(skill).toContain("cymbal-position-evidence");
    expect(skill).toContain("cymbal-position-unresolved");
    expect(skill).toMatch(/paired, non-empty section repeat that plays exactly twice/);
    expect(skill).toContain("Keep a supported section-repeat span in one block");
    expect(skill).toMatch(/Permit `%` (?:or|and) `%xN`/);
    expect(skill).toMatch(/never attach a boundary directly to a standalone measure-repeat line/i);
    expect(skill).toMatch(/Do not report a supported native section repeat as a workaround or loss/);
    expect(skill).toMatch(/flatten only after explicit user approval/);
    expect(skill).toContain("<skill-directory>/scripts/validate-drum-notation.mjs");
    expect(skill).not.toContain("<plugin-root>/scripts/validate-drum-notation.mjs");
    expect(validator).toContain("#!/usr/bin/env node");
    expect(reference).toContain("source legend or drum key as authoritative");
    expect(reference).toContain("generated x-notehead ladder");
    expect(reference).toContain("separate grace notehead");
    expect(reference).toContain("slash through the primary note's stem");
    expect(reference).toContain("clean validator result alone cannot prove");
    expect(reference).toContain("Keep the complete span in one `drums` block");
    expect(reference).toContain("appearance loss");
  });

  it("keeps detailed playground guidance and a concise manifest starter prompt", () => {
    const html = readRepoFile("web/index.html");
    const prompt = /<pre id="pg-import-prompt"[^>]*>([^<]+)<\/pre>/.exec(html)?.[1] ?? "";
    const metadata = JSON.parse(readRepoFile("agent-plugin/drum-notation-importer/metadata.json"));
    const starterPrompts = metadata.interface.defaultPrompt as string[];
    const skillAgent = readRepoFile("agent-plugin/drum-notation-importer/skills/import-drum-score/agents/openai.yaml");

    expect(prompt).toContain("import-drum-score skill");
    expect(prompt).toMatch(/instrument positions/i);
    expect(prompt).toMatch(/five staff lines/i);
    expect(prompt).toMatch(/ledger through the notehead/i);
    expect(prompt).toMatch(/focused crop containing the notehead and surrounding staff/i);
    expect(prompt).toMatch(/source legend/i);
    expect(prompt).toMatch(/row-length|length warnings/i);

    expect(starterPrompts).toHaveLength(3);
    expect(starterPrompts[0]).toMatch(/validated/i);
    expect(starterPrompts[0]).toMatch(/import report/i);
    expect(starterPrompts.every((value) => value.length <= 128)).toBe(true);
    expect(skillAgent).toContain("Use $import-drum-score");
    expect(skillAgent).toMatch(/validate/i);
    expect(skillAgent).toMatch(/import report/i);

    expect(prompt).not.toMatch(/\b(?:crash|flam|diddle)\b/i);
    expect(starterPrompts.join(" ")).not.toMatch(/\b(?:crash|flam|diddle)\b/i);
  });
});
