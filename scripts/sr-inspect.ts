#!/usr/bin/env node
/**
 * Print what a screen reader workflow can target on a page: the accessibility
 * tree (roughly what VoiceOver will read) and every focusable control with a
 * selector that matches exactly one element. Used by the sr-workflow skill.
 *
 * Usage:
 *   npm run sr:inspect -- https://example.com/login
 *   npm run sr:inspect -- ./screen-reader/fixtures/login.html
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";
import { srCommand } from "../src/screen-reader/paths.js";
import { applySession } from "../screen-reader/session.js";

interface Control {
  tag: string;
  role: string;
  name: string;
  candidates: string[];
}

/** Candidate selectors for each focusable control, most stable first. */
function collectControls(page: Page): Promise<Control[]> {
  return page.evaluate(() => {
    const css = (v: string) => CSS.escape(v);
    const quote = (v: string) => JSON.stringify(v);
    const focusable = Array.from(
      document.querySelectorAll<HTMLElement>(
        'a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), [contenteditable=""], [contenteditable=true], [role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=menuitem], [role=combobox], [role=slider]',
      ),
    ).filter((el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0);

    return focusable.map((el) => {
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute("type");
      const implicitRole: Record<string, string> = { a: "link", button: "button", select: "combobox", textarea: "textbox", summary: "button" };
      const inputRole: Record<string, string> = { checkbox: "checkbox", radio: "radio", submit: "button", button: "button", reset: "button", range: "slider", search: "searchbox" };
      const role = el.getAttribute("role") ?? (tag === "input" ? (inputRole[type ?? ""] ?? "textbox") : (implicitRole[tag] ?? tag));
      const labels = (el as HTMLInputElement).labels ? Array.from((el as HTMLInputElement).labels ?? []).map((l) => l.textContent ?? "") : [];
      const name = (
        el.getAttribute("aria-label") ||
        (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim() ||
        labels.join(" ").trim() ||
        (el as HTMLInputElement).value?.toString() ||
        el.textContent ||
        el.getAttribute("title") ||
        el.getAttribute("placeholder") ||
        ""
      ).replace(/\s+/g, " ").trim();

      const candidates: string[] = [];
      if (el.id) candidates.push(`#${css(el.id)}`);
      const testId = el.getAttribute("data-testid");
      if (testId) candidates.push(`[data-testid=${quote(testId)}]`);
      const nameAttr = el.getAttribute("name");
      if (nameAttr) candidates.push(`${tag}[name=${quote(nameAttr)}]`);
      if (name) candidates.push(`role=${role}[name=${quote(name)}]`);
      if (type) candidates.push(`${tag}[type=${quote(type)}]`);
      return { tag, role, name, candidates };
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const sessionIdx = args.indexOf("--session");
  const session = sessionIdx >= 0 ? args.splice(sessionIdx, 2)[1] : undefined;
  const target = args[0];
  if (!target) {
    console.error(`Usage: ${srCommand("inspect")} <url or local html file> [--session <name>]`);
    process.exit(1);
  }
  const url = /^[a-z]+:\/\//i.test(target) ? target : existsSync(target) ? pathToFileURL(resolve(target)).href : `https://${target}`;

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    if (session) await applySession(context, session);
    const page = await context.newPage();
    // tsx wraps named functions in `__name(...)`; define it in the page so evaluate() works.
    await page.addInitScript("window.__name = (fn) => fn");
    await page.goto(url, { waitUntil: "load" });
    // Single-page apps render after "load"; give them a moment.
    await page.waitForLoadState("networkidle").catch(() => {});

    console.log(`# ${await page.title()}\n${page.url()}\n`);
    console.log("## Accessibility tree (roughly what VoiceOver reads, in order)\n");
    console.log(await page.locator("body").ariaSnapshot());

    console.log("\n## Focusable controls, in DOM order\n");
    const controls = await collectControls(page);
    for (const [i, c] of controls.entries()) {
      // Keep only selectors that match exactly this one element.
      let selector = "";
      for (const candidate of c.candidates) {
        if ((await page.locator(candidate).count().catch(() => 0)) === 1) {
          selector = candidate;
          break;
        }
      }
      console.log(`${String(i + 1).padStart(3)}. ${c.role} "${c.name || "(no name)"}"  →  ${selector || "(no unique selector)"}`);
    }
    if (controls.length === 0) console.log("(none)");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
