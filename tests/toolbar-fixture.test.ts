import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(name, 'utf8');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const provenance = JSON.parse(read('tests/fixtures/toolbar/provenance.json'));
const source = read('main.ts');
const construction = source.slice(source.indexOf('    const root = el.createDiv'), source.indexOf('    const state: RenderState ='));
const labels = source.slice(source.indexOf('      const speedDescription ='), source.indexOf('      metronomeButton.disabled ='));

describe('native toolbar fixture provenance', () => {
  it('preserves the historical fixture and stylesheet bytes', () => {
    for (const [file, checksum] of Object.entries(provenance.files)) {
      expect(hash(read(`tests/fixtures/toolbar/${file}`)), file).toBe(checksum);
    }
  });
  it('requires fixture review when adapter construction or tempo formatting changes', () => {
    expect(construction.length).toBeGreaterThan(500);
    expect(labels.length).toBeGreaterThan(200);
    expect(hash(construction)).toBe(provenance.currentAdapter.constructionHash);
    expect(hash(labels)).toBe(provenance.currentAdapter.labelsHash);
    const current = JSON.parse(read('tests/fixtures/toolbar/native-current.json'));
    expect(current.captureMethod).toContain('Native Obsidian');
    const original = JSON.parse(read('tests/fixtures/toolbar/native-original.json'));
    expect(current.obsidianVersion).toBe(original.obsidianVersion);
    expect(current.controls.some((button: {label: string}) => /Practice tools|Exit Practice view/.test(button.label))).toBe(false);
    expect(current.controls.some((button: {label: string}) => button.label === 'Loop options')).toBe(true);
  });
});
