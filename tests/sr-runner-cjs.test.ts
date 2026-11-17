import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The screen reader runner is copied into the audited repo and compiled by
// Playwright there. Repos with "type": "commonjs" get it compiled as CommonJS,
// where import.meta is a syntax error and Playwright reports "No tests found".
const ROOT = resolve(__dirname, "..");
const ENTRIES = ["screen-reader/workflows.sr.ts", "screen-reader/playwright.config.ts"];

/** Every local file the runner loads, following relative imports from the entry points. */
function runnerFiles(): string[] {
  const seen = new Set<string>();
  const queue = ENTRIES.map((e) => join(ROOT, e));
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const [, spec] of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const base = join(dirname(file), spec!);
      const hit = [base, base.replace(/\.js$/, ".ts"), `${base}.ts`].find((p) => p.endsWith(".ts") && existsSync(p));
      if (hit) queue.push(hit);
    }
  }
  return [...seen];
}

describe("screen reader runner works in CommonJS repos", () => {
  it("never uses import.meta in a file the runner loads", () => {
    const files = runnerFiles();
    expect(files.length).toBeGreaterThan(ENTRIES.length);
    const offenders = files.filter((f) => /\bimport\.meta\b/.test(readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")));
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });
});
