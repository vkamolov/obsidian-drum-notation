import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { createLicenseBanner } from "./tools/license-banner.mjs";

const production = process.argv[2] === "production";
const licenseBanner = createLicenseBanner("Obsidian Drum Notation");

const context = await esbuild.context({
  banner: {
    js: licenseBanner
  },
  entryPoints: ["main.ts"],
  bundle: true,
  alias: {
    // Font-data modules are not exposed through vexflow's export map. These
    // resolve to the same files the vexflow/bravura entry imports, so esbuild
    // dedupes them and the bundle does not grow.
    "vexflow-fonts/bravura": "./node_modules/vexflow/build/esm/src/fonts/bravura.js",
    "vexflow-fonts/academico": "./node_modules/vexflow/build/esm/src/fonts/academico.js",
    "vexflow-fonts/academicobold": "./node_modules/vexflow/build/esm/src/fonts/academicobold.js"
  },
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  legalComments: "none",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: production
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
