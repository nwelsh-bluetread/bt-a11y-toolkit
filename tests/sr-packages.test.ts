import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { hasPackage, missingPackagesHint } from "../src/screen-reader/run.js";

const repo = mkdtempSync(join(tmpdir(), "bt-a11y-pkgs-"));
afterAll(() => rmSync(repo, { recursive: true, force: true }));
const install = (name: string) => {
  mkdirSync(join(repo, "node_modules", name), { recursive: true });
  writeFileSync(join(repo, "node_modules", name, "package.json"), JSON.stringify({ name }));
};

describe("screen reader package check", () => {
  // What an audited repo had: @guidepup/playwright installed, its peer @guidepup/guidepup not.
  for (const name of ["@guidepup/playwright", "@playwright/test", "playwright"]) install(name);
  const nested = join(repo, "packages", "web");
  mkdirSync(nested, { recursive: true });

  it("finds packages installed in the repo, from the repo or a folder inside it", () => {
    expect(hasPackage("@guidepup/playwright", [repo])).toBe(true);
    expect(hasPackage("playwright", [nested])).toBe(true);
    expect(hasPackage("@guidepup/guidepup", [repo])).toBe(false);
  });

  it("names only what's missing, with the install command, instead of a stack trace", () => {
    const hint = missingPackagesHint(["@guidepup/guidepup", "@guidepup/playwright", "@playwright/test", "playwright"], [repo])!;
    expect(hint).toContain("Missing a package the screen reader tools need: @guidepup/guidepup");
    expect(hint).toContain("  npm install -D @guidepup/guidepup\n");
    expect(hint).toContain("npm install -D @guidepup/guidepup @guidepup/playwright @playwright/test playwright tsx");
    install("@guidepup/guidepup");
    expect(missingPackagesHint(["@guidepup/guidepup", "@guidepup/playwright"], [repo])).toBeUndefined();
  });
});
