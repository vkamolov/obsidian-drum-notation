import { mkdir, readFile, writeFile, rename, rm, readdir, link } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { sha256 } from './reference-provenance.mjs';

const safeName = name => typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name);
export async function inventory(directory, metadata) {
  const files = {};
  for (const name of await readdir(directory)) {
    if (name === 'inventory.json') continue;
    assert.ok(safeName(name), 'Invalid artifact filename');
    const bytes = await readFile(path.join(directory, name));
    files[name] = {bytes: bytes.length, sha256: sha256(bytes)};
  }
  const result = {schemaVersion: 1, ...metadata, files};
  await writeFile(path.join(directory, 'inventory.json'), JSON.stringify(result, null, 2));
  return result;
}
export async function verifyInventory(directory, mode, baselineHash) {
  assert.ok(['measurement', 'historical', 'reconstructed'].includes(mode), 'Unknown evidence mode');
  const manifest = JSON.parse(await readFile(path.join(directory, 'inventory.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.mode, mode, 'Evidence mode mismatch; reconstructed PCM is not historical PCM');
  assert.equal(manifest.baselineHash, baselineHash, 'Evidence baseline mismatch');
  assert.ok(Object.keys(manifest.files).length > 0, 'Empty evidence inventory');
  for (const [name, record] of Object.entries(manifest.files)) {
    assert.ok(safeName(name), 'Invalid artifact filename');
    const bytes = await readFile(path.join(directory, name));
    assert.equal(bytes.length, record.bytes, `Artifact length mismatch: ${name}`);
    assert.equal(sha256(bytes), record.sha256, `Artifact checksum mismatch: ${name}`);
    if (name.endsWith('.f32.gz')) {
      const pcm = gunzipSync(bytes, {maxOutputLength: 64 * 1024 * 1024});
      assert.ok(pcm.length > 0 && pcm.length % 4 === 0, `Invalid PCM length: ${name}`);
      for (let offset = 0; offset < pcm.length; offset += 4) assert.ok(Number.isFinite(pcm.readFloatLE(offset)), `Nonfinite PCM: ${name}`);
    }
  }
  if (mode !== 'measurement') assert.ok(Object.keys(manifest.files).some(name => name.endsWith('.f32.gz')), 'Missing PCM');
  return manifest;
}
export async function exportArchive(directory, destination, mode, baselineHash) {
  const manifest = await verifyInventory(directory, mode, baselineHash);
  const files = {};
  for (const name of ['inventory.json', ...Object.keys(manifest.files)]) files[name] = (await readFile(path.join(directory, name))).toString('base64');
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, gzipSync(JSON.stringify({schemaVersion: 1, files})), {flag: 'wx'}); await link(temporary, destination); }
  finally { await rm(temporary, {force: true}); }
}
export async function importArchive(source, destination, mode, baselineHash) {
  const archive = JSON.parse(gunzipSync(await readFile(source), {maxOutputLength: 1024 * 1024 * 1024}));
  assert.equal(archive.schemaVersion, 1);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await mkdir(temporary, {recursive: true});
  try {
    for (const [name, encoded] of Object.entries(archive.files)) {
      assert.ok(safeName(name), 'Invalid archive filename');
      await writeFile(path.join(temporary, name), Buffer.from(encoded, 'base64'), {flag: 'wx'});
    }
    const manifest = await verifyInventory(temporary, mode, baselineHash);
    assert.deepEqual(Object.keys(archive.files).sort(), ['inventory.json', ...Object.keys(manifest.files)].sort());
    // Reserve the destination first: never replace existing evidence, even an empty directory.
    await mkdir(destination);
    try { await rename(temporary, destination); } catch (error) { await rm(destination, {recursive: true}); throw error; }
  } finally { await rm(temporary, {recursive: true, force: true}); }
}
