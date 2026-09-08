import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: "cached-navigation.spec.ts",
  testIgnore: [],
  reporter: [["line"], ["json", {outputFile: ".artifacts/navigation/report.json"}]],
  projects: [
    {name: "chromium-cache", use: {...devices["Desktop Chrome"], channel: "chromium", launchOptions: {ignoreDefaultArgs: ["--disable-back-forward-cache"]}}},
    {name: "webkit-navigation", use: {...devices["Desktop Safari"]}}
  ]
});
