/**
 * `bt-a11y start` — the guided, interactive audit.
 *
 *   setup ─► automated scans ─► manual checklist (per platform) ─► extra findings ─► report
 *
 * Every answer is saved to `a11y-audit/session.json` as soon as it's given, so
 * the tester can quit at any point (Ctrl+C or "Save & exit") and pick up where
 * they left off by running `bt-a11y start` again.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { checklistFor, howToFor, type AuditTarget, type ChecklistItem } from "../checklist.js";
import { formatConsole } from "../report.js";
import { WCAG } from "../wcag.js";
import type { Assessment, Finding, Severity, WcagLevel } from "../types.js";
import type { Choice, Prompter } from "./prompts.js";
import {
  allFindings,
  checklistProgress,
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
  env: Record<string, string | undefined>;
  resolveUrls: (opts: { urls?: string[]; urlsFile?: string; sitemap?: string }) => Promise<string[]>;
  scanAxe: Scanner;
  scanLighthouse: Scanner;
  /** Whether an optional package can be imported. */
  hasModule: (name: string) => Promise<boolean>;
  /** Run a command in `cwd` with inherited stdio; resolves to the exit code. */
  runCommand: (cmd: string, args: string[]) => Promise<number>;
  createJiraTickets?: (assessment: Assessment, minSeverity: Severity) => Promise<Array<{ key: string; finding: Finding }>>;
}

const TARGET_LABEL: Record<AuditTarget, string> = { web: "Website", ios: "iOS", android: "Android" };

const SEVERITY_CHOICES: Choice<Severity>[] = [
  { name: "Critical", value: "critical", description: "Blocks a task entirely for some users" },
  { name: "High", value: "high", description: "Major barrier; workaround is difficult" },
  { name: "Medium", value: "medium", description: "Causes friction; workaround exists" },
  { name: "Low", value: "low", description: "Minor or cosmetic" },
];

const CATEGORY_CHOICES = [
  "Screen Reader",
  "Keyboard & Focus",
  "Forms",
  "Images/Icons",
  "Contrast",
  "Visual",
  "Touch Targets",
  "Gestures & Touch",
  "Layout & Zoom",
  "Content",
  "Media & Motion",
  "Semantics",
].map((c) => ({ name: c, value: c }));

const SCANNERS = {
  axe: {
    label: "axe-core (via Playwright)",
    packages: ["playwright", "@axe-core/playwright"],
    postInstall: ["npx", ["playwright", "install", "chromium"]] as const,
  },
  lighthouse: {
    label: "Lighthouse (via Chrome)",
    packages: ["lighthouse", "chrome-launcher"],
    postInstall: undefined,
  },
} as const;

type ScannerId = keyof typeof SCANNERS;

const MOBILE_SCANNER: Record<"ios" | "android", { tool: string; source: string; steps: string[] }> = {
  ios: {
    tool: "ios-accessibility-inspector",
    source: "ios-inspector",
    steps: [
      "Connect the iPhone (or boot a Simulator) and open the app.",
      "In Xcode: Xcode → Open Developer Tool → Accessibility Inspector.",
      "Pick the device in the Inspector's target menu, then open the Audit tab (⚠ icon).",
      "On each screen in your flow list, click Run Audit and review each warning.",
      "Log the real issues below (skip false positives). Screenshot icons in the audit help.",
    ],
  },
  android: {
    tool: "android-accessibility-scanner",
    source: "android-scanner",
    steps: [
      "Install Accessibility Scanner from the Play Store on the test device.",
      "Turn it on: Settings → Accessibility → Accessibility Scanner → Use Accessibility Scanner.",
      "Open the app, go to each screen in your flow list, and tap the blue check button.",
      "Choose Snapshot (one screen) or Record (a flow) and review each suggestion.",
      "Log the real issues below (skip false positives). The Scanner can export screenshots.",
    ],
  },
};

