/**
 * axe-core *runner* — the side-effectful half of the axe integration.
 *
 * The pure conversion lives in `axe.ts`. This module drives a real browser via
 * Playwright, injects axe-core on each page, and collects results. It reuses the
 * URL-discovery helpers (`resolveUrls`, sitemaps) from the Lighthouse runner.
 *
 * `playwright` and `@axe-core/playwright` are optional peer deps, imported
 * lazily so consumers who never run a live axe scan don't need them installed:
 *   npm install -D playwright @axe-core/playwright
 *   npx playwright install chromium
 */
import type { Assessment, WcagLevel } from "../types.js";
import {
  axeToAssessment,
  combineAxeResults,
  type AxeResults,
  type AxePage,
} from "./axe.js";

// Re-export URL discovery so `bt-a11y axe` shares Lighthouse's sitemap logic.
export { resolveUrls, readUrlsFile, readSitemap } from "./lighthouse-runner.js";

/** Run a live axe-core accessibility scan against a single URL via Playwright. */
export async function runAxe(url: string): Promise<AxeResults> {
  let chromium: {
    launch(opts?: Record<string, unknown>): Promise<{
      newPage(): Promise<unknown>;
      close(): Promise<void>;
    }>;
  };
  let AxeBuilder: new (args: { page: unknown }) => { analyze(): Promise<AxeResults> };
  try {
    ({ chromium } = (await import("playwright" as string)) as { chromium: typeof chromium });
    const mod = (await import("@axe-core/playwright" as string)) as {
      default: typeof AxeBuilder;
    };
    AxeBuilder = mod.default;
  } catch {
    throw new Error(
      "Live axe scans require optional deps. Run: npm install -D playwright @axe-core/playwright && npx playwright install chromium",
    );
  }

  const browser = await chromium.launch();
  try {
    const page = (await browser.newPage()) as {
      goto(url: string, opts?: Record<string, unknown>): Promise<unknown>;
    };
    await page.goto(url, { waitUntil: "networkidle" });
    const results = await new AxeBuilder({ page }).analyze();
    return { ...results, url: results.url ?? url };
  } finally {
    await browser.close();
  }
}

/**
 * Scan one or many live URLs with axe and return a single {@link Assessment}.
 * When more than one page succeeds, results are merged with
 * {@link combineAxeResults}. Pages that fail are skipped (with an optional
 * `onProgress` notification) rather than aborting the run.
 */
export async function scanUrlsWithAxe(
  urls: string[],
  options: {
    targetLevel?: WcagLevel;
    onProgress?: (event:
      | { type: "start"; total: number }
      | { type: "page"; url: string; index: number; total: number }
      | { type: "skip"; url: string; error: string }) => void;
  } = {},
): Promise<{ assessment: Assessment; pages: AxePage[] }> {
  const { onProgress } = options;
  onProgress?.({ type: "start", total: urls.length });

  const pages: AxePage[] = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]!;
    onProgress?.({ type: "page", url, index: i, total: urls.length });
    try {
      const results = await runAxe(url);
      pages.push({ url, results });
    } catch (err) {
      onProgress?.({
        type: "skip",
        url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (pages.length === 0) throw new Error("No pages could be scanned.");

  const assessment =
    pages.length === 1
      ? axeToAssessment(pages[0]!.results, { targetLevel: options.targetLevel })
      : combineAxeResults(pages, { targetLevel: options.targetLevel });

  return { assessment, pages };
}
