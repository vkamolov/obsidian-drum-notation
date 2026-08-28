import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const validatorVersionRun = spawnSync(process.execPath, [
  "agent-plugin/drum-notation-importer/skills/import-drum-score/scripts/validate-drum-notation.mjs",
  "--version"
], { encoding: "utf8" });
if (validatorVersionRun.status !== 0) {
  throw new Error(`Unable to read bundled validator provenance: ${validatorVersionRun.stderr}`);
}
const validatorVersion = JSON.parse(validatorVersionRun.stdout) as {
  importerVersion: string;
  notationCoreVersion: string;
  notationCoreDigest: string;
  validatorBuildDigest: string;
};
const currentNotationCoreRun = spawnSync(process.execPath, [
  "--input-type=module",
  "--eval",
  'import { getNotationCoreInfoSync } from "./tools/notation-digest.mjs"; console.log(JSON.stringify(getNotationCoreInfoSync()));'
], { encoding: "utf8" });
if (currentNotationCoreRun.status !== 0) {
  throw new Error(`Unable to read current notation-core provenance: ${currentNotationCoreRun.stderr}`);
}
const currentNotationCore = JSON.parse(currentNotationCoreRun.stdout) as { version: string; digest: string };

function cleanImportReport(blockCount: number) {
  return {
    schemaVersion: 1,
    importerVersion: validatorVersion.importerVersion,
    notationCoreVersion: validatorVersion.notationCoreVersion,
    notationCoreDigest: validatorVersion.notationCoreDigest,
    validatorBuildDigest: validatorVersion.validatorBuildDigest,
    source: { kind: "image" },
    validationStatus: "clean",
    segments: Array.from({ length: blockCount }, (_, index) => ({
      id: `segment-${index + 1}`,
      title: `Segment ${index + 1}`,
      blockIndex: index,
      validationStatus: "clean",
      issues: [],
      ambiguities: [],
      workarounds: []
    })),
    humanReviewRequired: true
  } as const;
}

declare global {
  interface Window {
    __cspViolations: string[];
    __recordObjectUrlRevoke?: (url: string) => Promise<void>;
    __wakeLockRequests?: number;
    __wakeLockReleases?: number;
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations.push(`${event.violatedDirective}:${event.blockedURI}`);
    });
  });
});

test("importer catalog and policy pages are static, accessible, and tracking-free", async ({ page }) => {
  const offOriginRequests: string[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:4173")) {
      offOriginRequests.push(request.url());
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/importer/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Printed drum scores, ready for Obsidian.");
  await expect(page.getByRole("link", { name: "Open verification playground" })).toHaveAttribute("href", "../");
  await expect(page.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "./privacy.html");
  await expect(page.getByRole("link", { name: "Support" })).toHaveAttribute("href", /importer-support\.yml/);
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute("content", /connect-src 'none'/);
  await expect(page.locator("script")).toHaveCount(0);
  await expect(page.locator(".icon-card img")).toBeVisible();

  await page.goto("/importer/privacy.html");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("not sent to the developer");
  await expect(page.getByText("The ChatGPT, Codex, Claude, Gemini, or other host", { exact: false })).toBeVisible();
  await expect(page.locator("script")).toHaveCount(0);

  await page.goto("/importer/terms.html");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("reviewed draft");
  await expect(page.getByRole("heading", { name: "Human review is mandatory" })).toBeVisible();
  await expect(page.locator("script")).toHaveCount(0);

  expect(offOriginRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
});

test("production CSP keeps score rendering self-contained", async ({ page }) => {
  const consoleErrors: string[] = [];
  const offOriginRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Content Security Policy")) {
      consoleErrors.push(message.text());
    }
  });
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("http://127.0.0.1:4173") && !url.startsWith("data:") && !url.startsWith("blob:")) {
      offOriginRequests.push(url);
    }
  });

  await page.goto("/");
  await expect(page.locator("#pg-preview svg")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check("10px Bravura"))).toBe(true);
  expect(await page.evaluate(() => document.fonts.check("10px Academico"))).toBe(true);

  const noteheads = page.locator("#pg-preview svg .vf-notehead");
  expect(await noteheads.count()).toBeGreaterThan(0);
  await expect.poll(async () => {
    const boxes = await noteheads.evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }));
    return boxes.some((box) => box.width > 0 && box.height > 0);
  }).toBe(true);

  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("style-src 'self'");
  expect(csp).toContain("style-src-attr 'none'");
  expect(csp).toContain("connect-src 'none'");
  expect(await page.locator('meta[name="drum-notation-core-version"]').getAttribute("content"))
    .toBe(currentNotationCore.version);
  expect(await page.locator('meta[name="drum-notation-core-digest"]').getAttribute("content"))
    .toBe(currentNotationCore.digest);

  const fetchBlocked = await page.evaluate(async () => {
    try {
      await fetch("https://example.invalid/drum-notation-csp-probe");
      return false;
    } catch {
      return true;
    }
  });
  expect(fetchBlocked).toBe(true);
  expect(offOriginRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(await page.evaluate(() => window.__cspViolations.filter((entry) => !entry.startsWith("connect-src:")))).toEqual([]);
});

