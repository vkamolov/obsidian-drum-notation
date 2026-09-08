import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { checkSoundProvenance, readJson, repositoryRoot } from '../reference-provenance.mjs';

export const browserDirectory = path.join(repositoryRoot, '.artifacts/sound-runtime/browsers');

export function verifyInstalledPackages() {
  const verified = checkSoundProvenance();
  for (const name of ['@playwright/test', 'playwright', 'playwright-core', 'esbuild']) {
    const directory = path.join(verified.runnerDirectory, 'node_modules', name);
    let installed;
    try { installed = readJson(path.join(directory, 'package.json')); }
    catch { throw new Error('The isolated sound runner is not installed. Run npm run sound:runner:install.'); }
    assert.equal(installed.version, verified.record.runner.packages[`node_modules/${name}`].version, `Isolated package mismatch: ${name}`);
  }
  const distribution = readJson(path.join(verified.runnerDirectory, 'node_modules/playwright-core/browsers.json'));
  assert.deepEqual(distribution, verified.record.browserDistribution, 'Isolated browser distribution mismatch');
  return verified;
}

export async function loadRuntime() {
  const verified = verifyInstalledPackages();
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserDirectory;
  // Absolute module URLs prevent a missing private install from falling back to root dependencies.
  const playwright = await import(pathToFileURL(path.join(verified.runnerDirectory, 'node_modules/@playwright/test/index.mjs')).href);
  const esbuild = await import(pathToFileURL(path.join(verified.runnerDirectory, 'node_modules/esbuild/lib/main.js')).href);
  return {...verified, playwright, build: esbuild.build};
}
