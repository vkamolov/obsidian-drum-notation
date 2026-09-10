export interface ControlMetadata { label: string; classes: string; hidden: boolean; disabled: boolean }
export interface ToolbarCase { writtenTempo: number; text: string; description: string }
export const toolbarCases: ToolbarCase[] = [
  { writtenTempo: 120, text: '90 BPM · 75%', description: 'Playback speed 75% · 90 BPM' },
  { writtenTempo: 259, text: '388.5 BPM · 150%', description: 'Playback speed 150% · 388.5 BPM' },
];
export interface LayoutSample { requested: number; measured: number; available: number; height: number }
export interface LayoutReport { samples: LayoutSample[]; failures: { requested: number; issues: string[] }[]; runtimeMs: number }

// Self-contained: Playwright serializes this function into the fixture document.
export function measureToolbar(input: { controls: ControlMetadata[]; scenario: ToolbarCase; widths: number[] }): LayoutReport {
  const started = performance.now();
  const samples: LayoutSample[] = [], failures: LayoutReport['failures'] = [];
  const tokens = (value: string) => value.trim().split(/\s+/).sort().join(' ');
  const selectors = ['.drum-notation', '.drum-notation__toolbar', '.drum-notation__controls', '.drum-notation__title', '.drum-notation__speed', '.drum-notation__title small'];
  for (const requested of input.widths) {
    const issues: string[] = [];
    const elements = selectors.map(selector => {
      const matches = document.querySelectorAll<HTMLElement>(selector);
      if (matches.length !== 1) issues.push(`Expected exactly one ${selector}, found ${matches.length}`);
      return matches[0];
    });
    if (elements.some(el => !el)) { failures.push({ requested, issues }); continue; }
    const [root, toolbar, controls, title, speed, subtitle] = elements;
    root.style.width = `${requested}px`;
    const visible = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility === 'visible' && style.display !== 'none' && Number(style.opacity) > 0;
    };
    const positive = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      if (![r.x, r.y, r.width, r.height].every(Number.isFinite) || !visible(el)) issues.push(`Collapsed or invisible ${el.className}`);
    };
    const inside = (el: HTMLElement, parent: HTMLElement) => {
      const a = el.getBoundingClientRect(), b = parent.getBoundingClientRect();
      if (a.left < b.left - 1 || a.right > b.right + 1 || a.top < b.top - 1 || a.bottom > b.bottom + 1) issues.push(`Overflow: ${el.className}`);
    };
    const unclipped = (el: HTMLElement) => {
      const r = el.getBoundingClientRect(), style = getComputedStyle(el);
      const left = r.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      const right = r.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
      const top = r.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
      const bottom = r.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const box of Array.from(range.getClientRects())) {
          if (box.left < left - 1 || box.right > right + 1 || box.top < top - 1 || box.bottom > bottom + 1) issues.push(`Clipped text: ${el.className}`);
        }
      }
    };
    elements.forEach(positive);
    const titleText = title.querySelector('span');
    if (!titleText?.textContent?.trim()) issues.push('Empty title');
    const subtitleText = `${input.scenario.writtenTempo} BPM · 4/4 · 1 bar · 16 sixteenth slots`;
    if (subtitle.textContent !== subtitleText) issues.push('Wrong subtitle text');
    if (subtitle.getAttribute('aria-label') !== `${subtitleText}. Time: 4/4`) issues.push('Wrong subtitle description');
    if (subtitle.title !== 'Time: 4/4') issues.push('Wrong subtitle title');
    if (speed.textContent !== input.scenario.text || !speed.textContent.trim()) issues.push('Wrong speed text');
    if (speed.getAttribute('aria-label') !== input.scenario.description || speed.title !== input.scenario.description) issues.push('Wrong speed description');
    const buttons = Array.from(controls.querySelectorAll('button'));
    if (buttons.length !== input.controls.length || toolbar.querySelectorAll('button').length !== input.controls.length) issues.push('Wrong button count');
    if (!input.controls.some(control => !control.hidden)) issues.push('Empty expected visible set');
    if (input.controls.filter(control => control.classes.split(/\s+/).includes('drum-notation__speed')).length !== 1) issues.push('Invalid speed metadata');
    input.controls.forEach((expected, index) => {
      const button = buttons[index];
      if (!button) { issues.push(`Missing control ${index}`); return; }
      if (tokens(button.className) !== tokens(expected.classes)) issues.push(`Wrong classes/order ${index}`);
      const isSpeed = expected.classes.split(/\s+/).includes('drum-notation__speed');
      if (button.getAttribute('aria-label') !== (isSpeed ? input.scenario.description : expected.label)) issues.push(`Wrong label/order ${index}`);
      if (button.hidden !== expected.hidden || button.disabled !== expected.disabled) issues.push(`Wrong state ${index}`);
      if (expected.hidden) {
        if (visible(button) || button.getClientRects().length > 0) issues.push(`Unexpectedly visible hidden control ${index}`);
      } else { positive(button); inside(button, controls); unclipped(button); }
    });
    inside(toolbar, root); inside(controls, toolbar); inside(title, toolbar);
    if (titleText instanceof HTMLElement) { positive(titleText); unclipped(titleText); }
    unclipped(subtitle);
    const box = toolbar.getBoundingClientRect();
    samples.push({ requested, measured: root.getBoundingClientRect().width, available: box.width, height: box.height });
    if (issues.length) failures.push({ requested, issues: [...new Set(issues)] });
  }
  return { samples, failures, runtimeMs: performance.now() - started };
}

export function validateToolbarReport(report: LayoutReport, expectedWidths: number[]): string[] {
  const errors: string[] = [];
  if (!expectedWidths.length || new Set(expectedWidths).size !== expectedWidths.length) errors.push('Invalid expected sequence');
  if (report.samples.length !== expectedWidths.length || report.samples.some((sample, index) => sample.requested !== expectedWidths[index]) || new Set(report.samples.map(s => s.requested)).size !== expectedWidths.length) errors.push('Incomplete or duplicate coverage');
  if (report.samples.some(s => ![s.requested, s.measured, s.available, s.height].every(Number.isFinite) || s.measured <= 0 || s.available <= 0 || s.height <= 0 || Math.abs(s.measured - s.requested) > 1)) errors.push('Invalid measured geometry');
  if (!Number.isFinite(report.runtimeMs) || report.runtimeMs < 0) errors.push('Invalid runtime');
  if (report.failures.length) errors.push('Layout validity or containment failed');
  return errors;
}
