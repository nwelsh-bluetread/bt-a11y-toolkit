/**
 * `bt-a11y target-size`: measure touch targets on a running Android app over adb.
 *
 * Opens each screen (by deep link when it has one, otherwise the tester taps
 * there), dumps the view hierarchy with uiautomator, and checks every tappable
 * view against WCAG 2.5.8. Results are saved as an automated run, and the
 * checklist's target-size line for each measured screen is filled in.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadChecklist, loadSession, saveSession, upsertRun, type AutomatedRun, type AuditSession } from "../wizard/session.js";
import type { Prompter } from "../wizard/prompts.js";
import type { ScreenInfo } from "../code-scan/screens.js";
import { measurementSummary, measureTargets, parseUiDump, targetFindings, TARGET_RULE, type ScreenMeasurement } from "./target-size.js";

export interface Adb {
  /** Run `adb <args>` and resolve with stdout; reject if adb fails. */
  run(args: string[]): Promise<string>;
}

export interface TargetSizeDeps {
  cwd: string;
  prompter: Prompter;
  out: (text: string) => void;
  adb: Adb;
  sleep: (ms: number) => Promise<void>;
  /** How long to wait after opening a deep link before measuring. */
  waitMs?: number;
  /** Rewrite checklist.md from the updated session (the wizard's writer). */
  writeChecklist: (cwd: string, session: AuditSession) => void;
}

const MIN_DP = 24;

/** adb from ANDROID_HOME / ANDROID_SDK_ROOT, the default SDK folders, or PATH. */
export function findAdb(): string {
  const sdks = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), "Library", "Android", "sdk"), join(homedir(), "Android", "Sdk")];
  for (const sdk of sdks) {
    const adb = sdk && join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
    if (adb && existsSync(adb)) return adb;
  }
  return "adb";
}

export function systemAdb(path = findAdb()): Adb {
  return {
    run: (args) =>
      new Promise((resolve, reject) => {
        execFile(path, args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) reject(new Error((stderr || err.message).trim()));
          else resolve(stdout);
        });
      }),
  };
}

/** The `scheme` from app.json / app.config.*, for building deep links. */
export function detectScheme(cwd: string): string | undefined {
  for (const file of ["app.json", "app.config.js", "app.config.ts"]) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;
    const m = /["']?\bscheme["']?\s*:\s*["']([\w.+-]+)["']/.exec(readFileSync(path, "utf8"));
    if (m) return m[1];
  }
  return undefined;
}

export function parseDensity(output: string): number | undefined {
  const m = /Override density:\s*(\d+)/.exec(output) ?? /Physical density:\s*(\d+)/.exec(output);
  return m ? Number(m[1]) : undefined;
}

export function parseForegroundPackage(output: string): string | undefined {
  return /(?:topResumedActivity|mResumedActivity|ResumedActivity)[^\n]*?\s([\w.]+)\/[\w.$]+/.exec(output)?.[1];
}

/** The XML part of `uiautomator dump /dev/tty`, which appends a status line. */
export function extractXml(output: string): string | undefined {
  const start = output.indexOf("<?xml");
  const end = output.lastIndexOf("</hierarchy>");
  return start >= 0 && end > start ? output.slice(start, end + "</hierarchy>".length) : undefined;
}

