import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openAiSkillAgentYaml, validateOpenAiCatalogMetadata } from "./openai-catalog.mjs";
import { PLUGIN_ROOT, REPO_ROOT } from "./plugin-paths.mjs";

const metadata = JSON.parse(await readFile(path.join(PLUGIN_ROOT, "metadata.json"), "utf8"));
validateOpenAiCatalogMetadata(metadata);

const dossierPath = path.join(PLUGIN_ROOT, "submission", "openai-catalog.json");
const dossier = JSON.parse(await readFile(dossierPath, "utf8"));
const expectedListing = {
  displayName: metadata.interface.displayName,
  developerName: metadata.interface.developerName,
  category: metadata.interface.category,
  shortDescription: metadata.interface.shortDescription,
  longDescription: metadata.interface.longDescription,
  websiteURL: metadata.interface.websiteURL,
  privacyPolicyURL: metadata.interface.privacyPolicyURL,
  termsOfServiceURL: metadata.interface.termsOfServiceURL,
  supportURL: metadata.interface.supportURL
};

if (dossier.schemaVersion !== 1 || dossier.pluginVersion !== metadata.version || dossier.submissionType !== "skills-only") {
  throw new Error("OpenAI catalog dossier version or submission type is stale");
}
if (dossier.publisherIdentity !== metadata.author.name || dossier.supportChannel !== "GitHub Issues" ||
  dossier.availability !== "all-openai-eligible-regions") {
  throw new Error("OpenAI catalog dossier publisher, support, or availability metadata is stale");
}
if (JSON.stringify(dossier.listing) !== JSON.stringify(expectedListing) ||
  JSON.stringify(dossier.starterPrompts) !== JSON.stringify(metadata.interface.defaultPrompt)) {
  throw new Error("OpenAI catalog dossier listing metadata has drifted from canonical metadata");
}
if (typeof dossier.releaseNotes !== "string" || !dossier.releaseNotes.includes(`Importer ${metadata.version}`) ||
  !dossier.releaseNotes.includes("Skills-only") || !dossier.releaseNotes.includes("network-free")) {
  throw new Error("OpenAI catalog release notes are missing required scope and version details");
}
if (!Array.isArray(dossier.positiveTests) || dossier.positiveTests.length !== 5 ||
  !Array.isArray(dossier.negativeTests) || dossier.negativeTests.length !== 3) {
  throw new Error("OpenAI submission dossier must contain exactly five positive and three negative cases");
}

const caseIds = new Set();
async function checkCase(testCase, kind) {
  if (!testCase || typeof testCase !== "object" || typeof testCase.id !== "string" || caseIds.has(testCase.id)) {
    throw new Error(`OpenAI ${kind} case has a missing or duplicate id`);
  }
  caseIds.add(testCase.id);
  for (const field of ["prompt", "fixture", "expectedWorkflow", "expectedResultShape", "clarificationOrRefusal"]) {
    if (typeof testCase[field] !== "string" || testCase[field].trim() === "") {
      throw new Error(`OpenAI ${kind} case ${testCase.id} is missing ${field}`);
    }
  }
  if (!testCase.fixture.startsWith("submission/fixtures/") || testCase.fixture.includes("..")) {
    throw new Error(`OpenAI ${kind} case ${testCase.id} fixture path is unsafe`);
  }
  const fixture = path.join(PLUGIN_ROOT, testCase.fixture);
  if (!(await stat(fixture)).isFile()) {
    throw new Error(`OpenAI ${kind} case ${testCase.id} fixture is not a file`);
  }
  if (kind === "positive") {
    if (typeof testCase.expected !== "string" || !testCase.expected.startsWith("submission/expected/") || testCase.expected.includes("..")) {
      throw new Error(`OpenAI positive case ${testCase.id} expected-answer path is unsafe or missing`);
    }
    if (!(await stat(path.join(PLUGIN_ROOT, testCase.expected))).isFile()) {
      throw new Error(`OpenAI positive case ${testCase.id} expected answer is not a file`);
    }
  } else if (typeof testCase.whyNotComplete !== "string" || testCase.whyNotComplete.trim() === "") {
    throw new Error(`OpenAI negative case ${testCase.id} must explain why the plugin should not complete it`);
  }
}
for (const testCase of dossier.positiveTests) {
  await checkCase(testCase, "positive");
}
for (const testCase of dossier.negativeTests) {
  await checkCase(testCase, "negative");
}
if (!Array.isArray(dossier.localActivationTests) || dossier.localActivationTests.length < 1 ||
  !dossier.localActivationTests.some((testCase) => testCase.id === "out-of-domain-composition")) {
  throw new Error("Local activation suite must retain an out-of-domain composition case outside the portal negatives");
}

const skillAgentPath = path.join(PLUGIN_ROOT, "skills", "import-drum-score", "agents", "openai.yaml");
if (await readFile(skillAgentPath, "utf8") !== openAiSkillAgentYaml(metadata)) {
  throw new Error("Skill-level OpenAI metadata is stale");
}

