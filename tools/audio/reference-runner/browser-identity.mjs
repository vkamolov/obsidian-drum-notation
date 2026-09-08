import {readdir, readFile, readlink} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {sha256} from '../reference-provenance.mjs';
import {browserDirectory} from './runtime.mjs';

/** Include the engine/framework binaries, not only WebKit's launcher script. */
export async function browserBuildIdentity(executable) {
  const relative = path.relative(browserDirectory, executable);
  assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), 'Browser is outside the isolated installation');
  const root = path.join(browserDirectory, relative.split(path.sep)[0]);
  const files = {};
  async function visit(directory) {
    for (const entry of (await readdir(directory, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name), key = path.relative(root, file);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isSymbolicLink()) files[key] = {symlink: await readlink(file)};
      else if (entry.isFile()) files[key] = {sha256: sha256(await readFile(file))};
    }
  }
  await visit(root);
  return {directory: root, treeSHA256: sha256(JSON.stringify(files)), files};
}
