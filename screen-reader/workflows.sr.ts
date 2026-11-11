// Runs every workflow in screen-reader/workflows/ with real VoiceOver and saves
// a transcript per workflow to reports/screen-reader/<workflow>.json.
// `bt-a11y screen-reader` turns those transcripts into findings for review.
//
// `expect` checks are soft: failures are listed at the end, but every step
// still runs and the transcript always covers the whole workflow.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { voiceOverTest as test, type VoiceOverPlaywright } from "@guidepup/playwright";
import { expect, type Page } from "@playwright/test";
import type { FocusedControl, Spoken, TabSummary, Transcript, TranscriptStep } from "../src/screen-reader/transcript.ts";
import { applySession } from "./session.ts";
import { describeStep, FIND_COMMANDS, loadWorkflows, stepAction, stripHints, type WorkflowStep } from "./workflow.ts";

const workflows = loadWorkflows(join(import.meta.dirname, "workflows"));
const outDir = join(import.meta.dirname, "..", "reports", "screen-reader");
const MAX_ITEMS = 200;

/** Elements a keyboard user should be able to reach with Tab. */
const INTERACTIVE =
  'a[href], button, input:not([type=hidden]), select, textarea, summary, [contenteditable=""], [contenteditable=true], [role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=menuitem], [role=combobox], [role=slider]';

// Capture full announcements so late ones (role="alert", live regions) are recorded.
test.use({ voiceOverStartOptions: { capture: true } });

interface StepResult {
  output: Spoken[];
  tab?: TabSummary;
}

/** Role, name and states of an element, from the accessibility tree Playwright computes. */
async function describeElement(page: Page, selector: string): Promise<FocusedControl | undefined> {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return undefined;
  const first = (await el.ariaSnapshot().catch(() => "")).split("\n")[0] ?? "";
  const m = /^- ([\w-]+)(?: "((?:[^"\\]|\\.)*)")?(.*)$/.exec(first.trim());
  const info = await el.evaluate((node) => ({
    tag: node.tagName.toLowerCase(),
    href: node instanceof HTMLAnchorElement ? node.href : undefined,
    tabindex: node.hasAttribute("tabindex") ? Number(node.getAttribute("tabindex")) : undefined,
    domIndex: Array.prototype.indexOf.call(document.querySelectorAll("*"), node),
  }));
  return {
    role: m?.[1] ?? info.tag,
    name: (m?.[2] ?? "").replace(/\\"/g, '"'),
    states: [...(m?.[3] ?? "").matchAll(/\[([\w-]+)(?:=[^\]]*)?\]/g)].map((x) => x[1]!),
    ...info,
  };
}

/** Mark the focused element with a stable id; null when focus isn't in the page. */
function markFocus(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!document.hasFocus() || !el || el === document.body) return null;
    if (!el.hasAttribute("data-sr-tab")) el.setAttribute("data-sr-tab", String(document.querySelectorAll("[data-sr-tab]").length + 1));
    return el.getAttribute("data-sr-tab");
  });
}

async function heard(voiceOver: VoiceOverPlaywright, page?: Page): Promise<Spoken> {
  const out: Spoken = { spoken: stripHints(await voiceOver.lastSpokenPhrase()), item: await voiceOver.itemText() };
  if (page) {
    const id = await markFocus(page).catch(() => null);
    const focus = id ? await describeElement(page, `[data-sr-tab="${id}"]`).catch(() => undefined) : undefined;
    if (focus) out.focus = focus;
  }
  return out;
}

/** Visible, enabled interactive elements Tab never landed on. */
async function unreached(page: Page): Promise<FocusedControl[]> {
  const count = await page.evaluate((selector) => {
    let n = 0;
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (el.hasAttribute("data-sr-tab") || el.hasAttribute("disabled") || el.getClientRects().length === 0) continue;
      if (el.closest("[aria-hidden=true], [inert]")) continue;
      el.setAttribute("data-sr-unreached", String(n++));
    }
    return n;
  }, INTERACTIVE);
  const out: FocusedControl[] = [];
  for (let i = 0; i < Math.min(count, 30); i++) {
    const c = await describeElement(page, `[data-sr-unreached="${i}"]`);
    if (c) out.push(c);
  }
  return out;
}

/**
 * Focus an element from code and bring the VoiceOver cursor along. VoiceOver
 * doesn't follow focus set by script, and Guidepup only records speech that
 * follows its own commands, so without VO+Shift+F4 the step hears nothing and
 * VO+Space would act on whatever the VoiceOver cursor was on before.
 */
async function focusWithCursor(page: Page, voiceOver: VoiceOverPlaywright, selector: string): Promise<void> {
  await page.locator(selector).first().focus();
  await page.waitForTimeout(300);
  await voiceOver.perform(voiceOver.keyboardCommands.moveCursorToKeyboardFocus);
}

