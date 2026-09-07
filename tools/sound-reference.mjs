import { build } from 'esbuild';
import { chromium, webkit } from '@playwright/test';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const mode = process.argv[2] ?? 'compare';
if (!['capture', 'seam', 'compare'].includes(mode)) throw new Error('Expected capture, seam, or compare');
const baselinePath = 'tests/fixtures/sound/baseline.json';
const rawDirectory = 'test-results/sound-baseline';
const original = process.argv.includes("--original");
const outputDirectory = `test-results/sound-${mode}${original ? "-original" : ""}`;
const sourceHash = createHash('sha256').update(await readFile('src/synth.ts')).digest('hex');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
if (mode === 'capture') {
  let exists = false; try { await access(baselinePath); exists = true; } catch {}
  if (exists) throw new Error('Baseline already exists. Refusing to overwrite original sound references.');
}
const bundle = await build({entryPoints: ['tools/audio/render-reference.ts'], bundle: true, write: false, format: 'iife', globalName: 'SoundReference', target: 'es2022', plugins: original ? [{name: 'original-synth', setup(builder) {builder.onLoad({filter: /[\\/]src[\\/]synth\.ts$/}, () => ({contents: execFileSync('git', ['show', '4c65f4a781c8cb0a19310d0079d0da2c9f844116:src/synth.ts'], {encoding: 'utf8'}), loader: 'ts'}));}}] : []});
const baseline = mode === 'capture' ? {revision, sourceHash, createdAt: new Date().toISOString(), seeds: [1, 17, 42, 123, 1024, 65537, 1234567, 4294967294], cases: []} : JSON.parse(await readFile(baselinePath, 'utf8'));
const records = [], failures = [];
await mkdir(rawDirectory, {recursive: true}); await mkdir(outputDirectory, {recursive: true});
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
for (const [engine, launcher] of Object.entries({chromium, webkit})) {
  const browser = await launcher.launch({headless: true});
  try {
    const page = await browser.newPage(); await page.addScriptTag({content: bundle.outputFiles[0].text});
    const fixtures = await page.evaluate(() => SoundReference.fixtures);
    for (const sampleRate of [44100, 48000]) for (const fixture of fixtures) {
      const key = `${engine}-${sampleRate}-${fixture.id}`;
      const old = baseline.cases.find(item => item.key === key);
      if (mode !== 'capture' && (!old || old.browserVersion !== browser.version())) throw new Error(`Missing matching browser baseline: ${key}`);
      const draws = [];
      const seeds = mode === 'capture' ? [...baseline.seeds, ...Array(32).fill(null)] : baseline.seeds;
      for (let draw = 0; draw < seeds.length; draw++) {
        const seed = seeds[draw];
        const result = await page.evaluate(async ({id, sampleRate, seed}) => SoundReference.render(id, sampleRate, seed), {id: fixture.id, sampleRate, seed});
        const {pcm, ...metrics} = result;
        if (pcm) {
          const bytes = Buffer.from(pcm, 'base64'), file = path.join(rawDirectory, `${key}-${seed}.f32.gz`);
          if (mode === 'capture') await writeFile(file, gzipSync(bytes));
          if (mode === 'seam') {
            const reference = gunzipSync(await readFile(file));
            let difference = 0;
            if (reference.length !== bytes.length) difference = Infinity;
            else for (let offset = 0; offset < bytes.length; offset += 4) difference = Math.max(difference, Math.abs(bytes.readFloatLE(offset) - reference.readFloatLE(offset)));
            if (difference > 1e-7) failures.push(`${key}/${seed}: sample difference ${difference}`);
          }
          if (draw === 0) {
            const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(36 + bytes.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(3, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(32, 34); header.write('data', 36); header.writeUInt32LE(bytes.length, 40);
            await writeFile(path.join(outputDirectory, `${key}.wav`), Buffer.concat([header, bytes]));
          }
        }
        draws.push(metrics);
      }
      if (mode === 'capture') {
        const unseeded = draws.slice(8);
        const tolerances = unseeded[0].rms.map((_, index) => {
          const levels = unseeded.map(draw => draw.rms[index]);
          const average = mean(levels), deviation = Math.sqrt(mean(levels.map(level => (level - average) ** 2)));
          return {mean: average, tolerance: Math.max(2, deviation * 3), audible: average > -60};
        });
        baseline.cases.push({key, fixture, browserVersion: browser.version(), sampleRate, engine, draws: draws.map(({rms, centroids, ...metrics}) => ({...metrics, centroids: [mean(centroids.filter(value => value > 0))]})), tolerances});
      } else if (mode === 'compare') {
        const originals = old.draws.slice(8);
        for (const [field, limit] of [['energy', 1], ['attack', 1], ['end', 1]]) if (Math.abs(mean(draws.map(draw => draw[field])) - mean(originals.map(draw => draw[field]))) > limit) failures.push(`${key}: ${field}`);
        if (draws.some(draw => draw.nonFinite > 0)) failures.push(`${key}: nonfinite samples`);
        if (draws.some(draw => draw.clipping > 0) && !originals.some(draw => draw.clipping > 0)) failures.push(`${key}: new clipping`);
        if (20 * Math.log10(mean(draws.map(draw => draw.peak)) / mean(originals.map(draw => draw.peak))) > 1) failures.push(`${key}: peak increase`);
        for (const [index, window] of old.tolerances.entries()) {
          if (!window.audible) continue;
          if (window.tolerance > 4) { failures.push(`${key}: unstable original window ${index}`); continue; }
          if (Math.abs(mean(draws.map(draw => draw.rms[index])) - window.mean) > window.tolerance) failures.push(`${key}: RMS window ${index}`);
        }
        const spectral = list => mean(list.flatMap(draw => draw.centroids.filter(value => value > 0)));
        if (Math.abs(spectral(draws) / spectral(originals) - 1) > 0.1) failures.push(`${key}: spectral centroid`);
      }
      records.push({key, draws});
      console.log(`${mode}: ${key} (${draws.length} renders)`);
    }
  } finally { await browser.close(); }
}
if (mode === 'capture') await writeFile(baselinePath, JSON.stringify(baseline));
await writeFile(path.join(outputDirectory, 'result.json'), JSON.stringify({mode, revision, sourceHash, baselineSourceHash: baseline.sourceHash, cases: records.length, failures, records}));
console.log(JSON.stringify({mode, cases: records.length, failures: failures.length, firstFailures: failures.slice(0, 12)}));
if (failures.length) process.exitCode = 1;
