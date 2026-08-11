import { readFile } from "node:fs/promises";
import path from "node:path";
import { digestRecords, getNotationCoreInfo } from "./notation-digest.mjs";
import { PLUGIN_ROOT, REPO_ROOT, stableJson } from "./plugin-paths.mjs";

export async function getValidatorProvenance() {
  const metadata = JSON.parse(await readFile(path.join(PLUGIN_ROOT, "metadata.json"), "utf8"));
  const core = await getNotationCoreInfo(REPO_ROOT);
  const validatorSource = await readFile(path.join(PLUGIN_ROOT, "validator-src", "validator.ts"), "utf8");
  const buildSource = await readFile(path.join(REPO_ROOT, "tools", "build-agent-plugin.mjs"), "utf8");
  const validatorBuildDigest = digestRecords([
    ["agent-plugin/drum-notation-importer/validator-src/validator.ts", validatorSource],
    ["tools/build-agent-plugin.mjs", buildSource],
    ["virtual/importer-metadata.json", stableJson(metadata)],
    ["virtual/notation-core.txt", `${core.version}\n${core.digest}\n`]
  ]);

  return {
    importerVersion: metadata.version,
    notationCoreVersion: core.version,
    notationCoreDigest: core.digest,
    validatorBuildDigest
  };
}
