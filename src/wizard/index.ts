/**
 * `bt-a11y start` — the guided audit.
 *
 *   1. A few questions: project name, website / mobile app, WCAG level, then the
 *      screens (found in the code and confirmed) or pages to audit.
 *   2. The automated checks run on their own: React Native code scan, axe, Lighthouse.
 *   3. A per-screen manual checklist is printed and written to a11y-audit/checklist.md,
 *      tailored to what each screen contains. Testers fill it in, then run
 *      `bt-a11y report` to build the audit.
 *
 * Re-running keeps answers already filled in to checklist.md.
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { applyContext, mergeContexts, parseNavigationMap, UNLISTED_GROUP, type NavigationContext } from "../context.js";
import { MANUAL_CHECKLIST, TEST_MODES, type AuditTarget, type ChecklistItem } from "../checklist.js";
import { isReactNativeProject, RN_RULES, type CodeScanResult } from "../code-scan/react-native.js";
import { FEATURE_LABEL, isFile, screensFromUrls, type ScreenDiscovery, type ScreenInfo } from "../code-scan/screens.js";
import { LIGHTHOUSE_AUDIT_MAP } from "../integrations/lighthouse.js";
import type { Assessment, Finding, Severity, WcagLevel } from "../types.js";
import { findingOnSection, planChecklist, renderChecklist, renderScanDetails, type PlannedGroup } from "./checklist-md.js";
import type { Prompter } from "./prompts.js";
import {
  checklistPath,
  loadChecklist,
  loadSession,
  newSession,
  saveSession,
  SESSION_DIR,
  upsertRun,
  writeReports,
  type AuditSession,
  type MobileStack,
  type ProjectType,
} from "./session.js";

type ScanProgress = (event:
  | { type: "start"; total: number }
  | { type: "page"; url: string; index: number; total: number }
  | { type: "skip"; url: string; error: string }) => void;

type Scanner = (urls: string[], level: WcagLevel, onProgress: ScanProgress) => Promise<Assessment>;

/** Side effects the wizard needs, injectable so the flow can be tested. */
export interface WizardDeps {
  prompter: Prompter;
  cwd: string;
  out: (text: string) => void;
  resolveUrls: (opts: { urls?: string[]; urlsFile?: string; sitemap?: string }) => Promise<string[]>;
  scanAxe: Scanner;
  scanLighthouse: Scanner;
  scanCode: (root: string, level: WcagLevel, platforms: AuditTarget[]) => Promise<CodeScanResult>;
  discoverScreens: (root: string) => Promise<ScreenDiscovery>;
  /** Whether an optional package can be imported. */
  hasModule: (name: string) => Promise<boolean>;
  /** Run a command in `cwd` with inherited stdio; resolves to the exit code. */
  runCommand: (cmd: string, args: string[]) => Promise<number>;
}

const TARGET_LABEL: Record<AuditTarget, string> = { web: "Website", ios: "iOS", android: "Android" };
const MAX_PAGES = 25;

const SCANNERS = {
  axe: {
    label: "axe-core",
    packages: ["playwright", "@axe-core/playwright"],
    postInstall: ["npx", ["playwright", "install", "chromium"]] as const,
  },
  lighthouse: {
    label: "Lighthouse",
    packages: ["lighthouse", "chrome-launcher"],
    postInstall: undefined,
  },
} as const;

type ScannerId = keyof typeof SCANNERS;

/** Criteria each web scanner has rules for (axe-core 4.x; Lighthouse runs a subset of axe). */
const WEB_CHECKED: Record<ScannerId, string[]> = {
  axe: [
    "1.1.1", "1.2.2", "1.3.1", "1.3.4", "1.3.5", "1.4.1", "1.4.2", "1.4.3", "1.4.4", "1.4.12",
    "2.1.1", "2.2.1", "2.2.2", "2.4.1", "2.4.2", "2.4.4", "2.5.3", "2.5.8", "3.1.1", "3.1.2", "3.3.2", "4.1.2",
  ],
  lighthouse: [...new Set(Object.values(LIGHTHOUSE_AUDIT_MAP).flatMap((m) => m.wcag))],
};

