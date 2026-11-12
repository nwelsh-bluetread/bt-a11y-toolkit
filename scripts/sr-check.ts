#!/usr/bin/env node
/**
 * Validate the screen reader workflows in screen-reader/workflows/ without
 * starting VoiceOver: JSON shape, step names, and (with --selectors) that each
 * selector matches an element on its page.
 *
 * Usage:
 *   npm run sr:check
 *   npm run sr:check -- --selectors
 */
import { screenReaderPaths } from "../src/screen-reader/paths.js";
import { applySession } from "../screen-reader/session.js";
import { describeStep, loadWorkflows, stepAction } from "../screen-reader/workflow.js";

async function main() {
  const workflows = loadWorkflows(screenReaderPaths().workflows);
  console.log(`${workflows.length} workflow(s) valid.`);
  if (!process.argv.includes("--selectors")) return;

  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  let problems = 0;
  try {
    for (const wf of workflows) {
      const context = await browser.newContext();
      if (wf.session) await applySession(context, wf.session);
      const page = await context.newPage();
      await page.goto(wf.url, { waitUntil: "load" });
      for (const [i, step] of wf.steps.entries()) {
        const s = step as Record<string, unknown>;
        const action = stepAction(step);
        if (action === "goto") await page.goto(new URL(s.goto as string, page.url()).href, { waitUntil: "load" });
        const selector = action === "focus" ? s.focus : action === "activate" && s.activate !== true ? s.activate : action === "type" ? s.into : undefined;
        if (typeof selector !== "string") continue;
        const count = await page.locator(selector).count().catch(() => -1);
        if (count !== 1) {
          problems++;
          console.log(`✗ ${wf.id}, step ${i + 1} (${describeStep(step)}): selector matches ${count < 0 ? "nothing (invalid)" : `${count} elements`}`);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  // Steps after a form submit or click may target elements that only appear then.
  console.log(problems ? `\n${problems} selector problem(s). Elements that only appear after an earlier step are expected to show here.` : "All selectors match one element.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
