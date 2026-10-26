import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractXml, parseDensity, parseForegroundPackage, runTargetSize, type Adb } from "../src/device/android.js";
import { measurementSummary, measureTargets, parseUiDump, targetFindings } from "../src/device/target-size.js";
import { parseChecklist } from "../src/wizard/checklist-md.js";
import { buildCoverage } from "../src/wizard/coverage.js";
import { writeChecklistFiles } from "../src/wizard/index.js";
import type { Prompter } from "../src/wizard/prompts.js";
import { loadSession, newSession, saveSession } from "../src/wizard/session.js";

const PKG = "com.example.app";
// Density 320 → 2 px per dp, so the numbers below are dp × 2.
const node = (bounds: string, attrs = "", children = "") =>
  `<node index="0" text="" resource-id="" class="android.view.ViewGroup" package="${PKG}" content-desc="" clickable="false" enabled="true" scrollable="false" bounds="${bounds}" ${attrs}${children ? `>${children}</node>` : "/>"}`;
const tap = (bounds: string, label: string, extra = "") => node(bounds, `clickable="true" ${extra}`.replace('content-desc=""', ""), "").replace(`content-desc=""`, `content-desc="${label}"`);

function dump(...children: string[]): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${node("[0,0][1080,2400]", "", children.join(""))}</hierarchy>`;
}

const SCREEN = dump(
  tap("[100,100][200,200]", "Save"), // 50×50 dp
  tap("[500,500][536,536]", "Help"), // 18×18 dp, nothing near it
  tap("[100,800][136,836]", "Bold"), // 18×18 dp, 4 dp from its neighbor
  tap("[144,800][180,836]", "Italic"),
  node("[300,1000][700,1100]", 'clickable="true"', node("[300,1000][700,1100]", 'clickable="true"', node("[320,1020][400,1080]", 'text="Pay now"'))),
  tap("[600,100][630,130]", "Disabled", 'enabled="false"'),
  node("[0,2300][1080,2400]", 'package="com.android.systemui" clickable="true"'),
  node("[0,1200][1080,1500]", 'class="android.widget.ScrollView" scrollable="true"', tap("[100,1200][300,1220]", "Half-scrolled row")),
);

describe("measureTargets", () => {
  const m = measureTargets(parseUiDump(SCREEN), { pkg: PKG, density: 320 });
  const byLabel = Object.fromEntries(m.targets.map((t) => [t.label, t]));

  it("sizes the app's tappable views in dp and applies the spacing exception", () => {
    expect(byLabel.Save).toMatchObject({ widthDp: 50, heightDp: 50, result: "pass" });
    expect(byLabel.Help).toMatchObject({ widthDp: 18, heightDp: 18, result: "spaced" });
    expect(byLabel.Bold!.result).toBe("fail");
    expect(byLabel.Italic!.result).toBe("fail");
  });

  it("names controls from their children, counts nested same-size touchables once, and skips other apps, disabled and clipped views", () => {
    expect(byLabel["Pay now"]).toMatchObject({ widthDp: 200, result: "pass" });
    expect(m.targets.map((t) => t.label).sort()).toEqual(["Bold", "Help", "Italic", "Pay now", "Save"]);
    expect(m.clipped).toBe(1);
  });

  it("turns failures into findings tied to the screen", () => {
    const findings = targetFindings("Home", m);
    expect(findings.map((f) => f.nodeId)).toEqual(['"Bold" 18×18dp', '"Italic" 18×18dp']);
    expect(findings[0]).toMatchObject({ evidence: { screen: "Home" }, platforms: ["android"], wcag: [{ id: "2.5.8" }] });
    expect(measurementSummary(m)).toBe("2 of 5 targets too small");
  });
});

describe("adb output parsing", () => {
  it("reads density, the foreground app, and the dump XML", () => {
    expect(parseDensity("Physical density: 420\nOverride density: 480")).toBe(480);
    expect(parseDensity("Physical density: 420")).toBe(420);
    expect(parseForegroundPackage("  topResumedActivity=ActivityRecord{1a2b u0 com.example.app/.MainActivity t12}")).toBe(PKG);
    expect(extractXml(`${SCREEN}UI hierchary dumped to: /dev/tty`)).toBe(SCREEN);
    expect(extractXml("ERROR: could not get idle state.")).toBeUndefined();
  });
});

describe("runTargetSize", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "bt-a11y-target-"));
    const session = newSession({ name: "Demo", type: "mobile", targets: ["ios", "android"], targetLevel: "AA" }, [
      { name: "Home", kind: "mobile", file: "src/Home.tsx", files: ["src/Home.tsx"], deepLink: "home" },
      { name: "Billing", kind: "mobile", file: "src/Billing.tsx", files: ["src/Billing.tsx"], deepLink: "billing" },
      { name: "Settings", kind: "mobile", file: "src/Settings.tsx", files: ["src/Settings.tsx"] },
    ]);
    saveSession(cwd, session);
    writeChecklistFiles(cwd, session);
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  const goodScreen = dump(tap("[100,100][200,200]", "Pay"));
  function fakeAdb(screens: Record<string, string>): Adb & { calls: string[][] } {
    let current = "";
    const calls: string[][] = [];
    return {
      calls,
      run: async (args) => {
        calls.push(args);
        if (args[0] === "devices") return "List of devices attached\nemulator-5554\tdevice\n";
        if (args.join(" ") === "shell wm density") return "Physical density: 320\n";
        if (args.includes("dumpsys")) return `topResumedActivity=ActivityRecord{1 u0 ${PKG}/.MainActivity t1}`;
        if (args.includes("am")) current = args[args.indexOf("-d") + 1]!;
        if (args.includes("uiautomator")) return `${screens[current] ?? ""}UI hierchary dumped to: /dev/tty`;
        return "";
      },
    };
  }
  const prompter = (mode: string): Prompter => ({
    select: async (message) => (/Which screens/.test(message) ? mode : "") as never,
    checkbox: async () => [] as never,
    input: async (_m, o) => o?.default ?? "",
    confirm: async () => true,
  });

  it("measures deep-linked screens, saves the run, and fills in the checklist", async () => {
    const output: string[] = [];
    const adb = fakeAdb({ "demo://home": goodScreen, "demo://billing": SCREEN });
    // No app.json here, so the scheme prompt's default is empty: answer it.
    const p = prompter("linked");
    p.input = async (m, o) => (/scheme/.test(m) ? "demo" : (o?.default ?? ""));
    await runTargetSize({ cwd, prompter: p, out: (t) => output.push(t), adb, sleep: async () => {}, writeChecklist: (c, s) => void writeChecklistFiles(c, s) });

    expect(adb.calls).toContainEqual(["shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", "demo://home", PKG]);
    expect(output.join("\n")).toContain("✗ Billing: 2 of 5 targets too small");
    const session = loadSession(cwd)!;
    expect(session.project.device).toEqual({ androidPackage: PKG, scheme: "demo" });
    const run = session.automated.find((r) => r.tool === "device-target-size")!;
    expect(run.verified!.map((v) => v.screen)).toEqual(["Home", "Billing"]);
    expect(run.findings).toHaveLength(2);

    const md = readFileSync(join(cwd, "a11y-audit", "checklist.md"), "utf8");
    const android = md.slice(md.indexOf("# Android"));
    expect(android).toMatch(/- \[x\] \*\*2\.5\.8\*\* .*`target-size` — measured on device \(1 target, all at least 24×24 dp or spaced apart\)/);
    expect(android).toMatch(/- \[!\] \*\*2\.5\.8\*\* .*`target-size` — measured on device \(2 of 5 targets too small\)\n {2}⚑ Medium · Touch target smaller than 24×24 dp — "Bold" 18×18dp, "Italic" 18×18dp/);
    const rows = parseChecklist(md).rows.filter((r) => r.itemId === "target-size");
    expect(rows.filter((r) => r.target === "android" && r.auto).map((r) => [r.screen, r.status])).toEqual([["Home", "pass"], ["Billing", "fail"]]);
    expect(rows.filter((r) => r.target === "ios").every((r) => r.status === "open")).toBe(true);

    // Re-measuring after a fix replaces the old result for that screen only.
    await runTargetSize({
      cwd,
      prompter: prompter("linked"),
      out: () => {},
      adb: fakeAdb({ "demo://home": goodScreen, "demo://billing": goodScreen.replace("Pay", "Pay2") }),
      sleep: async () => {},
      writeChecklist: (c, s) => void writeChecklistFiles(c, s),
    });
    const after = loadSession(cwd)!;
    expect(after.automated.find((r) => r.tool === "device-target-size")!.findings).toHaveLength(0);
    const rerendered = parseChecklist(readFileSync(join(cwd, "a11y-audit", "checklist.md"), "utf8"));
    expect(rerendered.rows.find((r) => r.target === "android" && r.screen === "Billing" && r.itemId === "target-size")!.status).toBe("pass");
    expect(buildCoverage(after, rerendered).rows.find((r) => r.id === "2.5.8")!.byTarget.android!.status).not.toBe("fail");
  });

  it("skips a deep link that didn't change the screen", async () => {
    const output: string[] = [];
    const p = prompter("linked");
    p.input = async (m, o) => (/scheme/.test(m) ? "demo" : (o?.default ?? ""));
    await runTargetSize({
      cwd,
      prompter: p,
      out: (t) => output.push(t),
      adb: fakeAdb({ "demo://home": goodScreen, "demo://billing": goodScreen }),
      sleep: async () => {},
      writeChecklist: (c, s) => void writeChecklistFiles(c, s),
    });
    expect(output.join("\n")).toContain("Billing: the screen didn't change");
    expect(loadSession(cwd)!.automated.find((r) => r.tool === "device-target-size")!.verified!.map((v) => v.screen)).toEqual(["Home"]);
  });
});
