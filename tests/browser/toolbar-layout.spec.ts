import { expect, test } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const read = (name: string) => readFileSync(`tests/fixtures/toolbar/${name}`, 'utf8');
const original = JSON.parse(read('native-original.json')) as { toolbarHtml: string; theme: string; rootStyle: Record<string, string> };
const current = JSON.parse(read('native-current.json')) as typeof original;
const oldCss = read('original.css');
const hostCss = read('host.css');
const currentCss = readFileSync('styles.css', 'utf8');

for (const theme of ['theme-light', 'theme-dark']) {
  test(`native-derived toolbar transition comparison (${theme})`, async ({ page, browser }, info) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const reports = [];
    for (const labels of [['75%', '90 BPM · 75%'], ['150%', '388.5 BPM · 150%']]) {
      const variants = [];
      for (const variant of ['A', 'B', 'C']) {
        // Each navigation creates a separate document: historical and current CSS cannot mix.
        await page.goto('about:blank');
        const capture = variant === 'C' ? current : original;
        await page.setContent(`<html><head></head><body class="${capture.theme.replace(/theme-(light|dark)/g, theme)}"><div class="markdown-rendered"><div class="drum-notation-host"><div class="drum-notation">${capture.toolbarHtml}</div></div></div></body></html>`);
        await page.addStyleTag({ content: hostCss });
        await page.addStyleTag({ content: variant === 'C' ? currentCss : oldCss });
        await page.evaluate(({ values, label, writtenTempo }) => {
          const root = document.querySelector<HTMLElement>('.drum-notation')!;
          for (const [key, value] of Object.entries(values)) root.style.setProperty(key, value);
          document.querySelector('.drum-notation__speed')!.textContent = label;
          const subtitle = document.querySelector('.drum-notation__title small');
          if (subtitle) subtitle.textContent = subtitle.textContent!.replace('120 BPM', `${writtenTempo} BPM`);
        }, { values: capture.rootStyle, label: labels[variant === 'A' ? 0 : 1], writtenTempo: labels[0] === '75%' ? 120 : 259 });
        await page.evaluate(() => document.fonts.ready);
        const measured = await page.evaluate(() => {
          const root = document.querySelector<HTMLElement>('.drum-notation')!;
          const toolbar = root.querySelector<HTMLElement>('.drum-notation__toolbar')!;
          const title = root.querySelector<HTMLElement>('.drum-notation__title')!;
          const controls = root.querySelector<HTMLElement>('.drum-notation__controls')!;
          const samples = new Map<number, { width: number; available: number; height: number; below: boolean; internal: boolean; overflow: boolean; labelOverflow: boolean }>();
          function measure(width: number) {
            if (samples.has(width)) return samples.get(width)!;
            root.style.width = `${width}px`;
            const t = title.getBoundingClientRect(), c = controls.getBoundingClientRect();
            const buttons = [...controls.querySelectorAll('button')].filter(el => el.getBoundingClientRect().height > 0);
            const tops = buttons.map(el => el.getBoundingClientRect().top);
            const box = toolbar.getBoundingClientRect();
            const result = { width: root.getBoundingClientRect().width, available: box.width, height: box.height,
              below: c.top >= t.bottom - 0.5, internal: Math.max(...tops) - Math.min(...tops) > 2,
              overflow: c.right > box.right + 1 || c.left < box.left - 1 || buttons.some(el => el.getBoundingClientRect().right > box.right + 1),
              labelOverflow: buttons.some(el => el.scrollWidth > el.clientWidth + 1) };
            samples.set(width, result); return result;
          }
          function search(property: 'below' | 'internal') {
            let low = 280, high = 900;
            if (measure(low)[property] === measure(high)[property]) { low = 160; high = 1600; }
            const coarse = [];
            for (let width = low; width < high; width += 32) coarse.push(width);
            coarse.push(high);
            const reversals = coarse.slice(1).filter((width, i) => !measure(coarse[i])[property] && measure(width)[property]);
            if (reversals.length) return { status: 'sampled reversal', reversals, threshold: null };
            const index = coarse.findIndex(width => !measure(width)[property]);
            if (index === 0) return { status: 'never wrapped in range', threshold: null };
            if (index === -1) return { status: 'always wrapped in range', threshold: null };
            let left = coarse[index - 1], right = coarse[index];
            while (right - left > 1) { const middle = Math.floor((left + right) / 2); if (measure(middle)[property]) left = middle; else right = middle; }
            measure(right + 1); measure(left - 1);
            return { status: 'transition bracketed', threshold: right, before: measure(left), after: measure(right) };
          }
          const outer = search('below'), internal = search('internal');
          return { outer, internal, samples: [...samples.values()].sort((a, b) => a.width - b.width) };
        });
        expect(measured.outer.status).not.toBe('sampled reversal');
        expect(measured.internal.status).not.toBe('sampled reversal');
        if (variant === 'C') {
          // The expanded diagnostic range may be smaller than one supported label.
          for (const sample of measured.samples.filter(sample => sample.width >= 280)) {
            expect(sample.overflow, `C overflow at ${sample.width}px`).toBe(false);
            expect(sample.labelOverflow, `C label clipping at ${sample.width}px`).toBe(false);
          }
        }
        variants.push({ variant, ...measured });
      }
      const [a, b, c] = variants.map(result => result.outer.threshold);
      if (a !== null && b !== null && c !== null) expect(c).toBeLessThanOrEqual(Math.max(a, b) + 1);
      reports.push({ labels, labelCost: a !== null && b !== null ? b - a : null, netChange: a !== null && c !== null ? c - a : null, variants });
    }
    const report = { browser: browser.version(), theme, viewport: { width: 1280, height: 900 },
      sampling: 'No reversal detected at 32px sample spacing; narrower excursions can escape detection. Monotonicity is not proven.',
      provenance: 'Native Obsidian DOM and matched host CSS replayed in application test browsers. These are same-run comparisons; historical numbers are not pixel expectations.', reports };
    mkdirSync('.artifacts/toolbar', { recursive: true });
    writeFileSync(`.artifacts/toolbar/${info.project.name}-${theme}.json`, JSON.stringify(report, null, 2));
    await info.attach('toolbar-layout', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  });
}
