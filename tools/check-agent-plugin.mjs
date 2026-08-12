import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { digestRecords } from "./notation-digest.mjs";
import { loadBundledTsModule } from "./load-ts-module.mjs";
import { PLUGIN_ROOT, REPO_ROOT, SKILL_ROOT } from "./plugin-paths.mjs";
import { getValidatorProvenance } from "./validator-provenance.mjs";

function runNode(relativeScript, args = []) {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, relativeScript), ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`${relativeScript} failed:\n${result.stdout}${result.stderr}`);
  }
}

runNode("tools/generate-agent-plugin.mjs", ["--check"]);
runNode("tools/generate-kit-reference.mjs", ["--check"]);
runNode("tools/check-notation-reference.mjs");

const vendorRoot = path.join(PLUGIN_ROOT, "vendor", "agent-plugins-1.0.0");
const expectedAgentPluginSchemaChecksum = "0a4aad95ce337878ad38802ebf0daa3fde76abe3f65400c86bcbb1ec0b3ab883";
const schemaSource = await readFile(path.join(vendorRoot, "plugin.schema.json"), "utf8");
const checksums = JSON.parse(await readFile(path.join(vendorRoot, "checksums.json"), "utf8"));
const schemaChecksum = createHash("sha256").update(schemaSource).digest("hex");
if (checksums["plugin.schema.json"] !== expectedAgentPluginSchemaChecksum || schemaChecksum !== expectedAgentPluginSchemaChecksum) {
  throw new Error(`Vendored plugin schema checksum mismatch: ${schemaChecksum}`);
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const portable = JSON.parse(await readFile(path.join(PLUGIN_ROOT, "plugin.json"), "utf8"));
const portableValid = ajv.compile(JSON.parse(schemaSource));
if (!portableValid(portable)) {
  throw new Error(`Portable manifest is invalid: ${ajv.errorsText(portableValid.errors)}`);
}

const metadata = JSON.parse(await readFile(path.join(PLUGIN_ROOT, "metadata.json"), "utf8"));
const openai = JSON.parse(await readFile(path.join(PLUGIN_ROOT, ".codex-plugin", "plugin.json"), "utf8"));
const claude = JSON.parse(await readFile(path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8"));
const gemini = JSON.parse(await readFile(path.join(PLUGIN_ROOT, "gemini-extension.json"), "utf8"));
const sharedFields = ["name", "version", "description", "author", "homepage", "repository", "license", "keywords"];
for (const field of sharedFields) {
  if (JSON.stringify(portable[field]) !== JSON.stringify(openai[field]) ||
    JSON.stringify(openai[field]) !== JSON.stringify(claude[field]) ||
    JSON.stringify(claude[field]) !== JSON.stringify(metadata[field])) {
    throw new Error(`Manifest metadata drift in ${field}`);
  }
}
if (openai.skills !== "./skills/" || JSON.stringify(openai.interface) !== JSON.stringify(metadata.interface)) {
  throw new Error("OpenAI manifest skills/interface metadata is stale");
}
const allowedOpenAiKeys = new Set([...sharedFields, "skills", "interface"]);
const unexpectedOpenAiKeys = Object.keys(openai).filter((key) => !allowedOpenAiKeys.has(key));
if (unexpectedOpenAiKeys.length > 0) {
  throw new Error(`Unsupported OpenAI manifest fields: ${unexpectedOpenAiKeys.join(", ")}`);
}
const expectedClaudeSchema = "https://json.schemastore.org/claude-code-plugin-manifest.json";
const allowedClaudeKeys = new Set(["$schema", ...sharedFields, "displayName"]);
const unexpectedClaudeKeys = Object.keys(claude).filter((key) => !allowedClaudeKeys.has(key));
if (claude.$schema !== expectedClaudeSchema || claude.displayName !== metadata.interface.displayName || unexpectedClaudeKeys.length > 0) {
  throw new Error(`Claude manifest metadata is stale or unsupported: ${unexpectedClaudeKeys.join(", ")}`);
}
const allowedGeminiKeys = new Set(["name", "version", "description"]);
const unexpectedGeminiKeys = Object.keys(gemini).filter((key) => !allowedGeminiKeys.has(key));
for (const field of allowedGeminiKeys) {
  if (gemini[field] !== metadata[field]) {
    throw new Error(`Gemini extension metadata drift in ${field}`);
  }
}
if (unexpectedGeminiKeys.length > 0) {
  throw new Error(`Unsupported Gemini extension fields: ${unexpectedGeminiKeys.join(", ")}`);
}
const interfaceTextFields = ["displayName", "shortDescription", "longDescription", "developerName", "category", "websiteURL"];
if (interfaceTextFields.some((field) => typeof openai.interface?.[field] !== "string" || openai.interface[field].trim() === "") ||
  !Array.isArray(openai.interface?.capabilities) || !openai.interface.capabilities.every((value) => typeof value === "string") ||
  !Array.isArray(openai.interface?.defaultPrompt) || openai.interface.defaultPrompt.length === 0 ||
  !openai.interface.defaultPrompt.every((value) => typeof value === "string" && value.trim() !== "")) {
  throw new Error("OpenAI interface metadata does not satisfy local packaging rules");
}
const iconRelativePath = "./assets/drum-notation-importer.png";
if (openai.interface.brandColor !== "#6C5CE7" || openai.interface.composerIcon !== iconRelativePath || openai.interface.logo !== iconRelativePath) {
  throw new Error("OpenAI visual metadata is stale");
}
const assetsRoot = path.join(PLUGIN_ROOT, "assets");
const assetEntries = await readdir(assetsRoot);
if (JSON.stringify(assetEntries.sort()) !== JSON.stringify(["drum-notation-importer.png"])) {
  throw new Error(`Unexpected importer assets: ${assetEntries.join(", ")}`);
}
const iconBytes = await readFile(path.join(PLUGIN_ROOT, iconRelativePath.slice(2)));
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (!iconBytes.subarray(0, 8).equals(pngSignature) || iconBytes.readUInt32BE(16) !== 1024 || iconBytes.readUInt32BE(20) !== 1024) {
  throw new Error("Importer icon must be a 1024x1024 PNG");
}
if (!/^\d+\.\d+\.\d+$/.test(metadata.version)) {
  throw new Error(`Importer version must be exact semver: ${metadata.version}`);
}

const reportSchema = JSON.parse(await readFile(path.join(PLUGIN_ROOT, "skills", "import-drum-score", "references", "drum-import-report.schema.json"), "utf8"));
ajv.compile(reportSchema);
const pilotSchema = JSON.parse(await readFile(path.join(PLUGIN_ROOT, "pilot", "pilot-record.schema.json"), "utf8"));
ajv.compile(pilotSchema);
const aggregateSchema = JSON.parse(await readFile(path.join(PLUGIN_ROOT, "pilot", "pilot-aggregate.schema.json"), "utf8"));
const validateAggregate = ajv.compile(aggregateSchema);
const aggregate = JSON.parse(await readFile(path.join(PLUGIN_ROOT, "pilot", "aggregate.json"), "utf8"));
if (!validateAggregate(aggregate)) {
  throw new Error(`Pilot aggregate is invalid: ${ajv.errorsText(validateAggregate.errors)}`);
}
const skillSource = await readFile(path.join(PLUGIN_ROOT, "skills", "import-drum-score", "SKILL.md"), "utf8");
if (!/^---\nname: import-drum-score\ndescription: .+\n---\n/s.test(skillSource) || skillSource.includes("[TODO:")) {
  throw new Error("Skill frontmatter is invalid or still contains TODO placeholders");
}
if (!skillSource.includes("<skill-directory>/scripts/validate-drum-notation.mjs") || skillSource.includes("<plugin-root>/scripts/validate-drum-notation.mjs")) {
  throw new Error("Skill validator instructions must remain self-contained");
}
if (await stat(path.join(PLUGIN_ROOT, "scripts", "validate-drum-notation.mjs")).then(() => true).catch(() => false)) {
  throw new Error("Bundled validator must live inside the import-drum-score skill");
}
for (const forbidden of ["agents", "mcp.json", ".mcp.json", "hooks", path.join("skills", "import-drum-score", "agents")]) {
  const forbiddenPath = path.join(PLUGIN_ROOT, forbidden);
  if (await stat(forbiddenPath).then(() => true).catch(() => false)) {
    throw new Error(`${forbidden} is outside the 0.1 package scope`);
  }
}

const knownDigest = digestRecords([["b.txt", "two\r\n"], ["a.txt", "\uFEFFone\r"]]);
if (knownDigest !== "b3c3efa9da7d73bea4f48367902a6beaa94bc9b9e49f0dc757aea23dcacfea68") {
  throw new Error(`Notation digest known fixture changed: ${knownDigest}`);
}

const provenance = await getValidatorProvenance();
const validatorPath = path.join(SKILL_ROOT, "scripts", "validate-drum-notation.mjs");
const bundledValidatorSource = await readFile(validatorPath, "utf8");
if (/\b(?:fetch|WebSocket|EventSource|XMLHttpRequest|sendBeacon)\s*\(/.test(bundledValidatorSource) || /node:(?:http|https|net|tls)/.test(bundledValidatorSource)) {
  throw new Error("Bundled validator must remain network-free");
}
const versionRun = spawnSync(process.execPath, [validatorPath, "--version"], { encoding: "utf8" });
if (versionRun.status !== 0) {
  throw new Error(`Bundled validator --version failed: ${versionRun.stderr}`);
}
const bundledVersion = JSON.parse(versionRun.stdout);
for (const [key, value] of Object.entries(provenance)) {
  if (bundledVersion[key] !== value) {
    throw new Error(`Bundled validator ${key} is stale: ${bundledVersion[key]} != ${value}`);
  }
}

const current = await loadBundledTsModule(
  'export { validateDrumNotation } from "./src/validation.ts"; export { PLAYGROUND_EXAMPLES } from "./web/src/examples.ts";',
  REPO_ROOT
);
const fixtures = [
  ...current.PLAYGROUND_EXAMPLES.map((example) => ({ name: example.id, source: example.source })),
  { name: "invalid-empty", source: "Title: Empty" },
  { name: "warning-character", source: "HH | x?--------------" },
  { name: "boundary-grid-32", source: "Grid: 32\nHH | x-------------------------------" },
  {
    name: "cymbal-position-regression",
    source: "Time: 3/4\nVoicing: split\nCR | x-----------\nHH | --x-x-x-x-x-\nSD | ----Og-g---d\nBD | o-------o-o-"
  }
];

for (const fixture of fixtures) {
  const expected = current.validateDrumNotation(fixture.source);
  const run = spawnSync(process.execPath, [validatorPath], { input: fixture.source, encoding: "utf8" });
  const actual = JSON.parse(run.stdout);
  const expectedExit = actual.status === "invalid" ? 1 : actual.status === "warnings" ? 2 : 0;
  if (run.status !== expectedExit) {
    throw new Error(`Bundled validator exit mismatch for ${fixture.name}: ${run.status} != ${expectedExit}`);
  }
  for (const field of ["status", "normalized", "warnings", "errors"]) {
    if (JSON.stringify(actual[field]) !== JSON.stringify(expected[field])) {
      throw new Error(`Bundled/current validator mismatch for ${fixture.name} field ${field}`);
    }
  }
  if (fixture.name === "invalid-empty" &&
    (actual.status !== "invalid" || run.status !== 1 || !actual.errors.includes("No supported drum rows were parsed."))) {
    throw new Error("Rows-less notation must remain invalid JSON with exit code 1");
  }
}

const usageRun = spawnSync(process.execPath, [validatorPath, "--unknown"], { encoding: "utf8" });
if (usageRun.status !== 1 || JSON.parse(usageRun.stdout).status !== "invalid") {
  throw new Error("Bundled validator usage errors must emit authoritative invalid JSON and exit 1");
}

const claudeValidation = spawnSync("claude", ["plugin", "validate", PLUGIN_ROOT, "--strict"], { encoding: "utf8" });
if (!claudeValidation.error && claudeValidation.status !== 0) {
  throw new Error(`Claude plugin validation failed:\n${claudeValidation.stdout}${claudeValidation.stderr}`);
}

const obsidianRelease = await readFile(path.join(REPO_ROOT, ".github", "workflows", "release.yml"), "utf8");
const importerRelease = await readFile(path.join(REPO_ROOT, ".github", "workflows", "release-agent-plugin.yml"), "utf8");
const pagesRelease = await readFile(path.join(REPO_ROOT, ".github", "workflows", "pages.yml"), "utf8");
if (!/tags-ignore:\s*\n\s*- ["']agent-plugin-v\*["']/.test(obsidianRelease) || /\n\s+tags:\s*\n/.test(obsidianRelease)) {
  throw new Error("Obsidian release workflow must ignore agent-plugin-v* tags without a competing tags filter");
}
if (!/tags:\s*\n\s*- ["']agent-plugin-v\*["']/.test(importerRelease) || !importerRelease.includes("^agent-plugin-v[0-9]+\\.[0-9]+\\.[0-9]+$")) {
  throw new Error("Importer release workflow tag routing is stale");
}
if (/\n\s+tags(?:-ignore)?:/.test(pagesRelease)) {
  throw new Error("Pages workflow must remain branch/manual only");
}

const trackedPilotFiles = execFileSync("git", ["ls-files", "agent-plugin/drum-notation-importer/pilot/records"], {
  cwd: REPO_ROOT,
  encoding: "utf8"
}).trim().split(/\s+/).filter(Boolean).filter((file) => !file.endsWith("/.gitignore"));
if (trackedPilotFiles.length > 0) {
  throw new Error(`Raw pilot records must not be tracked: ${trackedPilotFiles.join(", ")}`);
}

console.log(`Agent plugin checks passed for ${fixtures.length} conformance fixtures.`);
