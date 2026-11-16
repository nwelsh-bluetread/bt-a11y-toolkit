/**
 * keyboard-summary.md: every check the keyboard runner did, per page and
 * workflow, as Pass / Fail / Not checked. A check fails exactly when the
 * analyzer produced a finding for it, so this file and the checklist agree.
 */
import type { Finding } from "../types.js";
import { analyzeKeyboard } from "./analyze.js";
import type { KbResult, KbStep } from "./results.js";

export type CheckStatus = "pass" | "fail" | "not-checked";

export interface CheckResult {
  id: string;
  title: string;
  wcag: string;
  status: CheckStatus;
  detail: string;
}

interface CheckDef {
  id: string;
  title: string;
  wcag: string;
  /** Finding rules that fail this check. */
  rules: string[];
  /** Pass detail, or undefined when the check didn't apply to this result. */
  passed: (r: KbResult, steps: KbStep[]) => string | undefined;
}

const tabRuns = (steps: KbStep[]) => steps.flatMap((s) => (s.tab ? [s.tab] : []));
const stops = (steps: KbStep[]) => tabRuns(steps).flatMap((t) => t.stops);
/** Full Tab-throughs (`tab: "all"` and page runs): the only ones that can show loops or unreached controls. */
const fullRuns = (steps: KbStep[]) => tabRuns(steps).filter((t) => t.stopped !== "count" && t.stopped !== "limit");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** In the order a tester works through them. */
export const CHECKS: CheckDef[] = [
  {
    id: "focus-indicator",
    title: "Visible focus indicator",
    wcag: "2.4.7",
    rules: ["kb-no-focus-indicator"],
    passed: (_r, steps) => {
      const all = stops(steps);
      const measured = all.filter((s) => s.indicator !== "unknown");
      if (measured.length === 0) return undefined;
      const unknown = all.length - measured.length;
      return `${measured.length} of ${plural(all.length, "stop")} look different when focused${unknown ? ` (${unknown} couldn't be measured: zero size)` : ""}`;
    },
  },
  {
    id: "focus-not-obscured",
    title: "Focus not hidden behind other content",
    wcag: "2.4.11",
    rules: ["kb-focus-obscured"],
    passed: (_r, steps) => (stops(steps).length ? `None of ${plural(stops(steps).length, "stop")} fully covered` : undefined),
  },
  {
    id: "focus-order",
    title: "Tab order follows the reading order",
    wcag: "2.4.3",
    rules: ["kb-focus-order", "kb-positive-tabindex"],
    passed: (_r, steps) => (stops(steps).length > 1 ? "Never jumps back up the page; no positive tabindex" : undefined),
  },
  {
    id: "no-trap",
    title: "No keyboard trap",
    wcag: "2.1.2",
    rules: ["kb-keyboard-trap", "kb-dialog-escape"],
    passed: (_r, steps) => {
      const runs = fullRuns(steps);
      const escapes = steps.filter((s) => s.escape);
      if (runs.length === 0 && escapes.length === 0) return undefined;
      const how = runs.map((t) => (t.stopped === "wrapped" ? "Tab wrapped back to the first control" : "Tab left the page"));
      return [...new Set(how), ...(escapes.length ? ["Escape closed the dialog"] : [])].join("; ");
    },
  },
  {
    id: "all-reachable",
    title: "Every control reachable with Tab",
    wcag: "2.1.1",
    rules: ["kb-unreachable"],
    passed: (_r, steps) => (fullRuns(steps).length ? `All interactive elements reached (${plural(stops(steps).length, "stop")})` : undefined),
  },
  {
    id: "bypass",
    title: "Skip link or landmark to bypass repeated content",
    wcag: "2.4.1",
    rules: ["kb-skip-link-broken", "kb-no-bypass"],
    passed: (r) => {
      const s = r.skipLink;
      if (!s) return undefined;
      if (s.present) return `Skip link “${s.name}” works${s.position && s.position > 1 ? ` (but it's Tab stop ${s.position}, not the first)` : ""}`;
      return r.hasMain ? "No skip link, but the page has a main landmark" : `No skip link or main landmark, but only ${plural(stops(r.steps).length, "control")} on the page`;
    },
  },
  {
    id: "activate",
    title: "Enter/Space activate controls",
    wcag: "2.1.1",
    rules: ["kb-activate-nothing"],
    passed: (_r, steps) => {
      const n = steps.filter((s) => s.activated).length;
      return n ? `${plural(n, "control")} responded to the keyboard` : undefined;
    },
  },
  {
    id: "dialog-focus",
    title: "Dialogs take focus when they open",
    wcag: "2.4.3",
    rules: ["kb-dialog-focus"],
    passed: (_r, steps) => {
      const n = steps.filter((s) => s.dialog).length;
      return n ? `Focus moved into ${plural(n, "dialog")}` : undefined;
    },
  },
  {
    id: "dialog-return",
    title: "Focus returns when a dialog closes",
    wcag: "2.4.3",
    rules: ["kb-dialog-focus-return"],
    passed: (_r, steps) => {
      const n = steps.filter((s) => s.escape?.closed).length;
      return n ? `Focus went back to the opener (${plural(n, "dialog")})` : undefined;
    },
  },
];

/** Every check for one page or workflow run. */
export function checkResults(result: KbResult, findings: Finding[] = analyzeKeyboard([{ result }])): CheckResult[] {
  const steps = result.steps;
  return CHECKS.map((c) => {
    const failed = findings.filter((f) => c.rules.includes(f.ruleId));
    if (failed.length) return { id: c.id, title: c.title, wcag: c.wcag, status: "fail", detail: failed.map((f) => `${f.title}${which(f, steps)}`).join("; ") };
    if (result.error && steps.length === 0) return { id: c.id, title: c.title, wcag: c.wcag, status: "not-checked", detail: `Couldn't run: ${result.error}` };
    const pass = c.passed(result, steps);
    return pass === undefined
      ? { id: c.id, title: c.title, wcag: c.wcag, status: "not-checked", detail: notCheckedWhy(c.id, result) }
      : { id: c.id, title: c.title, wcag: c.wcag, status: "pass", detail: pass };
  });
}

const named = (el: { role: string; name: string }) => (el.name ? `${el.role} “${el.name}”` : `${el.role} (no name)`);

/** The elements a failed check is about, e.g. ` (button “Save”, link “Help”)`. */
function which(f: Finding, steps: KbStep[]): string {
  const els =
    f.ruleId === "kb-no-focus-indicator"
      ? stops(steps).filter((s) => s.indicator === "none")
      : f.ruleId === "kb-focus-obscured"
        ? stops(steps).filter((s) => s.obscured)
        : f.ruleId === "kb-unreachable"
          ? tabRuns(steps).flatMap((t) => t.unreached)
          : f.ruleId === "kb-positive-tabindex"
            ? stops(steps).filter((s) => s.tabindex !== undefined && s.tabindex > 0)
            : [];
  if (els.length) return `: ${els.slice(0, 5).map(named).join(", ")}${els.length > 5 ? ` and ${els.length - 5} more` : ""}`;
  return f.nodeId ? ` (${f.nodeId})` : "";
}

function notCheckedWhy(id: string, r: KbResult): string {
  if (["activate", "dialog-focus", "dialog-return"].includes(id)) {
    return r.kind === "page" ? "Only checked in workflows (the page run doesn't activate anything)" : "This workflow didn't activate a control / open or close a dialog";
  }
  if (id === "bypass") return "Only checked on page runs";
  if (r.kind === "workflow") return "This workflow didn't Tab through the page";
  return "No Tab stops to check";
}

const ICON: Record<CheckStatus, string> = { pass: "✅ Pass", fail: "❌ Fail", "not-checked": "– Not checked" };
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function label(r: KbResult): string {
  if (r.kind === "workflow") return `Workflow: ${r.name}`;
  try {
    const u = new URL(r.url);
    return u.protocol === "file:" ? u.pathname.split("/").at(-1)! : `${u.pathname}${u.search}` || "/";
  } catch {
    return r.url;
  }
}

/** The whole summary, from every saved result. */
export function formatKeyboardSummary(results: Array<{ result: KbResult; file?: string }>, project?: string): string {
  const rows = results.map(({ result, file }) => ({ result, file, checks: checkResults(result) }));
  const all = rows.flatMap((r) => r.checks);
  const count = (s: CheckStatus) => all.filter((c) => c.status === s).length;
  const pages = rows.filter((r) => r.result.kind === "page").length;
  const ran = rows.map((r) => r.result.ranAt).sort().at(-1);

  const out = [
    `# Keyboard test results${project ? ` — ${project}` : ""}`,
    "",
    `${plural(pages, "page")} · ${plural(rows.length - pages, "workflow")}${ran ? ` · last run ${ran.slice(0, 16).replace("T", " ")} UTC` : ""}`,
    "",
    `**${count("pass")} passed · ${count("fail")} failed · ${count("not-checked")} not checked**`,
    "",
    "Automated keyboard checks (headless browser, no screen reader). A **Fail** is a lead to confirm on the checklist: " +
      "mark the line Fail to keep it in the report, Pass/N/A to dismiss it. A **Pass** means the automated check found nothing; " +
      "it doesn't replace testing by hand (whether the order makes sense, whether the focus indicator has enough contrast).",
    "",
    "## By check",
    "",
    "| Check | WCAG | Passed | Failed | Not checked |",
    "| --- | --- | ---: | ---: | ---: |",
    ...CHECKS.map((c) => {
      const these = all.filter((x) => x.id === c.id);
      const n = (s: CheckStatus) => these.filter((x) => x.status === s).length;
      return `| ${c.title} | ${c.wcag} | ${n("pass")} | ${n("fail")} | ${n("not-checked")} |`;
    }),
  ];

  for (const { result, file, checks } of rows) {
    out.push("", `## ${label(result)}`, "", result.url + (file ? ` · results: \`${file}\`` : ""));
    if (result.error) out.push("", `> ⚠ The run hit an error: ${result.error}`);
    out.push("", "| Check | WCAG | Result | Details |", "| --- | --- | --- | --- |");
    for (const c of checks) out.push(`| ${c.title} | ${c.wcag} | ${ICON[c.status]} | ${cell(c.detail)} |`);
  }
  return out.join("\n") + "\n";
}
