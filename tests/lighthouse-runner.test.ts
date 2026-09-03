import { describe, it, expect, vi, afterEach } from "vitest";
import { readSitemap, resolveUrls } from "../src/integrations/lighthouse-runner.js";

/** Build a fake fetch that serves a canned XML body per URL. */
function mockFetch(pages: Record<string, string>) {
  return vi.fn(async (url: string) => {
    const body = pages[url];
    if (body === undefined) return { ok: false, status: 404, text: async () => "" } as Response;
    return { ok: true, status: 200, text: async () => body } as Response;
  });
}

const urlset = (locs: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>
   <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
     ${locs.map((l) => `<url><loc>${l}</loc></url>`).join("\n")}
   </urlset>`;

const sitemapIndex = (locs: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>
   <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
     ${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join("\n")}
   </sitemapindex>`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readSitemap", () => {
  it("reads a flat urlset sitemap", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "https://ex.com/sitemap.xml": urlset([
          "https://ex.com/",
          "https://ex.com/about",
          "https://ex.com/contact",
        ]),
      }),
    );
    const urls = await readSitemap("https://ex.com/sitemap.xml");
    expect(urls).toEqual([
      "https://ex.com/",
      "https://ex.com/about",
      "https://ex.com/contact",
    ]);
  });

  it("follows a sitemap index into child sitemaps (the 'only got 3' fix)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "https://ex.com/sitemap.xml": sitemapIndex([
          "https://ex.com/sitemap-pages.xml",
          "https://ex.com/sitemap-blog.xml",
        ]),
        "https://ex.com/sitemap-pages.xml": urlset([
          "https://ex.com/",
          "https://ex.com/about",
        ]),
        "https://ex.com/sitemap-blog.xml": urlset([
          "https://ex.com/blog/a",
          "https://ex.com/blog/b",
          "https://ex.com/blog/c",
        ]),
      }),
    );
    const urls = await readSitemap("https://ex.com/sitemap.xml");
    expect(urls).toHaveLength(5);
    expect(urls).toContain("https://ex.com/blog/c");
  });

  it("skips a broken child sitemap without aborting", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "https://ex.com/sitemap.xml": sitemapIndex([
          "https://ex.com/good.xml",
          "https://ex.com/missing.xml",
        ]),
        "https://ex.com/good.xml": urlset(["https://ex.com/"]),
      }),
    );
    const urls = await readSitemap("https://ex.com/sitemap.xml");
    expect(urls).toEqual(["https://ex.com/"]);
  });
});

describe("resolveUrls", () => {
  it("merges inline URLs with a sitemap and de-dupes", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "https://ex.com/sitemap.xml": urlset(["https://ex.com/", "https://ex.com/about"]),
      }),
    );
    const urls = await resolveUrls({
      urls: ["https://ex.com/"], // duplicate of a sitemap entry
      sitemap: "https://ex.com/sitemap.xml",
    });
    expect(urls).toEqual(["https://ex.com/", "https://ex.com/about"]);
  });
});
