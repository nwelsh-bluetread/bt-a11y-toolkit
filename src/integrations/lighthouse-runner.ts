/**
 * Lighthouse *runner* — the side-effectful half of the Lighthouse integration.
 *
 * The pure conversion lives in `lighthouse.ts`. This module handles the parts
 * that touch the network / a browser: discovering URLs (list files, sitemaps,
 * sitemap indexes) and launching Lighthouse against live pages.
 *
 * `lighthouse` and `chrome-launcher` are optional peer deps and are imported
 * lazily, so consumers who never run a live scan don't need them installed:
 *   npm install -D lighthouse chrome-launcher
 */
import { readFileSync } from "node:fs";
import type { Assessment, WcagLevel } from "../types.js";
import {
  lighthouseToAssessment,
  combineLighthouseResults,
  type LighthouseResult,
  type LighthousePage,
} from "./lighthouse.js";

/** Read a URL list file (one URL per line, `#` comments and blanks ignored). */
export function readUrlsFile(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/**
 * Fetch a sitemap and return its URLs.
 *
 * Handles both a normal `<urlset>` sitemap and a `<sitemapindex>` (a "sitemap of
 * sitemaps"), recursively following child sitemaps. This is the usual reason a
 * scan "only finds 3 URLs": the top-level file is an index whose `<loc>`s point
 * at *other* sitemaps rather than pages.
 */
export async function readSitemap(
  sitemapUrl: string,
  seen = new Set<string>(),
): Promise<string[]> {
  if (seen.has(sitemapUrl)) return [];
  seen.add(sitemapUrl);

  const res = await fetch(sitemapUrl);
  if (!res.ok) throw new Error(`Failed to fetch sitemap (${res.status}): ${sitemapUrl}`);
  const xml = await res.text();

  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!);

  // If this is a sitemap index, its <loc>s are child sitemaps — follow them.
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  if (isIndex) {
    const all: string[] = [];
    for (const child of locs) {
      try {
        all.push(...(await readSitemap(child, seen)));
      } catch {
        // Skip a broken child sitemap rather than aborting the whole discovery.
      }
    }
    return all;
  }

  return locs;
}

/**
 * Resolve the full, de-duplicated list of URLs to scan from any combination of
 * inline URLs, a `--urls` list file, and a `--sitemap` (or sitemap index).
 */
export async function resolveUrls(opts: {
  urls?: string[];
  urlsFile?: string;
  sitemap?: string;
}): Promise<string[]> {
  const urls = [...(opts.urls ?? [])];
  if (opts.urlsFile) urls.push(...readUrlsFile(opts.urlsFile));
  if (opts.sitemap) urls.push(...(await readSitemap(opts.sitemap)));
  return [...new Set(urls)];
}

/** Run a live Lighthouse accessibility scan against a single URL. */
export async function runLighthouse(url: string): Promise<LighthouseResult> {
  let chromeLauncher: {
    launch(opts: Record<string, unknown>): Promise<{ port: number; kill(): Promise<void> }>;
  };
  let lighthouse: { default?: unknown } & Record<string, unknown>;
  try {
    chromeLauncher = (await import("chrome-launcher" as string)) as typeof chromeLauncher;
    lighthouse = (await import("lighthouse" as string)) as typeof lighthouse;
  } catch {
    throw new Error(
      "Live scans require optional deps. Run: npm install -D lighthouse chrome-launcher",
    );
  }

  const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless=new"] });
  try {
    const runner = (lighthouse.default ?? lighthouse) as (
      url: string,
      opts: Record<string, unknown>,
    ) => Promise<{ lhr: LighthouseResult } | undefined>;
    const result = await runner(url, {
      port: chrome.port,
      onlyCategories: ["accessibility"],
      output: "json",
      logLevel: "error",
    });
    if (!result?.lhr) throw new Error("Lighthouse returned no result.");
    return result.lhr;
  } finally {
    await chrome.kill();
  }
}

/**
 * Scan one or many live URLs and return a single {@link Assessment}. When more
 * than one page succeeds, the results are merged with
 * {@link combineLighthouseResults}. Pages that fail to load are skipped (with an
 * optional `onProgress` notification) rather than aborting the run.
 */
export async function scanUrls(
  urls: string[],
  options: {
    targetLevel?: WcagLevel;
    onProgress?: (event:
      | { type: "start"; total: number }
      | { type: "page"; url: string; index: number; total: number }
      | { type: "skip"; url: string; error: string }) => void;
  } = {},
): Promise<{ assessment: Assessment; pages: LighthousePage[] }> {
  const { onProgress } = options;
  onProgress?.({ type: "start", total: urls.length });

  const pages: LighthousePage[] = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]!;
    onProgress?.({ type: "page", url, index: i, total: urls.length });
    try {
      const lhr = await runLighthouse(url);
      pages.push({ url, lhr });
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
      ? lighthouseToAssessment(pages[0]!.lhr, { targetLevel: options.targetLevel })
      : combineLighthouseResults(pages, { targetLevel: options.targetLevel });

  return { assessment, pages };
}