export async function runWizard(deps: WizardDeps): Promise<void> {
  const { prompter: p, cwd, out } = deps;
  out(`\n${bold("BlueTread Accessibility Audit")}\n`);

  let session = loadSession(cwd);
  let fresh = false;
  if (session) {
    out(`Found an audit for ${bold(session.project.name)} (${describeProject(session)}, ${session.screens.length} screens).`);
    const action = await p.select("What would you like to do?", [
      { name: "Re-run the scans and refresh the checklist", value: "rerun", description: "Keeps answers already filled in to checklist.md" },
      { name: "Start a new audit", value: "new", description: "Replaces the saved setup and screen list" },
    ]);
    if (action === "new") session = undefined;
  }

  if (!session) {
    const context = await contextStep(deps);
    session = await setup(deps, context.ctx);
    if (context.files.length) session.context = { files: copyContextFiles(cwd, context.files) };
    fresh = true;
  } else if (session.screens.some((s) => s.kind === "mobile")) {
    session.screens = await refreshScreens(deps, session.screens, loadContext(cwd, session));
  }
  saveSession(cwd, session);

  const scanners = session.project.targets.includes("web") ? await webScannersToRun(deps) : [];
  if (fresh) await offerGitignore(deps);

  // ── Everything below runs without prompts ──
  await runAutomated(deps, session, scanners);
  saveSession(cwd, session);

  const groups = planChecklist(session.screens, session.project.targets, session.project.targetLevel);
  const previous = loadChecklist(cwd);
  writeFileSync(
    checklistPath(cwd),
    renderChecklist({
      projectName: session.project.name,
      targetLevel: session.project.targetLevel,
      groups,
      runs: session.automated,
      previous,
      contextFiles: session.context?.files,
    }),
    "utf8",
  );
  writeFileSync(
    join(cwd, SESSION_DIR, "scan-details.md"),
    renderScanDetails({ projectName: session.project.name, groups, runs: session.automated }) + "\n",
    "utf8",
  );
  const { markdown } = writeReports(cwd, session);

  displayChecklist(deps, session, groups);
  // Answers a person gave — not [!] lines the scan pre-filled.
  const answered = previous.rows.filter((r) => r.status !== "open" && !(r.flagged && r.status === "fail" && r.issues.length === 0)).length;
  out("");
  out(green(`✓ Checklist: ${checklistPath(cwd)}`) + (answered ? dim(` (kept ${answered} answers)`) : ""));
  out(green(`✓ Report so far (automated results): ${markdown}`));
  out(`\nNext: test each screen and mark the checklist, then run ${bold("npx bt-a11y report")} to build the report and summary PDF.\n`);
}

// ── 0. Context ───────────────────────────────────────────────────────────────

/** Ask for docs that describe the app (navigation map, sitemap, flows) before anything else. */
async function contextStep(deps: WizardDeps): Promise<{ files: string[]; ctx: NavigationContext }> {
  const { prompter: p, cwd, out } = deps;
  const suggestion = findContextDoc(cwd);
  const raw = await p.input("Any context docs to start from? (navigation map, sitemap, flow notes — paths, comma-separated; Enter to skip)", {
    default: suggestion,
    validate: (v) => {
      const missing = splitPaths(v).filter((f) => !isFile(resolvePath(cwd, f)));
      return missing.length === 0 ? true : `Not found: ${missing.join(", ")}`;
    },
  });
  const files = splitPaths(raw).map((f) => resolvePath(cwd, f));
  if (files.length === 0) return { files, ctx: mergeContexts([]) };

  const ctx = mergeContexts(files.filter((f) => /\.(md|markdown|txt)$/i.test(f)).map((f) => parseNavigationMap(readFileSync(f, "utf8"))));
  const groups = new Set(ctx.screens.map((s) => s.group));
  out(
    ctx.screens.length
      ? dim(`Context: ${ctx.screens.length} screens in ${groups.size} group${groups.size === 1 ? "" : "s"}${ctx.flows.length ? `, ${ctx.flows.length} navigation links` : ""}.`)
      : dim("Context saved with the audit (no screen tables found to read)."),
  );
  return { files, ctx };
}

/** A likely context doc in the repo root or docs/, offered as the default. */
function findContextDoc(cwd: string): string | undefined {
  for (const dir of [".", "docs", "doc"]) {
    const abs = join(cwd, dir);
    if (!existsSync(abs)) continue;
    const hit = readdirSync(abs).find((f) => /^(nav(igation)?[-_ ]?map|site[-_ ]?map|screens|routes|navigation)\.(md|markdown)$/i.test(f));
    if (hit) return dir === "." ? hit : `${dir}/${hit}`;
  }
  return undefined;
}

