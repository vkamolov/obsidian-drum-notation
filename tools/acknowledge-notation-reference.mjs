import { acknowledgeNotationReference } from "./notation-reference-review.mjs";
import { REFERENCE_ROOT, REPO_ROOT } from "./plugin-paths.mjs";

const confirmed = process.argv.includes("--confirm-reviewed");
const result = await acknowledgeNotationReference({
  repoRoot: REPO_ROOT,
  referenceRoot: REFERENCE_ROOT,
  confirmed
});
process.exitCode = result.exitCode;
