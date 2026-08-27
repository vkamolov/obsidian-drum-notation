import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { PLUGIN_ROOT, REPO_ROOT, stableJson } from "./plugin-paths.mjs";

export const INITIAL_SAMPLE_SIZE = 20;
export const EXTENDED_SAMPLE_SIZE = 30;
export const NAVIGATION_THRESHOLD_RATE = 0.25;
export const INITIAL_PLANNED_MIX = Object.freeze({ practice: 14, fullSongGig: 6 });
export const EXTENDED_PLANNED_MIX = Object.freeze({ practice: 21, fullSongGig: 9 });

const STRATA = ["practice", "full-song-gig"];
const SEVERITIES = ["none", "appearance", "structure", "meaning", "blocked"];
const FIRST_PASS_STATUSES = ["clean", "warnings", "invalid", "unavailable"];
const CORRECTION_EFFORTS = ["none", "quick", "moderate", "slow"];
const OUTCOMES = ["usable", "usable-after-correction", "not-usable"];
const RECORD_FILE_PATTERN = /^chart-(\d{2,3})\.json$/;

export function createPilotRecord({
  anonymousId,
  stratum,
  features,
  navigationBlocked,
  workaroundSeverity,
  notationEventCount,
  ambiguityCount,
  firstPassStatus,
  correctionEffort,
  outcome,
  replacementReason = ""
}) {
  const normalizedFeatures = [...new Set(features.map((feature) => feature.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const record = {
    anonymousId,
    stratum,
    features: normalizedFeatures,
    navigationBlocked,
    workaroundSeverity,
    notationEventCount,
    ambiguityCount,
    ambiguityRate: ratio(ambiguityCount, notationEventCount),
    firstPassStatus,
    correctionEffort,
    outcome
  };
  const normalizedReason = replacementReason.trim();
  if (normalizedReason) record.replacementReason = normalizedReason;
  validateRecordSemantics(record);
  return record;
}

export function calculatePilotAggregate(
  records,
  { plannedSampleSize = INITIAL_SAMPLE_SIZE, decisionRecord = null } = {}
) {
  const plannedMix = plannedMixForSize(plannedSampleSize);
  validateRecordCollection(records, plannedSampleSize, plannedMix);

  const featureFrequency = new Map();
  const workaroundSeverity = zeroCounts(SEVERITIES);
  const firstPassStatus = zeroCounts(FIRST_PASS_STATUSES);
  const correctionEffort = zeroCounts(CORRECTION_EFFORTS);
  const outcome = { usable: 0, usableAfterCorrection: 0, notUsable: 0 };
  let ambiguityCount = 0;
  let notationEventCount = 0;
  let navigationBlockedCount = 0;

  for (const record of records) {
    validateRecordSemantics(record);
    for (const feature of record.features) {
      featureFrequency.set(feature, (featureFrequency.get(feature) ?? 0) + 1);
    }
    workaroundSeverity[record.workaroundSeverity]++;
    firstPassStatus[record.firstPassStatus]++;
    correctionEffort[record.correctionEffort]++;
    outcome[outcomeAggregateKey(record.outcome)]++;
    ambiguityCount += record.ambiguityCount;
    notationEventCount += record.notationEventCount;
    if (record.navigationBlocked) navigationBlockedCount++;
  }

  const completed = records.length;
  const normalizedDecisionRecord = normalizeDecisionRecord(decisionRecord);
  return {
    schemaVersion: 1,
    plannedSampleSize,
    plannedMix,
    completed,
    status: inferAggregateStatus(completed, plannedSampleSize, normalizedDecisionRecord),
    featureFrequency: Object.fromEntries(
      [...featureFrequency.entries()].sort(([left], [right]) => left.localeCompare(right))
    ),
    workaroundSeverity,
    ambiguity: {
      count: ambiguityCount,
      notationEventCount,
      rate: ratio(ambiguityCount, notationEventCount)
    },
    firstPassStatus,
    correctionEffort,
    outcome,
    navigationBlocked: {
      count: navigationBlockedCount,
      rate: ratio(navigationBlockedCount, completed)
    },
    decisionRecord: normalizedDecisionRecord
  };
}

export function analyzePilotGate(aggregate) {
  const { completed, plannedSampleSize } = aggregate;
  const blockedCount = aggregate.navigationBlocked.count;
  if (completed < plannedSampleSize) {
    return {
      phase: plannedSampleSize === EXTENDED_SAMPLE_SIZE && completed >= INITIAL_SAMPLE_SIZE
        ? "extension-in-progress"
        : "collecting",
      extensionRequired: false,
      defaultTrack: null
    };
  }

  const extensionRequired = plannedSampleSize === INITIAL_SAMPLE_SIZE &&
    Math.abs(blockedCount - INITIAL_SAMPLE_SIZE * NAVIGATION_THRESHOLD_RATE) <= 1;
  if (extensionRequired) {
    return { phase: "extension-required", extensionRequired: true, defaultTrack: null };
  }

  return {
    phase: aggregate.decisionRecord ? "complete" : "decision-required",
    extensionRequired: false,
    defaultTrack: aggregate.navigationBlocked.rate >= NAVIGATION_THRESHOLD_RATE ? "A" : "B"
  };
}

export async function readPilotRecords(pilotRoot) {
  const recordsRoot = path.join(pilotRoot, "records");
  const validateRecord = await compileSchema(path.join(pilotRoot, "pilot-record.schema.json"));
  const entries = await readdir(recordsRoot, { withFileTypes: true });
  const records = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || entry.name === ".gitignore" || entry.name.startsWith(".")) continue;
    if (!entry.name.endsWith(".json")) continue;
    const match = RECORD_FILE_PATTERN.exec(entry.name);
    if (!match) {
      throw new Error(`Unexpected pilot record filename: ${entry.name}. Use chart-NN.json.`);
    }
    const record = await readJson(path.join(recordsRoot, entry.name));
    assertSchema(validateRecord, record, entry.name);
    validateRecordSemantics(record);
    const expectedId = entry.name.slice(0, -".json".length);
    if (record.anonymousId !== expectedId) {
      throw new Error(`${entry.name} contains anonymousId ${record.anonymousId}; expected ${expectedId}.`);
    }
    records.push(record);
  }
  return records;
}

export async function refreshPilotAggregate({
  pilotRoot = path.join(PLUGIN_ROOT, "pilot"),
  repoRoot = REPO_ROOT,
  preselectExtension = false,
  decisionRecord,
  check = false
} = {}) {
  const aggregatePath = path.join(pilotRoot, "aggregate.json");
  const current = await readJson(aggregatePath);
  const records = await readPilotRecords(pilotRoot);
  let plannedSampleSize = current.plannedSampleSize;
  if (preselectExtension) {
    const currentAggregate = calculatePilotAggregate(records, {
      plannedSampleSize,
      decisionRecord: current.decisionRecord
    });
    if (!analyzePilotGate(currentAggregate).extensionRequired) {
      throw new Error("The extension may be preselected only after 20 charts finish within one chart of the 25% boundary.");
    }
    plannedSampleSize = EXTENDED_SAMPLE_SIZE;
  }

  let nextDecisionRecord = decisionRecord === undefined ? current.decisionRecord : decisionRecord;
  if (nextDecisionRecord !== null && nextDecisionRecord !== undefined) {
    nextDecisionRecord = normalizeRepositoryPath(nextDecisionRecord);
    const decisionPath = path.join(repoRoot, nextDecisionRecord);
    const decisionStat = await stat(decisionPath).catch(() => null);
    if (!decisionStat?.isFile()) {
      throw new Error(`Decision record does not exist or is not a file: ${nextDecisionRecord}`);
    }
  }

  const aggregate = calculatePilotAggregate(records, {
    plannedSampleSize,
    decisionRecord: nextDecisionRecord
  });
  const gate = analyzePilotGate(aggregate);
  if (aggregate.decisionRecord && gate.extensionRequired) {
    throw new Error("A decision record cannot be attached until the required 30-chart extension is complete.");
  }
  if (aggregate.decisionRecord && aggregate.completed !== aggregate.plannedSampleSize) {
    throw new Error("A decision record cannot be attached before the planned sample is complete.");
  }

  const validateAggregate = await compileSchema(path.join(pilotRoot, "pilot-aggregate.schema.json"));
  assertSchema(validateAggregate, aggregate, "aggregate.json");
  const expected = stableJson(aggregate);
  const currentSource = await readFile(aggregatePath, "utf8");
  const changed = currentSource !== expected;
  if (check) {
    if (changed) throw new Error("Pilot aggregate is stale. Run npm run pilot:aggregate.");
    return { aggregate, gate, records, changed: false };
  }
  if (changed) await writeFile(aggregatePath, expected);
  return { aggregate, gate, records, changed };
}

export function formatPilotStatus(aggregate, gate, records = []) {
  const mix = countStrata(records);
  const blockedPercent = formatPercent(aggregate.navigationBlocked.rate);
  const ambiguityPercent = formatPercent(aggregate.ambiguity.rate);
  const lines = [
    `Pilot: ${aggregate.completed}/${aggregate.plannedSampleSize} (${aggregate.status})`,
    `Mix: practice ${mix.practice}/${aggregate.plannedMix.practice}; full-song/gig ${mix.fullSongGig}/${aggregate.plannedMix.fullSongGig}`,
    `Navigation blocked: ${aggregate.navigationBlocked.count}/${aggregate.completed || 0} (${blockedPercent})`,
    `Ambiguity: ${aggregate.ambiguity.count}/${aggregate.ambiguity.notationEventCount} events (${ambiguityPercent})`,
    `Correction effort: none ${aggregate.correctionEffort.none}; quick ${aggregate.correctionEffort.quick}; moderate ${aggregate.correctionEffort.moderate}; slow ${aggregate.correctionEffort.slow}`,
    `Outcomes: usable ${aggregate.outcome.usable}; corrected ${aggregate.outcome.usableAfterCorrection}; not usable ${aggregate.outcome.notUsable}`
  ];

  if (gate.phase === "extension-required") {
    lines.push("Next: preselect the 7-practice/3-full-song extension, then run npm run pilot:aggregate -- --preselect-extension.");
  } else if (gate.phase === "decision-required") {
    lines.push(`Default threshold result: Track ${gate.defaultTrack}. Human review of severity and intended-use mix is still required.`);
    lines.push("Next: write the decision record, then run npm run pilot:aggregate -- --decision <repo-relative-path>.");
  } else if (gate.phase === "complete") {
    lines.push(`Decision complete: Track ${gate.defaultTrack}; ${aggregate.decisionRecord}.`);
  } else {
    lines.push(`Next anonymous ID: ${nextAnonymousId(records, aggregate.plannedSampleSize) ?? "sample complete"}.`);
  }
  return `${lines.join("\n")}\n`;
}

export function nextAnonymousId(records, plannedSampleSize) {
  const used = new Set(records.map((record) => record.anonymousId));
  for (let index = 1; index <= plannedSampleSize; index++) {
    const candidate = `chart-${String(index).padStart(2, "0")}`;
    if (!used.has(candidate)) return candidate;
  }
  return null;
}

async function runRecordCommand({ pilotRoot, input, output, presetStratum }) {
  const current = await readJson(path.join(pilotRoot, "aggregate.json"));
  const records = await readPilotRecords(pilotRoot);
  const anonymousId = nextAnonymousId(records, current.plannedSampleSize);
  if (!anonymousId) throw new Error("The planned sample is complete. Aggregate it before recording more charts.");
  const mix = countStrata(records);
  const plannedMix = plannedMixForSize(current.plannedSampleSize);
  output.write(`Creating ${anonymousId}. Remaining mix: practice ${plannedMix.practice - mix.practice}; full-song/gig ${plannedMix.fullSongGig - mix.fullSongGig}.\n`);

  const rl = createInterface({ input, output });
  try {
    const stratum = presetStratum ?? await askEnum(rl, "Stratum", STRATA);
    if (stratum === "practice" && mix.practice >= plannedMix.practice) {
      throw new Error("The planned practice-chart quota is already full.");
    }
    if (stratum === "full-song-gig" && mix.fullSongGig >= plannedMix.fullSongGig) {
      throw new Error("The planned full-song/gig quota is already full.");
    }
    const features = (await rl.question("Features (comma-separated, blank for none): "))
      .split(",");
    const navigationBlocked = await askBoolean(rl, "Navigation blocked");
    const workaroundSeverity = await askEnum(rl, "Worst workaround severity", SEVERITIES);
    const notationEventCount = await askInteger(rl, "Notation event count", 1);
    const ambiguityCount = await askInteger(rl, "Ambiguity count", 0, notationEventCount);
    const firstPassStatus = await askEnum(rl, "First-pass status", FIRST_PASS_STATUSES);
    const correctionEffort = await askEnum(rl, "Correction effort", CORRECTION_EFFORTS);
    const outcome = await askEnum(rl, "Outcome", OUTCOMES);
    const replacementReason = await rl.question("Replacement reason (blank unless this chart replaced an out-of-scope preselection): ");
    const record = createPilotRecord({
      anonymousId,
      stratum,
      features,
      navigationBlocked,
      workaroundSeverity,
      notationEventCount,
      ambiguityCount,
      firstPassStatus,
      correctionEffort,
      outcome,
      replacementReason
    });
    const validateRecord = await compileSchema(path.join(pilotRoot, "pilot-record.schema.json"));
    assertSchema(validateRecord, record, `${anonymousId}.json`);
    const recordPath = path.join(pilotRoot, "records", `${anonymousId}.json`);
    await writeFile(recordPath, stableJson(record), { flag: "wx" });
    output.write(`Saved ${path.relative(REPO_ROOT, recordPath)}. Run npm run pilot:aggregate to refresh totals.\n`);
    return record;
  } finally {
    rl.close();
  }
}

async function runCli(args = process.argv.slice(2)) {
  const command = args[0] ?? "help";
  const pilotRoot = path.join(PLUGIN_ROOT, "pilot");
  if (command === "record") {
    const commandArgs = args.slice(1);
    assertKnownOptions(commandArgs, ["--stratum"], []);
    const stratum = optionValue(commandArgs, "--stratum");
    if (stratum !== null && !STRATA.includes(stratum)) {
      throw new Error(`--stratum must be one of: ${STRATA.join(", ")}`);
    }
    await runRecordCommand({
      pilotRoot,
      input: process.stdin,
      output: process.stdout,
      presetStratum: stratum
    });
    return;
  }
  if (command === "aggregate") {
    const commandArgs = args.slice(1);
    assertKnownOptions(commandArgs, ["--decision"], ["--preselect-extension", "--check"]);
    const result = await refreshPilotAggregate({
      pilotRoot,
      preselectExtension: commandArgs.includes("--preselect-extension"),
      decisionRecord: optionValue(commandArgs, "--decision") ?? undefined,
      check: commandArgs.includes("--check")
    });
    process.stdout.write(result.changed ? "Updated pilot aggregate.\n" : "Pilot aggregate is current.\n");
    process.stdout.write(formatPilotStatus(result.aggregate, result.gate, result.records));
    return;
  }
  if (command === "status") {
    if (args.length > 1) throw new Error("pilot:status does not accept options.");
    const current = await readJson(path.join(pilotRoot, "aggregate.json"));
    const records = await readPilotRecords(pilotRoot);
    const aggregate = calculatePilotAggregate(records, {
      plannedSampleSize: current.plannedSampleSize,
      decisionRecord: current.decisionRecord
    });
    const expected = stableJson(aggregate);
    const currentSource = await readFile(path.join(pilotRoot, "aggregate.json"), "utf8");
    process.stdout.write(formatPilotStatus(aggregate, analyzePilotGate(aggregate), records));
    if (currentSource !== expected) process.stdout.write("aggregate.json is stale; run npm run pilot:aggregate.\n");
    return;
  }
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write([
      "Importer pilot helper",
      "",
      "  npm run pilot:record [-- --stratum practice|full-song-gig]",
      "  npm run pilot:aggregate",
      "  npm run pilot:aggregate -- --preselect-extension",
      "  npm run pilot:aggregate -- --decision <repo-relative-path>",
      "  npm run pilot:status",
      "  npm run pilot:check",
      ""
    ].join("\n"));
    return;
  }
  throw new Error(`Unknown pilot command: ${command}`);
}

