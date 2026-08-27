import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzePilotGate,
  calculatePilotAggregate,
  createPilotRecord,
  formatPilotStatus,
  nextAnonymousId,
  readPilotRecords,
  refreshPilotAggregate
} from "../tools/importer-pilot.mjs";

const temporaryRoots: string[] = [];
const schemaRoot = path.resolve("agent-plugin/drum-notation-importer/pilot");

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function record(
  index: number,
  stratum: "practice" | "full-song-gig",
  overrides: Record<string, unknown> = {}
) {
  return createPilotRecord({
    anonymousId: `chart-${String(index).padStart(2, "0")}`,
    stratum,
    features: index % 2 === 0 ? ["mixed-meter", "section-repeat-native"] : ["mixed-meter"],
    navigationBlocked: false,
    workaroundSeverity: "none",
    notationEventCount: 20,
    ambiguityCount: 1,
    firstPassStatus: "warnings",
    correctionEffort: "quick",
    outcome: "usable-after-correction",
    ...overrides
  });
}

function sample20(blockedCount = 0) {
  return Array.from({ length: 20 }, (_, offset) => {
    const index = offset + 1;
    return record(index, index <= 14 ? "practice" : "full-song-gig", {
      navigationBlocked: index <= blockedCount
    });
  });
}

async function createPilotFixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "importer-pilot-test-"));
  temporaryRoots.push(repoRoot);
  const pilotRoot = path.join(repoRoot, "pilot");
  await mkdir(path.join(pilotRoot, "records"), { recursive: true });
  await copyFile(path.join(schemaRoot, "pilot-record.schema.json"), path.join(pilotRoot, "pilot-record.schema.json"));
  await copyFile(path.join(schemaRoot, "pilot-aggregate.schema.json"), path.join(pilotRoot, "pilot-aggregate.schema.json"));
  await writeFile(path.join(pilotRoot, "aggregate.json"), JSON.stringify(calculatePilotAggregate([]), null, 2) + "\n");
  return { repoRoot, pilotRoot };
}

async function writeRecords(pilotRoot: string, records: ReturnType<typeof record>[]) {
  await Promise.all(records.map((value) => writeFile(
    path.join(pilotRoot, "records", `${value.anonymousId}.json`),
    JSON.stringify(value, null, 2) + "\n"
  )));
}

describe("importer pilot aggregation", () => {
  it("derives deterministic counts, rates, features, and status", () => {
    const records = [
      record(1, "practice"),
      record(2, "full-song-gig", {
        navigationBlocked: true,
        workaroundSeverity: "blocked",
        notationEventCount: 10,
        ambiguityCount: 2,
        firstPassStatus: "invalid",
        correctionEffort: "slow",
        outcome: "not-usable"
      })
    ];
    const aggregate = calculatePilotAggregate(records);

    expect(aggregate).toMatchObject({
      completed: 2,
      status: "in-progress",
      featureFrequency: { "mixed-meter": 2, "section-repeat-native": 1 },
      workaroundSeverity: { none: 1, appearance: 0, structure: 0, meaning: 0, blocked: 1 },
      ambiguity: { count: 3, notationEventCount: 30, rate: 0.1 },
      navigationBlocked: { count: 1, rate: 0.5 }
    });
    expect(formatPilotStatus(aggregate, analyzePilotGate(aggregate), records)).toContain(
      "Mix: practice 1/14; full-song/gig 1/6"
    );
  });

  it("requires the extension only within one chart of the initial threshold", () => {
    for (const count of [4, 5, 6]) {
      expect(analyzePilotGate(calculatePilotAggregate(sample20(count))).phase).toBe("extension-required");
    }
    expect(analyzePilotGate(calculatePilotAggregate(sample20(3)))).toMatchObject({
      phase: "decision-required",
      defaultTrack: "B"
    });
    expect(analyzePilotGate(calculatePilotAggregate(sample20(7)))).toMatchObject({
      phase: "decision-required",
      defaultTrack: "A"
    });
  });

  it("enforces ambiguity arithmetic, duplicate IDs, and planned mix quotas", () => {
    expect(() => calculatePilotAggregate([
      { ...record(1, "practice"), ambiguityRate: 0.9 }
    ])).toThrow("ambiguityRate must equal");
    expect(() => calculatePilotAggregate([
      record(1, "practice"),
      record(1, "practice")
    ])).toThrow("Duplicate pilot record ID");
    expect(() => calculatePilotAggregate(
      Array.from({ length: 15 }, (_, index) => record(index + 1, "practice"))
    )).toThrow("Pilot mix exceeds the plan");
  });

  it("finds the first missing anonymous ID rather than assuming contiguous records", () => {
    expect(nextAnonymousId([record(1, "practice"), record(3, "practice")], 20)).toBe("chart-02");
  });
});

describe("importer pilot files", () => {
  it("preselects the 30-chart extension and updates the planned mix", async () => {
    const fixture = await createPilotFixture();
    await writeRecords(fixture.pilotRoot, sample20(5));
    const result = await refreshPilotAggregate({
      ...fixture,
      preselectExtension: true
    });

    expect(result.aggregate).toMatchObject({
      plannedSampleSize: 30,
      plannedMix: { practice: 21, fullSongGig: 9 },
      completed: 20,
      status: "extension-preselected"
    });
    expect(result.gate.phase).toBe("extension-in-progress");
  });

  it("attaches an existing decision record only after a completed non-boundary sample", async () => {
    const fixture = await createPilotFixture();
    await writeRecords(fixture.pilotRoot, sample20(3));
    await mkdir(path.join(fixture.repoRoot, "docs"));
    await writeFile(path.join(fixture.repoRoot, "docs", "pilot-decision.md"), "# Pilot decision\n");
    const result = await refreshPilotAggregate({
      ...fixture,
      decisionRecord: "docs/pilot-decision.md"
    });

    expect(result.aggregate.status).toBe("complete");
    expect(result.aggregate.decisionRecord).toBe("docs/pilot-decision.md");
    expect(result.gate).toMatchObject({ phase: "complete", defaultTrack: "B" });
  });

  it("rejects filenames that do not match their anonymous record IDs", async () => {
    const fixture = await createPilotFixture();
    await writeFile(
      path.join(fixture.pilotRoot, "records", "chart-01.json"),
      JSON.stringify(record(2, "practice"), null, 2) + "\n"
    );

    await expect(readPilotRecords(fixture.pilotRoot)).rejects.toThrow(
      "chart-01.json contains anonymousId chart-02"
    );
  });

  it("writes a canonical aggregate and subsequently passes check mode", async () => {
    const fixture = await createPilotFixture();
    await writeRecords(fixture.pilotRoot, [record(1, "practice")]);
    const first = await refreshPilotAggregate(fixture);
    const second = await refreshPilotAggregate({ ...fixture, check: true });

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    const saved = JSON.parse(await readFile(path.join(fixture.pilotRoot, "aggregate.json"), "utf8"));
    expect(saved.completed).toBe(1);
  });
});