function copyContextFiles(cwd: string, files: string[]): string[] {
  const dir = join(cwd, SESSION_DIR, "context");
  mkdirSync(dir, { recursive: true });
  return files.map((f) => {
    copyFileSync(f, join(dir, basename(f)));
    return `context/${basename(f)}`;
  });
}

/** Re-read the context docs saved with the audit. */
function loadContext(cwd: string, session: AuditSession): NavigationContext {
  const docs = (session.context?.files ?? [])
    .map((f) => join(cwd, SESSION_DIR, f))
    .filter((f) => existsSync(f) && /\.(md|markdown|txt)$/i.test(f));
  return mergeContexts(docs.map((f) => parseNavigationMap(readFileSync(f, "utf8"))));
}

function splitPaths(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function resolvePath(cwd: string, path: string): string {
  const expanded = path.replace(/^~(?=\/|$)/, homedir());
  return isAbsolute(expanded) ? expanded : join(cwd, expanded);
}

// ── 1. Setup ─────────────────────────────────────────────────────────────────

async function setup(deps: WizardDeps, ctx: NavigationContext): Promise<AuditSession> {
  const { prompter: p, cwd, out } = deps;

  const name = await p.input("Project / client name:", { default: detectProjectName(cwd), required: true });
  const type = await p.select<ProjectType>("What are you auditing?", [
    { name: "Mobile app (iOS + Android)", value: "mobile" },
    { name: "Website / web app", value: "web" },
    { name: "Both", value: "both" },
  ]);
  const targetLevel = await p.select<WcagLevel>(
    "Target WCAG compliance level?",
    [
      { name: "A", value: "A", description: "Minimum — removes the most severe barriers" },
      { name: "AA (recommended)", value: "AA", description: "The legal/industry standard (ADA, Section 508, EN 301 549)" },
      { name: "AAA", value: "AAA", description: "Enhanced — rarely required for a whole product" },
    ],
    { default: "AA" },
  );

  const targets: AuditTarget[] = [];
  if (type !== "web") targets.push("ios", "android");
  if (type !== "mobile") targets.push("web");
  const stack: MobileStack | undefined = type === "web" ? undefined : detectStack(cwd);

  const screens: ScreenInfo[] = [];
  if (type !== "web") screens.push(...(await mobileScreens(deps, stack!, ctx)));
  let urls: string[] | undefined;
  if (type !== "mobile") {
    urls = await webPages(deps);
    screens.push(...screensFromUrls(urls));
  }
  out("");
  return newSession({ name, type, targets, stack, targetLevel, urls }, screens);
}

/** Find screens (code + context doc), let the user pick groups in scope, and confirm or edit the list. */
async function mobileScreens(deps: WizardDeps, stack: MobileStack, ctx: NavigationContext): Promise<ScreenInfo[]> {
  const { prompter: p, cwd, out } = deps;
  let detected: ScreenInfo[] = [];

  if (stack === "react-native") {
    out(dim("\nLooking for screens in the navigation code…"));
    try {
      detected = (await deps.discoverScreens(cwd)).screens;
    } catch (err) {
      out(red(`Couldn't read the navigation code: ${message(err)}`));
    }
  } else if (ctx.screens.length === 0) {
    out(dim(`\nNo React Native project here${stack === "unknown" ? "" : ` (looks like ${stack})`} — the code scan only supports React Native, so list the screens yourself.`));
  }
  let screens = applyContext(detected, ctx);

  if (screens.length > 0) {
    printScreens(out, screens, stack === "react-native");
    const groups = [...new Set(screens.map((s) => s.group).filter((g): g is string => Boolean(g)))];
    if (groups.length > 1) {
      const chosen = await p.checkbox(
        "Which parts of the app are in scope?",
        groups.map((g) => ({ name: `${g} (${screens.filter((s) => s.group === g).length})`, value: g, checked: g !== UNLISTED_GROUP })),
        { required: true },
      );
      screens = screens.filter((s) => !s.group || chosen.includes(s.group));
    }
    if (await p.confirm(`Audit these ${screens.length} screens?`, { default: true })) return screens;
  } else if (stack === "react-native") {
    out(dim("No screens found in the navigation code."));
  }

  const raw = await p.input("Screens to audit (comma-separated):", {
    default: screens.map((s) => s.name).join(", ") || undefined,
    required: true,
  });
  const all = applyContext(detected, ctx);
  return splitNames(raw).map((name) => all.find((s) => s.name === name) ?? { name, kind: "mobile" as const });
}

function printScreens(out: (t: string) => void, screens: ScreenInfo[], fromCode: boolean): void {
  const grouped = screens.some((s) => s.group);
  const notInCode = fromCode ? screens.filter((s) => !s.file).length : 0;
  out(`\nFound ${bold(String(screens.length))} screens${notInCode ? dim(` (${notInCode} listed in the context doc but not found in code — their contents are unknown)`) : ""}:`);
  if (!grouped) {
    for (const s of screens) {
      const features = s.features?.length ? dim(` · ${s.features.map((f) => FEATURE_LABEL[f]).join(", ")}`) : "";
      out(`  • ${s.name.padEnd(24)} ${dim(s.file ?? "")}${features}`);
    }
    return;
  }
  for (const group of [...new Set(screens.map((s) => s.group ?? "Other"))]) {
    const names = screens.filter((s) => (s.group ?? "Other") === group).map((s) => (fromCode && !s.file ? `${s.name}*` : s.name));
    out(`  ${bold(group)} ${dim(`(${names.length})`)}`);
    out(dim(`    ${names.join(", ")}`));
  }
  if (notInCode) out(dim("  * not found in code"));
}

/** Re-discover screens on a re-run: keep the user's list, refresh files/features and context details. */
async function refreshScreens(deps: WizardDeps, saved: ScreenInfo[], ctx: NavigationContext): Promise<ScreenInfo[]> {
  let fresh: ScreenInfo[] = [];
  try {
    fresh = (await deps.discoverScreens(deps.cwd)).screens;
  } catch {
    // Not a React Native project (or unreadable) — context alone can still refresh details.
  }
  const all = applyContext(fresh, ctx);
  return saved.map((s) => (s.kind === "mobile" ? (all.find((f) => f.name === s.name) ?? s) : s));
}

async function webPages(deps: WizardDeps): Promise<string[]> {
  const { prompter: p, cwd, out } = deps;
  for (;;) {
    const raw = await p.input("Pages to audit — URLs (space-separated), a sitemap URL, or a URL list file:", {
      default: existsSync(join(cwd, "urls.txt")) ? "urls.txt" : undefined,
      required: true,
    });
    const tokens = splitList(raw);
    let urls: string[] = [];
    try {
      if (tokens.length === 1 && !/^https?:\/\//.test(tokens[0]!)) {
        if (!isFile(join(cwd, tokens[0]!))) {
          out(red(`Not a URL or a file: ${tokens[0]}`));
          continue;
        }
        urls = await deps.resolveUrls({ urlsFile: join(cwd, tokens[0]!) });
      } else if (tokens.length === 1 && /sitemap|\.xml$/i.test(tokens[0]!)) {
        out(dim("Reading sitemap…"));
        urls = await deps.resolveUrls({ sitemap: tokens[0]! });
      } else {
        const bad = tokens.filter((t) => !/^https?:\/\//.test(t));
        if (bad.length) {
          out(red(`Each URL must start with http:// or https:// (${bad.join(", ")})`));
          continue;
        }
        urls = await deps.resolveUrls({ urls: tokens });
      }
    } catch (err) {
      out(red(`Couldn't get the page list: ${message(err)}`));
      continue;
    }
    if (urls.length === 0) {
      out(red("No pages found."));
      continue;
    }
    if (urls.length > MAX_PAGES && !(await p.confirm(`Found ${urls.length} pages. Audit all of them? (No = first ${MAX_PAGES})`, { default: false }))) {
      urls = urls.slice(0, MAX_PAGES);
    }
    out(dim(`${urls.length} page(s).`));
    return urls;
  }
}

/** Check scanner packages up front so the automated run needs no prompts. */
async function webScannersToRun(deps: WizardDeps): Promise<ScannerId[]> {
  const { prompter: p, out } = deps;
  const ready: ScannerId[] = [];
  const missing: ScannerId[] = [];
  for (const id of Object.keys(SCANNERS) as ScannerId[]) {
    const present = await Promise.all(SCANNERS[id].packages.map((pkg) => deps.hasModule(pkg)));
    (present.every(Boolean) ? ready : missing).push(id);
  }
  if (missing.length === 0) return ready;

  const pkgs = missing.flatMap((id) => [...SCANNERS[id].packages]);
  if (!(await p.confirm(`The website scanners need ${pkgs.join(", ")}. Install them as dev dependencies now?`, { default: true }))) {
    out(dim(`Skipping ${missing.map((id) => SCANNERS[id].label).join(" and ")}. Install later with: npm install -D ${pkgs.join(" ")}`));
    return ready;
  }
  if ((await deps.runCommand("npm", ["install", "-D", ...pkgs])) !== 0) {
    out(red(`Install failed. Try manually: npm install -D ${pkgs.join(" ")}`));
    return ready;
  }
  for (const id of missing) {
    const post = SCANNERS[id].postInstall;
    if (post && (await deps.runCommand(post[0], [...post[1]])) !== 0) {
      out(red(`Setup failed. Try manually: ${post[0]} ${post[1].join(" ")}`));
      continue;
    }
    ready.push(id);
  }
  return ready;
}

async function offerGitignore(deps: WizardDeps): Promise<void> {
  const { prompter: p, cwd, out } = deps;
  if (!existsSync(join(cwd, ".git"))) return;
  const path = join(cwd, ".gitignore");
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (current.split("\n").some((l) => l.trim().replace(/\/$/, "") === SESSION_DIR)) return;
  if (await p.confirm(`Add ${SESSION_DIR}/ to .gitignore so audit findings aren't committed?`, { default: true })) {
    appendFileSync(path, `${current && !current.endsWith("\n") ? "\n" : ""}${SESSION_DIR}/\n`);
    out(dim(`Added ${SESSION_DIR}/ to .gitignore.`));
  }
}

// ── 2. Automated checks ──────────────────────────────────────────────────────

async function runAutomated(deps: WizardDeps, session: AuditSession, scanners: ScannerId[]): Promise<void> {
  const { out, cwd } = deps;
  const { targets, targetLevel, stack, urls } = session.project;
  const mobile = targets.filter((t) => t !== "web");
  out(bold("\nRunning automated checks…"));

  if (mobile.length > 0 && (stack === "react-native" || isReactNativeProject(cwd))) {
    try {
      const result = await deps.scanCode(cwd, targetLevel, mobile);
      upsertRun(session, {
        tool: "rn-code-scan",
        targets: mobile,
        ranAt: new Date().toISOString(),
        filesScanned: result.filesScanned,
        checked: result.checked,
        signals: result.signals,
        findings: result.findings,
      });
      out(`\n${green("✓")} React Native code scan ${dim(`— ${result.filesScanned} files · ${result.checked.length} WCAG criteria checked`)}`);
      printFindingSummary(out, result.findings);
    } catch (err) {
      out(red(`\n✗ Code scan failed: ${message(err)}`));
    }
  } else if (mobile.length > 0) {
    out(dim("\n– No code scan (not a React Native project). The manual checklist covers every criterion."));
  }

  for (const tool of scanners) {
    out(`\n${bold(SCANNERS[tool].label)} ${dim(`— ${urls!.length} page(s)`)}`);
    const scan = tool === "axe" ? deps.scanAxe : deps.scanLighthouse;
    try {
      const assessment = await scan(urls!, targetLevel, (e) => {
        if (e.type === "page") out(dim(`  [${e.index + 1}/${e.total}] ${e.url}`));
        else if (e.type === "skip") out(red(`  ! skipped ${e.url} (${e.error})`));
      });
      upsertRun(session, {
        tool,
        targets: ["web"],
        ranAt: new Date().toISOString(),
        pages: urls!.length,
        wcag: assessment.wcag,
        checked: WEB_CHECKED[tool],
        findings: assessment.findings,
      });
      out(`${green("✓")} ${SCANNERS[tool].label} ${dim(`— ${count(assessment.findings)}`)}`);
    } catch (err) {
      out(red(`✗ ${SCANNERS[tool].label} failed: ${message(err)}`));
    }
  }
}

function printFindingSummary(out: (t: string) => void, findings: Finding[]): void {
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) byRule.set(f.ruleId, [...(byRule.get(f.ruleId) ?? []), f]);
  if (byRule.size === 0) {
    out(dim("  No issues found in code — the manual checklist still needs to confirm."));
    return;
  }
  const ordered = [...byRule].sort((a, b) => SEVERITY_ORDER[a[1][0]!.severity] - SEVERITY_ORDER[b[1][0]!.severity]);
  for (const [ruleId, list] of ordered) {
    const places = list.reduce((n, f) => n + ((f.evidence?.lines as number[] | undefined)?.length ?? 1), 0);
    out(`  ${red("✗")} ${RN_RULES[ruleId]?.title ?? ruleId} ${dim(`— ${places} place${places === 1 ? "" : "s"} in ${list.length} file${list.length === 1 ? "" : "s"} · ${list[0]!.severity}`)}`);
  }
}

// ── 3. Display the checklist ─────────────────────────────────────────────────

function displayChecklist(deps: WizardDeps, session: AuditSession, groups: PlannedGroup[]): void {
  const { out } = deps;
  for (const group of groups) {
    const screens = group.sections.filter((s) => s.screen).map((s) => s.screen!);
    const noun = group.kind === "web" ? "page" : "screen";
    const platforms = group.targets.map((t) => TARGET_LABEL[t]);
    out(`\n${bold(`Manual checklist — ${group.title} · WCAG ${session.project.targetLevel}`)}`);
    out(
      dim(
        `${screens.length} ${noun}${screens.length === 1 ? "" : "s"}. Work through it one testing pass at a time` +
          (platforms.length > 1 ? ` — all of ${platforms[0]} first, then the same passes on ${platforms.slice(1).join(" and ")}.` : "."),
      ),
    );

    // Each check, with how many screens it's done on (or app-wide).
    const onCount = new Map<string, { item: ChecklistItem; screens: number; appWide: boolean; ifPresent: boolean }>();
    for (const section of group.sections) {
      for (const { item, ifPresent } of section.checks) {
        const entry = onCount.get(item.id) ?? { item, screens: 0, appWide: false, ifPresent: false };
        if (section.screen) entry.screens++;
        else entry.appWide = true;
        if (ifPresent) entry.ifPresent = true;
        onCount.set(item.id, entry);
      }
    }
    const order = new Map(MANUAL_CHECKLIST.map((i, n) => [i.id, n]));
    let n = 0;
    for (const mode of TEST_MODES) {
      const checks = [...onCount.values()].filter((c) => c.item.mode === mode.id).sort((a, b) => order.get(a.item.id)! - order.get(b.item.id)!);
      if (checks.length === 0) continue;
      const lines = checks.reduce((sum, c) => sum + c.screens + (c.appWide ? 1 : 0), 0);
      out(`\n  ${bold(`${++n}. ${mode.title}`)} ${dim(`(${checks.length} checks · ${lines} to mark per platform)`)}`);
      for (const c of checks) {
        const where = [c.screens ? `${c.screens} ${noun}${c.screens === 1 ? "" : "s"}` : "", c.appWide ? (c.ifPresent ? "app-wide, if present" : "app-wide") : ""].filter(Boolean).join(" + ");
        out(`    ☐ ${c.item.title} ${dim(`(${c.item.wcag.join(", ")}) — ${where}`)}`);
      }
    }

    const flagged = screens
      .map((screen) => ({ screen, n: session.automated.flatMap((r) => r.findings).filter((f) => findingOnSection(f, { heading: "", screen, checks: [] }, screens)).length }))
      .filter((x) => x.n > 0);
    if (flagged.length) {
      out(`\n  ${yellow("⚑ Automated findings by " + noun + ":")} ${dim(flagged.map((x) => `${x.screen.name} (${x.n})`).join(", "))}`);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function describeProject(session: AuditSession): string {
  return `${session.project.targets.map((t) => TARGET_LABEL[t]).join(" + ")} · WCAG ${session.project.targetLevel}`;
}

function detectProjectName(cwd: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { name?: string };
    if (pkg.name) return pkg.name;
  } catch {
    // No package.json — fall back to the folder name.
  }
  return basename(cwd);
}

function detectStack(cwd: string): MobileStack {
  if (isReactNativeProject(cwd)) return "react-native";
  if (existsSync(join(cwd, "pubspec.yaml"))) return "flutter";
  if (existsSync(join(cwd, "ios")) || existsSync(join(cwd, "android"))) return "native";
  return "unknown";
}

function splitList(value: string): string[] {
  return value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

function splitNames(value: string): string[] {
  return [...new Set(value.split(",").map((s) => s.trim()).filter(Boolean))];
}

function count(findings: Finding[]): string {
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const ansi = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = ansi("1");
const dim = ansi("2");
const green = ansi("32");
const red = ansi("31");
const yellow = ansi("33");
