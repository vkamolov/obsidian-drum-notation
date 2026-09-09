import { expect, test, type Page } from '@playwright/test';

const phrase = 'Title: Refit fixture\nTempo: 120\nTime: 4/4\nGrid: 16\nLegend: used\nHH | x-x-x-x-x-x-x-x- | x-x-x-x-x-x-x-x-\nSD | ----o-------o--- | ----o-------o---';
async function load(page: Page) {
  await page.goto('/');
  await page.locator('#pg-editor').fill(phrase);
  await expect(page.locator('#pg-title')).toHaveValue('Refit fixture');
  await expect(page.locator('#pg-preview svg').first()).toBeVisible();
}
async function resizePane(page: Page, width: number) {
  await page.locator('#pg-preview').evaluate((el, width) => { el.parentElement!.style.width = `${width}px`; }, width);
}

test('width refits preserve score focus, selection, and external dialog elements', async ({ page }) => {
  await load(page);
  await page.locator('#pg-loop-all').click();
  await page.getByRole('menuitemcheckbox', { name: 'Select bars', exact: true }).click();
  const bar = page.locator('.pg-bar-selectors').getByRole('button', { name: 'Add bar 2 to practice selection', exact: true });
  await bar.click();
  const selected = page.locator('.pg-bar-selectors').getByRole('button', { name: 'Remove bar 2 from practice selection', exact: true });
  await selected.focus();
  await resizePane(page, 540);
  await expect(selected).toBeFocused();
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(200);
  await expect(selected).toBeFocused();
  await expect(page.locator('#pg-preview .drum-notation__legend')).toHaveCount(1);
  await page.locator('#pg-speed').click();
  await page.getByRole('menuitem', { name: 'Tempo ramp…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Tempo ramp trainer' });
  await dialog.locator('input').first().focus();
  await resizePane(page, 480);
  await page.waitForTimeout(220);
  await expect(dialog.locator('input').first()).toBeFocused();
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
});

test('a resize does not commit pending source edits ahead of their debounce', async ({ page }) => {
  await load(page);
  await page.clock.install();
  await page.locator('#pg-editor').fill(phrase.replace('Refit fixture', 'Pending edit'));
  await resizePane(page, 510);
  await page.clock.runFor(180);
  await expect(page.locator('#pg-title')).toHaveValue('Refit fixture');
  await page.clock.runFor(100);
  await expect(page.locator('#pg-title')).toHaveValue('Pending edit');
});

test('Focus refits once immediately, preserves source, and expands only its hit area', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await load(page);
  const focus = page.locator('#pg-focus-view');
  const before = await page.locator('.pg-action-group--playback .pg-action-group__controls').boundingBox();
  const visual = await focus.boundingBox();
  expect(visual!.height).toBeLessThan(44);
  const without = await page.evaluate(() => {
    const style = document.createElement('style'); style.textContent = '.pg-btn--focus::before { content: none; }'; document.head.append(style);
    const height = document.querySelector('.pg-action-group--playback .pg-action-group__controls')!.getBoundingClientRect().height;
    style.remove(); return height;
  });
  expect(without).toBe(before!.height);
  await page.mouse.click(visual!.x + visual!.width / 2, visual!.y - 4);
  await expect(focus).toHaveAttribute('aria-pressed', 'true');
  await expect(focus).toBeFocused();
  const score = await page.locator('#pg-preview svg').first().elementHandle();
  await page.waitForTimeout(220);
  expect(await score!.evaluate(el => el.isConnected)).toBe(true);
  await expect(page.locator('#pg-editor')).toHaveValue(phrase);
  await focus.press('Space');
  await expect(focus).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(focus).toHaveAttribute('aria-pressed', 'false');
});

test('Focus remains focusable but unavailable during editing and verification', async ({ page }) => {
  await load(page);
  const focus = page.locator('#pg-focus-view');
  await page.locator('#pg-edit').click();
  await expect(focus).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#pg-focus-reason')).toHaveText('Finish editing to use Focus view.');
  await focus.focus(); await focus.press('Enter');
  await expect(focus).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('body')).toHaveClass(/pg-editing/);
  await page.locator('#pg-edit').click();
  await expect(focus).toHaveAttribute('aria-disabled', 'false');
  await page.locator('#pg-mode-verify').click();
  await expect(focus).toHaveAttribute('aria-disabled', 'true');
  await focus.click({ force: true });
  await expect(focus).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('body')).toHaveClass(/pg-verifying/);
});

test('audio recovery warning survives resize and Focus transitions', async ({ page }) => {
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    const contexts: AudioContext[] = [];
    Object.defineProperty(window, 'AudioContext', { value: class extends Native {
      constructor(options?: AudioContextOptions) { super(options); contexts.push(this); }
    }});
    Object.defineProperty(window, '__refitSuspend', { value: () => Promise.all(contexts.map(context => context.suspend())) });
  });
  await load(page);
  await page.locator('#pg-play').click();
  await expect(page.locator('#pg-play')).toHaveClass(/is-playing/);
  await page.evaluate(async () => { await (window as unknown as { __refitSuspend(): Promise<unknown> }).__refitSuspend(); });
  const warnings = page.locator('#pg-notes');
  await expect(warnings).toContainText(/paused|suspended|Resume/i);
  const text = await warnings.textContent();
  await resizePane(page, 480); await page.waitForTimeout(220);
  await expect(warnings).toHaveText(text!);
  await page.locator('#pg-focus-view').click();
  await expect(warnings).toBeVisible();
  await expect(warnings).toHaveText(text!);
});

test('paused ramp configuration and progress survive refits and focused note replacement', async ({ page }) => {
  await load(page);
  await page.locator('#pg-speed').click();
  await page.getByRole('menuitem', { name: 'Tempo ramp…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Tempo ramp trainer' });
  await dialog.getByRole('spinbutton', { name: 'Start BPM', exact: true }).fill('80');
  await dialog.getByRole('spinbutton', { name: 'Increase by BPM', exact: true }).fill('5');
  await dialog.getByRole('spinbutton', { name: 'Every N passes', exact: true }).fill('3');
  await dialog.getByRole('spinbutton', { name: 'Ceiling BPM', exact: true }).fill('100');
  await dialog.getByRole('button', { name: 'Start ramp', exact: true }).click();
  await expect(page.locator('#pg-loop')).toHaveClass(/is-playing/);
  await page.locator('#pg-stop').click();
  const progress = await page.locator('.drum-notation__practice-label').textContent();
  const note = page.locator('#pg-preview .drum-notation__interactive-note[data-slot-index="0"]').first();
  await note.focus();
  const oldNote = await note.elementHandle();
  await resizePane(page, 470);
  await expect.poll(() => oldNote!.evaluate(el => el.isConnected)).toBe(false);
  await expect(note).toBeFocused();
  await expect(page.locator('.drum-notation__practice-label')).toHaveText(progress!);
  await expect(page.locator('#pg-speed')).toHaveAttribute('aria-label', 'Tempo ramp · 80 BPM');
  await page.locator('#pg-speed').click();
  await page.getByRole('menuitem', { name: 'Tempo ramp…', exact: true }).click();
  await expect(dialog.getByRole('spinbutton', { name: 'Start BPM', exact: true })).toHaveValue('80');
  await expect(dialog.getByRole('spinbutton', { name: 'Every N passes', exact: true })).toHaveValue('3');
  await expect(dialog.getByRole('spinbutton', { name: 'Ceiling BPM', exact: true })).toHaveValue('100');
});