function validateRecordCollection(records, plannedSampleSize, plannedMix) {
  if (records.length > plannedSampleSize) {
    throw new Error(`Pilot has ${records.length} records but the planned sample is ${plannedSampleSize}.`);
  }
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.anonymousId)) throw new Error(`Duplicate pilot record ID: ${record.anonymousId}`);
    ids.add(record.anonymousId);
    const match = /^chart-(\d{2,3})$/.exec(record.anonymousId);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > plannedSampleSize) {
      throw new Error(`${record.anonymousId} is outside the planned sample of ${plannedSampleSize}.`);
    }
  }
  const mix = countStrata(records);
  if (mix.practice > plannedMix.practice || mix.fullSongGig > plannedMix.fullSongGig) {
    throw new Error(
      `Pilot mix exceeds the plan: practice ${mix.practice}/${plannedMix.practice}, full-song/gig ${mix.fullSongGig}/${plannedMix.fullSongGig}.`
    );
  }
}

function validateRecordSemantics(record) {
  if (!record || typeof record !== "object" || !/^chart-[0-9]{2,3}$/.test(record.anonymousId)) {
    throw new Error("Pilot record must have an anonymous chart-NN ID.");
  }
  if (!STRATA.includes(record.stratum)) {
    throw new Error(`${record.anonymousId}: unsupported stratum ${record.stratum}.`);
  }
  if (!Array.isArray(record.features) || record.features.some((feature) => typeof feature !== "string" || !feature.trim()) ||
    new Set(record.features).size !== record.features.length) {
    throw new Error(`${record.anonymousId}: features must be unique, non-empty strings.`);
  }
  if (typeof record.navigationBlocked !== "boolean") {
    throw new Error(`${record.anonymousId}: navigationBlocked must be Boolean.`);
  }
  for (const [field, value, allowed] of [
    ["workaroundSeverity", record.workaroundSeverity, SEVERITIES],
    ["firstPassStatus", record.firstPassStatus, FIRST_PASS_STATUSES],
    ["correctionEffort", record.correctionEffort, CORRECTION_EFFORTS],
    ["outcome", record.outcome, OUTCOMES]
  ]) {
    if (!allowed.includes(value)) throw new Error(`${record.anonymousId}: unsupported ${field} ${value}.`);
  }
  if (record.replacementReason !== undefined && (typeof record.replacementReason !== "string" || !record.replacementReason.trim())) {
    throw new Error(`${record.anonymousId}: replacementReason must be a non-empty string when present.`);
  }
  if (!Number.isInteger(record.notationEventCount) || record.notationEventCount < 1) {
    throw new Error(`${record.anonymousId}: notationEventCount must be a positive integer.`);
  }
  if (!Number.isInteger(record.ambiguityCount) || record.ambiguityCount < 0 || record.ambiguityCount > record.notationEventCount) {
    throw new Error(`${record.anonymousId}: ambiguityCount must be between zero and notationEventCount.`);
  }
  const expectedRate = ratio(record.ambiguityCount, record.notationEventCount);
  if (Math.abs(record.ambiguityRate - expectedRate) > 1e-9) {
    throw new Error(`${record.anonymousId}: ambiguityRate must equal ambiguityCount / notationEventCount (${expectedRate}).`);
  }
}

