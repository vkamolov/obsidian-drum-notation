import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PLUGIN_ROOT = path.join(REPO_ROOT, "agent-plugin", "drum-notation-importer");
export const SKILL_ROOT = path.join(PLUGIN_ROOT, "skills", "import-drum-score");
export const REFERENCE_ROOT = path.join(SKILL_ROOT, "references");

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