test("Obsidian speed-button labels fit inside their interactive background", async ({ page }) => {
  await page.goto("/");

  const measurements = await page.evaluate(() => {
    const root = document.createElement("div");
    root.className = "drum-notation";
    const toolbar = document.createElement("div");
    toolbar.className = "drum-notation__toolbar";
    const controls = document.createElement("div");
    controls.className = "drum-notation__controls";
    const button = document.createElement("button");
    button.className = "drum-notation__button drum-notation__speed";
    controls.append(button);
    toolbar.append(controls);
    root.append(toolbar);
    document.body.append(root);

    const result = ["70%", "100%", "130%", "124 BPM", "260 BPM ▲"].map((label) => {
      button.textContent = label;
      return {
        label,
        clientWidth: button.clientWidth,
        scrollWidth: button.scrollWidth
      };
    });
    root.remove();
    return result;
  });

  for (const measurement of measurements) {
    expect(measurement.clientWidth, measurement.label).toBeGreaterThanOrEqual(measurement.scrollWidth);
  }
  expect(measurements[0].clientWidth).toBeLessThan(measurements[2].clientWidth);
  expect(measurements[2].clientWidth).toBeLessThan(measurements[4].clientWidth);
});

test("practice selection supports pointer, keyboard, responsive, and print workflows", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/");
  await page.locator("#pg-editor").fill([
    "Title: Practice phrase",
    "Tempo: 100",
    "Time: 4/4",
    "Grid: 16",
    "HH | x-x-x-x-x-x-x-x- | x-x-x-x-x-x-x-x-",
    "SD | ----o-------o--- | ----o-------o---",
    "BD | o-------o-o----- | o-----o-o-------"
  ].join("\n"));
  await expect(page.locator("#pg-title")).toHaveValue("Practice phrase");

  const loopOptions = page.getByRole("button", { name: "Loop options" });
  await loopOptions.click();
  const loopWholeMenuItem = page.getByRole("menuitemcheckbox", { name: "Loop whole notation" });
  await expect(loopWholeMenuItem).toBeFocused();
  await loopWholeMenuItem.press("End");
  const selectBarsMenuItem = page.getByRole("menuitemcheckbox", { name: "Select bars" });
  await expect(selectBarsMenuItem).toBeFocused();
  await selectBarsMenuItem.press("Enter");
  await expect(page.getByText("Select bars to practise · 0 selected")).toBeVisible();

  const barSelectors = page.locator("#pg-preview .pg-bar-selector");
  expect(await barSelectors.count()).toBeGreaterThanOrEqual(2);
  await barSelectors.nth(0).click();
  await barSelectors.nth(1).click();
  await expect(page.getByText("Select bars to practise · 2 selected")).toBeVisible();
  await expect(barSelectors.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(barSelectors.nth(1)).toHaveAttribute("aria-pressed", "true");

  const firstRenderedNote = page.locator("#pg-preview .drum-notation__interactive-note").first();
  await expect(firstRenderedNote).toHaveAttribute("aria-label", /Remove bar 1 from practice selection/);
  await firstRenderedNote.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Select bars to practise · 1 selected")).toBeVisible();
  await expect(barSelectors.nth(0)).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: "Done selecting practice bars" }).click();
  await expect(page.getByText("Practice selection · 1 bar")).toBeVisible();
  await page.locator("#pg-title").fill("Practice selection survives rerender");
  await expect(page.getByText("Practice selection · 1 bar")).toBeVisible();
  await expect(page.locator("#pg-preview .pg-bar-selector.is-practice-selected")).toHaveCount(1);

  await loopOptions.click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Loop selected bars (1)" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 520, height: 780 });
  const practiceStatus = page.locator("#pg-preview .drum-notation__tip--practice");
  await expect(practiceStatus).toBeVisible();
  await expect(practiceStatus.locator(".drum-notation__practice-action > span").first()).toBeHidden();

  await page.emulateMedia({ media: "print" });
  await expect(practiceStatus).toBeHidden();
  await expect(page.locator("#pg-preview .pg-bar-selectors")).toBeHidden();
});

test("two-bar count-in and page-session wake lock controls are available", async ({ page }) => {
  await page.addInitScript(() => {
    window.__wakeLockRequests = 0;
    window.__wakeLockReleases = 0;

    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async () => {
          window.__wakeLockRequests = (window.__wakeLockRequests ?? 0) + 1;
          const releaseListeners = new Set<() => void>();
          const sentinel = {
            released: false,
            addEventListener: (_type: "release", listener: () => void) => {
              releaseListeners.add(listener);
            },
            removeEventListener: (_type: "release", listener: () => void) => {
              releaseListeners.delete(listener);
            },
            release: async () => {
              if (sentinel.released) return;
              sentinel.released = true;
              window.__wakeLockReleases = (window.__wakeLockReleases ?? 0) + 1;
              releaseListeners.forEach((listener) => listener());
            }
          };
          return sentinel;
        }
      }
    });
  });

  await page.goto("/");
  const metronomeButton = page.locator("#pg-metronome");
  await metronomeButton.click();
  const twoBarCountIn = page.getByRole("menuitemradio", { name: "Count-in: 2 bars" });
  await expect(twoBarCountIn).toBeVisible();
  await twoBarCountIn.click();
  await expect(metronomeButton).toHaveAttribute("aria-label", /Count-in: 2 bars/);

  await page.locator("#pg-loop-all").click();
  await page.getByRole("menuitemcheckbox", { name: "Loop whole notation" }).click();
  await expect.poll(() => page.evaluate(() => window.__wakeLockRequests ?? 0)).toBe(1);

  await metronomeButton.click();
  const keepAwake = page.getByRole("menuitemcheckbox", { name: "Keep screen awake", exact: true });
  await expect(keepAwake).toHaveAttribute("aria-checked", "true");
  await keepAwake.click();
  await expect.poll(() => page.evaluate(() => window.__wakeLockReleases ?? 0)).toBe(1);

  await metronomeButton.click();
  await page.getByRole("menuitemcheckbox", { name: "Keep screen awake", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__wakeLockRequests ?? 0)).toBe(2);

  await page.locator("#pg-stop").click();
  await expect.poll(() => page.evaluate(() => window.__wakeLockReleases ?? 0)).toBe(2);
});

