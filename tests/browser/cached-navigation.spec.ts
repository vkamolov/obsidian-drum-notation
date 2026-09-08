import {expect, test, type Page} from "@playwright/test";

async function startGoal(page: Page) {
  await page.goto("/");
  await page.locator("#pg-editor").fill("Tempo: 120\nTime: 1/4\nSD | x---");
  await page.getByRole("button", {name: "Loop options"}).click();
  await page.getByRole("menuitem", {name: "Practice repetitions…"}).click();
  const dialog = page.getByRole("dialog", {name: "Practice repetitions"});
  await dialog.getByRole("spinbutton", {name: "Passes"}).fill("32");
  await dialog.getByRole("button", {name: "Start goal"}).click();
  await expect(page.locator(".drum-notation__practice-label")).toContainText(/ [1-9]\d*\/32/);
}

test("Back restores the same cached Chromium page and a usable paused session", async ({page, browserName}, info) => {
  await page.addInitScript(() => {
    const state = {identity: crypto.randomUUID(), persisted: false};
    Object.assign(window, {navigationProbe: state});
    window.addEventListener("pageshow", event => {state.persisted = event.persisted;});
  });
  await startGoal(page);
  const before = await page.evaluate(() => (window as unknown as {navigationProbe: {identity: string}}).navigationProbe.identity);
  await page.goto("/importer/privacy.html");
  await page.goBack({waitUntil: "commit"});
  await expect(page.locator("#pg-play")).toBeVisible();
  const restored = await page.evaluate(() => (window as unknown as {navigationProbe: {identity: string; persisted: boolean}}).navigationProbe);
  await info.attach("navigation-path", {body: JSON.stringify({browserName, sameInstance: before === restored.identity, persisted: restored.persisted}), contentType: "application/json"});
  if (browserName === "chromium") {
    expect(restored.identity).toBe(before);
    expect(restored.persisted).toBe(true);
  }
  if (restored.persisted) {
    const label = page.locator(".drum-notation__practice-label");
    await expect(label).toContainText("Practice paused");
    const paused = await label.textContent();
    await page.waitForTimeout(750); expect(await label.textContent()).toBe(paused);
    await page.locator("#pg-play").click();
    await expect(label).toContainText("Practice goal");
    await expect.poll(() => label.textContent()).not.toBe(paused);
    await page.locator("#pg-stop").click();
  }
  await page.reload();
  expect(await page.evaluate(() => (window as unknown as {navigationProbe: {identity: string}}).navigationProbe.identity)).not.toBe(before);
  await expect(page.locator("#pg-play")).toBeEnabled();
});

test("cached lifecycle branch remains reusable over repeated cycles", async ({page}) => {
  await startGoal(page);
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", {persisted: true})));
    await expect(page.locator(".drum-notation__practice-label")).toContainText("Practice paused");
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", {persisted: true})));
    await expect(page.locator("#pg-play")).toBeEnabled();
    await page.locator("#pg-play").click();
    await expect(page.locator(".drum-notation__practice-label")).toContainText("Practice goal");
    await page.waitForTimeout(100);
  }
  await page.locator("#pg-stop").click();
});
