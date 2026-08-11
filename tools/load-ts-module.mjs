import esbuild from "esbuild";

export async function loadBundledTsModule(contents, resolveDir) {
  const result = await esbuild.build({
    stdin: { contents, resolveDir, sourcefile: "generated-entry.ts", loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    write: false,
    logLevel: "silent"
  });
  const source = result.outputFiles[0]?.text;
  if (!source) {
    throw new Error("esbuild did not return a bundled TypeScript module");
  }

  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}