test("advanced click menu, badge, and gap cues remain compact and accessible", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: undefined
    });
  });
  await page.setViewportSize({ width: 520, height: 780 });
  await page.goto("/");
  await page.locator("#pg-editor").fill([
    "Title: Advanced click",
    "Tempo: 100",
    "Time: 4/4",
    "Grid: 16",
    "HH | x-x-x-x-x-x-x-x- | x-x-x-x-x-x-x-x-",
    "SD | ----o-------o--- | ----o-------o---",
    "BD | o-------o-o----- | o-----o-o-------"
  ].join("\n"));
  await expect(page.locator("#pg-title")).toHaveValue("Advanced click");
  const metronomeButton = page.locator("#pg-metronome");
  const initialWidth = await metronomeButton.evaluate((button) => button.getBoundingClientRect().width);

  await metronomeButton.click();
  await page.getByRole("menuitemradio", { name: "With drums" }).click();
  await metronomeButton.click();
  await page.getByRole("menuitemradio", { name: "3 per beat · eighth-note triplets" }).click();
  await metronomeButton.click();
  await page.getByRole("menuitemradio", { name: "1 on / 1 off" }).click();

  await expect(metronomeButton.locator(".drum-notation__click-badge")).toHaveText("3G");
  await expect(metronomeButton).toHaveAttribute("aria-label", /Subdivision: 3 per beat/);
  await expect(metronomeButton).toHaveAttribute("aria-label", /Gap click: 1 on \/ 1 off/);
  expect(await metronomeButton.evaluate((button) => button.getBoundingClientRect().width)).toBe(initialWidth);

  await page.locator("#pg-play").click();
  await expect(page.locator("#pg-preview .drum-notation__gap-overlay.is-gap-next")).toBeVisible();
  await expect(page.locator("#pg-preview .drum-notation__gap-overlays")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#pg-preview .drum-notation__practice-label")).toContainText("Advanced click · 3 per beat · Gap next");
  await page.locator("#pg-stop").click();
  await expect(page.locator("#pg-preview .drum-notation__gap-overlays")).toHaveCount(0);
});