/** `output` is filled as the step goes, so a step that fails partway still keeps what VoiceOver said. */
async function runStep(step: WorkflowStep, page: Page, voiceOver: VoiceOverPlaywright, output: Spoken[]): Promise<StepResult> {
  const s = step as Record<string, unknown>;
  switch (stepAction(step)) {
    case "read": {
      // Move until VoiceOver stops advancing (the end of the page).
      let repeats = 0;
      for (let i = 0; i < MAX_ITEMS && repeats < 2; i++) {
        const before = await voiceOver.itemText();
        await voiceOver.next();
        const now = await heard(voiceOver);
        repeats = now.item === before ? repeats + 1 : 0;
        if (repeats === 0) output.push(now);
      }
      return { output };
    }
    case "next": {
      for (let i = 0; i < (s.next as number); i++) {
        await voiceOver.next();
        output.push(await heard(voiceOver));
      }
      return { output };
    }
    case "tab": {
      // `all` stops when focus leaves the page or comes back to a control already visited.
      const all = s.tab === "all";
      const limit = all ? MAX_ITEMS : (s.tab as number);
      const seen = new Set<string>();
      let stopped: TabSummary["stopped"] = all ? "limit" : "count";
      for (let i = 0; i < limit; i++) {
        await voiceOver.press("Tab");
        const id = await markFocus(page);
        if (all && id === null) { stopped = "left-page"; break; }
        if (all && seen.has(id!)) { stopped = "repeated"; break; }
        if (id) seen.add(id);
        output.push(await heard(voiceOver, page));
      }
      return { output, tab: { stopped, unreached: all ? await unreached(page) : [] } };
    }
    case "goto":
      await page.goto(new URL(s.goto as string, page.url()).href, { waitUntil: "load" });
      await voiceOver.navigateToWebContent();
      return { output: [await heard(voiceOver)] };
    case "find":
      await voiceOver.perform(voiceOver.keyboardCommands[FIND_COMMANDS[s.find as keyof typeof FIND_COMMANDS]]);
      return { output: [await heard(voiceOver)] };
    case "focus":
      await focusWithCursor(page, voiceOver, s.focus as string);
      return { output: [await heard(voiceOver, page)] };
    case "type":
      if (s.into) await focusWithCursor(page, voiceOver, s.into as string);
      await voiceOver.type(s.type as string);
      return { output: [await heard(voiceOver, page)] };
    case "press":
      await voiceOver.press(s.press as string);
      return { output: [await heard(voiceOver, page)] };
    case "activate":
      if (s.activate !== true) await focusWithCursor(page, voiceOver, s.activate as string);
      await voiceOver.act();
      await page.waitForTimeout(1000);
      return { output: [await heard(voiceOver, page)] };
    case "wait":
      await page.waitForTimeout(s.wait as number);
      return { output: [await heard(voiceOver)] };
  }
}

for (const wf of workflows) {
  test(wf.name, async ({ page, voiceOver }) => {
    const transcript: Transcript = { version: 1, workflow: wf.name, url: wf.url, ranAt: new Date().toISOString(), steps: [] };
    const steps = transcript.steps;
    try {
      if (wf.session) await applySession(page.context(), wf.session);
      await page.goto(wf.url, { waitUntil: "load" });
      await voiceOver.navigateToWebContent();
      steps.push({ step: 0, action: "start", kind: "start", url: page.url(), output: [await heard(voiceOver)] });

      for (const [i, step] of wf.steps.entries()) {
        const entry: TranscriptStep = { step: i + 1, action: describeStep(step), kind: stepAction(step), url: page.url(), output: [] };
        steps.push(entry);
        try {
          const result = await runStep(step, page, voiceOver, entry.output);
          entry.output = result.output;
          if (result.tab) entry.tab = result.tab;
        } catch (err) {
          // Note the failure and carry on with the next step.
          entry.error = err instanceof Error ? err.message.split("\n")[0] : String(err);
        }
        if (step.expect !== undefined) {
          const said = entry.output.map((o) => o.spoken).join(" ");
          entry.expect = step.expect;
          entry.passed = said.toLowerCase().includes(step.expect.toLowerCase());
          if (step.wcag) entry.wcag = step.wcag;
          expect.soft(said, `step ${i + 1} (${entry.action}) should announce "${step.expect}"`).toContain(step.expect);
        }
        if (entry.error) expect.soft(entry.error, `step ${i + 1} (${entry.action}) failed`).toBe("");
      }
    } finally {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, `${wf.id}.json`), JSON.stringify(transcript, null, 2));
      console.log(`\n${wf.name}\n` + steps.map(printStep).join("\n"));
    }
  });
}

function printStep(s: TranscriptStep): string {
  const head = `${String(s.step).padStart(2)}. [${s.action}]`;
  const lines = s.output.map((o) => `      ${o.spoken || "(silent)"}`);
  if (s.expect !== undefined) lines.push(`      ${s.passed ? "✓" : "✗"} expected "${s.expect}"`);
  if (s.tab?.unreached.length) lines.push(`      ⚠ ${s.tab.unreached.length} control(s) never reached by Tab`);
  if (s.error) lines.push(`      ⚠ ${s.error}`);
  return [head, ...lines].join("\n");
}
