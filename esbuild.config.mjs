import esbuild from "esbuild";
import { builtinModules } from "node:module";

const production = process.argv[2] === "production";
const licenseBanner = `/*!
 * Obsidian Drum Notation
 * Copyright (c) 2026 vkamolov
 * Released under the MIT License.
 *
 * Includes VexFlow 5.0.0:
 * VexFlow - A JavaScript library for rendering music notation.
 * Copyright (c) 2023-present VexFlow contributors (see AUTHORS.md).
 * Copyright (c) 2010-2022 Mohit Muthanna Cheppudira
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */`;

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