test("tempo ramp setup runs exact BPM stages and preserves completed progress", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined });
  });
  await page.goto("/");
  await page.locator("#pg-editor").fill([
    "Title: Tempo ladder",
    "Tempo: 100",
    "Time: 4/4",
    "Grid: 16",
    "HH | x-x-x-x-x-x-x-x-",
    "SD | ----o-------o---",
    "BD | o-------o-o-----"
  ].join("\n"));
  await expect(page.locator("#pg-title")).toHaveValue("Tempo ladder");

  const speed = page.locator("#pg-speed");
  await speed.click();
  await expect(page.getByRole("menuitemradio", { name: "100% · 100 BPM" })).toBeChecked();
  await expect(page.getByRole("menuitemradio", { name: "50% · 50 BPM" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Tempo ramp…" }).click();

  const dialog = page.getByRole("dialog", { name: "Tempo ramp trainer" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("spinbutton", { name: "Start BPM" }).fill("250");
  await dialog.getByRole("spinbutton", { name: "Increase by BPM" }).fill("10");
  await dialog.getByRole("spinbutton", { name: "Every N passes" }).fill("1");
  await dialog.getByRole("spinbutton", { name: "Ceiling BPM" }).fill("260");
  await dialog.getByRole("combobox", { name: "At ceiling" }).selectOption("stop");
  await expect(dialog).toContainText("250 → 260 BPM · 1 pass each");
  await dialog.getByRole("button", { name: "Start ramp" }).click();

  await expect(speed).toHaveText(/250 BPM/);
  await expect(speed).toHaveAttribute("aria-label", /Tempo ramp/);
  await expect(page.locator("#pg-preview .drum-notation__practice-label")).toContainText("Tempo ramp");
  await expect.poll(async () => speed.textContent(), { timeout: 5_000 }).toContain("260 BPM");
  await expect.poll(async () => page.locator("#pg-preview .drum-notation__practice-label").textContent(), {
    timeout: 5_000
  }).toContain("Ramp complete · 260 BPM");

  await speed.click();
  await expect(page.getByRole("menuitem", { name: "Run tempo ramp again" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Reset ramp" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Turn off trainer" })).toBeVisible();

  await page.getByRole("menuitem", { name: "Tempo ramp…" }).click();
  await dialog.getByRole("button", { name: "Start ramp" }).click();
  const replaceRamp = page.getByRole("dialog", { name: "Confirm action" });
  await expect(replaceRamp).toBeVisible();
  await replaceRamp.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await speed.click();
  await page.getByRole("menuitem", { name: "Tempo ramp…" }).click();
  await dialog.getByRole("button", { name: "Start ramp" }).click();
  await page.getByRole("dialog", { name: "Confirm action" }).getByRole("button", { name: "Confirm" }).click();
  await expect(dialog).toBeHidden();
});

test("tap tempo and finite practice goals produce a page-session summary", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined });
  });
  await page.goto("/");
  await page.locator("#pg-editor").fill([
    "Title: Session drill",
    "Tempo: 260",
    "Time: 1/4",
    "Grid: 16",
    "HH | x---"
  ].join("\n"));
  await expect(page.locator("#pg-title")).toHaveValue("Session drill");

  await page.locator("#pg-metronome").click();
  await page.getByRole("menuitemradio", { name: "Before every pass" }).click();
  await expect(page.locator("#pg-metronome")).toHaveAttribute("aria-label", /Count-in timing: Before every pass/);

  await page.locator("#pg-speed").click();
  await page.getByRole("menuitem", { name: "Tap tempo…" }).click();
  const tapDialog = page.getByRole("dialog", { name: "Tap tempo" });
  const tapButton = tapDialog.getByRole("button", { name: "Tap" });
  await tapButton.click();
  await page.waitForTimeout(500);
  await tapButton.click();
  const measuredTempo = tapDialog.locator(".pg-confirm__message");
  await expect(measuredTempo).toHaveText(/^\d+ BPM$/);
  const measuredBpm = Number((await measuredTempo.textContent())?.replace(" BPM", ""));
  expect(measuredBpm).toBeGreaterThanOrEqual(30);
  expect(measuredBpm).toBeLessThanOrEqual(260);
  await tapDialog.getByRole("button", { name: "Use BPM" }).click();
  await expect(page.locator("#pg-speed")).toHaveText(`${measuredBpm} BPM`);

  await page.getByRole("button", { name: "Loop options" }).click();
  await page.getByRole("menuitem", { name: "Practice repetitions…" }).click();
  const goalDialog = page.getByRole("dialog", { name: "Practice repetitions" });
  await goalDialog.getByRole("spinbutton", { name: "Passes" }).fill("1");
  await goalDialog.getByRole("button", { name: "Start goal" }).click();

  await expect.poll(async () => page.locator("#pg-preview .drum-notation__practice-label").textContent(), {
    timeout: 5_000
  }).toContain("Practice complete · 1/1");
  await page.getByRole("button", { name: "View practice summary" }).click();
  const summary = page.getByRole("dialog", { name: "Practice summary" });
  await expect(summary).toContainText("Passes: 1/1");
  await expect(summary).toContainText(`Tempo: ${measuredBpm} BPM`);
  await expect(summary).toContainText("Active session time:");
  await expect(summary.getByRole("button", { name: "Copy Markdown" })).toBeEnabled();
  await summary.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Loop options" }).click();
  await page.getByRole("menuitem", { name: "Practice repetitions…" }).click();
  await goalDialog.getByRole("button", { name: "Start goal" }).click();
  const replaceGoal = page.getByRole("dialog", { name: "Confirm action" });
  await expect(replaceGoal).toBeVisible();
  await replaceGoal.getByRole("button", { name: "Cancel" }).click();
  await expect(goalDialog).toBeHidden();
  await page.getByRole("button", { name: "Loop options" }).click();
  await page.getByRole("menuitem", { name: "Practice repetitions…" }).click();
  await goalDialog.getByRole("spinbutton", { name: "Passes" }).fill("32");
  await goalDialog.getByRole("button", { name: "Start goal" }).click();
  await page.getByRole("dialog", { name: "Confirm action" }).getByRole("button", { name: "Confirm" }).click();
  await expect(goalDialog).toBeHidden();

  await expect.poll(async () => page.locator("#pg-preview .drum-notation__practice-label").textContent(), {
    timeout: 5_000
  }).toMatch(/Practice goal .* [1-9]\d*\/32/);
  await page.locator("#pg-stop").click();
  await expect(page.locator("#pg-preview .drum-notation__practice-label")).toContainText("Practice paused");
  const finishAndSummary = page.getByRole("button", { name: "Finish session and view summary" });
  await expect(finishAndSummary).toBeVisible();
  const actionButtonBounds = await finishAndSummary.boundingBox();
  const actionIconBounds = await finishAndSummary.locator("svg").boundingBox();
  const actionLabelBounds = await finishAndSummary.locator("span").boundingBox();
  expect(actionButtonBounds).not.toBeNull();
  expect(actionIconBounds).not.toBeNull();
  expect(actionLabelBounds).not.toBeNull();
  expect(actionIconBounds!.x + actionIconBounds!.width).toBeLessThan(actionLabelBounds!.x);
  const actionCenter = actionButtonBounds!.x + actionButtonBounds!.width / 2;
  const contentCenter = (actionIconBounds!.x + actionLabelBounds!.x + actionLabelBounds!.width) / 2;
  expect(Math.abs(actionCenter - contentCenter)).toBeLessThan(1);
  expect(actionButtonBounds!.width).toBeLessThan(140);
  await page.setViewportSize({ width: 500, height: 800 });
  await expect(finishAndSummary.locator("span")).toBeHidden();
  await expect(finishAndSummary.locator("svg path")).toBeVisible();
  await page.setViewportSize({ width: 1200, height: 800 });
  await finishAndSummary.click();
  const earlySummary = page.getByRole("dialog", { name: "Practice summary" });
  await expect(earlySummary).toContainText(/Passes: [1-9]\d*\/32/);
  await expect(earlySummary).toContainText("Result: Finished early");
});

test("wake lock control is disabled when the API is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: undefined
    });
  });

  await page.goto("/");
  await page.locator("#pg-metronome").click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Keep screen awake (unavailable)" })).toBeDisabled();
});

