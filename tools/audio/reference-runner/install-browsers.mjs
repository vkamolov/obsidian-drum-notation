import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { browserDirectory, verifyInstalledPackages } from './runtime.mjs';

const {runnerDirectory} = verifyInstalledPackages();
const result = spawnSync(process.execPath, [path.join(runnerDirectory, 'node_modules/playwright/cli.js'), 'install', 'chromium', 'webkit'], {
  stdio: 'inherit', env: {...process.env, PLAYWRIGHT_BROWSERS_PATH: browserDirectory}
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
