/**
 * Spawns {@link ./lighthouseWorker.mjs} to scan one page.
 *
 * Shared by `scan:lighthouse` and `scan:all` so both get process isolation —
 * see the worker's header for why running Lighthouse in-process breaks under
 * concurrency. The overhead is one Node startup per page, which is noise next
 * to the page load it wraps.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LighthouseResult } from "../src/integrations/lighthouse.js";
import { lighthouseEmulationSettings, type FormFactorConfig } from "../src/formFactor.js";

const WORKER = fileURLToPath(new URL("./lighthouseWorker.mjs", import.meta.url));

/** Run a live Lighthouse accessibility scan against a URL. */
export async function runLighthouse(
  url: string,
  ff: FormFactorConfig,
): Promise<LighthouseResult> {
  const dir = await mkdtemp(join(tmpdir(), "bt-a11y-lh-"));
  const outFile = join(dir, "lhr.json");
  const payload = JSON.stringify({ url, settings: lighthouseEmulationSettings(ff) });

  try {
    await runWorker([WORKER, payload, outFile]);
    return JSON.parse(await readFile(outFile, "utf8")) as LighthouseResult;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Run the worker, rejecting with whatever it wrote to stderr. */
function runWorker(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      const detail = stderr.trim().split("\n").filter(Boolean).slice(-2).join("; ");
      reject(new Error(detail || `lighthouse worker exited with code ${code}`));
    });
  });
}