test("verification comparison workspace can be resized and maximized", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Verify agent result" }).click();

  const panel = page.locator("#pg-verify-panel");
  const divider = page.locator("#pg-verify-divider");
  const separator = page.getByRole("separator", { name: "Resize verification controls and comparison workspace" });
  const main = page.locator("#pg-main");
  const topbar = page.locator(".pg-topbar");
  await expect(divider).toBeVisible();

  const initialPanel = await panel.boundingBox();
  const initialMain = await main.boundingBox();
  const separatorBounds = await separator.boundingBox();
  expect(initialPanel).not.toBeNull();
  expect(initialMain).not.toBeNull();
  expect(separatorBounds).not.toBeNull();
  await page.mouse.move(separatorBounds!.x + separatorBounds!.width / 2, separatorBounds!.y + separatorBounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(separatorBounds!.x + separatorBounds!.width / 2, separatorBounds!.y - 100);
  await page.mouse.up();

  const resizedPanel = await panel.boundingBox();
  const resizedMain = await main.boundingBox();
  expect(resizedPanel!.height).toBeLessThan(initialPanel!.height - 70);
  expect(resizedMain!.y).toBeLessThan(initialMain!.y - 70);

  await separator.focus();
  await page.keyboard.press("End");
  const requestedHeight = (await panel.boundingBox())!.height;
  expect(requestedHeight).toBeGreaterThan(300);

  await page.setViewportSize({ width: 1200, height: 400 });
  await expect(separator).toHaveAttribute("aria-valuemax", "168");
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeLessThanOrEqual(169);
  const constrainedValues = await separator.evaluate((element) => ({
    now: Number(element.getAttribute("aria-valuenow")),
    max: Number(element.getAttribute("aria-valuemax"))
  }));
  expect(constrainedValues.now).toBeLessThanOrEqual(constrainedValues.max);

  await page.setViewportSize({ width: 1200, height: 900 });
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeCloseTo(requestedHeight, 0);

  await page.setViewportSize({ width: 1200, height: 500 });
  await separator.focus();
  await page.keyboard.press("ArrowUp");
  const constrainedRequestedHeight = (await panel.boundingBox())!.height;
  expect(constrainedRequestedHeight).toBeLessThan(210);
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeCloseTo(constrainedRequestedHeight, 0);

  await separator.focus();
  await page.keyboard.press("Home");
  expect((await panel.boundingBox())!.height).toBeLessThanOrEqual(1);
  const collapsedMain = await main.boundingBox();
  const topbarBounds = await topbar.boundingBox();
  const dividerBounds = await divider.boundingBox();
  expect(Math.abs(collapsedMain!.y - (topbarBounds!.y + topbarBounds!.height + dividerBounds!.height))).toBeLessThanOrEqual(2);

  const fullScreenButton = page.getByRole("button", { name: "Full screen" });
  await fullScreenButton.focus();
  await page.keyboard.press("Enter");
  await expect(topbar).toBeHidden();
  const restoreButton = page.getByRole("button", { name: "Restore" });
  await expect(restoreButton).toBeVisible();
  await expect(restoreButton).toBeFocused();
  expect((await main.boundingBox())!.y).toBeLessThan(collapsedMain!.y);

  await page.keyboard.press("Escape");
  await expect(topbar).toBeVisible();
  await expect(page.getByRole("button", { name: "Full screen" })).toBeVisible();
  await separator.dblclick();
  expect((await panel.boundingBox())!.height).toBeGreaterThan(100);
  await expect.poll(() => page.evaluate(() => document.body.style.getPropertyValue("--pg-verify-panel-height"))).toBe("auto");
  await page.setViewportSize({ width: 1200, height: 600 });
  await expect.poll(() => page.evaluate(() => document.body.style.getPropertyValue("--pg-verify-panel-height"))).toBe("auto");

  await page.getByRole("button", { name: "Playground", exact: true }).click();
  await expect(divider).toBeHidden();
});

test("verification mode keeps source and report ephemeral", async ({ page }) => {
  const revokedObjectUrls: string[] = [];
  await page.exposeFunction("__recordObjectUrlRevoke", (url: string) => {
    revokedObjectUrls.push(url);
  });
  await page.addInitScript(() => {
    const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url: string) => {
      const count = Number(sessionStorage.getItem("test.revoked-object-urls") ?? "0");
      sessionStorage.setItem("test.revoked-object-urls", String(count + 1));
      void window.__recordObjectUrlRevoke?.(url);
      revokeObjectUrl(url);
    };
  });
  await page.goto("/");
  await expect(page.locator("#pg-source-pane")).toBeHidden();
  await page.evaluate(() => localStorage.setItem("drum-playground.notation", "Title: Existing draft\nHH | x---------------"));
  await page.reload();
  const originalDraft = await page.evaluate(() => localStorage.getItem("drum-playground.notation"));
  await page.getByRole("button", { name: "Verify agent result" }).click();
  await expect(page.locator("#pg-source-pane")).toBeVisible();
  const fileButtonStyle = await page.locator("#pg-source-file").evaluate((element) => {
    const style = getComputedStyle(element, "::file-selector-button");
    return { borderRadius: style.borderRadius, cursor: style.cursor };
  });
  expect(fileButtonStyle).toEqual({ borderRadius: "5px", cursor: "pointer" });

  const response = "```drums\nTitle: Imported groove\nHH | x-x-x-x-x-x-x-x-\nSD | ----o-------o---\nBD | o-------o-o-----\n```";
  await page.locator("#pg-agent-response").fill(response);
  await page.getByRole("button", { name: "Extract and verify" }).click();
  await expect(page.locator("#pg-signal-parser")).toContainText("Valid");
  await expect(page.locator("#pg-signal-report")).toContainText("Not supplied");
  await expect(page.getByRole("button", { name: "Save selected to playground" })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem("drum-playground.notation"))).toBe(originalDraft);

  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  await page.locator("#pg-source-file").setInputFiles({ name: "score.png", mimeType: "image/png", buffer: onePixelPng });
  await expect(page.locator("#pg-source-image")).toBeVisible();
  await page.locator("#pg-source-file").setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: onePixelPng });
  await expect.poll(() => revokedObjectUrls.length).toBe(1);

  await page.getByRole("button", { name: "Save selected to playground" }).click();
  const saved = await page.evaluate(() => localStorage.getItem("drum-playground.notation") ?? "");
  expect(saved).toContain("HH |");
  expect(saved).not.toContain("drum-import-report");
  expect(saved).not.toContain("iVBOR");

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => revokedObjectUrls.length).toBe(2);
  await expect(page.locator("#pg-source-image")).toBeHidden();
  await expect(page.locator("#pg-agent-response")).toHaveValue("");

  await page.locator("#pg-source-file").setInputFiles({ name: "exit.png", mimeType: "image/png", buffer: onePixelPng });
  await expect(page.locator("#pg-source-image")).toBeVisible();
  await page.goto("/?after-pagehide");
  expect(await page.evaluate(() => sessionStorage.getItem("test.revoked-object-urls"))).toBe("3");
});

