import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createLicenseBanner, getPinnedVexFlowVersion } from "./license-banner.mjs";
import { REPO_ROOT } from "./plugin-paths.mjs";

const packageJson = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
const lockfile = JSON.parse(await readFile(path.join(REPO_ROOT, "package-lock.json"), "utf8"));
const version = getPinnedVexFlowVersion(REPO_ROOT);

if (packageJson.devDependencies?.esbuild !== "0.25.12") {
  throw new Error("esbuild must remain pinned exactly to 0.25.12");
}
if (lockfile.packages?.[""]?.dependencies?.vexflow !== version) {
  throw new Error("package-lock root vexflow declaration does not match package.json");
}
if (lockfile.packages?.["node_modules/vexflow"]?.version !== version) {
  throw new Error("package-lock resolved vexflow version does not match package.json");
}
if (lockfile.packages?.[""]?.devDependencies?.esbuild !== "0.25.12" || lockfile.packages?.["node_modules/esbuild"]?.version !== "0.25.12") {
  throw new Error("package-lock esbuild pin/resolution is stale");
}

const notice = await readFile(path.join(REPO_ROOT, "THIRD_PARTY_NOTICES.md"), "utf8");
const readme = await readFile(path.join(REPO_ROOT, "README.md"), "utf8");
if (!notice.includes(`## VexFlow ${version}`) || !readme.includes(`${version} for music engraving`)) {
  throw new Error("VexFlow README or third-party notice version is stale");
}

const pluginBanner = createLicenseBanner("Obsidian Drum Notation", REPO_ROOT);
const webBanner = createLicenseBanner("Obsidian Drum Notation web playground", REPO_ROOT);
const mainBundle = await readFile(path.join(REPO_ROOT, "main.js"), "utf8").catch(() => null);
if (mainBundle === null || !mainBundle.startsWith(pluginBanner)) {
  throw new Error("Minified main.js is missing the complete generated license banner; run npm run build");
}

const webAssetsRoot = path.join(REPO_ROOT, "web", "dist", "assets");
const webFiles = await readdir(webAssetsRoot).catch(() => []);
const javascriptFiles = webFiles.filter((file) => file.endsWith(".js"));
if (javascriptFiles.length === 0) {
  throw new Error("No built web JavaScript artifacts found; run npm run web:build");
}
for (const file of javascriptFiles) {
  const source = await readFile(path.join(webAssetsRoot, file), "utf8");
  if (!source.startsWith(webBanner)) {
    throw new Error(`Built web artifact ${file} is missing the complete generated license banner`);
  }
}

console.log(`Third-party checks passed for VexFlow ${version} across ${javascriptFiles.length + 1} production bundles.`);
