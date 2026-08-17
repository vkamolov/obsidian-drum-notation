import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMPORT_PATTERNS = [
  /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
];

function importSpecifiers(source) {
  return IMPORT_PATTERNS.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]));
}

export function normalizeSourceText(source) {
  return source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export function sourceChecksum(source) {
  return createHash("sha256").update(normalizeSourceText(source)).digest("hex");
}

export function digestRecords(records) {
  const hash = createHash("sha256");

  for (const [relativePath, source] of [...records].sort(([left], [right]) => left.localeCompare(right))) {
    const normalized = normalizeSourceText(source);
    const pathBytes = Buffer.from(relativePath, "utf8");
    const sourceBytes = Buffer.from(normalized, "utf8");
    hash.update(`${pathBytes.length}:`);
    hash.update(pathBytes);
    hash.update(`${sourceBytes.length}:`);
    hash.update(sourceBytes);
  }

  return hash.digest("hex");
}

async function resolveLocalImport(specifier, importer, repoRoot) {
  if (!specifier.startsWith(".")) {
    throw new Error(`notation core source ${path.relative(repoRoot, importer)} imports external module ${specifier}`);
  }

  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, path.join(base, "index.ts")];

  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "EISDIR") {
        throw error;
      }
    }
  }

  throw new Error(`cannot resolve ${specifier} from ${path.relative(repoRoot, importer)}`);
}

export async function collectNotationCoreRecords(repoRoot = DEFAULT_ROOT) {
  const entry = path.join(repoRoot, "src", "validation.ts");
  const queue = [entry];
  const visited = new Set();
  const records = [];

  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || visited.has(file)) {
      continue;
    }
    visited.add(file);

    const source = await readFile(file, "utf8");
    const relativePath = path.relative(repoRoot, file).split(path.sep).join("/");
    records.push([relativePath, source]);

    for (const specifier of importSpecifiers(source)) {
      queue.push(await resolveLocalImport(specifier, file, repoRoot));
    }
  }

  return records;
}

export async function getNotationCoreInfo(repoRoot = DEFAULT_ROOT) {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, "manifest.json"), "utf8"));
  const records = await collectNotationCoreRecords(repoRoot);

  return {
    version: manifest.version,
    digest: digestRecords(records),
    inputs: records.map(([relativePath]) => relativePath).sort()
  };
}

function resolveLocalImportSync(specifier, importer, repoRoot) {
  if (!specifier.startsWith(".")) {
    throw new Error(`notation core source ${path.relative(repoRoot, importer)} imports external module ${specifier}`);
  }
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, path.join(base, "index.ts")];
  const resolved = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (!resolved) {
    throw new Error(`cannot resolve ${specifier} from ${path.relative(repoRoot, importer)}`);
  }
  return resolved;
}

export function collectNotationCoreRecordsSync(repoRoot = DEFAULT_ROOT) {
  const queue = [path.join(repoRoot, "src", "validation.ts")];
  const visited = new Set();
  const records = [];

  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || visited.has(file)) {
      continue;
    }
    visited.add(file);
    const source = readFileSync(file, "utf8");
    records.push([path.relative(repoRoot, file).split(path.sep).join("/"), source]);
    for (const specifier of importSpecifiers(source)) {
      queue.push(resolveLocalImportSync(specifier, file, repoRoot));
    }
  }
  return records;
}

export function getNotationCoreInfoSync(repoRoot = DEFAULT_ROOT) {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));
  const records = collectNotationCoreRecordsSync(repoRoot);
  return {
    version: manifest.version,
    digest: digestRecords(records),
    inputs: records.map(([relativePath]) => relativePath).sort()
  };
}

function assertReleaseRef(ref) {
  if (!/^\d+\.\d+\.\d+$/.test(ref)) {
    throw new Error(`notation core ref ${ref} must be an exact semver release tag`);
  }
}

function readGitFileSync(repoRoot, ref, relativePath, optional = false) {
  const result = spawnSync("git", ["show", `${ref}:${relativePath}`], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024
  });

  if (result.status === 0) {
    return result.stdout;
  }
  if (optional) {
    return undefined;
  }

  const detail = result.stderr.trim() || `git exited with status ${result.status}`;
  throw new Error(`cannot read ${relativePath} from notation core ref ${ref}: ${detail}`);
}

function resolveGitLocalImportSync(specifier, importer, repoRoot, ref) {
  if (!specifier.startsWith(".")) {
    throw new Error(`notation core source ${importer} at ${ref} imports external module ${specifier}`);
  }

  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  if (base === ".." || base.startsWith("../") || path.posix.isAbsolute(base)) {
    throw new Error(`notation core import ${specifier} escapes the repository at ${ref}`);
  }
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, path.posix.join(base, "index.ts")];
  const resolved = candidates.find((candidate) => readGitFileSync(repoRoot, ref, candidate, true) !== undefined);
  if (!resolved) {
    throw new Error(`cannot resolve ${specifier} from ${importer} at notation core ref ${ref}`);
  }
  return resolved;
}

export function collectNotationCoreRecordsAtGitRefSync(repoRoot = DEFAULT_ROOT, ref) {
  assertReleaseRef(ref);
  const queue = ["src/validation.ts"];
  const visited = new Set();
  const records = [];

  while (queue.length > 0) {
    const relativePath = queue.shift();
    if (!relativePath || visited.has(relativePath)) {
      continue;
    }
    visited.add(relativePath);
    const source = readGitFileSync(repoRoot, ref, relativePath);
    records.push([relativePath, source]);
    for (const specifier of importSpecifiers(source)) {
      queue.push(resolveGitLocalImportSync(specifier, relativePath, repoRoot, ref));
    }
  }

  return records;
}

export function getNotationCoreInfoAtGitRefSync(repoRoot = DEFAULT_ROOT, ref) {
  assertReleaseRef(ref);
  const manifest = JSON.parse(readGitFileSync(repoRoot, ref, "manifest.json"));
  if (manifest.version !== ref) {
    throw new Error(`notation core ref ${ref} contains manifest version ${manifest.version}`);
  }
  const records = collectNotationCoreRecordsAtGitRefSync(repoRoot, ref);
  return {
    version: manifest.version,
    digest: digestRecords(records),
    inputs: records.map(([relativePath]) => relativePath).sort(),
    records
  };
}

export async function getNotationCoreInfoAtGitRef(repoRoot = DEFAULT_ROOT, ref) {
  return getNotationCoreInfoAtGitRefSync(repoRoot, ref);
}
