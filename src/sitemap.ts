/**
 * Sitemap discovery.
 *
 * Turns a `sitemap.xml` URL into a flat list of page URLs to scan. Handles both
 * plain `<urlset>` sitemaps and `<sitemapindex>` files that merely point at more
 * sitemaps — the latter is what Shopify, WordPress, and most large CMSes serve
 * at `/sitemap.xml`, and feeding those `.xml` locations straight to Lighthouse
 * or axe would "scan" XML documents instead of pages.
 */

/** A minimal fetch signature so this is injectable/testable without globals. */
export type SitemapFetch = (
  url: string
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface ReadSitemapOptions {
  /** Injectable fetch. Defaults to `globalThis.fetch`. */
  fetchImpl?: SitemapFetch;
  /** How many levels of nested sitemap index to follow. Defaults to 3. */
  maxDepth?: number;
  /** Cap on returned URLs. Unlimited by default. */
  limit?: number;
}

const LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;

/** Extract raw `<loc>` values from sitemap XML, decoding XML entities. */
export function parseSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(LOC_RE)].map(m => decodeXmlEntities(m[1]!));
}

/** True when the document is an index pointing at other sitemaps. */
export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Fetch a sitemap and return the page URLs it describes, following nested
 * sitemap index files. Results are de-duplicated and preserve discovery order.
 */
export async function readSitemap(
  sitemapUrl: string,
  options: ReadSitemapOptions = {}
): Promise<string[]> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as SitemapFetch);
  const maxDepth = options.maxDepth ?? 3;

  const out: string[] = [];
  const seenSitemaps = new Set<string>();
  const seenUrls = new Set<string>();

  const visit = async (url: string, depth: number): Promise<void> => {
    if (seenSitemaps.has(url)) return;
    seenSitemaps.add(url);

    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Failed to fetch sitemap (${res.status}): ${url}`);
    const xml = await res.text();
    const locs = parseSitemapLocs(xml);

    if (isSitemapIndex(xml)) {
      if (depth >= maxDepth) return;
      for (const child of locs) {
        await visit(child, depth + 1);
      }
      return;
    }

    for (const loc of locs) {
      if (seenUrls.has(loc)) continue;
      seenUrls.add(loc);
      out.push(loc);
    }
  };

  await visit(sitemapUrl, 0);
  return typeof options.limit === "number" ? out.slice(0, options.limit) : out;
}
