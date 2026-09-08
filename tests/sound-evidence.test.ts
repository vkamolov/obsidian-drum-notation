import { describe, expect, it, vi } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import {gzipSync} from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkSoundProvenance } from "../tools/audio/reference-provenance.mjs";
import { variabilityReport, populationSD, formatVariability } from "../tools/audio/sound-report.mjs";
import { launchVerified } from "../tools/audio/reference-runner/run.mjs";
import { inventory, verifyInventory, exportArchive, importArchive } from "../tools/audio/sound-artifacts.mjs";

const baseline = JSON.parse(readFileSync("tests/fixtures/sound/baseline.json", "utf8"));

describe("sound provenance and isolated runner (no browsers)", () => {
  it("validates static evidence without importing or launching a browser", () => {
    expect(checkSoundProvenance().baseline.sourceHash).toBe(baseline.sourceHash);
  });
  it("rejects altered frozen provenance", () => {
    const record = JSON.parse(readFileSync("tests/fixtures/sound/provenance.json", "utf8"));
    record.capture.files["tools/audio/render-reference.ts"] = "changed";
    expect(() => checkSoundProvenance(record)).toThrow("Capture provenance mismatch");
  });
  it("validates actual browser versions only at explicit launch", async () => {
    const close = vi.fn(async () => {});
    const launcher = {launch: vi.fn(async () => ({version: () => "wrong", close}))};
    await expect(launchVerified(launcher, "frozen")).rejects.toThrow("Reference browser version mismatch");
    expect(close).toHaveBeenCalledOnce();
    launcher.launch.mockImplementation(async () => ({version: () => "frozen", close}));
    expect((await launchVerified(launcher, "frozen")).version()).toBe("frozen");
  });
  it("resolves absolute private dependencies and has no root Playwright dependency", () => {
    const source = readFileSync("tools/audio/reference-runner/runtime.mjs", "utf8");
    expect(source).toContain("verified.runnerDirectory, 'node_modules/@playwright/test/index.mjs'");
    expect(source).toContain("verified.runnerDirectory, 'node_modules/esbuild/lib/main.js'");
    const root = JSON.parse(readFileSync("package.json", "utf8"));
    root.devDependencies["@playwright/test"] = "999.0.0";
    // Static provenance consumes capture/runner manifests, never this application manifest.
    expect(checkSoundProvenance().record.runner.packageVersion).not.toBe(root.devDependencies["@playwright/test"]);
  });
});

describe("variability coverage", () => {
  it("derives counts and row identities independently from the selected manifest", () => {
    const records = baseline.cases.map((item: any) => ({key: item.key, draws: Array.from({length: baseline.seeds.length + 32}, () => ({rms: item.tolerances.map((window: any) => window.mean)}))}));
    const report = variabilityReport(baseline, records);
    const all: any[] = [], audible: any[] = [], identities: string[] = [];
    for (const item of baseline.cases) for (let index = 0; index < item.tolerances.length; index++) {
      const window = item.tolerances[index]; all.push(window); if (window.audible) audible.push(window);
      if (window.tolerance > 2) identities.push(`${item.key}/${index}`);
    }
    for (const [name, values] of [["all", all], ["audible", audible]] as const) {
      expect(report.coverage[name].total).toBe(values.length);
      expect(report.coverage[name].recoverable).toBe(values.filter(value => value.tolerance > 2).length);
      expect(report.coverage[name].floored).toBe(values.filter(value => value.tolerance === 2).length);
    }
    expect(report.recoverableWindows.map((row: any) => `${row.case}/${row.index}`)).toEqual(identities);
    expect(report.rows.filter((row: any) => row.historicalInstability).length).toBe(all.filter(window => window.tolerance > 4).length);
    expect(formatVariability(report)).toContain("confound engine build, platform and sampling");
  });
  it("distinguishes bounds, population SD, expansion, zero spread and historical instability", () => {
    const selected = {seeds: [1], cases: [{key: "fixture", tolerances: [
      {tolerance: 2, mean: -30, audible: true}, {tolerance: 3, mean: -30, audible: true}, {tolerance: 4.75, mean: -30, audible: false}
    ]}]};
    const records = [{key: "fixture", draws: [{rms: [0, 0, 0]}, ...Array.from({length: 32}, (_, index) => ({rms: [index % 2 ? -29.5 : -30.5, index % 2 ? -28 : -32, -30]}))]}];
    const report = variabilityReport(selected, records);
    expect(populationSD([1, 3])).toBe(1);
    expect(report.rows[0]).toMatchObject({originalObservedSD: null, originalSDBound: 2/3, observedSD: 0.5, boundSatisfied: true, sdRatio: null});
    expect(report.rows[1]).toMatchObject({originalObservedSD: 1, observedSD: 2, sdRatio: 2, observedBand: 6, newlyObservedInstability: true});
    expect(report.rows[1].approximateRelativeRatioUncertainty).toBeCloseTo(0.1796, 3);
    expect(report.rows[2]).toMatchObject({historicalInstability: true, observedInstability: false, approximateRelativeSDUncertainty: null});
    expect(selected.cases[0].tolerances[2].tolerance).toBe(4.75);
  });
});

describe("durable sound archives", () => {
  it("checks modes/checksums, imports atomically, and never overwrites existing evidence", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "sound-artifacts-"));
    try {
      const pcm = path.join(directory, "case-1.f32.gz"); await writeFile(pcm, gzipSync(new Uint8Array(new Float32Array([0, 0.1, -0.1]).buffer)));
      await inventory(directory, {mode: "reconstructed", baselineHash: "baseline"});
      await expect(verifyInventory(directory, "historical", "baseline")).rejects.toThrow("Evidence mode mismatch");
      const archive = `${directory}.gz`, destination = `${directory}-imported`;
      try {
        await exportArchive(directory, archive, "reconstructed", "baseline");
        await importArchive(archive, destination, "reconstructed", "baseline");
        expect(await readFile(path.join(destination, "case-1.f32.gz"))).toEqual(await readFile(pcm));
        await expect(importArchive(archive, destination, "reconstructed", "baseline")).rejects.toThrow();
        await writeFile(pcm, "corrupt");
        await expect(verifyInventory(directory, "reconstructed", "baseline")).rejects.toThrow("Artifact");
      } finally {rmSync(archive, {force: true}); rmSync(destination, {recursive: true, force: true});}
    } finally {rmSync(directory, {recursive: true, force: true});}
  });
});
