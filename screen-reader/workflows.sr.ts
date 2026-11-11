// Runs every workflow in screen-reader/workflows/ with real VoiceOver and saves
// a transcript per workflow to reports/screen-reader/<workflow>.json.
//
// `expect` checks are soft: failures are listed at the end, but every step
// still runs and the transcript always covers the whole workflow.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { voiceOverTest as test, type VoiceOverPlaywright } from "@guidepup/playwright";
import { expect, type Page } from "@playwright/test";
import { describeStep, FIND_COMMANDS, loadWorkflows, stepAction, stripHints, type WorkflowStep } from "./workflow.ts";

const workflows = loadWorkflows(join(import.meta.dirname, "workflows"));
const outDir = join(import.meta.dirname, "..", "reports", "screen-reader");
const MAX_ITEMS = 200;

interface Spoken {
  /** What VoiceOver said, without its usage hints. */
  spoken: string;
  /** The item under the VoiceOver cursor afterwards. */
  item: string;
}

interface TranscriptStep {
  step: number;
  action: string;
  /** One entry per VoiceOver move (a `read` or `next` step has several). */
  output: Spoken[];
  expect?: string;
  passed?: boolean;
  error?: string;
}

// Capture full announcements so late ones (role="alert", live regions) are recorded.
test.use({ voiceOverStartOptions: { capture: true } });

async function heard(voiceOver: VoiceOverPlaywright): Promise<Spoken> {
  return { spoken: stripHints(await voiceOver.lastSpokenPhrase()), item: await voiceOver.itemText() };
}

async function runStep(step: WorkflowStep, page: Page, voiceOver: VoiceOverPlaywright): Promise<Spoken[]> {
  const s = step as Record<string, unknown>;
  switch (stepAction(step)) {
    case "read": {
      // Move until VoiceOver stops advancing (the end of the page).
      const out: Spoken[] = [];
      let repeats = 0;
      for (let i = 0; i < MAX_ITEMS && repeats < 2; i++) {
        const before = await voiceOver.itemText();
        await voiceOver.next();
        const now = await heard(voiceOver);
        repeats = now.item === before ? repeats + 1 : 0;
        if (repeats === 0) out.push(now);
      }
      return out;
    }
    case "next": {
      const out: Spoken[] = [];
      for (let i = 0; i < (s.next as number); i++) {
        await voiceOver.next();
        out.push(await heard(voiceOver));
      }
      return out;
    }
    case "find":
      await voiceOver.perform(voiceOver.keyboardCommands[FIND_COMMANDS[s.find as keyof typeof FIND_COMMANDS]]);
      return [await heard(voiceOver)];
    case "focus":
      await page.locator(s.focus as string).first().focus();
      await page.waitForTimeout(500);
      return [await heard(voiceOver)];
    case "type":
      if (s.into) await page.locator(s.into as string).first().focus();
      await voiceOver.type(s.type as string);
      return [await heard(voiceOver)];
    case "press":
      await voiceOver.press(s.press as string);
      return [await heard(voiceOver)];
    case "activate":
      if (s.activate !== true) await page.locator(s.activate as string).first().focus();
      await voiceOver.act();
      await page.waitForTimeout(1000);
      return [await heard(voiceOver)];
    case "wait":
      await page.waitForTimeout(s.wait as number);
      return [await heard(voiceOver)];
  }
}

for (const wf of workflows) {
  test(wf.name, async ({ page, voiceOver }) => {
    const steps: TranscriptStep[] = [];
    try {
      await page.goto(wf.url, { waitUntil: "load" });
      await voiceOver.navigateToWebContent();
      steps.push({ step: 0, action: "start", output: [await heard(voiceOver)] });

      for (const [i, step] of wf.steps.entries()) {
        const entry: TranscriptStep = { step: i + 1, action: describeStep(step), output: [] };
        steps.push(entry);
        try {
          entry.output = await runStep(step, page, voiceOver);
        } catch (err) {
          // Note the failure and carry on with the next step.
          entry.error = err instanceof Error ? err.message.split("\n")[0] : String(err);
        }
        if (step.expect !== undefined) {
          const said = entry.output.map((o) => o.spoken).join(" ");
          entry.expect = step.expect;
          entry.passed = said.toLowerCase().includes(step.expect.toLowerCase());
          expect.soft(said, `step ${i + 1} (${entry.action}) should announce "${step.expect}"`).toContain(step.expect);
        }
        if (entry.error) expect.soft(entry.error, `step ${i + 1} (${entry.action}) failed`).toBe("");
      }
    } finally {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, `${wf.id}.json`), JSON.stringify({ workflow: wf.name, url: wf.url, steps }, null, 2));
      console.log(`\n${wf.name}\n` + steps.map(printStep).join("\n"));
    }
  });
}

function printStep(s: TranscriptStep): string {
  const head = `${String(s.step).padStart(2)}. [${s.action}]`;
  const lines = s.output.map((o) => `      ${o.spoken || "(silent)"}`);
  if (s.expect !== undefined) lines.push(`      ${s.passed ? "✓" : "✗"} expected "${s.expect}"`);
  if (s.error) lines.push(`      ⚠ ${s.error}`);
  return [head, ...lines].join("\n");
}
