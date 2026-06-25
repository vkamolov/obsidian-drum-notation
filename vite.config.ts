import { defineConfig } from "vite";

const licenseBanner = `/*!
 * Obsidian Drum Notation web playground
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

// The playground lives in web/ but imports the shared core and renderer straight
// from ../src — one source of truth, no package split. base: "./" keeps asset
// paths relative so the built site works from a subpath (e.g. GitHub Pages).
export default defineConfig({
  root: "web",
  base: "./",
  server: {
    // Allow importing modules from the repo root (../src) while rooted in web/.
    fs: { allow: [".."] },
    // Honor a PORT assigned by the tooling (e.g. the preview harness); falls back
    // to Vite's default (5173) when unset.
    port: process.env.PORT ? Number(process.env.PORT) : undefined
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        banner: licenseBanner
      }
    }
  }
});
