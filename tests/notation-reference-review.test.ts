import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sourceChecksum } from "../tools/notation-digest.mjs";
import { acknowledgeNotationReference } from "../tools/notation-reference-review.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createReviewRepository(source = "# Format\n\nOriginal.\n") {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "notation-review-test-"));
  temporaryRoots.push(repoRoot);
  const referenceRoot = path.join(repoRoot, "references");
  await mkdir(path.join(repoRoot, "docs"), { recursive: true });
  await mkdir(referenceRoot, { recursive: true });
  await writeFile(path.join(repoRoot, "docs", "notation-format.md"), source);
  await writeFile(path.join(referenceRoot, "notation-reference.md"), "# Curated reference\n");
  await writeFile(path.join(referenceRoot, "notation-reference.source.json"), JSON.stringify({
    source: "docs/notation-format.md",
    normalization: "strip-bom-and-normalize-newlines",
    sha256: sourceChecksum(source)
  }, null, 2) + "\n");
  execFileSync("git", ["init", "-q"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "tests@example.invalid"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "Tests"], { cwd: repoRoot });
  execFileSync("git", ["add", "."], { cwd: repoRoot });
  execFileSync("git", ["commit", "-qm", "initial"], { cwd: repoRoot });
  return { repoRoot, referenceRoot };
}

function capture() {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (value: string) => { stdout += value; } },
    stderr: { write: (value: string) => { stderr += value; } },
    output: () => ({ stdout, stderr })
  };
}

describe("notation reference acknowledgment", () => {
  it("does nothing when content is unchanged or differs only by normalized newlines", async () => {
    const fixture = await createReviewRepository();
    const first = capture();
    const unchanged = await acknowledgeNotationReference({ ...fixture, stdout: first.stdout, stderr: first.stderr });
    expect(unchanged).toMatchObject({ changed: false, exitCode: 0 });

    const canonicalPath = path.join(fixture.repoRoot, "docs", "notation-format.md");
    await writeFile(canonicalPath, "# Format\r\n\r\nOriginal.\r\n");
    const newlineOnly = await acknowledgeNotationReference({ ...fixture, stdout: first.stdout, stderr: first.stderr });
    expect(newlineOnly).toMatchObject({ changed: false, exitCode: 0 });
  });

  it("prints the full stale-source diff and requires explicit confirmation", async () => {
    const fixture = await createReviewRepository();
    const metadataPath = path.join(fixture.referenceRoot, "notation-reference.source.json");
    const before = await readFile(metadataPath, "utf8");
    await writeFile(path.join(fixture.repoRoot, "docs", "notation-format.md"), "# Format\n\nOriginal.\n\nNew syntax.\n");
    const streams = capture();
    const result = await acknowledgeNotationReference({ ...fixture, stdout: streams.stdout, stderr: streams.stderr });
    expect(result).toMatchObject({ changed: false, exitCode: 1 });
    expect(streams.output().stdout).toContain("+New syntax.");
    expect(streams.output().stderr).toContain("--confirm-reviewed");
    expect(await readFile(metadataPath, "utf8")).toBe(before);
  });

  it("updates only the checksum after the curated reference is reconciled", async () => {
    const fixture = await createReviewRepository();
    const canonical = "# Format\n\nOriginal.\n\nNew syntax.\n";
    const referencePath = path.join(fixture.referenceRoot, "notation-reference.md");
    const curated = "# Curated reference\n\nNew syntax summarized.\n";
    await writeFile(path.join(fixture.repoRoot, "docs", "notation-format.md"), canonical);
    await writeFile(referencePath, curated);
    const streams = capture();
    const result = await acknowledgeNotationReference({ ...fixture, confirmed: true, stdout: streams.stdout, stderr: streams.stderr });
    expect(result).toMatchObject({ changed: true, exitCode: 0, checksum: sourceChecksum(canonical) });
    const metadata = JSON.parse(await readFile(path.join(fixture.referenceRoot, "notation-reference.source.json"), "utf8"));
    expect(metadata.sha256).toBe(sourceChecksum(canonical));
    expect(await readFile(referencePath, "utf8")).toBe(curated);
  });

  it("fails when the acknowledged source is unavailable in Git history", async () => {
    const fixture = await createReviewRepository();
    const metadataPath = path.join(fixture.referenceRoot, "notation-reference.source.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    metadata.sha256 = "f".repeat(64);
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + "\n");
    await writeFile(path.join(fixture.repoRoot, "docs", "notation-format.md"), "# Different\n");
    const streams = capture();
    await expect(acknowledgeNotationReference({ ...fixture, confirmed: true, stdout: streams.stdout, stderr: streams.stderr }))
      .rejects.toThrow("not available in Git history");
  });
});
