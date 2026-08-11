import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const validatorVersionRun = spawnSync(process.execPath, [
  "agent-plugin/drum-notation-importer/scripts/validate-drum-notation.mjs",
  "--version"
], { encoding: "utf8" });
if (validatorVersionRun.status !== 0) {
  throw new Error(`Unable to read bundled validator provenance: ${validatorVersionRun.stderr}`);
}
const validatorVersion = JSON.parse(validatorVersionRun.stdout) as {
  notationCoreVersion: string;
  notationCoreDigest: string;
};

declare global {
  interface Window {
    __cspViolations: string[];
    __recordObjectUrlRevoke?: (url: string) => Promise<void>;
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
  const noteheads = page.locator("#pg-preview svg .vf-notehead");
  await expect(noteheads.first()).toBeVisible();
  expect(await noteheads.count()).toBeGreaterThan(0);
  const noteheadBox = await noteheads.first().boundingBox();
  expect(noteheadBox?.width ?? 0).toBeGreaterThan(0);
  expect(noteheadBox?.height ?? 0).toBeGreaterThan(0);

  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("style-src 'self'");
  expect(csp).toContain("style-src-attr 'none'");
  expect(csp).toContain("connect-src 'none'");
  expect(await page.locator('meta[name="drum-notation-core-version"]').getAttribute("content"))
    .toBe(validatorVersion.notationCoreVersion);
  expect(await page.locator('meta[name="drum-notation-core-digest"]').getAttribute("content"))
    .toBe(validatorVersion.notationCoreDigest);

  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check("10px Bravura"))).toBe(true);
  expect(await page.evaluate(() => document.fonts.check("10px Academico"))).toBe(true);

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
