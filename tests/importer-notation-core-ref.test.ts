import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getNotationCoreInfoAtGitRefSync, getNotationCoreInfoSync } from "../tools/notation-digest.mjs";

const metadata = JSON.parse(readFileSync("agent-plugin/drum-notation-importer/metadata.json", "utf8")) as {
  version: string;
  notationCoreRef: string;
};
const validatorPath = "agent-plugin/drum-notation-importer/skills/import-drum-score/scripts/validate-drum-notation.mjs";

describe("importer notation-core release pin", () => {
  it("builds importer 0.2.1 from the released 1.6.0 source graph", () => {
    const pinned = getNotationCoreInfoAtGitRefSync(process.cwd(), metadata.notationCoreRef);
    const current = getNotationCoreInfoSync(process.cwd());
    const versionRun = spawnSync(process.execPath, [validatorPath, "--version"], { encoding: "utf8" });
    const bundled = JSON.parse(versionRun.stdout) as {
      importerVersion: string;
      notationCoreVersion: string;
      notationCoreDigest: string;
    };

    expect(metadata.notationCoreRef).toBe("1.6.0");
    expect(pinned.version).toBe(metadata.notationCoreRef);
    expect(pinned.digest).toBe("3920b0e9d89585623dac697f7cabef47f5592536e9dbd86fbe621c113b70fd26");
    expect(pinned.inputs).toContain("src/validation.ts");
    expect(pinned.inputs.every((input: string) => input.startsWith("src/"))).toBe(true);
    expect(current.version).not.toBe(pinned.version);
    expect(versionRun.status).toBe(0);
    expect(bundled).toMatchObject({
      importerVersion: metadata.version,
      notationCoreVersion: pinned.version,
      notationCoreDigest: pinned.digest,
    });
  });

  it("rejects non-release and unavailable core refs", () => {
    expect(() => getNotationCoreInfoAtGitRefSync(process.cwd(), "main")).toThrow(/exact semver/);
    expect(() => getNotationCoreInfoAtGitRefSync(process.cwd(), "99.99.99")).toThrow(/cannot read manifest/);
  });
});
