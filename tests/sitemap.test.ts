import { describe, expect, it } from "vitest";
import {
  isSitemapIndex,
  parseSitemapLocs,
  readSitemap,
  type SitemapFetch,
} from "../src/sitemap.js";

const urlset = (...urls: string[]): string => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc></url>`).join("\n")}
</urlset>`;

const index = (...sitemaps: string[]): string => `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps.map(s => `  <sitemap><loc>${s}</loc></sitemap>`).join("\n")}
</sitemapindex>`;

/** Serve a fixed map of url -> xml, recording what was requested. */
function fakeFetch(pages: Record<string, string>): {
  fetchImpl: SitemapFetch;
  requested: string[];
} {
  const requested: string[] = [];
  const fetchImpl: SitemapFetch = async url => {
    requested.push(url);
    const body = pages[url];
    if (body === undefined) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => body };
  };
  return { fetchImpl, requested };
}

describe("parseSitemapLocs", () => {
  it("extracts loc values", () => {
    expect(parseSitemapLocs(urlset("https://x.test/a", "https://x.test/b"))).toEqual([
      "https://x.test/a",
      "https://x.test/b",
    ]);
  });

  it("decodes XML entities in URLs", () => {
    const xml = urlset("https://x.test/s.xml?from=1&amp;to=2");
    expect(parseSitemapLocs(xml)).toEqual(["https://x.test/s.xml?from=1&to=2"]);
  });
});

describe("isSitemapIndex", () => {
  it("distinguishes an index from a urlset", () => {
    expect(isSitemapIndex(index("https://x.test/s1.xml"))).toBe(true);
    expect(isSitemapIndex(urlset("https://x.test/a"))).toBe(false);
  });
});

describe("readSitemap", () => {
  it("returns page URLs from a plain urlset", async () => {
    const { fetchImpl } = fakeFetch({
      "https://x.test/sitemap.xml": urlset("https://x.test/a", "https://x.test/b"),
    });

    await expect(readSitemap("https://x.test/sitemap.xml", { fetchImpl })).resolves.toEqual([
      "https://x.test/a",
      "https://x.test/b",
    ]);
  });

  it("follows a sitemap index instead of returning the .xml locations", async () => {
    const { fetchImpl } = fakeFetch({
      "https://x.test/sitemap.xml": index("https://x.test/pages.xml", "https://x.test/blogs.xml"),
      "https://x.test/pages.xml": urlset("https://x.test/pages/terms"),
      "https://x.test/blogs.xml": urlset("https://x.test/blogs/post-1"),
    });

    await expect(readSitemap("https://x.test/sitemap.xml", { fetchImpl })).resolves.toEqual([
      "https://x.test/pages/terms",
      "https://x.test/blogs/post-1",
    ]);
  });

  it("de-duplicates URLs listed in more than one child sitemap", async () => {
    const { fetchImpl } = fakeFetch({
      "https://x.test/sitemap.xml": index("https://x.test/a.xml", "https://x.test/b.xml"),
      "https://x.test/a.xml": urlset("https://x.test/dupe"),
      "https://x.test/b.xml": urlset("https://x.test/dupe", "https://x.test/unique"),
    });

    await expect(readSitemap("https://x.test/sitemap.xml", { fetchImpl })).resolves.toEqual([
      "https://x.test/dupe",
      "https://x.test/unique",
    ]);
  });

  it("stops recursing at maxDepth", async () => {
    const { fetchImpl, requested } = fakeFetch({
      "https://x.test/sitemap.xml": index("https://x.test/l1.xml"),
      "https://x.test/l1.xml": index("https://x.test/l2.xml"),
      "https://x.test/l2.xml": urlset("https://x.test/deep"),
    });

    await expect(
      readSitemap("https://x.test/sitemap.xml", { fetchImpl, maxDepth: 1 })
    ).resolves.toEqual([]);
    expect(requested).not.toContain("https://x.test/l2.xml");
  });

  it("does not revisit a sitemap referenced twice", async () => {
    const { fetchImpl, requested } = fakeFetch({
      "https://x.test/sitemap.xml": index("https://x.test/a.xml", "https://x.test/a.xml"),
      "https://x.test/a.xml": urlset("https://x.test/a"),
    });

    await readSitemap("https://x.test/sitemap.xml", { fetchImpl });
    expect(requested.filter(u => u === "https://x.test/a.xml")).toHaveLength(1);
  });

  it("applies the limit", async () => {
    const { fetchImpl } = fakeFetch({
      "https://x.test/sitemap.xml": urlset("https://x.test/a", "https://x.test/b"),
    });

    await expect(
      readSitemap("https://x.test/sitemap.xml", { fetchImpl, limit: 1 })
    ).resolves.toEqual(["https://x.test/a"]);
  });

  it("throws on a failed fetch", async () => {
    const { fetchImpl } = fakeFetch({});
    await expect(readSitemap("https://x.test/missing.xml", { fetchImpl })).rejects.toThrow(
      /Failed to fetch sitemap \(404\)/
    );
  });
});
