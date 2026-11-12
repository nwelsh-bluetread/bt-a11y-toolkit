/**
 * The keyboard runner: drives pages with the keyboard in a real browser
 * (Playwright, headless; no screen reader) and records what happened, for
 * analyze.ts to turn into findings.
 *
 * For each page: Tab through every control, checking each stop for a visible
 * focus indicator (focused vs. not focused, compared as screenshots and styles)
 * and whether something covers it; then the skip link; then the controls Tab
 * never reached. Saved screen reader workflows run too, minus their
 * VoiceOver-only steps: activating checks that something happened, dialogs
 * that open are checked for taking focus, and Escape for closing them and
 * returning focus.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, BrowserType, Page } from "playwright";
import { pageSlug } from "../screen-reader/baseline.js";
import { applySession } from "../screen-reader/sign-in.js";
import { describeStep, stepAction, type Workflow, type WorkflowStep } from "../screen-reader/workflow.js";
import type { KbElement, KbResult, KbStep, KbStop, KbTabRun } from "./results.js";

const MAX_STOPS = 150;
/** Room around an element for a focus ring drawn outside it (outline-offset, box-shadow). */
const RING = 8;

export type KeyboardProgress = (e: { type: "start" | "done" | "error"; name: string; index: number; total: number; error?: string }) => void;

export interface KeyboardRunOptions {
  /** Pages to Tab through. */
  pages: string[];
  /** Saved workflows to run with the keyboard. */
  workflows?: Workflow[];
  /** Saved sign-in for the pages (workflows use their own `session`). */
  signIn?: string;
  /** Where to save one result file per page/workflow. */
  outDir: string;
  onProgress?: KeyboardProgress;
}

/** Interactive elements a keyboard user should be able to reach. */
const INTERACTIVE =
  'a[href], button, input:not([type=hidden]), select, textarea, summary, [contenteditable=""], [contenteditable=true], [role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=menuitem], [role=combobox], [role=slider]';

// ── In-page helpers (passed as strings so bundlers can't rename or wrap them) ──

const PAGE_HELPERS = `
window.__kb = {
  role(el) {
    const tag = el.tagName.toLowerCase(), type = el.getAttribute("type");
    const implicit = { a: "link", button: "button", select: "combobox", textarea: "textbox", summary: "button", iframe: "iframe" };
    const input = { checkbox: "checkbox", radio: "radio", submit: "button", button: "button", reset: "button", range: "slider", search: "searchbox" };
    return el.getAttribute("role") || (tag === "input" ? input[type || ""] || "textbox" : implicit[tag] || tag);
  },
  name(el) {
    const by = (el.getAttribute("aria-labelledby") || "").split(/\\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
    const labels = el.labels ? Array.from(el.labels).map((l) => l.textContent || "").join(" ").trim() : "";
    const img = el.querySelector?.("img[alt]")?.getAttribute("alt") || "";
    return (el.getAttribute("aria-label") || by || labels || el.textContent || img || el.getAttribute("title") || el.getAttribute("placeholder") || el.value || "")
      .toString().replace(/\\s+/g, " ").trim().slice(0, 80);
  },
  describe(el) {
    const tabindex = el.getAttribute("tabindex");
    return {
      role: window.__kb.role(el),
      name: window.__kb.name(el),
      tag: el.tagName.toLowerCase(),
      domIndex: Array.prototype.indexOf.call(document.querySelectorAll("*"), el),
      ...(tabindex !== null && !isNaN(Number(tabindex)) ? { tabindex: Number(tabindex) } : {}),
    };
  },
  mark(el) {
    if (!el.hasAttribute("data-kb-id")) el.setAttribute("data-kb-id", String(document.querySelectorAll("[data-kb-id]").length + 1));
    return el.getAttribute("data-kb-id");
  },
  byId(id) { return document.querySelector('[data-kb-id="' + id + '"]'); },
  visible(el) {
    const s = getComputedStyle(el);
    return el.getClientRects().length > 0 && s.visibility !== "hidden" && s.display !== "none";
  },
  dialogs() {
    return Array.from(document.querySelectorAll("dialog[open], [role=dialog], [role=alertdialog]")).filter((d) => window.__kb.visible(d));
  },
};
`;

/** Counts DOM changes (ignoring the runner's own markers) so `activate` can tell whether anything happened. */
const MUTATION_COUNTER = `
window.__kbMutations = 0;
new MutationObserver((list) => {
  for (const m of list) if (!(m.type === "attributes" && (m.attributeName || "").startsWith("data-kb"))) window.__kbMutations++;
}).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
`;

interface Focused extends KbElement {
  id: string;
  rect: { x: number; y: number; width: number; height: number };
  obscured: boolean;
  inMain: boolean;
}

