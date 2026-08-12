import esbuild from "esbuild";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { PLUGIN_ROOT, SKILL_ROOT } from "./plugin-paths.mjs";
import { getValidatorProvenance } from "./validator-provenance.mjs";

const provenance = await getValidatorProvenance();
const output = path.join(SKILL_ROOT, "scripts", "validate-drum-notation.mjs");
await mkdir(path.dirname(output), { recursive: true });

await esbuild.build({
  entryPoints: [path.join(PLUGIN_ROOT, "validator-src", "validator.ts")],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minify: true,
  legalComments: "none",
  banner: { js: "#!/usr/bin/env node" },
  define: {
    __IMPORTER_VERSION__: JSON.stringify(provenance.importerVersion),
    __NOTATION_CORE_VERSION__: JSON.stringify(provenance.notationCoreVersion),
    __NOTATION_CORE_DIGEST__: JSON.stringify(provenance.notationCoreDigest),
    __VALIDATOR_BUILD_DIGEST__: JSON.stringify(provenance.validatorBuildDigest)
  }
});
await chmod(output, 0o755);
console.log(`Built validator ${provenance.validatorBuildDigest}.`);
