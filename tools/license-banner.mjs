import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function getPinnedVexFlowVersion(repoRoot = REPO_ROOT) {
  const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const version = packageJson.dependencies?.vexflow;

  if (typeof version !== "string" || !EXACT_VERSION.test(version)) {
    throw new Error(`package.json must pin vexflow to an exact version; received ${JSON.stringify(version)}`);
  }

  return version;
}

export function createLicenseBanner(heading, repoRoot = REPO_ROOT) {
  const vexflowVersion = getPinnedVexFlowVersion(repoRoot);

  return `/*!
 * ${heading}
 * Copyright (c) 2026 vkamolov
 * Released under the MIT License.
 *
 * Includes VexFlow ${vexflowVersion}:
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
}
