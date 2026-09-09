/** Explicit native evidence capture; not part of CI. Uses a disposable vault only. */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, basename } from 'node:path';

const args = process.argv.slice(2);
const value = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const pluginDir = resolve(value('--plugin-dir', '.'));
const name = value('--name', 'current');
if (!['original', 'current'].includes(name)) throw new Error('--name must be original or current');
const output = resolve(value('--output-dir', 'tests/fixtures/toolbar'));
if (name === 'original' && existsSync(join(output, 'native-original.json')) && !args.includes('--replace-original')) throw new Error('Historical fixture exists; explicitly review replacement and pass --replace-original.');
const executable = value('--executable', '/Applications/Obsidian.app/Contents/MacOS/Obsidian');
const base = mkdtempSync(join(tmpdir(), 'drum-toolbar-'));
const vault = join(base, 'vault');
const profile = join(base, 'profile');
const installed = join(vault, '.obsidian/plugins/drum-notation');
mkdirSync(installed, { recursive: true }); mkdirSync(profile); mkdirSync(output, { recursive: true });
const appPackage = value('--app-package', null);
if (appPackage) copyFileSync(resolve(appPackage), join(profile, basename(appPackage)));
for (const file of ['main.js', 'styles.css', 'manifest.json']) copyFileSync(join(pluginDir, file), join(installed, file));
writeFileSync(join(profile, 'obsidian.json'), JSON.stringify({ vaults: { drumfixture: { path: vault, ts: Date.now(), open: true } } }));
writeFileSync(join(profile, 'drumfixture.json'), '{}');
writeFileSync(join(vault, '.obsidian/community-plugins.json'), '["drum-notation"]');
writeFileSync(join(vault, '.obsidian/app.json'), '{"restrictedMode":false}');
writeFileSync(join(vault, 'Fixture.md'), '```drums\nTitle: Toolbar fixture\nTempo: 120\nHH | x-x-x-x-x-x-x-x-\nSD | ----o-------o---\nBD | o-------o-------\n```\n');
const child = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-port=0'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    const timer = setTimeout(() => reject(new Error('No native debugger endpoint')), 20000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.stderr.on('data', bytes => {
      const match = bytes.toString().match(/ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+/);
      if (match) { clearTimeout(timer); resolveEndpoint(match[0]); }
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent('page');
  await page.waitForFunction(() => typeof app !== 'undefined' && app.workspace?.layoutReady && app.workspace.rootSplit);
  await page.evaluate(async () => {
    await app.plugins.enablePlugin('drum-notation');
    await app.workspace.openLinkText('Fixture.md', '', false);
    await app.workspace.getMostRecentLeaf().setViewState({ type: 'markdown', state: { file: 'Fixture.md', mode: 'preview' } });
  });
  await page.locator('.drum-notation__toolbar:visible').first().waitFor();
  const data = await page.evaluate(() => {
    const root = [...document.querySelectorAll('.drum-notation-host > .drum-notation')].find(el => el.getBoundingClientRect().height > 0);
    const toolbar = root.querySelector('.drum-notation__toolbar');
    const clone = toolbar.cloneNode(true);
    clone.querySelectorAll('*').forEach(el => { el.removeAttribute('id'); el.removeAttribute('style'); });
    const cs = getComputedStyle(root);
    const properties = ['font-family', 'font-size', 'font-weight', 'line-height', '--font-smallest', '--font-interface', '--font-text', '--font-ui-small', '--icon-size', '--icon-stroke'];
    return { captureMethod: 'Native Obsidian CDP in disposable vault; visible Reading-view block', capturedAt: new Date().toISOString(),
      obsidianVersion: document.title.match(/Obsidian ([0-9.]+)/)?.[1] ?? null, userAgent: navigator.userAgent, theme: document.body.className,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }, rootStyle: Object.fromEntries(properties.map(p => [p, cs.getPropertyValue(p)])),
      toolbarHtml: clone.outerHTML, controls: [...toolbar.querySelectorAll('button')].map(el => ({ label: el.getAttribute('aria-label'), classes: el.className, hidden: el.hidden, disabled: el.disabled })) };
  });
  data.appPackageHash = appPackage ? createHash('sha256').update(readFileSync(appPackage)).digest('hex') : null;
  data.pluginHashes = Object.fromEntries(['main.js', 'styles.css', 'manifest.json'].map(file => [file, createHash('sha256').update(readFileSync(join(pluginDir, file))).digest('hex')]));
  if (name === 'original') copyFileSync(join(pluginDir, 'styles.css'), join(output, 'original.css'));
  if (args.includes('--capture-host-css')) {
    const hostCss = await page.evaluate(() => {
      const root = [...document.querySelectorAll('.drum-notation-host > .drum-notation')].find(el => el.getBoundingClientRect().height > 0);
      const targets = [document.documentElement, document.body, root, ...root.querySelector('.drum-notation__toolbar').querySelectorAll('*')];
      const bodyClass = document.body.className;
      const collect = rules => [...rules].flatMap(rule => {
        if (rule.selectorText) { try { return targets.some(el => el.matches(rule.selectorText)) ? [rule.cssText] : []; } catch { return []; } }
        if (rule.cssRules) { const inner = collect(rule.cssRules); return inner.length ? [rule.cssText.slice(0, rule.cssText.indexOf('{') + 1) + inner.join('\n') + '}'] : []; }
        return [];
      });
      const all = new Set();
      for (const theme of ['theme-light', 'theme-dark']) {
        document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(theme);
        for (const sheet of [...document.styleSheets].filter(sheet => sheet.href?.endsWith('/app.css'))) collect(sheet.cssRules).forEach(rule => all.add(rule));
      }
      document.body.className = bodyClass;
      return [...all].join('\n');
    });
    writeFileSync(join(output, 'host.css'), hostCss + '\n');
  }
  const checks = await page.evaluate(() => {
    const root = [...document.querySelectorAll('.drum-notation-host > .drum-notation')].find(el => el.getBoundingClientRect().height > 0);
    return [280, 390, 625].map(width => {
      root.style.width = `${width}px`;
      const toolbar = root.querySelector('.drum-notation__toolbar').getBoundingClientRect();
      const controls = root.querySelector('.drum-notation__controls').getBoundingClientRect();
      return { width, available: toolbar.width, controls: controls.width, overflow: controls.right > toolbar.right + 1 || controls.left < toolbar.left - 1 };
    });
  });
  data.nativeWidthChecks = checks;
  await page.emulateMedia({ media: 'print' });
  data.printControlsHidden = await page.locator('.drum-notation__controls').evaluateAll(els => els.every(el => getComputedStyle(el).display === 'none'));
  await page.emulateMedia({ media: 'screen' });
  if (args.includes('--verify-contexts')) {
    const report = { version: data.obsidianVersion, reading: checks, printControlsHidden: data.printControlsHidden };
    await page.evaluate(async () => {
      app.plugins.plugins['drum-notation'].settings.enableVisualEditMode = true;
      const source = await app.vault.read(app.vault.getAbstractFileByPath('Fixture.md'));
      await app.vault.create('Multiple.md', '# Multiple blocks\n\n' + source + '\n' + source);
      await app.vault.create('Embed.md', '# Embedded score\n\n![[Fixture]]');
      await app.workspace.openLinkText('Multiple.md', '', false);
      await app.workspace.getMostRecentLeaf().setViewState({ type: 'markdown', state: { file: 'Multiple.md', mode: 'preview' } });
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.drum-notation__toolbar')].filter(el => el.getBoundingClientRect().height > 0).length === 2);
    report.multiple = await page.locator('.drum-notation__toolbar:visible').evaluateAll(els => ({ count: els.length, practiceControls: els.reduce((sum, el) => sum + el.querySelectorAll('.drum-notation__practice-entry').length, 0) }));
    await page.evaluate(async () => {
      await app.workspace.getMostRecentLeaf().setViewState({ type: 'markdown', state: { file: 'Multiple.md', mode: 'source', source: false } });
    });
    await page.locator('.cm-preview-code-block .drum-notation__toolbar:visible').first().waitFor();
    report.livePreview = await page.locator('.cm-preview-code-block .drum-notation__toolbar:visible').first().evaluate(el => [...el.querySelectorAll('button')].map(button => ({ label: button.getAttribute('aria-label'), disabled: button.disabled })).filter(button => /Reading view|visual|Edit/i.test(button.label ?? '')));
    await page.evaluate(async () => {
      await app.workspace.openLinkText('Embed.md', '', false);
      await app.workspace.getMostRecentLeaf().setViewState({ type: 'markdown', state: { file: 'Embed.md', mode: 'preview' } });
    });
    await page.locator('.markdown-embed .drum-notation__toolbar:visible').first().waitFor();
    report.embed = { rendered: true };
    const popupPromise = context.waitForEvent('page');
    await page.evaluate(() => { app.workspace.moveLeafToPopout(app.workspace.getMostRecentLeaf()); });
    const popup = await popupPromise;
    await popup.locator('.drum-notation__toolbar:visible').first().waitFor();
    report.popout = { rendered: true, tempo: await popup.locator('.drum-notation__speed:visible').first().textContent() };
    const artifacts = resolve('.artifacts/native-toolbar'); mkdirSync(artifacts, { recursive: true });
    try { await popup.pdf({ path: join(artifacts, 'score.pdf'), printBackground: true }); report.pdf = 'exported'; }
    catch (error) { report.pdf = error instanceof Error ? error.message : String(error); }
    writeFileSync(join(artifacts, 'contexts.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  }
  if (!args.includes('--verify-contexts')) {
  writeFileSync(join(output, `native-${name}.json`), JSON.stringify(data, null, 2) + '\n');
  console.log(JSON.stringify({ captured: name, checks, printControlsHidden: data.printControlsHidden }));
  }
} finally {
  if (browser) await Promise.race([browser.close(), new Promise(resolveTimeout => setTimeout(resolveTimeout, 2000))]);
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
  child.stdout.destroy(); child.stderr.destroy(); child.unref();
}