test("verification mode requires confirmation before accepting unfenced notation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Verify agent result" }).click();
  const source = "Here is the notation:\nHH | x-x-x-x-x-x-x-x-";
  const response = page.locator("#pg-agent-response");
  const accept = page.getByRole("button", { name: "Treat pasted text as one drums block" });

  await response.fill(source);
  await page.getByRole("button", { name: "Extract and verify" }).click();
  await expect(page.locator("#pg-verify-message")).toContainText("including any surrounding text");
  await expect(accept).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);

  await response.evaluate((input: HTMLTextAreaElement) => {
    input.value = `${input.value}\nComment: changed without an input event`;
  });
  await accept.click();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.locator("#pg-verify-message")).toContainText("changed or no longer validates");

  await response.fill(source);
  await page.getByRole("button", { name: "Extract and verify" }).click();
  await response.fill(`${source}\nComment: changed`);
  await expect(accept).toBeHidden();
  await expect(page.locator("#pg-verify-message")).toContainText("Select Extract and verify");

  await response.fill(source);
  await page.getByRole("button", { name: "Extract and verify" }).click();
  await accept.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Segment 1" })).toBeVisible();
  await expect(page.locator("#pg-editor")).toHaveValue(source);
  await expect(page.locator("#pg-signal-parser")).toContainText("Valid · clean");
  await expect(page.locator("#pg-signal-report")).toHaveText("Not supplied");
  await expect(page.locator("#pg-verify-message")).toContainText("complete pasted text as one drums block");

  await page.getByRole("button", { name: "Clear" }).click();
  await response.fill("```\nHH | x---------------\n```");
  await page.getByRole("button", { name: "Extract and verify" }).click();
  await expect(accept).toBeHidden();
  await expect(page.locator("#pg-verify-message")).toContainText("No fenced drums blocks found");
});

test("split voicing preserves dotted lower-voice sixteenth positions", async ({ page }) => {
  await page.setViewportSize({ width: 1910, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Verify agent result" }).click();
  const source = `Title: Exercise #1
Tempo: 100
Time: 4/4
Grid: 16
Legend: used
Voicing: split
HH | -x-----x-x-----x
RB | --x--x--x--x--x-
SN | ----o-------o---
KD | o--o--o---o--o--`;
  const response = `\`\`\`drums\n${source}\n\`\`\``;
  const noteX = async (slotIndex: number, instrument: string): Promise<number> => {
    const value = await page.locator(
      `g[data-slot-index="${slotIndex}"][data-drum-instrument-labels="${instrument}"] .vf-notehead text`
    ).first().getAttribute("x");
    return Number(value);
  };
  const expectWrittenOrdering = async (): Promise<void> => {
    expect(await noteX(3, "Kick")).toBeGreaterThan(await noteX(2, "Ride bell"));
    expect(await noteX(13, "Kick")).toBeGreaterThan(await noteX(12, "Snare"));
  };

  await page.locator("#pg-agent-response").fill(response);
  await page.getByRole("button", { name: "Extract and verify" }).click();
  await expectWrittenOrdering();

  await page.locator("#pg-editor").fill(source.replace("Voicing: split", "Voicing: single"));
  await page.waitForTimeout(300);
  await expectWrittenOrdering();
  await page.locator("#pg-editor").fill(source);
  await page.waitForTimeout(300);
  await expectWrittenOrdering();
});

test("verification mode hands off the prompt before an ephemeral focused crop", async ({ page }) => {
  await page.addInitScript(() => {
    const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url: string) => {
      const count = Number(sessionStorage.getItem("test.crop-revocations") ?? "0");
      sessionStorage.setItem("test.crop-revocations", String(count + 1));
      revokeObjectUrl(url);
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async () => {
          if (sessionStorage.getItem("test.crop-clipboard-mode") === "reject") {
            throw new Error("blocked for fallback test");
          }
          sessionStorage.setItem("test.crop-copied", "true");
        },
        writeText: async () => {
          sessionStorage.setItem("test.prompt-copied", "true");
        }
      }
    });
    if (typeof ClipboardItem === "undefined") {
      Object.defineProperty(window, "ClipboardItem", {
        configurable: true,
        value: class ClipboardItem {
          constructor(_items: Record<string, Blob>) {}
        }
      });
    }
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Create focused crop" })).toBeHidden();
  await page.getByRole("button", { name: "Verify agent result" }).click();

  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  await page.locator("#pg-source-file").setInputFiles({ name: "score.png", mimeType: "image/png", buffer: onePixelPng });
  await page.getByRole("button", { name: "Create focused crop" }).click();

  const dialog = page.getByRole("dialog", { name: "Create a focused crop" });
  await expect(dialog).toBeVisible();
  const stage = page.locator("#pg-crop-stage");
  const bounds = await stage.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width * 0.25, bounds!.y + bounds!.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.75, bounds!.y + bounds!.height * 0.75);
  await page.mouse.up();

  await expect(page.getByRole("button", { name: "Generate crop" })).toBeEnabled();
  await page.getByRole("button", { name: "Generate crop" }).click();
  await expect(page.locator("#pg-crop-preview")).toBeVisible();
  await expect(page.locator("#pg-crop-preview")).toHaveAttribute("src", /^blob:/);
  await expect(page.locator("#pg-crop-status")).toContainText("Nothing was uploaded or saved");
  await expect(page.locator("#pg-crop-retry-prompt")).toContainText("positioned immediately above a ledger line");
  await expect(page.locator(".pg-crop-handoff")).toContainText("Copy and paste the retry prompt");
  await expect(page.locator(".pg-crop-handoff")).toContainText("clipboard holds one item at a time");
  await expect(page.locator(".pg-crop-actions button")).toHaveText([
    "1. Copy retry prompt",
    "2. Copy crop",
    "Download crop"
  ]);

  await page.getByRole("button", { name: "1. Copy retry prompt" }).click();
  await expect(page.locator("#pg-crop-status")).toContainText("Paste it first");
  expect(await page.evaluate(() => sessionStorage.getItem("test.prompt-copied"))).toBe("true");

  await page.getByRole("button", { name: "2. Copy crop" }).click();
  await expect(page.locator("#pg-crop-status")).toContainText("Paste it now");
  expect(await page.evaluate(() => sessionStorage.getItem("test.crop-copied"))).toBe("true");

  await page.evaluate(() => sessionStorage.setItem("test.crop-clipboard-mode", "reject"));
  await page.getByRole("button", { name: "2. Copy crop" }).click();
  await expect(page.locator("#pg-crop-status")).toContainText("Use Download crop instead");
  await expect(page.getByRole("button", { name: "Download crop" })).toBeFocused();

  await page.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem("test.crop-revocations") ?? "0"))).toBe(1);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("blob:");

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem("test.crop-revocations") ?? "0"))).toBe(2);
});

