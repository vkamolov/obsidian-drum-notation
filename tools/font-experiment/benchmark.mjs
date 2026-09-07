import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = path.join(projectRoot, "test-results/font-packaging");
const buildsRoot = path.join(outputRoot, "builds");
const resultPath = path.join(outputRoot, "benchmark.json");
const trialCount = Number.parseInt(process.env.DRUM_FONT_TRIALS ?? "30", 10);
const port = Number.parseInt(process.env.DRUM_FONT_PORT ?? "43991", 10);
const baseUrl = `http://127.0.0.1:${port}/obsidian-drum-notation/`;
const variants = ["inline", "external"];
const scenarios = ["cold", "repeat", "update-fresh-fonts", "update-expired-fonts"];
const fontFamilies = new Set(["Bravura", "Academico"]);

if (!Number.isInteger(trialCount) || trialCount < 1) {
  throw new Error("DRUM_FONT_TRIALS must be a positive integer.");
}

function runVite(args) {
  const vite = path.join(projectRoot, "node_modules/vite/bin/vite.js");
  const result = spawnSync(process.execPath, [vite, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`Vite failed with status ${result.status}.`);
  }
}

function buildOutput(variant) {
  return path.join(buildsRoot, `${variant}-a`);
}

function buildAll() {
  rmSync(buildsRoot, { recursive: true, force: true });
  mkdirSync(buildsRoot, { recursive: true });

  runVite(["build", "--outDir", "../test-results/font-packaging/builds/inline-a", "--emptyOutDir"]);
  runVite([
    "build",
    "--config",
    "tools/font-experiment/vite.config.mjs",
    "--outDir",
    "../test-results/font-packaging/builds/external-a",
    "--emptyOutDir"
  ]);

  for (const variant of variants) {
    const source = buildOutput(variant);
    const destination = path.join(buildsRoot, `${variant}-b`);
    cpSync(source, destination, { recursive: true });
    createJavaScriptRevision(destination);
  }
}

function createJavaScriptRevision(directory) {
  const indexPath = path.join(directory, "index.html");
  const html = readFileSync(indexPath, "utf8");
  const match = /src="\.\/assets\/([^"/]+\.js)"/.exec(html);

  if (!match) {
    throw new Error(`Could not locate the playground JavaScript in ${indexPath}.`);
  }

  const oldName = match[1];
  const oldPath = path.join(directory, "assets", oldName);
  const revised = Buffer.concat([
    readFileSync(oldPath),
    Buffer.from("\n/* font-packaging benchmark JavaScript revision B */\n")
  ]);
  const digest = createHash("sha256").update(revised).digest("hex").slice(0, 8);
  const newName = oldName.replace(/-[^-]+\.js$/, `-${digest}.js`);
  const newPath = path.join(directory, "assets", newName);
  writeFileSync(newPath, revised);
  rmSync(oldPath);
  writeFileSync(indexPath, html.replace(oldName, newName));
}

function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    const relative = path.posix.join(prefix, entry);
    if (statSync(absolute).isDirectory()) {
      files.push(...listFiles(absolute, relative));
    } else {
      files.push(relative);
    }
  }
  return files;
}

function readBuild(directory) {
  const resources = new Map();
  for (const relative of listFiles(directory)) {
    const body = readFileSync(path.join(directory, relative));
    resources.set(`/${relative}`, {
      body,
      gzip: shouldCompress(relative) ? gzipSync(body, { level: 9 }) : null,
      type: contentType(relative)
    });
  }
  return resources;
}

