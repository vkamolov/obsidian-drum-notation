import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { validateToolbarReport, type LayoutReport } from './helpers/toolbar-layout';

const widths = [280, 280.5, 281];
const good = (): LayoutReport => ({ runtimeMs: 1, failures: [], samples: widths.map(requested => ({ requested, measured: requested, available: requested - 20, height: 80 })) });
describe('toolbar report coverage', () => {
  it('accepts a complete valid sequence with wrapping height changes', () => {
    const report = good(); report.samples[0].height = 160;
    expect(validateToolbarReport(report, widths)).toEqual([]);
  });
  it.each(['empty', 'truncated', 'duplicate', 'reordered', 'nonfinite', 'wrong-width', 'missing-middle', 'failure'] as const)('rejects %s reports', kind => {
    const report = good();
    if (kind === 'empty') report.samples = [];
    if (kind === 'truncated') report.samples.pop();
    if (kind === 'duplicate') report.samples[1] = report.samples[0];
    if (kind === 'reordered') report.samples.reverse();
    if (kind === 'nonfinite') report.samples[0].measured = NaN;
    if (kind === 'wrong-width') report.samples[0].measured = 900;
    if (kind === 'missing-middle') report.samples.splice(1, 1);
    if (kind === 'failure') report.failures.push({ requested: 280, issues: ['Invalid fixture'] });
    expect(validateToolbarReport(report, widths).length).toBeGreaterThan(0);
  });
});
it.each(['--name', '--name=current', '--replace-original', '--replace-original=true'])('rejects retired capture argument %s before touching plugin files or launching Obsidian', argument => {
  const result = spawnSync(process.execPath, ['tools/capture-native-toolbar.mjs', argument, '--plugin-dir', '/nonexistent/toolbar-plugin', '--executable', '/nonexistent/obsidian'], { encoding: 'utf8' });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Retired capture arguments');
  expect(result.stderr).not.toContain('ENOENT');
});