test("focused crop keeps a one-pixel ledger line crisp at four-times enlargement", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Verify agent result" }).click();

  const sourceBase64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 3;
    canvas.height = 3;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas unavailable");
    }
    context.fillStyle = "#fff";
    context.fillRect(0, 0, 3, 3);
    context.fillStyle = "#000";
    context.fillRect(0, 1, 3, 1);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#pg-source-file").setInputFiles({
    name: "ledger.png",
    mimeType: "image/png",
    buffer: Buffer.from(sourceBase64, "base64")
  });
  await page.getByRole("button", { name: "Create focused crop" }).click();

  const stage = page.locator("#pg-crop-stage");
  const selection = await stage.evaluate((element) => {
    const image = element.querySelector("img") as HTMLImageElement;
    const bounds = element.getBoundingClientRect();
    const scale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    return {
      left: bounds.left + (bounds.width - width) / 2,
      top: bounds.top + (bounds.height - height) / 2,
      right: bounds.left + (bounds.width + width) / 2,
      bottom: bounds.top + (bounds.height + height) / 2
    };
  });
  await page.mouse.move(selection.left + 1, selection.top + 1);
  await page.mouse.down();
  await page.mouse.move(selection.right - 1, selection.bottom - 1);
  await page.mouse.up();
  await page.getByRole("button", { name: "Generate crop" }).click();
  const cropPreview = page.locator("#pg-crop-preview");
  await expect(cropPreview).toBeVisible();
  await expect.poll(() => cropPreview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(12);

  const pixels = await cropPreview.evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas unavailable");
    }
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const rowKinds: string[] = [];
    const colors = new Set<string>();
    for (let y = 0; y < canvas.height; y++) {
      let black = 0;
      for (let x = 0; x < canvas.width; x++) {
        const index = (y * canvas.width + x) * 4;
        colors.add(`${data[index]},${data[index + 1]},${data[index + 2]},${data[index + 3]}`);
        if (data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 0 && data[index + 3] === 255) {
          black += 1;
        }
      }
      rowKinds.push(black === canvas.width ? "black" : black === 0 ? "white" : "mixed");
    }
    return { width: canvas.width, height: canvas.height, colors: [...colors].sort(), rowKinds };
  });

  expect(pixels.width).toBe(12);
  expect(pixels.height).toBe(12);
  expect(pixels.colors).toEqual(["0,0,0,255", "255,255,255,255"]);
  expect(pixels.rowKinds).toEqual([
    "white", "white", "white", "white",
    "black", "black", "black", "black",
    "white", "white", "white", "white"
  ]);
});

test("visual verification can move a hit to a compatible unoccupied instrument", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Verify agent result" }).click();
  const response = [
    "```drums",
    "HH | x---",
    "```",
    "```drum-import-report",
    JSON.stringify(cleanImportReport(1)),
    "```"
  ].join("\n");
  await page.locator("#pg-agent-response").fill(response);
  await page.getByRole("button", { name: "Extract and verify" }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Hi-hat, beat 1, normal" }).click();

  const move = page.getByRole("combobox", { name: "Move to instrument" });
  await expect(move.locator("option[value=crash]")).toBeEnabled();
  await move.selectOption("crash");

  await expect(page.locator("#pg-editor")).toHaveValue(/CR \| x---/);
  expect(await page.locator("#pg-editor").inputValue()).not.toContain("HH | x---");
  await expect(page.locator("#pg-signal-parser")).toContainText("Valid · clean");
  await expect(page.locator("#pg-human-review")).toHaveValue("needs-changes");
  await expect(page.locator("#pg-report-origin")).toHaveText("Original agent report · may not match current edits");
  await expect(page.locator("#pg-signal-agent")).toContainText("original result; current notation edited");

  await page.locator("#pg-edit-root").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("#pg-editor")).toHaveValue(/HH \| x---/);
  await expect(page.locator("#pg-report-details")).toBeHidden();
  await expect(page.locator("#pg-signal-agent")).toContainText("clean · agrees");
  await expect(page.locator("#pg-human-review")).toHaveValue("needs-changes");
});