const pageChecks = [
  ["web/importer/index.html", ["Directory status", "review", metadata.interface.supportURL]],
  ["web/importer/privacy.html", ["makes no network requests", "host’s own data policy", "ephemeral", "GitHub Issues"]],
  ["web/importer/terms.html", ["permission", "Human review is mandatory", "No warranties", "fitness for a particular purpose"]]
];
for (const [relativePath, fragments] of pageChecks) {
  const source = await readFile(path.join(REPO_ROOT, relativePath), "utf8");
  if (/<script\b/i.test(source) || /(?:google-analytics\.com|segment\.com|googletagmanager\.com|plausible\.io)/i.test(source)) {
    throw new Error(`${relativePath} must remain script-free and tracking-free`);
  }
  for (const fragment of fragments) {
    if (!source.includes(fragment)) {
      throw new Error(`${relativePath} is missing required policy text: ${fragment}`);
    }
  }
}
await stat(path.join(REPO_ROOT, ".github", "ISSUE_TEMPLATE", "importer-support.yml"));

const expectedFixtureNames = [
  "negative-01-audio-input.wav",
  "negative-02-unreadable-handwriting.png",
  "negative-03-unsupported-navigation.png",
  "positive-01-clear-groove.png",
  "positive-02-cymbal-positions.png",
  "positive-03-ornament-split-rest.png",
  "positive-04-section-repeat.png",
  "positive-05-two-tempo-chart.png"
];
const fixtureRoot = path.join(PLUGIN_ROOT, "submission", "fixtures");
if (JSON.stringify((await readdir(fixtureRoot)).sort()) !== JSON.stringify(expectedFixtureNames)) {
  throw new Error("OpenAI submission fixtures must contain exactly five positive and three negative project-owned files");
}
for (const fixtureName of expectedFixtureNames.filter((name) => name.endsWith(".png"))) {
  const bytes = await readFile(path.join(fixtureRoot, fixtureName));
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, 8).equals(pngSignature) || bytes.readUInt32BE(16) < 48 || bytes.readUInt32BE(20) < 48) {
    throw new Error(`OpenAI evaluation fixture must be a valid non-trivial PNG: ${fixtureName}`);
  }
}
const audioFixture = await readFile(path.join(fixtureRoot, "negative-01-audio-input.wav"));
if (audioFixture.subarray(0, 4).toString("ascii") !== "RIFF" || audioFixture.subarray(8, 12).toString("ascii") !== "WAVE") {
  throw new Error("OpenAI negative audio fixture must be a valid project-owned WAV file");
}
const expectedRoot = path.join(PLUGIN_ROOT, "submission", "expected");
const expectedFiles = (await readdir(expectedRoot)).sort();
if (expectedFiles.length !== 5 || !expectedFiles.every((name) => /^positive-0[1-5]-.+\.md$/.test(name))) {
  throw new Error("OpenAI submission must keep exactly five positive expected-answer files outside the uploaded skill");
}
const validatorPath = path.join(PLUGIN_ROOT, "skills", "import-drum-score", "scripts", "validate-drum-notation.mjs");
for (const expectedFile of expectedFiles) {
  const expectedSource = await readFile(path.join(expectedRoot, expectedFile), "utf8");
  const notationBlocks = [...expectedSource.matchAll(/```drums\n([\s\S]*?)```/g)].map((match) => match[1].trim());
  if (notationBlocks.length === 0) {
    throw new Error(`OpenAI expected answer has no drums block: ${expectedFile}`);
  }
  for (const block of notationBlocks) {
    const validation = spawnSync(process.execPath, [validatorPath], { input: block, encoding: "utf8" });
    const result = JSON.parse(validation.stdout);
    if (validation.status !== 0 || result.status !== "clean") {
      throw new Error(`OpenAI expected answer must validate cleanly: ${expectedFile}`);
    }
  }
}

const archiveArg = process.argv[2];
const archivePath = archiveArg
  ? path.resolve(REPO_ROOT, archiveArg)
  : path.join(REPO_ROOT, "dist", "agent-plugin", `${metadata.name}-${metadata.version}-openai.zip`);
const archiveStats = await stat(archivePath).catch(() => undefined);
if (!archiveStats?.isFile()) {
  throw new Error(`OpenAI submission ZIP is missing; run npm run agent-plugin:package first: ${archivePath}`);
}
if (archiveStats.size === 0 || archiveStats.size > 100 * 1024 * 1024) {
  throw new Error("OpenAI submission ZIP must be non-empty and no larger than 100 MB");
}

