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
if (!distRoot.startsWith(path.join(REPO_ROOT, "dist") + path.sep)) {
  throw new Error("Refusing to package outside the repository dist directory");
}
await rm(distRoot, { recursive: true, force: true });

const variants = [
  { id: "portable", suffix: "", entries: ["plugin.json", "skills"] },
  { id: "openai", suffix: "-openai", entries: ["plugin.json", ".codex-plugin", "skills", "assets"] },
  { id: "claude", suffix: "-claude", entries: ["plugin.json", ".claude-plugin", "skills"] },
  { id: "gemini", suffix: "-gemini", entries: ["plugin.json", "gemini-extension.json", "skills"] }
];

for (const variant of variants) {
  const variantRoot = path.join(distRoot, variant.id);
  const stagingRoot = path.join(variantRoot, metadata.name);
  await mkdir(stagingRoot, { recursive: true });
  for (const entry of variant.entries) {
    await cp(path.join(PLUGIN_ROOT, entry), path.join(stagingRoot, entry), { recursive: true });
  }
  await cp(path.join(REPO_ROOT, "LICENSE"), path.join(stagingRoot, "LICENSE"));
  await writeFile(path.join(stagingRoot, "VERSION"), `${metadata.version}\n`);

  const archive = path.join(distRoot, `${metadata.name}-${metadata.version}${variant.suffix}.tar.gz`);
  const tar = spawnSync("tar", ["-czf", archive, "-C", variantRoot, metadata.name], { encoding: "utf8" });
  if (tar.status !== 0) {
    throw new Error(`tar failed for ${variant.id}: ${tar.stderr}`);
  }
  console.log(`Packaged ${variant.id}: ${archive}`);
}

const directoryVariantRoot = path.join(distRoot, "openai-directory");
const directoryStagingRoot = path.join(directoryVariantRoot, metadata.name);
await mkdir(directoryStagingRoot, { recursive: true });
for (const entry of [".codex-plugin", "skills", "assets"]) {
  await cp(path.join(PLUGIN_ROOT, entry), path.join(directoryStagingRoot, entry), { recursive: true });
}
await cp(path.join(REPO_ROOT, "LICENSE"), path.join(directoryStagingRoot, "LICENSE"));
await writeFile(path.join(directoryStagingRoot, "VERSION"), `${metadata.version}\n`);

const directoryArchive = path.join(distRoot, `${metadata.name}-${metadata.version}-openai.zip`);
const zip = spawnSync("zip", ["-qr", "-X", directoryArchive, metadata.name], {
  cwd: directoryVariantRoot,
  encoding: "utf8"
});
if (zip.status !== 0) {
  throw new Error(`zip failed for OpenAI directory submission: ${zip.stderr}`);
}
console.log(`Packaged OpenAI directory ZIP: ${directoryArchive}`);

const submissionCheck = spawnSync(process.execPath, [path.join(REPO_ROOT, "tools", "check-openai-submission.mjs"), directoryArchive], {
  cwd: REPO_ROOT,
  encoding: "utf8",
  stdio: "inherit"
});
if (submissionCheck.status !== 0) {
  process.exit(submissionCheck.status ?? 1);
}
