import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dependencySpec, installedCommit, toolkitRoot } from "../src/update.js";

let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "bt-a11y-update-"));
  mkdirSync(join(project, "node_modules", "@bluetread", "accessibility-toolkit"), { recursive: true });
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

const installed = () => join(project, "node_modules", "@bluetread", "accessibility-toolkit");
const lock = (resolved: string) =>
  JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/@bluetread/accessibility-toolkit": { version: "0.3.0", resolved } } });

describe("installedCommit", () => {
  it("reads the commit npm recorded for the GitHub install", () => {
    writeFileSync(join(project, "package-lock.json"), lock("git+ssh://git@github.com/nwelsh-bluetread/bt-a11y-toolkit.git#a46487bf7535af383984d74f490bd8f6485323d7"));
    expect(installedCommit(installed())).toBe("a46487bf7535af383984d74f490bd8f6485323d7");
  });

  it("prefers node_modules/.package-lock.json, which reflects what's actually installed", () => {
    writeFileSync(join(project, "package-lock.json"), lock("git+ssh://git@github.com/x/y.git#1111111111111111111111111111111111111111"));
    writeFileSync(join(project, "node_modules", ".package-lock.json"), lock("git+ssh://git@github.com/x/y.git#2222222222222222222222222222222222222222"));
    expect(installedCommit(installed())).toBe("2222222222222222222222222222222222222222");
  });

  it("is undefined for a checkout of the toolkit itself or a non-git install", () => {
    expect(installedCommit(toolkitRoot())).toBeUndefined();
    writeFileSync(join(project, "package-lock.json"), lock("https://registry.npmjs.org/x/-/x-1.0.0.tgz"));
    expect(installedCommit(installed())).toBeUndefined();
  });
});

describe("dependencySpec", () => {
  it("reads how the project depends on the toolkit, including pins", () => {
    writeFileSync(join(project, "package.json"), JSON.stringify({ devDependencies: { "@bluetread/accessibility-toolkit": "github:nwelsh-bluetread/bt-a11y-toolkit#v0.4.0" } }));
    expect(dependencySpec(project)).toBe("github:nwelsh-bluetread/bt-a11y-toolkit#v0.4.0");
    expect(dependencySpec(join(project, "missing"))).toBeUndefined();
  });
});
