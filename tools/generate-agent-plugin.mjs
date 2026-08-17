import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { openAiSkillAgentYaml } from "./openai-catalog.mjs";
import { PLUGIN_ROOT, stableJson } from "./plugin-paths.mjs";

const check = process.argv.includes("--check");
const metadata = JSON.parse(await readFile(path.join(PLUGIN_ROOT, "metadata.json"), "utf8"));
const shared = {
  name: metadata.name,
  version: metadata.version,
  description: metadata.description,
  author: metadata.author,
  homepage: metadata.homepage,
  repository: metadata.repository,
  license: metadata.license,
  keywords: metadata.keywords
};
const portable = {
  $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  ...shared
};
const openai = {
  ...shared,
  skills: "./skills/",
  interface: metadata.interface
};
const claude = {
  $schema: "https://json.schemastore.org/claude-code-plugin-manifest.json",
  ...shared,
  displayName: metadata.interface.displayName
};
const gemini = {
  name: metadata.name,
  version: metadata.version,
  description: metadata.description
};
const openaiSkillAgent = openAiSkillAgentYaml(metadata);
const releaseRef = `agent-plugin-v${metadata.version}`;
const repositoryUrl = `${metadata.repository}.git`;
const openaiMarketplace = {
  name: "obsidian-drum-notation",
  interface: { displayName: "Obsidian Drum Notation" },
  plugins: [
    {
      name: metadata.name,
      source: {
        source: "git-subdir",
        url: repositoryUrl,
        path: "./agent-plugin/drum-notation-importer",
        ref: releaseRef
      },
      policy: {
        installation: "AVAILABLE",
        authentication: "ON_INSTALL"
      },
      category: metadata.interface.category
    }
  ]
};
const claudeMarketplace = {
  name: "obsidian-drum-notation",
  owner: metadata.author,
  description: "Agent plugins for Obsidian Drum Notation.",
  plugins: [
    {
      name: metadata.name,
      description: metadata.description,
      version: metadata.version,
      source: {
        source: "git-subdir",
        url: repositoryUrl,
        path: "agent-plugin/drum-notation-importer",
        ref: releaseRef
      }
    }
  ]
};

async function emit(relativePath, value) {
  const destination = path.join(PLUGIN_ROOT, relativePath);
  const expected = stableJson(value);

  if (check) {
    const current = await readFile(destination, "utf8").catch(() => "");
    if (current !== expected) {
      throw new Error(`${relativePath} is stale; run npm run agent-plugin:generate`);
    }
    return;
  }

  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, expected);
}

async function emitText(destination, expected) {
  if (check) {
    const current = await readFile(destination, "utf8").catch(() => "");
    if (current !== expected) {
      throw new Error(`${path.relative(PLUGIN_ROOT, destination)} is stale; run npm run agent-plugin:generate`);
    }
    return;
  }

  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, expected);
}

await emit("plugin.json", portable);
await emit(path.join(".codex-plugin", "plugin.json"), openai);
await emit(path.join(".claude-plugin", "plugin.json"), claude);
await emit("gemini-extension.json", gemini);
await emitText(path.join(PLUGIN_ROOT, "skills", "import-drum-score", "agents", "openai.yaml"), openaiSkillAgent);
await emitText(path.join(PLUGIN_ROOT, "..", "..", ".agents", "plugins", "marketplace.json"), stableJson(openaiMarketplace));
await emitText(path.join(PLUGIN_ROOT, "..", "..", ".claude-plugin", "marketplace.json"), stableJson(claudeMarketplace));
console.log(check ? "Agent plugin manifests are current." : "Generated agent plugin manifests.");