function shouldCompress(file) {
  return /\.(?:html|css|js|json|svg|txt)$/.test(file);
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (file.endsWith(".woff2")) return "font/woff2";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function createBenchmarkServer(builds) {
  let state = {
    variant: "inline",
    revision: "a",
    initialAge: 0,
    blockFonts: false
  };
  const requests = [];
  const prefix = "/obsidian-drum-notation";
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", baseUrl);
    if (!requestUrl.pathname.startsWith(prefix)) {
      response.writeHead(404).end();
      return;
    }
    let resourcePath = requestUrl.pathname.slice(prefix.length) || "/";
    if (resourcePath.endsWith("/")) resourcePath += "index.html";
    const build = builds.get(`${state.variant}-${state.revision}`);
    const resource = build?.get(resourcePath);
    const isFont = resourcePath.endsWith(".woff2");

    if (!resource || (state.blockFonts && isFont)) {
      requests.push({ path: resourcePath, status: state.blockFonts && isFont ? 503 : 404 });
      response.writeHead(state.blockFonts && isFont ? 503 : 404, {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8"
      }).end("Unavailable");
      return;
    }

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=600",
      "Content-Type": resource.type,
      ETag: `"${state.revision}-${resource.body.length.toString(16)}"`,
      Expires: new Date(Date.now() + 600_000).toUTCString(),
      "Last-Modified": state.revision === "a" ? "Fri, 28 Aug 2026 02:37:15 GMT" : "Mon, 07 Sep 2026 02:37:15 GMT",
      Vary: "Accept-Encoding"
    };
    if (state.initialAge > 0) headers.Age = String(state.initialAge);

    if (request.headers["if-none-match"] === headers.ETag) {
      requests.push({ path: resourcePath, status: 304 });
      response.writeHead(304, headers).end();
      return;
    }

    const acceptsGzip = request.headers["accept-encoding"]?.includes("gzip") && resource.gzip;
    const body = acceptsGzip ? resource.gzip : resource.body;
    if (acceptsGzip) headers["Content-Encoding"] = "gzip";
    headers["Content-Length"] = String(body.length);
    requests.push({ path: resourcePath, status: 200, bytes: body.length });
    response.writeHead(200, headers).end(body);
  });

  return {
    listen: () => new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    }),
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    setState(next) {
      state = { ...state, ...next };
    },
    takeRequests() {
      return requests.splice(0, requests.length);
    }
  };
}

async function configurePage(context) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    const observe = () => {
      const faces = [...document.fonts].filter((face) => face.family === "Bravura" || face.family === "Academico");
      if (document.querySelector("#pg-preview svg") && faces.length >= 3 && faces.every((face) => face.status === "loaded")) {
        requestAnimationFrame(() => performance.mark("notation-painted"));
      } else {
        requestAnimationFrame(observe);
      }
    };
    requestAnimationFrame(observe);
  });
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: 4_000_000 / 8,
    uploadThroughput: 4_000_000 / 8,
    connectionType: "cellular4g"
  });
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  return { page, session };
}

async function waitForPaintedNotation(page, requireFonts = true) {
  await page.waitForFunction(
    ({ requireFonts, expectedFaces }) => {
      const score = document.querySelector("#pg-preview svg");
      const faces = [...document.fonts].filter((face) => expectedFaces.includes(face.family));
      return Boolean(score) && (!requireFonts || (faces.length >= 3 && faces.every((face) => face.status === "loaded")));
    },
    { requireFonts, expectedFaces: [...fontFamilies] },
    { timeout: 30_000 }
  );
  return page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const resources = performance.getEntriesByType("resource")
      .filter((entry) => /\.(?:js|woff2)(?:$|\?)/.test(entry.name))
      .map((entry) => ({
        name: new URL(entry.name).pathname,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize
      }));
    const faces = [...document.fonts]
      .filter((face) => face.family === "Bravura" || face.family === "Academico")
      .map((face) => ({ family: face.family, status: face.status, weight: face.weight }));
    return {
      timeMs: performance.getEntriesByName("notation-painted")[0]?.startTime ?? performance.now(),
      resources,
      faces
    };
  });
}

