import { checkSoundProvenance } from './audio/reference-provenance.mjs';

try {
  const {record} = checkSoundProvenance();
  console.log(`Sound provenance verified: ${record.coverage.cases} cases; isolated Playwright ${record.runner.packageVersion}. No browser binaries required.`);
} catch (error) {
  console.error(`Sound provenance verification failed: ${error instanceof Error ? error.message : 'invalid provenance'}`);
  process.exitCode = 1;
}
