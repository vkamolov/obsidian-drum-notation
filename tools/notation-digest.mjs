import { createHash } from "node:crypto";
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