function plannedMixForSize(plannedSampleSize) {
  if (plannedSampleSize === INITIAL_SAMPLE_SIZE) return { ...INITIAL_PLANNED_MIX };
  if (plannedSampleSize === EXTENDED_SAMPLE_SIZE) return { ...EXTENDED_PLANNED_MIX };
  throw new Error(`Unsupported planned sample size: ${plannedSampleSize}. Amend the protocol and schema before changing it.`);
}

function inferAggregateStatus(completed, plannedSampleSize, decisionRecord) {
  if (completed === 0) return "not-started";
  if (completed < plannedSampleSize) {
    return plannedSampleSize === EXTENDED_SAMPLE_SIZE && completed === INITIAL_SAMPLE_SIZE
      ? "extension-preselected"
      : "in-progress";
  }
  return decisionRecord ? "complete" : "decision-required";
}

function countStrata(records) {
  return records.reduce((counts, record) => {
    if (record.stratum === "practice") counts.practice++;
    else if (record.stratum === "full-song-gig") counts.fullSongGig++;
    return counts;
  }, { practice: 0, fullSongGig: 0 });
}

function outcomeAggregateKey(outcome) {
  if (outcome === "usable-after-correction") return "usableAfterCorrection";
  if (outcome === "not-usable") return "notUsable";
  return "usable";
}