test("verification report freshness follows normalized edits per segment", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Verify agent result" }).click();
  const response = [
    "```drums",
    "Time: 3/4",
    "HH | x-----------",
    "SD | ----o-------",
    "```",
    "```drums",
    "BD | o---",
    "```",
    "```drum-import-report",
    JSON.stringify(cleanImportReport(2)),
    "```"
  ].join("\n");
  await page.locator("#pg-agent-response").fill(response);
  await page.getByRole("button", { name: "Extract and verify" }).click();
  await expect(page.locator("#pg-signal-agent")).toHaveText("clean · agrees");

  await page.locator("#pg-editor").fill("Time: 3/4\nHH | x----------\nSD | ----o-------");
  await expect(page.locator("#pg-signal-parser")).toContainText("warning");
  await expect(page.locator("#pg-report-details")).toContainText("Local parser warnings");
  await expect(page.locator("#pg-report-origin")).toHaveText("Original agent report · may not match current edits");
  await expect(page.locator("#pg-human-review")).toHaveValue("needs-changes");

  await page.getByRole("tab", { name: "Segment 2" }).click();
  await expect(page.locator("#pg-editor")).toHaveValue("BD | o---");
  await expect(page.locator("#pg-report-details")).toBeHidden();
  await expect(page.locator("#pg-signal-agent")).toHaveText("clean · agrees");

  await page.getByRole("tab", { name: "Segment 1" }).click();
  await expect(page.locator("#pg-report-origin")).toHaveText("Original agent report · may not match current edits");
  await page.locator("#pg-editor").fill("Title: no supported rows");
  await expect(page.locator("#pg-signal-parser")).toContainText("Invalid");
  await expect(page.locator("#pg-report-origin")).toHaveText("Original agent report · may not match current edits");

  await page.locator("#pg-editor").fill("Title: Drum notation\nTempo: 100\nTime: 3/4\nGrid: 16\nHH | x-----------\nSD | ----o-------");
  await expect(page.locator("#pg-signal-parser")).toHaveText("Valid · clean");
  await expect(page.locator("#pg-report-details")).toBeHidden();
  await expect(page.locator("#pg-signal-agent")).toHaveText("clean · agrees");
  await expect(page.locator("#pg-human-review")).toHaveValue("needs-changes");

  await page.locator("#pg-human-review").selectOption("approved");
  await expect(page.locator("#pg-human-review")).toHaveValue("approved");
  await expect(page.locator("#pg-signal-agent")).toHaveText("clean · agrees");
});

test("verification mode renders report details without interpreting report text as markup", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Verify agent result" }).click();

  const unsafeMessage = '<img src="https://example.invalid/tracker.png"> remains text';
  const report = {
    schemaVersion: 1,
    importerVersion: validatorVersion.importerVersion,
    notationCoreVersion: validatorVersion.notationCoreVersion,
    notationCoreDigest: validatorVersion.notationCoreDigest,
    validatorBuildDigest: validatorVersion.validatorBuildDigest,
    source: { kind: "image" },
    validationStatus: "warnings",
    segments: [
      {
        id: "segment-1",
        title: "Detailed segment",
        blockIndex: 0,
        validationStatus: "warnings",
        issues: [{ code: "split-voice-explicit-rest", message: unsafeMessage }],
        ambiguities: [{ code: "cymbal-position", message: "Crash or ride requires confirmation." }],
        workarounds: [{ feature: "visible lower-voice rest", action: "Preserved its silent span.", loss: "appearance" }]
      },
      {
        id: "segment-2",
        title: "Missing details",
        blockIndex: 1,
        validationStatus: "warnings",
        issues: [],
        ambiguities: [],
        workarounds: []
      }
    ],
    humanReviewRequired: true
  };
  const response = [
    "```drums",
    "HH | x?--------------",
    "```",
    "```drums",
    "HH | x---------------",
    "```",
    "```drum-import-report",
    JSON.stringify(report),
    "```"
  ].join("\n");

  await page.locator("#pg-agent-response").fill(response);
  await page.getByRole("button", { name: "Extract and verify" }).click();

  const details = page.locator("#pg-report-details");
  await expect(details).toBeVisible();
  await expect(details).toContainText("Local parser warnings");
  await expect(details).toContainText("Agent observations");
  await expect(details).toContainText("Ambiguities");
  await expect(details).toContainText("Workarounds");
  await expect(details).toContainText(unsafeMessage);
  await expect(page.locator("#pg-report-details-count")).toHaveText("4 items");
  await expect(details.locator("img")).toHaveCount(0);

  await page.setViewportSize({ width: 2048, height: 280 });
  const reportCardSize = await details.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }));
  expect(reportCardSize.clientHeight).toBeGreaterThanOrEqual(reportCardSize.scrollHeight);

  await page.getByRole("tab", { name: "Missing details" }).click();
  await expect(details).toContainText("warning-details-missing");
  await expect(details).toContainText("supplied no issue, ambiguity, or workaround details");
  await expect(details).not.toContainText("Crash or ride requires confirmation");
  await expect(page.locator("#pg-report-details-count")).toHaveText("1 item");
});

test("verification mode rejects SVG and oversized image bytes before decode", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Verify agent result" }).click();
  await page.locator("#pg-source-file").setInputFiles({
    name: "score.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  });
  await expect(page.locator("#pg-verify-message")).toContainText("SVG");
  await expect(page.locator("#pg-source-image")).toBeHidden();

  const oversized = Buffer.alloc(15 * 1024 * 1024 + 1);
  oversized.set([0xff, 0xd8, 0xff]);
  await page.locator("#pg-source-file").setInputFiles({
    name: "oversized.jpg",
    mimeType: "image/jpeg",
    buffer: oversized
  });
  await expect(page.locator("#pg-verify-message")).toContainText("Image exceeds");
  await expect(page.locator("#pg-source-image")).toBeHidden();
});
