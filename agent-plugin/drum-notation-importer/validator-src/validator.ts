import { readFile, stat } from "node:fs/promises";
import { stdin, stdout } from "node:process";
import { validateDrumNotation } from "pinned-notation-core/validation";

declare const __IMPORTER_VERSION__: string;
declare const __NOTATION_CORE_VERSION__: string;
declare const __NOTATION_CORE_DIGEST__: string;
declare const __VALIDATOR_BUILD_DIGEST__: string;

const MAX_INPUT_BYTES = 128 * 1024;
const version = {
  importerVersion: __IMPORTER_VERSION__,
  notationCoreVersion: __NOTATION_CORE_VERSION__,
  notationCoreDigest: __NOTATION_CORE_DIGEST__,
  validatorBuildDigest: __VALIDATOR_BUILD_DIGEST__
};

function writeJson(value: unknown): void {
  stdout.write(`${JSON.stringify(value)}\n`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of stdin) {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(next);
    totalBytes += next.length;
    if (totalBytes > MAX_INPUT_BYTES) {
      throw new Error(`Input exceeds ${MAX_INPUT_BYTES} bytes.`);
    }
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 1 && args[0] === "--version") {
    writeJson({ schemaVersion: 1, ...version });
    return;
  }

  if (args.length > 1 || args[0]?.startsWith("--")) {
    writeJson({ schemaVersion: 1, status: "invalid", ...version, normalized: "", warnings: [], errors: ["Usage: validate-drum-notation.mjs [file]"] });
    process.exitCode = 1;
    return;
  }

  if (args[0] && (await stat(args[0])).size > MAX_INPUT_BYTES) {
    throw new Error(`Input exceeds ${MAX_INPUT_BYTES} bytes.`);
  }
  const source = args[0] ? await readFile(args[0], "utf8") : await readStdin();
  if (Buffer.byteLength(source, "utf8") > MAX_INPUT_BYTES) {
    throw new Error(`Input exceeds ${MAX_INPUT_BYTES} bytes.`);
  }

  const result = validateDrumNotation(source);
  writeJson({ schemaVersion: 1, ...version, ...result });
  process.exitCode = result.status === "invalid" ? 1 : result.status === "warnings" ? 2 : 0;
}

main().catch((error) => {
  writeJson({
    schemaVersion: 1,
    status: "invalid",
    ...version,
    normalized: "",
    warnings: [],
    errors: [error instanceof Error ? error.message : String(error)]
  });
  process.exitCode = 1;
});