function zeroCounts(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function ratio(numerator, denominator) {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(6));
}

function normalizeDecisionRecord(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeRepositoryPath(value) {
  const normalized = String(value).trim().replace(/\\/g, "/");
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Decision record must be a non-empty repository-relative path without traversal.");
  }
  return normalized;
}

async function compileSchema(schemaPath) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  return ajv.compile(await readJson(schemaPath));
}

function assertSchema(validate, value, label) {
  if (!validate(value)) {
    throw new Error(`${label} is invalid: ${validate.errors?.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ")}`);
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${filePath} contains invalid JSON: ${error.message}`);
    throw error;
  }
}

async function askEnum(rl, label, values) {
  while (true) {
    const answer = (await rl.question(`${label} [${values.join("/")}]: `)).trim();
    if (values.includes(answer)) return answer;
    rl.write(`Choose one of: ${values.join(", ")}\n`);
  }
}

async function askBoolean(rl, label) {
  while (true) {
    const answer = (await rl.question(`${label} [yes/no]: `)).trim().toLowerCase();
    if (answer === "yes" || answer === "y") return true;
    if (answer === "no" || answer === "n") return false;
    rl.write("Enter yes or no.\n");
  }
}

async function askInteger(rl, label, minimum, maximum = Number.POSITIVE_INFINITY) {
  while (true) {
    const answer = Number((await rl.question(`${label} [${minimum}${Number.isFinite(maximum) ? `-${maximum}` : "+"}]: `)).trim());
    if (Number.isInteger(answer) && answer >= minimum && answer <= maximum) return answer;
    rl.write(`Enter a whole number from ${minimum}${Number.isFinite(maximum) ? ` to ${maximum}` : " upward"}.\n`);
  }
}

function optionValue(args, option) {
  const index = args.indexOf(option);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

function assertKnownOptions(args, valuedOptions, booleanOptions) {
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (booleanOptions.includes(option)) continue;
    if (valuedOptions.includes(option)) {
      if (!args[index + 1] || args[index + 1].startsWith("--")) {
        throw new Error(`${option} requires a value.`);
      }
      index++;
      continue;
    }
    throw new Error(`Unknown pilot option: ${option}`);
  }
}

function formatPercent(value) {
  return `${(value * 100).toFixed(value === 0 ? 0 : 1).replace(/\.0$/, "")}%`;
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectExecution) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
