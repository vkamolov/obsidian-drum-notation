import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
export const gitFile = (revision, file, root = repositoryRoot) =>
  execFileSync('git', ['show', `${revision}:${file}`], {cwd: root});

/** Static only: never imports Playwright, launches a browser or accesses the network. */
export function checkSoundProvenance(record = readJson(path.join(repositoryRoot, 'tests/fixtures/sound/provenance.json'))) {
  assert.equal(record.schemaVersion, 1, 'Unsupported sound provenance schema');
  const baselineBytes = readFileSync(path.join(repositoryRoot, 'tests/fixtures/sound/baseline.json'));
  assert.equal(sha256(baselineBytes), record.baseline.sha256, 'Frozen sound baseline changed');
  const baseline = JSON.parse(baselineBytes);
  assert.equal(record.original.revision, baseline.revision);
  assert.equal(record.original.sourceHash, baseline.sourceHash);
  assert.equal(sha256(gitFile(record.original.revision, record.original.sourcePath)), baseline.sourceHash, 'Original synth hash mismatch');
  for (const [file, expected] of Object.entries(record.capture.files)) {
    assert.equal(sha256(gitFile(record.capture.revision, file)), expected, `Capture provenance mismatch: ${file}`);
  }
  const runnerDirectory = path.join(repositoryRoot, 'tools/audio/reference-runner');
  for (const [file, expected] of Object.entries(record.runner.files)) {
    assert.equal(sha256(readFileSync(path.join(runnerDirectory, file))), expected, `Frozen runner changed: ${file}`);
  }
  const runner = readJson(path.join(runnerDirectory, 'package.json'));
  const lock = readJson(path.join(runnerDirectory, 'package-lock.json'));
  const captureLock = JSON.parse(gitFile(record.capture.revision, 'package-lock.json'));
  assert.deepEqual(lock.packages[''].dependencies, runner.dependencies);
  assert.equal(runner.dependencies['@playwright/test'], record.runner.packageVersion);
  assert.equal(record.runner.packageVersion, captureLock.packages['node_modules/@playwright/test'].version);
  const expectedPackages = Object.keys(record.runner.packages).sort();
  assert.deepEqual(Object.keys(lock.packages).filter(key => key !== '').sort(), expectedPackages);
  for (const key of expectedPackages) {
    const actual = lock.packages[key], original = captureLock.packages[record.runner.capturePackagePaths?.[key] ?? key];
    assert.ok(original, `Package was not in the capture lock: ${key}`);
    assert.deepEqual({version: actual.version, integrity: actual.integrity}, record.runner.packages[key], `Runner package mismatch: ${key}`);
    assert.equal(actual.version, original.version);
    assert.equal(actual.integrity, original.integrity);
    assert.equal(actual.resolved, original.resolved);
    assert.deepEqual(actual.dependencies, original.dependencies);
    assert.deepEqual(actual.optionalDependencies, original.optionalDependencies);
    for (const dependency of [...Object.keys(actual.dependencies ?? {}), ...Object.keys(actual.optionalDependencies ?? {})]) {
      assert.ok(lock.packages[`node_modules/${dependency}`], `Missing locked dependency: ${dependency}`);
    }
  }
  assert.deepEqual(record.coverage, {
    cases: baseline.cases.length,
    seeds: baseline.seeds,
    sampleRates: [...new Set(baseline.cases.map(item => item.sampleRate))],
    browsers: Object.fromEntries(baseline.cases.map(item => [item.engine, item.browserVersion]))
  });
  for (const [name, version] of Object.entries(record.coverage.browsers)) {
    assert.equal(record.browserDistribution.browsers.find(item => item.name === name)?.browserVersion, version);
  }
  return {record, baseline, runnerDirectory};
}