export async function runTargetSize(deps: TargetSizeDeps): Promise<void> {
  const { cwd, prompter: p, out, sleep } = deps;
  const session = loadSession(cwd);
  if (!session) throw new Error("No guided audit found in ./a11y-audit. Run 'bt-a11y start' first.");
  if (!session.project.targets.includes("android")) throw new Error("This audit doesn't include Android, and target size is measured on an Android device.");

  // ── Device ──
  let adb = deps.adb;
  let devices: string[];
  try {
    devices = (await adb.run(["devices"])).split("\n").map((l) => /^(\S+)\s+device$/.exec(l.trim())?.[1]).filter((d): d is string => Boolean(d));
  } catch (err) {
    throw new Error(`Couldn't run adb (${err instanceof Error ? err.message : String(err)}). Install Android platform-tools, or set ANDROID_HOME.`);
  }
  if (devices.length === 0) {
    throw new Error("No Android device found. Connect a phone with USB debugging on, or start an emulator, then check `adb devices` lists it.");
  }
  if (devices.length > 1) {
    const serial = await p.select("Which device?", devices.map((d) => ({ name: d, value: d })));
    const base = adb;
    adb = { run: (args) => base.run(["-s", serial, ...args]) };
  }
  const density = parseDensity(await adb.run(["shell", "wm", "density"]));
  if (!density) throw new Error("Couldn't read the device's screen density (adb shell wm density).");

  // ── App ──
  const device = (session.project.device ??= {});
  if (!device.androidPackage) {
    await p.confirm("Open the app on the device and sign in with the test account. Ready?", { default: true });
    const detected = parseForegroundPackage(await adb.run(["shell", "dumpsys", "activity", "activities"]));
    device.androidPackage = (await p.input("App package to measure", { default: detected, required: true })).trim();
  }
  if (device.scheme === undefined) {
    device.scheme = (await p.input("Deep link scheme (e.g. myapp; Enter to skip deep links)", { default: detectScheme(cwd) ?? "" })).trim();
  }
  saveSession(cwd, session);
  const pkg = device.androidPackage;

  // ── Screens ──
  const checklist = loadChecklist(cwd, session.screens.map((s) => s.name));
  const blocked = new Set(checklist.screenMarks.filter((m) => m.target === "android" && m.blocked).map((m) => m.screen));
  const screens = session.screens.filter((s) => s.kind === "mobile" && !blocked.has(s.name));
  const linked = device.scheme ? screens.filter((s) => s.deepLink) : [];
  const mode = await p.select<"linked" | "all" | "current">("Which screens?", [
    ...(linked.length ? [{ name: `Screens with a deep link (${linked.length}), opened automatically`, value: "linked" as const }] : []),
    { name: `All ${screens.length} screens: deep links open automatically, you open the rest`, value: "all" },
    { name: "Just the screen on the device now", value: "current" },
  ]);
  let queue: ScreenInfo[];
  if (mode === "current") {
    const name = await p.select("Which screen is it?", screens.map((s) => ({ name: s.name, value: s.name })));
    queue = screens.filter((s) => s.name === name);
  } else {
    queue = mode === "linked" ? linked : screens;
  }
  if (blocked.size) out(`Skipping ${blocked.size} screen${blocked.size === 1 ? "" : "s"} marked blocked.`);

  // ── Measure ──
  const results = new Map<string, ScreenMeasurement>();
  let previousSignature = "";
  for (const screen of queue) {
    const deepLink = device.scheme && screen.deepLink && mode !== "current" ? `${device.scheme}://${screen.deepLink}` : undefined;
    if (deepLink) {
      await adb.run(["shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", deepLink, pkg]);
      await sleep(deps.waitMs ?? 2500);
    } else if (mode !== "current") {
      const answer = (await p.input(`Open "${screen.name}" on the device, then press Enter (s = skip, q = stop)`, { default: "" })).trim().toLowerCase();
      if (answer === "q") break;
      if (answer === "s") continue;
    }

    const xml = await dumpHierarchy(adb, sleep);
    if (!xml) {
      out(`  ? ${screen.name}: couldn't read the screen (uiautomator dump failed). Skipped.`);
      continue;
    }
    const roots = parseUiDump(xml);
    if (!xml.includes(`package="${pkg}"`)) {
      out(`  ? ${screen.name}: ${pkg} isn't on screen (login page, another app, or a crash?). Skipped.`);
      continue;
    }
    const m = measureTargets(roots, { pkg, density, minDp: MIN_DP });
    const signature = m.targets.map((t) => `${t.label}@${t.bounds.x1},${t.bounds.y1}`).join("|");
    if (deepLink && signature === previousSignature) {
      out(`  ? ${screen.name}: the screen didn't change after opening ${deepLink}. Skipped; measure it with "Just the screen on the device now".`);
      continue;
    }
    previousSignature = signature;
    results.set(screen.name, m);
    const fails = m.targets.filter((t) => t.result === "fail");
    out(`  ${fails.length ? "✗" : "✓"} ${screen.name}: ${measurementSummary(m, MIN_DP)}`);
    for (const t of fails.slice(0, 5)) out(`      "${t.label}" ${t.widthDp}×${t.heightDp} dp`);
    if (fails.length > 5) out(`      +${fails.length - 5} more`);
  }

  if (results.size === 0) {
    out("\nNothing measured.");
    return;
  }

  // ── Save: replace earlier results for these screens, keep the rest ──
  const earlier = session.automated.find((r) => r.tool === TARGET_RULE);
  const run: AutomatedRun = {
    tool: TARGET_RULE,
    targets: ["android"],
    ranAt: new Date().toISOString(),
    checked: ["2.5.8"],
    findings: [
      ...(earlier?.findings ?? []).filter((f) => !results.has(String(f.evidence?.screen))),
      ...[...results].flatMap(([screen, m]) => targetFindings(screen, m, MIN_DP)),
    ],
    verified: [
      ...(earlier?.verified ?? []).filter((v) => !results.has(v.screen)),
      ...[...results].map(([screen, m]) => ({ screen, criteria: ["2.5.8"], summary: measurementSummary(m, MIN_DP) })),
    ],
  };
  upsertRun(session, run);
  saveSession(cwd, session);
  deps.writeChecklist(cwd, session);

  const failed = [...results.values()].filter((m) => m.targets.some((t) => t.result === "fail")).length;
  out(`\n✓ Measured ${results.size} screen${results.size === 1 ? "" : "s"} on Android: ${results.size - failed} pass, ${failed} fail.`);
  out("  The target-size line for each one is filled in on checklist.md (Android). iOS is still checked by hand.");
  out("  Run npx bt-a11y report to update the report.");
}

async function dumpHierarchy(adb: Adb, sleep: (ms: number) => Promise<void>): Promise<string | undefined> {
  // uiautomator fails while the screen is animating ("could not get idle state"); try a few times.
  for (let attempt = 0; attempt < 3; attempt++) {
    const xml = extractXml(await adb.run(["exec-out", "uiautomator", "dump", "/dev/tty"]).catch(() => ""));
    if (xml) return xml;
    await sleep(1000);
  }
  return undefined;
}
