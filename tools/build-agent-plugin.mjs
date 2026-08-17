import esbuild from "esbuild";
import { tmpdir } from "node:os";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PLUGIN_ROOT, SKILL_ROOT } from "./plugin-paths.mjs";
import { getValidatorProvenance } from "./validator-provenance.mjs";

const provenance = await getValidatorProvenance();
const output = path.join(SKILL_ROOT, "scripts", "validate-drum-notation.mjs");
await mkdir(path.dirname(output), { recursive: true });
const pinnedCoreRoot = await mkdtemp(path.join(tmpdir(), "drum-notation-core-"));

try {
  for (const [relativePath, source] of provenance.notationCoreRecords) {
    const destination = path.join(pinnedCoreRoot, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, source);
  }

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
    plugins: [{
      name: "pinned-notation-core",
      setup(build) {
        build.onResolve({ filter: /^pinned-notation-core\/validation$/ }, () => ({
          path: path.join(pinnedCoreRoot, "src", "validation.ts")
        }));
      }
    }],
    define: {
      __IMPORTER_VERSION__: JSON.stringify(provenance.importerVersion),
      __NOTATION_CORE_VERSION__: JSON.stringify(provenance.notationCoreVersion),
      __NOTATION_CORE_DIGEST__: JSON.stringify(provenance.notationCoreDigest),
      __VALIDATOR_BUILD_DIGEST__: JSON.stringify(provenance.validatorBuildDigest)
    }
  });
  await chmod(output, 0o755);
} finally {
  await rm(pinnedCoreRoot, { recursive: true, force: true });
}
console.log(`Built validator ${provenance.validatorBuildDigest}.`);
