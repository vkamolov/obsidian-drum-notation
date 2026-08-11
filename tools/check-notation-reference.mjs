import { readFile } from "node:fs/promises";
import path from "node:path";
import { sourceChecksum } from "./notation-digest.mjs";
import { REFERENCE_ROOT, REPO_ROOT } from "./plugin-paths.mjs";

const metadataPath = path.join(REFERENCE_ROOT, "notation-reference.source.json");
const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
const canonicalPath = path.join(REPO_ROOT, metadata.source);
const canonical = await readFile(canonicalPath, "utf8");
const actual = sourceChecksum(canonical);

if (metadata.normalization !== "strip-bom-and-normalize-newlines") {
  throw new Error(`unsupported notation-reference normalization: ${metadata.normalization}`);
}
if (actual !== metadata.sha256) {
  throw new Error(
    `Notation reference review is stale (${metadata.sha256} -> ${actual}). Review the curated reference, then run npm run agent-plugin:acknowledge-notation-reference -- --confirm-reviewed.`
  );
}

console.log(`Notation reference acknowledges ${metadata.source} at ${actual}.`);