export async function runWizard(deps: WizardDeps): Promise<void> {
  const { prompter: p, cwd, out } = deps;
  out(`\n${bold("BlueTread Accessibility Audit")}\n${dim(`Progress is saved to ${SESSION_DIR}/ as you go.`)}\n`);

  let session = loadSession(cwd);
  if (session) {
    out(`Found an audit in progress: ${bold(session.project.name)} (${describeProject(session)}).\n`);
    const action = await p.select("What would you like to do?", [
      { name: "Continue this audit", value: "continue" },
      { name: "Start a new audit", value: "new", description: "Replaces the saved session and its findings" },
    ]);
    if (action === "new" && (await p.confirm("Discard the saved audit and start over?", { default: false }))) {
      session = undefined;
    }
  }

  if (!session) {
    session = await setup(deps);
    saveSession(cwd, session);
    await offerGitignore(deps);
  }

  await mainMenu(deps, session);
}

// ── Setup ────────────────────────────────────────────────────────────────────

async function setup(deps: WizardDeps): Promise<AuditSession> {
  const { prompter: p, cwd } = deps;

  const name = await p.input("Project / client name:", { default: detectProjectName(cwd), required: true });

  const type = await p.select<ProjectType>("What are you auditing?", [
    { name: "Website / web app", value: "web" },
    { name: "Mobile app (iOS / Android)", value: "mobile" },
    { name: "Both", value: "both" },
  ]);

  const targets: AuditTarget[] = type === "mobile" ? [] : ["web"];
  let stack: MobileStack | undefined;
  if (type !== "web") {
    const mobile = await p.checkbox<AuditTarget>(
      "Which mobile platforms?",
      [
        { name: "iOS", value: "ios", checked: true },
        { name: "Android", value: "android", checked: true },
      ],
      { required: true },
    );
    targets.push(...mobile);
    stack = await p.select<MobileStack>(
      "How is the app built?",
      [
        { name: "React Native", value: "react-native" },
        { name: "Native (Swift / Kotlin)", value: "native" },
        { name: "Flutter", value: "flutter" },
        { name: "Not sure", value: "unknown" },
      ],
      { default: detectStack(cwd) },
    );
  }

  const targetLevel = await p.select<WcagLevel>(
    "Target WCAG compliance level?",
    [
      { name: "A", value: "A", description: "Minimum — removes the most severe barriers" },
      { name: "AA (recommended)", value: "AA", description: "The legal/industry standard (ADA, Section 508, EN 301 549)" },
      { name: "AAA", value: "AAA", description: "Enhanced — rarely required for a whole product" },
    ],
    { default: "AA" },
  );

  return newSession({ name, type, targets, stack, targetLevel });
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

// ── Main menu ────────────────────────────────────────────────────────────────

type MenuAction =
  | { kind: "automated" }
  | { kind: "checklist"; target: AuditTarget }
  | { kind: "extra" }
  | { kind: "report" }
  | { kind: "exit" };

async function mainMenu(deps: WizardDeps, session: AuditSession): Promise<void> {
  const { prompter: p, out } = deps;
  for (;;) {
    out(`\n${bold(session.project.name)} ${dim(`— ${describeProject(session)}`)}`);

    const choices: Choice<MenuAction>[] = [];
    const runs = session.automated;
    choices.push({
      name: `1. Automated scans ${status(runs.length > 0, runs.length > 0 ? `${runs.length} run · ${count(runs.flatMap((r) => r.findings))}` : "not started")}`,
      value: { kind: "automated" },
    });
    for (const target of session.project.targets) {
      const prog = checklistProgress(session, target);
      choices.push({
        name: `2. Manual checklist — ${TARGET_LABEL[target]} ${status(prog.done === prog.total, `${prog.done}/${prog.total} checked${prog.failed ? ` · ${prog.failed} failed` : ""}`)}`,
        value: { kind: "checklist", target },
      });
    }
    choices.push({
      name: `3. Add other findings ${dim(`(${count(session.extraFindings)})`)}`,
      value: { kind: "extra" },
    });
    choices.push({ name: `4. Generate audit report ${dim(`(${count(allFindings(session))} total)`)}`, value: { kind: "report" } });
    choices.push({ name: "Save & exit", value: { kind: "exit" } });

    const action = await p.select("What next?", choices, { default: nextStep(session, choices) });
    switch (action.kind) {
      case "automated":
        await automatedStep(deps, session);
        break;
      case "checklist":
        await checklistStep(deps, session, action.target);
        break;
      case "extra":
        await extraFindingsStep(deps, session);
        break;
      case "report":
        await reportStep(deps, session);
        break;
      case "exit":
        saveSession(deps.cwd, session);
        out(`\nSaved. Run ${bold("bt-a11y start")} to pick up where you left off.\n`);
        return;
    }
  }
}

/** The first unfinished step, so pressing Enter always moves the audit forward. */
function nextStep(session: AuditSession, choices: Choice<MenuAction>[]): MenuAction {
  const find = (pred: (a: MenuAction) => boolean) => choices.find((c) => pred(c.value))!.value;
  if (session.automated.length === 0) return find((a) => a.kind === "automated");
  for (const target of session.project.targets) {
    const prog = checklistProgress(session, target);
    if (prog.done < prog.total) return find((a) => a.kind === "checklist" && a.target === target);
  }
  return find((a) => a.kind === "report");
}

// ── Step 1: automated scans ─────────────────────────────────────────────────

async function automatedStep(deps: WizardDeps, session: AuditSession): Promise<void> {
  const { prompter: p, out } = deps;
  const targets = session.project.targets;
  const chosen =
    targets.length === 1
      ? targets
      : await p.checkbox<AuditTarget>(
          "Which platforms do you want to scan now?",
          targets.map((t) => ({ name: TARGET_LABEL[t], value: t, checked: true })),
          { required: true },
        );

  for (const target of chosen) {
    if (target === "web") await webScans(deps, session);
    else await mobileScan(deps, session, target);
  }
  out(green("\n✓ Automated step saved."));
}

async function webScans(deps: WizardDeps, session: AuditSession): Promise<void> {
  const { prompter: p, out, cwd } = deps;
  out(`\n${bold("Website scans")}`);

  const saved = session.project.urls;
  const source = await p.select<"saved" | "urls" | "file" | "sitemap">("Which pages should be scanned?", [
    ...(saved?.length ? [{ name: `Same pages as last time (${saved.length})`, value: "saved" as const }] : []),
    { name: "Enter one or more URLs", value: "urls" },
    { name: "A URL list file (one URL per line)", value: "file" },
    { name: "A sitemap.xml (or sitemap index)", value: "sitemap" },
  ]);

  let urls: string[];
  try {
    if (source === "saved") urls = saved!;
    else if (source === "urls") {
      const raw = await p.input("URLs (separate with spaces or commas):", {
        required: true,
        validate: (v) => (splitList(v).every((u) => /^https?:\/\//.test(u)) ? true : "Each URL must start with http:// or https://"),
      });
      urls = await deps.resolveUrls({ urls: splitList(raw) });
    } else if (source === "file") {
      const file = await p.input("Path to the URL list file:", {
        default: existsSync(join(cwd, "urls.txt")) ? "urls.txt" : undefined,
        validate: (v) => (existsSync(join(cwd, v)) ? true : "File not found"),
      });
      urls = await deps.resolveUrls({ urlsFile: join(cwd, file) });
    } else {
      const sitemap = await p.input("Sitemap URL:", {
        validate: (v) => (/^https?:\/\//.test(v) ? true : "Must start with http:// or https://"),
      });
      out(dim("Reading sitemap…"));
      urls = await deps.resolveUrls({ sitemap });
    }
  } catch (err) {
    out(red(`Couldn't get the page list: ${message(err)}`));
    return;
  }

  if (urls.length === 0) {
    out(red("No pages found to scan."));
    return;
  }
  if (urls.length > 25) {
    const limit = await p.select(`Found ${urls.length} pages. Scan all of them?`, [
      { name: `First 25 pages`, value: 25, description: "Quicker; good for a first pass" },
      { name: `All ${urls.length} pages`, value: urls.length, description: "Roughly 10–60 seconds per page per tool" },
    ]);
    urls = urls.slice(0, limit);
  }
  session.project.urls = urls;
  saveSession(cwd, session);

  const tools = await p.checkbox<ScannerId>(
    "Which scanners?",
    [
      { name: SCANNERS.axe.label, value: "axe", checked: true, description: "Most precise WCAG rule mapping" },
      { name: SCANNERS.lighthouse.label, value: "lighthouse", checked: true, description: "Google's audit; overall score per page" },
    ],
    { required: true },
  );

  for (const tool of tools) {
    if (!(await ensureScanner(deps, tool))) continue;
    const scan = tool === "axe" ? deps.scanAxe : deps.scanLighthouse;
    out(`\n${bold(SCANNERS[tool].label)}`);
    try {
      const assessment = await scan(urls, session.project.targetLevel, (e) => {
        if (e.type === "page") out(dim(`  [${e.index + 1}/${e.total}] ${e.url}`));
        else if (e.type === "skip") out(red(`  ! skipped ${e.url} (${e.error})`));
      });
      upsertRun(session, {
        tool,
        target: "web",
        ranAt: new Date().toISOString(),
        pages: urls.length,
        wcag: assessment.wcag,
        findings: assessment.findings,
      });
      saveSession(cwd, session);
      out(green(`  ✓ ${count(assessment.findings)}`));
    } catch (err) {
      out(red(`  ${SCANNERS[tool].label} failed: ${message(err)}`));
    }
  }
}

/** Make sure a scanner's optional packages are installed, offering to install them. */
async function ensureScanner(deps: WizardDeps, tool: ScannerId): Promise<boolean> {
  const { prompter: p, out } = deps;
  const { label, packages, postInstall } = SCANNERS[tool];
  const missing: string[] = [];
  for (const pkg of packages) if (!(await deps.hasModule(pkg))) missing.push(pkg);
  if (missing.length === 0) return true;

  const install = await p.confirm(
    `${label} needs ${missing.join(" + ")}, which aren't installed. Install them as dev dependencies now?`,
    { default: true },
  );
  if (!install) {
    out(dim(`Skipping ${label}. To install later: npm install -D ${packages.join(" ")}`));
    return false;
  }
  if ((await deps.runCommand("npm", ["install", "-D", ...packages])) !== 0) {
    out(red(`Install failed. Try manually: npm install -D ${packages.join(" ")}`));
    return false;
  }
  if (postInstall && (await deps.runCommand(postInstall[0], [...postInstall[1]])) !== 0) {
    out(red(`Setup failed. Try manually: ${postInstall[0]} ${postInstall[1].join(" ")}`));
    return false;
  }
  return true;
}

async function mobileScan(deps: WizardDeps, session: AuditSession, target: "ios" | "android"): Promise<void> {
  const { prompter: p, out, cwd } = deps;
  const scanner = MOBILE_SCANNER[target];
  out(`\n${bold(`${TARGET_LABEL[target]} — on-device scan`)}`);
  out(dim("There's no command-line scanner for native apps; run the platform tool and log what it finds."));
  scanner.steps.forEach((s, i) => out(`  ${i + 1}. ${s}`));
  if (session.project.stack === "react-native") {
    out(dim("\n  Tip: with source access, also run eslint-plugin-react-native-a11y to catch missing labels/roles in code."));
  }

  const existing = session.automated.find((r) => r.tool === scanner.tool && r.target === target);
  const findings = [...(existing?.findings ?? [])];
  if (existing) out(dim(`\n  ${count(findings)} already logged from an earlier run.`));

  for (;;) {
    const next = await p.select(findings.length ? "Log another issue from the scanner?" : "Did the scanner find real issues?", [
      { name: "Yes — log an issue", value: "log" },
      { name: findings.length ? "No — done with this scan" : "No issues found — done", value: "done" },
    ]);
    if (next === "done") break;
    findings.push(await captureFinding(deps, { platforms: [target], source: scanner.source, rulePrefix: scanner.source }));
    upsertRun(session, { tool: scanner.tool, target, ranAt: new Date().toISOString(), findings });
    saveSession(cwd, session);
  }
  upsertRun(session, { tool: scanner.tool, target, ranAt: new Date().toISOString(), findings });
  saveSession(cwd, session);
}

// ── Step 2: manual checklist ────────────────────────────────────────────────

async function checklistStep(deps: WizardDeps, session: AuditSession, target: AuditTarget): Promise<void> {
  const { prompter: p, out, cwd } = deps;
  const items = checklistFor(target, session.project.targetLevel);
  const results = (session.checklist[target] ??= {});

  out(`\n${bold(`Manual checklist — ${TARGET_LABEL[target]} (WCAG ${session.project.targetLevel})`)}`);
  out(dim(`${items.length} checks. Test each across your primary flows, then record the result.`));

  let queue = items.filter((i) => !results[i.id]);
  if (queue.length === 0) {
    const redo = await p.select<string | null>(
      "Every check is recorded. Revisit one?",
      [
        ...items.map((i) => ({ name: `${statusIcon(results[i.id]!.status)} ${i.title}`, value: i.id })),
        { name: "← Back to menu", value: null },
      ],
      { default: null },
    );
    if (redo === null) return;
    queue = items.filter((i) => i.id === redo);
  }

  for (const item of queue) {
    const position = items.indexOf(item) + 1;
    out(`\n${bold(`[${position}/${items.length}] ${item.title}`)}`);
    out(dim(`WCAG ${item.wcag.map((id) => `${id} ${WCAG[id]?.name ?? ""}`.trim()).join(", ")} · Level ${item.level}`));
    out(`How to test: ${howToFor(item, target)}`);

    const result = await p.select<"pass" | "fail" | "na" | "skip" | "menu">("Result:", [
      { name: "✓ Pass", value: "pass" },
      { name: "✗ Fail — log the issue(s)", value: "fail" },
      { name: "– Not applicable", value: "na" },
      { name: "Skip for now", value: "skip", description: "Leave it unanswered and come back later" },
      { name: "Save & back to menu", value: "menu" },
    ]);
    if (result === "menu") return;
    if (result === "skip") continue;

    const findings: Finding[] = [];
    if (result === "fail") {
      do {
        findings.push(await captureFinding(deps, { platforms: [target], source: "manual", item }));
      } while (await p.confirm("Log another issue for this check (e.g. on a different screen)?", { default: false }));
    }
    results[item.id] = { status: result, findings, testedAt: new Date().toISOString() };
    saveSession(cwd, session);
  }

  const prog = checklistProgress(session, target);
  out(
    prog.done === prog.total
      ? green(`\n✓ ${TARGET_LABEL[target]} checklist complete — ${prog.failed} failed.`)
      : dim(`\n${prog.done}/${prog.total} checked. Skipped items stay open for later.`),
  );
}

// ── Step 3: extra findings ──────────────────────────────────────────────────

async function extraFindingsStep(deps: WizardDeps, session: AuditSession): Promise<void> {
  const { prompter: p, out, cwd } = deps;
  out(`\n${bold("Other findings")}`);
  out(dim("Anything not covered above — code review, BrowserStack, client-reported issues, etc."));

  for (;;) {
    const platforms =
      session.project.targets.length === 1
        ? session.project.targets
        : await p.checkbox<AuditTarget>(
            "Which platforms does this issue affect?",
            session.project.targets.map((t) => ({ name: TARGET_LABEL[t], value: t })),
            { required: true },
          );
    const source = await p.input("Where did it come from?", { default: "manual" });
    session.extraFindings.push(await captureFinding(deps, { platforms, source, rulePrefix: "manual" }));
    saveSession(cwd, session);
    if (!(await p.confirm("Add another finding?", { default: false }))) break;
  }
}

// ── Step 4: report ──────────────────────────────────────────────────────────

async function reportStep(deps: WizardDeps, session: AuditSession): Promise<void> {
  const { prompter: p, out, cwd, env } = deps;

  const open = session.project.targets
    .map((t) => ({ t, prog: checklistProgress(session, t) }))
    .filter(({ prog }) => prog.done < prog.total);
  if (open.length > 0) {
    out(`\n${bold("Heads up:")} the manual checklist isn't finished:`);
    for (const { t, prog } of open) out(`  ${TARGET_LABEL[t]}: ${prog.total - prog.done} check(s) left`);
    if (!(await p.confirm("Generate a draft report anyway?", { default: true }))) return;
  }

  const { assessment, markdown, json } = writeReports(cwd, session);
  out(`\n${formatConsole(assessment)}\n`);
  out(green(`✓ Report written:`));
  out(`  ${markdown}`);
  out(`  ${json}`);

  if (assessment.findings.length === 0 || !deps.createJiraTickets) return;
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY } = env;
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN || !JIRA_PROJECT_KEY) {
    out(dim("\nTo file Jira tickets from here, set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY."));
    return;
  }
  if (!(await p.confirm(`File Jira tickets in ${JIRA_PROJECT_KEY}?`, { default: false }))) return;
  const minSeverity = await p.select<Severity>("Only file tickets at or above:", SEVERITY_CHOICES, { default: "high" });
  try {
    const created = await deps.createJiraTickets(assessment, minSeverity);
    out(green(`\n✓ Created ${created.length} Jira ticket(s):`));
    for (const t of created) out(`  ${t.key} — ${t.finding.title}`);
  } catch (err) {
    out(red(`Jira failed: ${message(err)}`));
  }
}

// ── Finding capture ─────────────────────────────────────────────────────────

async function captureFinding(
  deps: WizardDeps,
  ctx: { platforms: AuditTarget[]; source: string; item?: ChecklistItem; rulePrefix?: string },
): Promise<Finding> {
  const { prompter: p } = deps;
  const { item } = ctx;
  const isWeb = ctx.platforms.length === 1 && ctx.platforms[0] === "web";

  const title = await p.input("Issue title:", { default: item?.title, required: true });
  const where = await p.input(isWeb ? "Page / URL where it happens:" : "Screen / flow where it happens:", {
    required: true,
  });
  const description = await p.input("What happens? (what you heard/saw vs. what you expected)", {
    required: true,
  });
  const severity = await p.select("Severity:", SEVERITY_CHOICES, { default: item?.severity ?? "medium" });

  let wcagIds = item?.wcag ?? [];
  if (!item) {
    const raw = await p.input("WCAG criteria (comma-separated, e.g. 1.1.1, 4.1.2; blank if unsure):", {
      validate: (v) => {
        const unknown = splitList(v).filter((id) => !WCAG[id]);
        return unknown.length === 0 ? true : `Unknown criteria: ${unknown.join(", ")}`;
      },
    });
    wcagIds = splitList(raw);
  }
  const category = item?.category ?? (await p.select("Category:", CATEGORY_CHOICES, { default: "Semantics" }));
  const remediation = await p.input("Suggested fix (optional):");
  const screenshot = await p.input("Screenshot / recording path (optional):");

  const evidence: Record<string, unknown> = { [isWeb ? "page" : "screen"]: where };
  if (screenshot) evidence.screenshot = screenshot;

  return {
    ruleId: item ? `manual:${item.id}` : `${ctx.rulePrefix ?? "manual"}:${slug(title)}`,
    title,
    description,
    severity,
    wcag: wcagIds.map((id) => WCAG[id]!),
    nodeId: where,
    platforms: ctx.platforms,
    category,
    source: ctx.source,
    ...(remediation ? { remediation } : {}),
    evidence,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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
  if (existsSync(join(cwd, "pubspec.yaml"))) return "flutter";
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as Record<string, Record<string, string>>;
    if (pkg.dependencies?.["react-native"] || pkg.devDependencies?.["react-native"]) return "react-native";
  } catch {
    // Not a JS project.
  }
  if (existsSync(join(cwd, "ios")) || existsSync(join(cwd, "android"))) return "native";
  return "unknown";
}

function splitList(value: string): string[] {
  return value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "finding";
}

function count(findings: Finding[]): string {
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function statusIcon(s: "pass" | "fail" | "na"): string {
  return s === "pass" ? green("✓") : s === "fail" ? red("✗") : dim("–");
}

function status(done: boolean, text: string): string {
  return done ? green(`✓ ${text}`) : dim(`(${text})`);
}

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const ansi = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = ansi("1");
const dim = ansi("2");
const green = ansi("32");
const red = ansi("31");
