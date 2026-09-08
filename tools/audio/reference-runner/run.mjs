import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { loadRuntime } from './runtime.mjs';
import {browserBuildIdentity} from './browser-identity.mjs';
import { repositoryRoot, gitFile, sha256, checkSoundProvenance } from '../reference-provenance.mjs';
import { compareMeasurements, variabilityReport, formatVariability } from '../sound-report.mjs';
import { inventory, verifyInventory, importArchive, exportArchive } from '../sound-artifacts.mjs';

export async function launchVerified(launcher, version, options = {}) {
  const browser = await launcher.launch({headless: true, ...options});
  try { assert.equal(browser.version(), version, 'Reference browser version mismatch'); return browser; }
  catch (error) { await browser.close(); throw error; }
}
function wav(bytes, sampleRate) {
  const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(36 + bytes.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(3, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(32, 34); header.write('data', 36); header.writeUInt32LE(bytes.length, 40);
  return Buffer.concat([header, bytes]);
}
export async function run(args = process.argv.slice(2)) {
  const [command = 'compare'] = args;
  const value = flag => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const evidenceMode = value('--mode') ?? 'measurement';
  const selected = value('--reference');
  const {record, baseline} = checkSoundProvenance();
  const storage = path.join(repositoryRoot, '.artifacts/sound-references');
  await mkdir(storage, {recursive: true});
  if (command === 'capture') throw new Error('Frozen baseline already exists. Use reconstruct; never overwrite original measurements.');
  if (command === 'import' || command === 'export') {
    assert.ok(selected && value('--archive'), 'Specify --reference DIRECTORY --archive FILE --mode MODE');
    return command === 'import' ? importArchive(value('--archive'), selected, evidenceMode, record.baseline.sha256)
      : exportArchive(selected, value('--archive'), evidenceMode, record.baseline.sha256);
  }
  assert.ok(['reconstruct', 'compare', 'seam', 'preflight'].includes(command), 'Unknown sound operation');
  if (command === 'seam') {
    assert.ok(selected && ['historical', 'reconstructed'].includes(evidenceMode), 'Sample comparison requires explicit --reference and --mode historical|reconstructed. Original PCM was lost.');
    const reference = await verifyInventory(selected, evidenceMode, record.baseline.sha256);
    for (const item of baseline.cases) for (const seed of baseline.seeds) assert.ok(reference.files[`${item.key}-${seed}.f32.gz`], `Missing reference PCM: ${item.key}/${seed}`);
  }
  const runtime = await loadRuntime();
  const historicalSource = command === 'reconstruct' || args.includes('--original');
  const bundle = command === 'preflight' ? null : await runtime.build({
    absWorkingDir: repositoryRoot, entryPoints: ['tools/audio/render-reference.ts'], bundle: true, write: false,
    format: 'iife', globalName: 'SoundReference', target: 'es2022', plugins: [{name: 'frozen-capture-harness', setup(builder) {
      builder.onLoad({filter: /\.(ts)$/}, ({path: file}) => {
        const relative = path.relative(repositoryRoot, file).split(path.sep).join('/');
        if (relative === 'tools/audio/render-reference.ts' || historicalSource && relative.startsWith('src/')) {
          const revision = relative === 'src/synth.ts' ? record.original.revision : record.capture.revision;
          return {contents: gitFile(revision, relative).toString(), loader: 'ts'};
        }
      });
    }}]
  });
  const id = `${command}-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
  const destination = path.join(storage, id), staging = `${destination}.partial`;
  await mkdir(staging);
  const environment = {createdAt: new Date().toISOString(), os: os.platform(), release: os.release(), architecture: os.arch(), node: process.version,
    playwright: record.runner.packageVersion, bundler: record.runner.packages['node_modules/esbuild'].version,
    originalSource: historicalSource, sourceHash: historicalSource ? record.original.sourceHash : sha256(readFileSync(path.join(repositoryRoot, 'src/synth.ts'))),
    harnessRevision: record.capture.revision, browsers: {}};
  const records = [], failures = [];
  try {
    for (const [engine, version] of Object.entries(record.coverage.browsers)) {
      const launcher = runtime.playwright[engine];
      const browser = await launchVerified(launcher, version, {executablePath: launcher.executablePath()});
      try {
        const executable = launcher.executablePath();
        environment.browsers[engine] = {version: browser.version(), executable, executableSHA256: sha256(await readFile(executable)), build: await browserBuildIdentity(executable), distribution: record.browserDistribution.browsers.filter(item => item.name === engine)};
        if (command === 'preflight') continue;
        const page = await browser.newPage();
        await page.addScriptTag({content: bundle.outputFiles[0].text});
        const fixtures = await page.evaluate(() => SoundReference.fixtures);
        for (const item of baseline.cases.filter(item => item.engine === engine)) {
          assert.deepEqual(fixtures.find(fixture => fixture.id === item.fixture.id), item.fixture, `Frozen fixture changed: ${item.key}`);
          const seeds = command === 'reconstruct' ? [...baseline.seeds, ...Array(32).fill(null)] : baseline.seeds;
          const draws = [];
          for (const [draw, seed] of seeds.entries()) {
            const {pcm, ...metrics} = await page.evaluate(({id, sampleRate, seed}) => SoundReference.render(id, sampleRate, seed), {id: item.fixture.id, sampleRate: item.sampleRate, seed});
            draws.push(metrics);
            if (pcm) {
              const bytes = Buffer.from(pcm, 'base64'), filename = `${item.key}-${seed}.f32.gz`;
              await writeFile(path.join(staging, filename), gzipSync(bytes));
              if (draw === 0) await writeFile(path.join(staging, `${item.key}.wav`), wav(bytes, item.sampleRate));
              if (command === 'seam') {
                const reference = gunzipSync(await readFile(path.join(selected, filename)));
                let difference = bytes.length === reference.length ? 0 : Infinity;
                if (Number.isFinite(difference)) for (let offset = 0; offset < bytes.length; offset += 4) {
                  const delta = Math.abs(bytes.readFloatLE(offset) - reference.readFloatLE(offset));
                  difference = Number.isFinite(delta) ? Math.max(difference, delta) : Infinity;
                }
                if (difference > 1e-7) failures.push(`${item.key}/${seed}: sample difference ${difference}`);
              }
            }
          }
          if (command !== 'seam') failures.push(...compareMeasurements(item, draws.slice(0, baseline.seeds.length)));
          records.push({key: item.key, draws});
          console.log(`${command}: ${item.key} (${draws.length} renders)`);
        }
      } finally { await browser.close(); }
    }
    const variability = command === 'reconstruct' ? variabilityReport(baseline, records) : null;
    const result = {command, mode: command === 'reconstruct' ? 'reconstructed' : command === 'seam' ? evidenceMode : 'measurement',
      baselineHash: record.baseline.sha256, environment, historicalPCMAvailable: command === "seam" && evidenceMode === "historical",
      meanLimitAgreement: failures.filter(failure => !failure.includes('unstable original')), historicalInstability: failures.filter(failure => failure.includes('unstable original')),
      failures, variability, records};
    await writeFile(path.join(staging, 'report.json'), JSON.stringify(result));
    if (variability) await writeFile(path.join(staging, 'variability.md'), formatVariability(variability));
    await inventory(staging, {mode: result.mode, baselineHash: record.baseline.sha256, environment});
    await rename(staging, destination);
    console.log(JSON.stringify({destination, cases: records.length, failures: failures.length, firstFailures: failures.slice(0, 12)}));
    // Reconstruction generates evidence, including limitations; acoustic acceptance remains separate.
    if (command !== 'reconstruct' && failures.length) process.exitCode = 1;
    return result;
  } catch (error) { await rm(staging, {recursive: true, force: true}); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await run();
