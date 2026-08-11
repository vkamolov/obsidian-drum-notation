import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./plugin-paths.mjs";

const projectRoots = [
  path.join(REPO_ROOT, "main.ts"),
  path.join(REPO_ROOT, "src"),
  path.join(REPO_ROOT, "web", "src"),
  path.join(REPO_ROOT, "web", "index.html")
];
const vexflowRoot = path.join(REPO_ROOT, "node_modules", "vexflow", "build", "esm", "src");
const codeExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".html"]);

async function collectFiles(target) {
  const targetStat = await stat(target).catch(() => null);
  if (!targetStat) {
    throw new Error(`Required style-sink scan target is missing or relocated: ${path.relative(REPO_ROOT, target)}`);
  }
  if (targetStat.isFile()) {
    return [target];
  }

  const files = [];
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(child));
    } else if (entry.isFile() && codeExtensions.has(path.extname(entry.name))) {
      files.push(child);
    }
  }
  return files;
}

const files = [];
for (const root of [...projectRoots, vexflowRoot]) {
  files.push(...await collectFiles(root));
}
const vexflowFiles = files.filter((file) => file.startsWith(vexflowRoot + path.sep));
if (vexflowFiles.length < 10) {
  throw new Error(`VexFlow style-sink scan resolved only ${vexflowFiles.length} files; source layout likely changed`);
}

const findings = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  const checks = [
    { label: "setAttribute(style)", pattern: /setAttribute(?:NS)?\s*\(\s*["']style["']/g },
    { label: "cssText", pattern: /\.cssText\b/g },
    { label: "literal style attribute", pattern: /<[^>]*\sstyle\s*=/gi }
  ];

  for (const check of checks) {
    for (const match of source.matchAll(check.pattern)) {
      const line = source.slice(0, match.index).split("\n").length;
      findings.push(`${path.relative(REPO_ROOT, file)}:${line} ${check.label}`);
    }
  }
}

if (findings.length > 0) {
  throw new Error(`Forbidden style sinks found:\n${findings.join("\n")}`);
}
console.log(`Style-sink scan passed for ${files.length} files (${vexflowFiles.length} VexFlow files).`);
