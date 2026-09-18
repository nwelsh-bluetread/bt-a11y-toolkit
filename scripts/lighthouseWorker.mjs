#!/usr/bin/env node
/**
 * One-page Lighthouse runner, executed as a child process.
 *
 * Lighthouse is **not safe to run concurrently inside one Node process**: it
 * records progress through module-global `performance` marks, so a second run
 * starting while a first is in flight clears marks the first still needs and
 * both fail with "The 'start lh:runner:gather' performance mark has not been
 * set". Isolating each run in its own process is what makes `--concurrency`
 * usable.
 *
 * Plain `.mjs` on purpose: the parent spawns it with bare `node`, so it must
 * not need a TypeScript loader.
 *
 * Usage (internal): node lighthouseWorker.mjs '<json args>' <out-file>
 *   json args: { "url": "...", "settings": { ...lighthouse emulation... } }
 */
import { writeFile } from "node:fs/promises";

async function loadEngines() {
  try {
    const [chromeLauncher, lighthouseMod] = await Promise.all([
      import("chrome-launcher"),
      import("lighthouse"),
    ]);
    const launch = chromeLauncher.launch ?? chromeLauncher.default?.launch;
    const lighthouse = lighthouseMod.default ?? lighthouseMod;
    if (typeof launch !== "function" || typeof lighthouse !== "function") {
      throw new Error("unexpected module shape");
    }
    return { launch, lighthouse };
  } catch {
    throw new Error("Live Lighthouse scans require: npm install -D lighthouse chrome-launcher");
  }
}

async function main() {
  const [rawArgs, outFile] = process.argv.slice(2);
  if (!rawArgs || !outFile) throw new Error("lighthouseWorker: expected <json args> <out-file>");
  const { url, settings } = JSON.parse(rawArgs);

  const { launch, lighthouse } = await loadEngines();
  const chrome = await launch({ chromeFlags: ["--headless=new"] });
  try {
    const result = await lighthouse(url, {
      port: chrome.port,
      onlyCategories: ["accessibility"],
      ...settings,
      output: "json",
      logLevel: "error",
    });
    if (!result?.lhr) throw new Error("Lighthouse returned no result.");
    await writeFile(outFile, JSON.stringify(result.lhr), "utf8");
  } finally {
    await chrome.kill();
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
