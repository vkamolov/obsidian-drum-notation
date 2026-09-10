import { expect, test, type Page } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { measureToolbar, toolbarCases, validateToolbarReport, type ControlMetadata, type ToolbarCase } from '../helpers/toolbar-layout';

const read = (name: string) => readFileSync(`tests/fixtures/toolbar/${name}`, 'utf8');
const current = JSON.parse(read('native-current.json')) as { toolbarHtml: string; theme: string; rootStyle: Record<string, string>; controls: ControlMetadata[] };
const hostCss = read('host.css');
const currentCss = readFileSync('styles.css', 'utf8');
const widths = Array.from({ length: 1241 }, (_, index) => (560 + index) / 2);

async function setup(page: Page, scenario: ToolbarCase, theme = 'theme-light') {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('about:blank');
  await page.setContent(`<html><head></head><body class="${current.theme.replace(/theme-(light|dark)/g, theme)}"><div class="markdown-rendered"><div class="drum-notation-host"><div class="drum-notation">${current.toolbarHtml}</div></div></div></body></html>`);
  await page.addStyleTag({ content: hostCss });
  await page.addStyleTag({ content: currentCss });
  await page.evaluate(({ values, scenario }) => {
    const ancestor = document.querySelector<HTMLElement>('.drum-notation-host')!;
    for (const [key, value] of Object.entries(values)) ancestor.style.setProperty(key, value);
    const speed = document.querySelector<HTMLElement>('.drum-notation__speed')!;
    speed.textContent = scenario.text;
    speed.setAttribute('aria-label', scenario.description); speed.title = scenario.description;
    // Written tempo is independent of effective playback tempo. Keep the time clause.
    if (scenario.writtenTempo !== 120) {
      const subtitle = document.querySelector<HTMLElement>('.drum-notation__title small')!;
      subtitle.textContent = subtitle.textContent!.replace(/^120 BPM/, `${scenario.writtenTempo} BPM`);
      subtitle.setAttribute('aria-label', subtitle.getAttribute('aria-label')!.replace(/^120 BPM/, `${scenario.writtenTempo} BPM`));
    }
  }, { values: current.rootStyle, scenario });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

for (const theme of ['theme-light', 'theme-dark']) {
  test(`current native-derived toolbar containment (${theme})`, async ({ page, browser }, info) => {
    const reports = [];
    for (const scenario of toolbarCases) {
      await setup(page, scenario, theme);
      const measured = await page.evaluate(measureToolbar, { controls: current.controls, scenario, widths });
      const validation = validateToolbarReport(measured, widths);
      const report = { scenario, ...measured, validation };
      reports.push(report);
      // Attach diagnostics even when the assertion fails; never print a passing coverage claim early.
      await info.attach(`toolbar-${scenario.writtenTempo}`, { body: JSON.stringify(report), contentType: 'application/json' });
      expect(validation, JSON.stringify(measured.failures.slice(0, 3))).toEqual([]);
    }
    const report = { browser: browser.version(), theme, platform: process.platform, architecture: process.arch, fonts: current.rootStyle, viewport: { width: 1280, height: 900 },
      coverage: 'All 1,241 integer and half-integer widths from 280–900px passed using a 1 CSS px measurement allowance.',
      limitations: 'Fractional probes detect wrap changes producing overflow greater than 1px. This does not establish zero subpixel overflow, arbitrary fractional-width or zoom coverage, other platform/theme coverage, or native-host equivalence. Captured host fonts resolve on this machine.', reports };
    mkdirSync('.artifacts/toolbar', { recursive: true });
    writeFileSync(`.artifacts/toolbar/${info.project.name}-${theme}.json`, JSON.stringify(report, null, 2));
  });
}

test('toolbar checks reject invalid fixtures without a full sweep', async ({ page }) => {
  const scenario = toolbarCases[1];
  const mutations: { name: string; selector: string; action: string; value?: string }[] = [
    { name: 'missing toolbar', selector: '.drum-notation__toolbar', action: 'remove' },
    { name: 'missing control', selector: 'button', action: 'remove' },
    { name: 'reordered controls', selector: 'button', action: 'reorder' },
    { name: 'substituted control', selector: 'button', action: 'class', value: 'unexpected-control' },
    { name: 'wrong disabled state', selector: 'button', action: 'disabled', value: '' },
    { name: 'empty title', selector: '.drum-notation__title span', action: 'text', value: '' },
    { name: 'wrong speed text', selector: '.drum-notation__speed', action: 'text', value: '' },
    { name: 'wrong non-speed label', selector: 'button', action: 'aria-label', value: 'Wrong' },
    { name: 'stale speed description', selector: '.drum-notation__speed', action: 'aria-label', value: 'Playback speed 100%' },
    { name: 'missing subtitle suffix', selector: 'small', action: 'aria-label', value: '259 BPM · 4/4 · 1 bar · 16 sixteenth slots' },
    { name: 'stale subtitle', selector: 'small', action: 'aria-label', value: '120 BPM · 4/4 · 1 bar · 16 sixteenth slots. Time: 4/4' },
    { name: 'changed time title', selector: 'small', action: 'title', value: 'Time: 3/4' },
    { name: 'visible hidden control', selector: 'button[hidden]', action: 'style', value: 'display:block!important' },
    { name: 'collapsed button', selector: 'button', action: 'style', value: 'width:0!important;height:0!important;min-width:0!important;min-height:0!important;padding:0!important;border:0!important' },
    { name: 'overflow', selector: '.drum-notation__controls', action: 'style', value: 'transform:translateX(500px)' },
    { name: 'clipped label', selector: '.drum-notation__speed', action: 'style', value: 'width:10px!important;overflow:hidden!important' },
    { name: 'responsive hide', selector: '.drum-notation__controls', action: 'responsive' },
  ];
  for (const mutation of mutations) {
    await setup(page, scenario);
    await page.evaluate(mutation => {
      const el = document.querySelector<HTMLElement>(mutation.selector)!;
      if (mutation.action === 'remove') el.remove();
      else if (mutation.action === 'reorder') el.parentElement!.append(el);
      else if (mutation.action === 'text') el.textContent = mutation.value!;
      else if (mutation.action === 'responsive') {
        const style = document.createElement('style');
        style.textContent = '.drum-notation[style*="500.5px"] button:first-child { display:none!important }'; document.head.append(style);
      } else el.setAttribute(mutation.action, mutation.value!);
    }, mutation);
    const measured = await page.evaluate(measureToolbar, { controls: current.controls, scenario, widths: [500, 500.5, 501] });
    expect(measured.failures.length, mutation.name).toBeGreaterThan(0);
    if (mutation.action === 'responsive') expect(measured.failures.map(f => f.requested)).toEqual([500.5]);
  }
});
