import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PLUGIN_ROOT, REPO_ROOT } from "./plugin-paths.mjs";

const check = spawnSync(process.execPath, [path.join(REPO_ROOT, "tools", "check-agent-plugin.mjs")], {
  cwd: REPO_ROOT,
  encoding: "utf8",
  stdio: "inherit"
});
if (check.status !== 0) {
  process.exit(check.status ?? 1);
}

const metadata = JSON.parse(await readFile(path.join(PLUGIN_ROOT, "metadata.json"), "utf8"));
const distRoot = path.join(REPO_ROOT, "dist", "agent-plugin");
const stagingRoot = path.join(distRoot, metadata.name);
if (!stagingRoot.startsWith(path.join(REPO_ROOT, "dist") + path.sep)) {
  throw new Error("Refusing to package outside the repository dist directory");
}
await rm(distRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });

for (const entry of ["plugin.json", ".codex-plugin", "skills", "scripts"]) {
  await cp(path.join(PLUGIN_ROOT, entry), path.join(stagingRoot, entry), { recursive: true });
}
await cp(path.join(REPO_ROOT, "LICENSE"), path.join(stagingRoot, "LICENSE"));
await writeFile(path.join(stagingRoot, "VERSION"), `${metadata.version}\n`);

const archive = path.join(distRoot, `${metadata.name}-${metadata.version}.tar.gz`);
const tar = spawnSync("tar", ["-czf", archive, "-C", distRoot, metadata.name], { encoding: "utf8" });
if (tar.status !== 0) {
  throw new Error(`tar failed: ${tar.stderr}`);
}
console.log(`Packaged ${archive}`);