/** The focused element, or null when focus isn't in the page. */
function focused(page: Page): Promise<Focused | null> {
  return page.evaluate(() => {
    const kb = (window as unknown as { __kb: Record<string, (...a: unknown[]) => unknown> }).__kb;
    const el = document.activeElement as HTMLElement | null;
    if (!document.hasFocus() || !el || el === document.body || el === document.documentElement) return null;
    const r = el.getBoundingClientRect();
    // Covered = every sample point is off screen or topped by something that isn't the element (or inside it).
    const inset = Math.min(4, r.width / 4, r.height / 4);
    const points = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + inset, r.top + inset],
      [r.right - inset, r.top + inset],
      [r.left + inset, r.bottom - inset],
      [r.right - inset, r.bottom - inset],
    ];
    const obscured =
      r.width > 0 &&
      r.height > 0 &&
      points.every(([x, y]) => {
        const top = document.elementFromPoint(x!, y!);
        return !top || !(el === top || el.contains(top) || top.contains(el));
      });
    return {
      ...(kb.describe!(el) as KbElement),
      id: kb.mark!(el) as string,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      obscured,
      inMain: Boolean(el.closest("main, [role=main]")),
    };
  });
}

/** What changes when an element gets focus: compared focused vs. blurred. */
function styleOf(page: Page, id: string): Promise<string> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-kb-id="${id}"]`);
    if (!el) return "";
    const s = getComputedStyle(el);
    return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.outlineOffset, s.boxShadow, s.borderColor, s.borderWidth, s.backgroundColor, s.color, s.textDecorationLine].join("|");
  }, id);
}

async function shot(page: Page, rect: Focused["rect"]): Promise<Buffer | undefined> {
  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  const x = Math.max(0, rect.x - RING);
  const y = Math.max(0, rect.y - RING);
  const width = Math.min(vp.width, rect.x + rect.width + RING) - x;
  const height = Math.min(vp.height, rect.y + rect.height + RING) - y;
  if (width < 1 || height < 1) return undefined;
  return page.screenshot({ clip: { x, y, width, height }, animations: "disabled", caret: "hide" }).catch(() => undefined);
}

/** Focused vs. not focused: does anything look different? */
async function indicator(page: Page, f: Focused): Promise<KbStop["indicator"]> {
  if (f.rect.width < 1 || f.rect.height < 1) return "unknown";
  const [onShot, onStyle] = [await shot(page, f.rect), await styleOf(page, f.id)];
  await page.evaluate((id) => (document.querySelector(`[data-kb-id="${id}"]`) as HTMLElement | null)?.blur(), f.id);
  await page.waitForTimeout(120);
  const [offShot, offStyle] = [await shot(page, f.rect), await styleOf(page, f.id)];
  // Put focus back so the next Tab carries on from here.
  await page.evaluate((id) => (document.querySelector(`[data-kb-id="${id}"]`) as HTMLElement | null)?.focus({ preventScroll: true }), f.id);
  await page.waitForTimeout(60);
  if (!onShot || !offShot) return onStyle !== offStyle ? "visible" : "unknown";
  return onStyle !== offStyle || !onShot.equals(offShot) ? "visible" : "none";
}

const strip = ({ id: _id, rect: _rect, obscured: _o, inMain: _m, ...el }: Focused): KbElement => el;

async function tabThrough(page: Page, count: number | "all"): Promise<KbTabRun> {
  const all = count === "all";
  const limit = all ? MAX_STOPS : count;
  const stops: KbStop[] = [];
  const seen = new Map<string, number>();
  let stopped: KbTabRun["stopped"] = all ? "limit" : "count";
  let lastId: string | undefined;
  for (let presses = 0; stops.length < limit && presses < limit * 3; presses++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(80);
    const f = await focused(page);
    if (!f) {
      if (all) {
        stopped = "left-page";
        break;
      }
      continue;
    }
    // Tabbing inside an iframe keeps the iframe as the page's focused element.
    if (f.id === lastId && f.tag === "iframe") continue;
    lastId = f.id;
    if (all && seen.has(f.id)) {
      stopped = seen.get(f.id) === 0 ? "wrapped" : "repeated";
      break;
    }
    seen.set(f.id, stops.length);
    stops.push({ ...strip(f), indicator: await indicator(page, f), obscured: f.obscured, inMain: f.inMain });
  }
  return { stops, stopped, unreached: all ? await unreached(page) : [] };
}

async function unreached(page: Page): Promise<KbElement[]> {
  return page.evaluate((selector) => {
    const kb = (window as unknown as { __kb: Record<string, (...a: unknown[]) => unknown> }).__kb;
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter(
        (el) =>
          !el.hasAttribute("data-kb-id") &&
          !el.hasAttribute("disabled") &&
          el.getAttribute("aria-disabled") !== "true" &&
          (kb.visible!(el) as boolean) &&
          !el.closest("[aria-hidden=true], [inert]") &&
          !(el.closest("details:not([open])") && el.tagName !== "SUMMARY"),
      )
      .slice(0, 30)
      .map((el) => kb.describe!(el) as KbElement);
  }, INTERACTIVE);
}

/** Tab from the top (up to 3 stops) for a skip link, then check it moves focus to (or past) its target. */
async function skipLinkTest(page: Page): Promise<KbResult["skipLink"]> {
  let first: { name: string; target: string } | null = null;
  let position = 0;
  for (; position < 3 && !first; position++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(80);
    first = await page.evaluate(() => {
      const el = document.activeElement as HTMLAnchorElement | null;
      if (!el || el.tagName !== "A") return null;
      const href = el.getAttribute("href") ?? "";
      const name = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      return href.length > 1 && href.startsWith("#") && /skip|main|content|jump/i.test(`${name} ${el.getAttribute("aria-label") ?? ""}`) ? { name, target: href.slice(1) } : null;
    });
  }
  if (!first) return { present: false };
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const inTarget = (afterTab: boolean) =>
    page.evaluate(
      ({ target, afterTab }) => {
        const t = document.getElementById(target) ?? document.getElementsByName(target)[0];
        const a = document.activeElement;
        if (!t || !a) return false;
        if (t === a || t.contains(a)) return true;
        // After one more Tab, focus should land after the start of the target.
        return afterTab && Boolean(t.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
      },
      { target: first.target, afterTab },
    );
  let works = await inTarget(false);
  if (!works) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(80);
    works = await inTarget(true);
  }
  return { present: true, name: first.name, works, position };
}

async function open(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load" });
  // Single-page apps render after "load"; give them a moment.
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  return page;
}

async function newContext(browser: Browser, signIn?: string): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  if (signIn) await applySession(context, signIn);
  // tsx/esbuild may wrap functions in __name(); define it so evaluate() works under them.
  await context.addInitScript("window.__name = (fn) => fn");
  await context.addInitScript(PAGE_HELPERS);
  await context.addInitScript(MUTATION_COUNTER);
  return context;
}

export async function runPage(browser: Browser, url: string, signIn?: string): Promise<KbResult> {
  const result: KbResult = { version: 1, kind: "page", name: url, url, ranAt: new Date().toISOString(), steps: [] };
  const context = await newContext(browser, signIn);
  try {
    const page = await open(context, url);
    result.url = page.url();
    result.hasMain = await page.evaluate(() => Boolean(document.querySelector("main, [role=main]")));
    result.steps.push({ step: 1, action: "tab through all controls", kind: "tab", url: page.url(), tab: await tabThrough(page, "all") });
    // A fresh load for the skip link, so the Tab-through's focus changes don't affect it.
    await page.goto(url, { waitUntil: "load" });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    result.skipLink = await skipLinkTest(page);
  } catch (err) {
    result.error = err instanceof Error ? err.message.split("\n")[0] : String(err);
  } finally {
    await context.close();
  }
  return result;
}

/** The focused element (marked), for activate/Escape bookkeeping. */
async function current(page: Page): Promise<(KbElement & { id: string }) | undefined> {
  const f = await focused(page);
  return f ? { ...strip(f), id: f.id } : undefined;
}

const SPACE_ROLES = new Set(["checkbox", "radio", "switch", "menuitemcheckbox", "menuitemradio"]);

export async function runWorkflow(browser: Browser, wf: Workflow): Promise<KbResult> {
  const result: KbResult = { version: 1, kind: "workflow", name: wf.name, url: wf.url, ranAt: new Date().toISOString(), steps: [] };
  const context = await newContext(browser, wf.session);
  let dialog: { opener?: KbElement & { id: string } } | undefined;
  try {
    const page = await open(context, wf.url);
    for (const [i, step] of wf.steps.entries()) {
      const entry: KbStep = { step: i + 1, action: describeStep(step), kind: stepAction(step), url: page.url() };
      result.steps.push(entry);
      try {
        dialog = await runStep(page, step, entry, dialog);
      } catch (err) {
        entry.error = err instanceof Error ? err.message.split("\n")[0] : String(err);
      }
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message.split("\n")[0] : String(err);
  } finally {
    await context.close();
  }
  return result;
}

type OpenDialog = { opener?: KbElement & { id: string } } | undefined;

async function runStep(page: Page, step: WorkflowStep, entry: KbStep, dialog: OpenDialog): Promise<OpenDialog> {
  const s = step as Record<string, unknown>;
  switch (stepAction(step)) {
    case "read":
    case "next":
    case "find":
      entry.skipped = true;
      return dialog;
    case "goto":
      await page.goto(new URL(s.goto as string, page.url()).href, { waitUntil: "load" });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      return undefined;
    case "wait":
      await page.waitForTimeout(s.wait as number);
      return dialog;
    case "tab":
      entry.tab = await tabThrough(page, s.tab as number | "all");
      return dialog;
    case "focus":
      await page.locator(s.focus as string).first().focus();
      return dialog;
    case "type":
      if (s.into) await page.locator(s.into as string).first().focus();
      await page.keyboard.type(s.type as string);
      return dialog;
    case "press": {
      const key = s.press as string;
      await page.keyboard.press(key);
      await page.waitForTimeout(400);
      if (key === "Escape" && dialog) {
        const closed = (await page.evaluate(() => (window as unknown as { __kb: { dialogs(): unknown[] } }).__kb.dialogs().length)) === 0;
        const now = await current(page);
        entry.escape = { closed, focusReturned: Boolean(dialog.opener && now?.id === dialog.opener.id), ...(dialog.opener ? { opener: strip2(dialog.opener) } : {}) };
        return closed ? undefined : dialog;
      }
      return dialog;
    }
    case "activate": {
      if (s.activate !== true) await page.locator(s.activate as string).first().focus();
      const target = await current(page);
      if (!target) throw new Error("Nothing has focus to activate");
      const key = SPACE_ROLES.has(target.role) ? "Space" : "Enter";
      const before = await page.evaluate(() => ({
        url: location.href,
        mutations: (window as unknown as { __kbMutations: number }).__kbMutations,
        dialogs: (window as unknown as { __kb: { dialogs(): unknown[] } }).__kb.dialogs().length,
      }));
      await page.keyboard.press(key);
      await page.waitForTimeout(600);
      const after = await page
        .evaluate(() => ({
          url: location.href,
          mutations: (window as unknown as { __kbMutations: number }).__kbMutations,
          dialogs: (window as unknown as { __kb: { dialogs(): Element[] } }).__kb.dialogs().map((d) => d.contains(document.activeElement)),
        }))
        // Activating a link can navigate away mid-evaluate: that's a change.
        .catch(() => ({ url: "", mutations: Number.MAX_SAFE_INTEGER, dialogs: [] as boolean[] }));
      const now = await current(page).catch(() => undefined);
      const changed = after.url !== before.url || after.mutations > before.mutations || now?.id !== target.id;
      entry.activated = { target: strip2(target), key, changed };
      if (after.dialogs.length > before.dialogs) {
        entry.dialog = { focusInside: after.dialogs.some(Boolean), opener: strip2(target) };
        return { opener: target };
      }
      return dialog;
    }
  }
}

const strip2 = ({ id: _id, ...el }: KbElement & { id: string }): KbElement => el;

async function launch(): Promise<Browser> {
  let chromium: BrowserType;
  try {
    ({ chromium } = (await import("playwright" as string)) as { chromium: BrowserType });
  } catch {
    throw new Error("Keyboard tests need Playwright. Run: npm install -D playwright && npx playwright install chromium");
  }
  // Fall back to the installed Google Chrome when Playwright's own Chromium wasn't downloaded.
  return chromium.launch().catch((err: unknown) => {
    if (!/Executable doesn't exist|playwright install/i.test(String(err))) throw err;
    return chromium.launch({ channel: "chrome" }).catch(() => {
      throw err;
    });
  });
}

/** Run every page and workflow; saves one result file each and returns them. */
export async function runKeyboard(opts: KeyboardRunOptions): Promise<KbResult[]> {
  const jobs: Array<{ name: string; file: string; run: (b: Browser) => Promise<KbResult> }> = [
    ...opts.pages.map((url) => ({ name: url, file: `page-${safeSlug(url)}.json`, run: (b: Browser) => runPage(b, url, opts.signIn) })),
    ...(opts.workflows ?? []).map((wf) => ({ name: wf.name, file: `workflow-${wf.id}.json`, run: (b: Browser) => runWorkflow(b, wf) })),
  ];
  mkdirSync(opts.outDir, { recursive: true });
  const browser = await launch();
  const results: KbResult[] = [];
  try {
    for (const [index, job] of jobs.entries()) {
      opts.onProgress?.({ type: "start", name: job.name, index, total: jobs.length });
      const result = await job.run(browser);
      writeFileSync(join(opts.outDir, job.file), JSON.stringify(result, null, 2) + "\n");
      results.push(result);
      opts.onProgress?.({ type: result.error ? "error" : "done", name: job.name, index, total: jobs.length, ...(result.error ? { error: result.error } : {}) });
    }
  } finally {
    await browser.close();
  }
  return results;
}

function safeSlug(url: string): string {
  try {
    return pageSlug(url) || "page";
  } catch {
    return url.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  }
}