async function navigateAndMeasure(page, server, revision = "a") {
  server.takeRequests();
  await page.goto(`${baseUrl}?release=${revision}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const result = await waitForPaintedNotation(page);
  return {
    ...result,
    transferBytes: result.resources.reduce((total, entry) => total + entry.transferSize, 0),
    encodedBodyBytes: result.resources.reduce((total, entry) => total + entry.encodedBodySize, 0),
    requests: server.takeRequests()
  };
}

async function warm(page, server) {
  server.takeRequests();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForPaintedNotation(page);
  server.takeRequests();
}

async function measureScenario(browser, server, variant, scenario) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const { page, session } = await configurePage(context);

  try {
    if (scenario === "cold") {
      server.setState({ variant, revision: "a", initialAge: 0, blockFonts: false });
      return await navigateAndMeasure(page, server);
    }

    if (scenario === "repeat") {
      server.setState({ variant, revision: "a", initialAge: 0, blockFonts: false });
      await warm(page, server);
      return await navigateAndMeasure(page, server);
    }

    const expired = scenario === "update-expired-fonts";
    server.setState({
      variant,
      revision: "a",
      initialAge: expired ? 600 : 0,
      blockFonts: false
    });
    await warm(page, server);
    server.setState({ variant, revision: "b", initialAge: 0, blockFonts: false });
    return await navigateAndMeasure(page, server, "b");
  } finally {
    await session.detach();
    await context.close();
  }
}

async function validateFailureRetry(browser, server) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    server.setState({ variant: "external", revision: "a", initialAge: 0, blockFonts: true });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    const failed = await waitForPaintedNotation(page, false);
    const failedFaces = failed.faces.filter((face) => face.status === "error").length;
    if (failedFaces < 3) {
      throw new Error(`Expected three failed font faces, found ${failedFaces}.`);
    }

    server.setState({ variant: "external", revision: "a", initialAge: 0, blockFonts: false });
    await page.reload({ waitUntil: "domcontentloaded" });
    const retried = await waitForPaintedNotation(page, true);
    if (retried.faces.length < 3 || retried.faces.some((face) => face.status !== "loaded")) {
      throw new Error("External fonts did not load after retrying the page.");
    }
    return { failedFaces, retryLoadedFaces: retried.faces.length };
  } finally {
    await context.close();
  }
}

function percentile(values, percentileValue) {
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileValue * ordered.length) - 1);
  return ordered[index];
}

function summarize(trials) {
  const summary = {};
  for (const scenario of scenarios) {
    summary[scenario] = {};
    for (const variant of variants) {
      const matches = trials.filter((trial) => trial.scenario === scenario && trial.variant === variant);
      summary[scenario][variant] = {
        medianMs: percentile(matches.map((trial) => trial.timeMs), 0.5),
        p95Ms: percentile(matches.map((trial) => trial.timeMs), 0.95),
        medianTransferBytes: percentile(matches.map((trial) => trial.transferBytes), 0.5),
        medianEncodedBodyBytes: percentile(matches.map((trial) => trial.encodedBodyBytes), 0.5)
      };
    }
  }
  return summary;
}

function assessGate(summary) {
  const comparisons = {};
  for (const scenario of scenarios) {
    const inline = summary[scenario].inline;
    const external = summary[scenario].external;
    comparisons[scenario] = {
      medianChangePercent: ((external.medianMs - inline.medianMs) / inline.medianMs) * 100,
      p95ChangePercent: ((external.p95Ms - inline.p95Ms) / inline.p95Ms) * 100,
      medianImprovementMs: inline.medianMs - external.medianMs
    };
  }
  const qualifyingImprovement = ["cold", "update-expired-fonts"].some((scenario) => {
    const comparison = comparisons[scenario];
    return comparison.medianChangePercent <= -10 && comparison.medianImprovementMs >= 50;
  });
  const boundedRegressions = Object.values(comparisons).every(
    (comparison) => comparison.medianChangePercent <= 5 && comparison.p95ChangePercent <= 5
  );
  return {
    accepted: trialCount >= 30 && qualifyingImprovement && boundedRegressions,
    sufficientTrials: trialCount >= 30,
    qualifyingImprovement,
    boundedRegressions,
    comparisons
  };
}

function validateBuilds(builds) {
  const inlineJs = [...builds.get("inline-a").entries()].find(([name]) => name.endsWith(".js"))?.[1].body.toString("utf8") ?? "";
  const externalJs = [...builds.get("external-a").entries()].find(([name]) => name.endsWith(".js"))?.[1].body.toString("utf8") ?? "";
  const externalFonts = [...builds.get("external-a").keys()].filter((name) => name.endsWith(".woff2"));
  const plugin = readFileSync(path.join(projectRoot, "main.js"), "utf8");
  const externalIndex = builds.get("external-a").get("/index.html")?.body.toString("utf8") ?? "";

  const checks = {
    inlineWebHasEmbeddedFonts: (inlineJs.match(/data:font\/woff2/g) ?? []).length >= 3,
    externalWebHasNoEmbeddedFonts: !externalJs.includes("data:font/woff2"),
    externalWebHasThreeFonts: externalFonts.length === 3,
    externalUsesContentHashedFonts: externalFonts.every((name) => /-[A-Za-z0-9_-]{8}\.woff2$/.test(name)),
    pluginKeepsEmbeddedFonts: (plugin.match(/data:font\/woff2/g) ?? []).length >= 3,
    cspAllowsOnlySelfHostedFonts: externalIndex.replaceAll("&#39;", "'").includes("font-src 'self' data:"),
    licenseBannerPresent: externalJs.startsWith("/*!"),
    revisionKeepsFontUrls: [...builds.get("external-b").keys()].filter((name) => name.endsWith(".woff2")).join("|") === externalFonts.join("|")
  };
  if (Object.values(checks).some((passed) => !passed)) {
    throw new Error(`Font packaging checks failed: ${JSON.stringify(checks)}`);
  }
  return { checks, externalFonts };
}

async function main() {
  buildAll();
  const builds = new Map();
  for (const variant of variants) {
    for (const revision of ["a", "b"]) {
      builds.set(`${variant}-${revision}`, readBuild(path.join(buildsRoot, `${variant}-${revision}`)));
    }
  }
  const buildValidation = validateBuilds(builds);
  const server = createBenchmarkServer(builds);
  await server.listen();
  const browser = await chromium.launch();

  try {
    const failureRetry = await validateFailureRetry(browser, server);
    const trials = [];
    for (const scenario of scenarios) {
      for (let trial = 0; trial < trialCount; trial += 1) {
        const order = trial % 2 === 0 ? variants : [...variants].reverse();
        for (const variant of order) {
          const measurement = await measureScenario(browser, server, variant, scenario);
          trials.push({ scenario, variant, trial: trial + 1, ...measurement });
        }
        process.stdout.write(`${scenario}: ${trial + 1}/${trialCount}\n`);
      }
    }

    const summary = summarize(trials);
    const gate = assessGate(summary);
    const result = {
      recordedAt: new Date().toISOString(),
      sourceRevision: spawnSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).stdout.trim(),
      environment: {
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        machine: os.cpus()[0]?.model ?? "unknown",
        logicalCpuCount: os.cpus().length,
        memoryBytes: os.totalmem(),
        node: process.version,
        chromium: browser.version(),
        cpuSlowdown: 4,
        bandwidthMbps: 4,
        latencyMs: 150,
        cacheControl: "public, max-age=600",
        validators: ["ETag", "Last-Modified"],
        deploymentModel: "Changed timestamp/size validators for all assets, including unchanged fonts",
        expirationModel: "Age: 600 on warm-up responses; real browser cache revalidation",
        compression: "gzip"
      },
      trialCountPerBuildAndScenario: trialCount,
      scenarios,
      buildValidation,
      failureRetry,
      summary,
      gate,
      trials
    };
    mkdirSync(outputRoot, { recursive: true });
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ resultPath, summary, gate }, null, 2)}\n`);
  } finally {
    await browser.close();
    await server.close();
  }
}

await main();