const listRun = spawnSync("unzip", ["-Z1", archivePath], { cwd: REPO_ROOT, encoding: "utf8" });
if (listRun.status !== 0) {
  throw new Error(`OpenAI submission archive is not a readable ZIP: ${listRun.stderr}`);
}
const entries = listRun.stdout.split(/\r?\n/).filter(Boolean);
if (entries.length === 0 || entries.length > 5_000) {
  throw new Error("OpenAI submission ZIP must contain 1 to 5,000 entries");
}
const normalizedPaths = new Set();
for (const entry of entries) {
  if (entry !== entry.trim() || entry.includes("\\") || entry.startsWith("/") || /^[A-Za-z]:/.test(entry)) {
    throw new Error(`Unsafe ZIP entry path: ${entry}`);
  }
  const segments = entry.split("/").filter((segment, index, values) => !(index === values.length - 1 && segment === ""));
  if (segments.length === 0 || segments.length > 20 || segments.some((segment) => segment === "" || segment === "." || segment === "..") || entry.length > 255) {
    throw new Error(`Unsupported ZIP entry path: ${entry}`);
  }
  const normalized = entry.normalize("NFC").toLocaleLowerCase("en-US");
  if (normalizedPaths.has(normalized)) {
    throw new Error(`ZIP entry path collides after normalization: ${entry}`);
  }
  normalizedPaths.add(normalized);
  if (segments[0] !== metadata.name) {
    throw new Error(`ZIP must contain one top-level ${metadata.name}/ directory`);
  }
}

const relativeEntries = entries
  .filter((entry) => !entry.endsWith("/"))
  .map((entry) => entry.slice(`${metadata.name}/`.length));
for (const required of [
  ".codex-plugin/plugin.json",
  "skills/import-drum-score/SKILL.md",
  "skills/import-drum-score/agents/openai.yaml",
  "assets/drum-notation-importer.png",
  "LICENSE",
  "VERSION"
]) {
  if (!relativeEntries.includes(required)) {
    throw new Error(`OpenAI submission ZIP is missing ${required}`);
  }
}
const allowedRoots = new Set([".codex-plugin", "skills", "assets", "LICENSE", "VERSION"]);
for (const entry of relativeEntries) {
  const root = entry.split("/")[0];
  if (!allowedRoots.has(root) || /(?:^|\/)(?:\.claude-plugin|gemini-extension\.json|pilot|submission|hooks|screenshots?|\.mcp\.json|mcp\.json|\.app\.json)(?:\/|$)/i.test(entry)) {
    throw new Error(`OpenAI submission ZIP contains an excluded surface: ${entry}`);
  }
}
if (relativeEntries.includes("plugin.json")) {
  throw new Error("OpenAI directory ZIP must use .codex-plugin/plugin.json without a duplicate root manifest");
}

const extractRoot = await mkdtemp(path.join(tmpdir(), "drum-notation-openai-zip-"));
try {
  const extractRun = spawnSync("unzip", ["-q", archivePath, "-d", extractRoot], { cwd: REPO_ROOT, encoding: "utf8" });
  if (extractRun.status !== 0) {
    throw new Error(`Unable to extract OpenAI submission ZIP: ${extractRun.stderr}`);
  }
  let totalBytes = 0;
  async function inspectTree(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const entryStats = await lstat(entryPath);
      if (entryStats.isSymbolicLink() || (!entryStats.isDirectory() && !entryStats.isFile())) {
        throw new Error(`OpenAI ZIP contains an unsupported member type: ${entryPath}`);
      }
      if (entryStats.isDirectory()) {
        await inspectTree(entryPath);
      } else {
        if (entryStats.size > 100 * 1024 * 1024) {
          throw new Error(`OpenAI ZIP member exceeds 100 MiB: ${entryPath}`);
        }
        totalBytes += entryStats.size;
      }
    }
  }
  await inspectTree(extractRoot);
  if (totalBytes > 512 * 1024 * 1024) {
    throw new Error("OpenAI submission ZIP exceeds 512 MiB extracted");
  }

  const extractedRoot = path.join(extractRoot, metadata.name);
  const archiveManifest = JSON.parse(await readFile(path.join(extractedRoot, ".codex-plugin", "plugin.json"), "utf8"));
  if (archiveManifest.version !== metadata.version || archiveManifest.name !== metadata.name ||
    JSON.stringify(archiveManifest.interface) !== JSON.stringify(metadata.interface)) {
    throw new Error("OpenAI submission ZIP manifest has drifted from canonical metadata");
  }
  if (await readFile(path.join(extractedRoot, "VERSION"), "utf8") !== `${metadata.version}\n` ||
    await readFile(path.join(extractedRoot, "skills", "import-drum-score", "agents", "openai.yaml"), "utf8") !== openAiSkillAgentYaml(metadata)) {
    throw new Error("OpenAI submission ZIP version or skill metadata is stale");
  }
} finally {
  await rm(extractRoot, { recursive: true, force: true });
}

console.log(`OpenAI submission checks passed for ${metadata.name} ${metadata.version}.`);
