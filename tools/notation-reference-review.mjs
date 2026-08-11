import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sourceChecksum } from "./notation-digest.mjs";
import { stableJson } from "./plugin-paths.mjs";

export async function acknowledgeNotationReference({
  repoRoot,
  referenceRoot,
  confirmed = false,
  stdout = process.stdout,
  stderr = process.stderr
}) {
  const metadataPath = path.join(referenceRoot, "notation-reference.source.json");
  const referencePath = path.join(referenceRoot, "notation-reference.md");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  const canonicalPath = path.join(repoRoot, metadata.source);
  const currentSource = await readFile(canonicalPath, "utf8");
  const currentChecksum = sourceChecksum(currentSource);

  if (currentChecksum === metadata.sha256) {
    stdout.write("Notation reference checksum is already current.\n");
    return { changed: false, exitCode: 0, checksum: currentChecksum };
  }

  const history = spawnSync("git", ["log", "--format=%H", "--", metadata.source], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (history.status !== 0) {
    throw new Error(`Unable to inspect notation history: ${history.stderr.trim() || "git log failed"}`);
  }

  const commits = history.stdout.trim().split(/\s+/).filter(Boolean);
  let previousSource = null;
  let previousCommit = null;
  for (const commit of commits) {
    try {
      const source = execFileSync("git", ["show", `${commit}:${metadata.source}`], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      if (sourceChecksum(source) === metadata.sha256) {
        previousSource = source;
        previousCommit = commit;
        break;
      }
    } catch {
      // Older commits may predate the notation document.
    }
  }

  if (previousSource === null || previousCommit === null) {
    throw new Error("The previously acknowledged notation source is not available in Git history. Fetch full history before acknowledging.");
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "drum-notation-reference-"));
  try {
    const oldPath = path.join(tempDir, "acknowledged-notation-format.md");
    await writeFile(oldPath, previousSource);
    stdout.write(`Changes since acknowledged source ${previousCommit}:\n`);
    const diff = spawnSync("git", ["diff", "--no-index", "--", oldPath, canonicalPath], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    if (diff.status !== 0 && diff.status !== 1) {
      throw new Error(`Unable to display notation diff: ${diff.stderr.trim() || "git diff failed"}`);
    }
    stdout.write(diff.stdout || "(no byte-level diff after normalization)\n");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  if (!confirmed) {
    stderr.write(`No files changed. Reconcile ${path.relative(repoRoot, referencePath)}, then rerun with --confirm-reviewed.\n`);
    return { changed: false, exitCode: 1, checksum: currentChecksum };
  }

  metadata.sha256 = currentChecksum;
  await writeFile(metadataPath, stableJson(metadata));
  stdout.write(`Acknowledged notation reference at ${currentChecksum}.\n`);
  return { changed: true, exitCode: 0, checksum: currentChecksum };
}
