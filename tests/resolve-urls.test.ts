import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveUrls } from "../src/integrations/lighthouse-runner.js";

const dir = mkdtempSync(join(tmpdir(), "bt-a11y-urls-"));
const file = (name: string, text: string) => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};

describe("resolveUrls with a local file", () => {
  it("reads a sitemap file's <loc>s, not its lines", async () => {
    const path = file(
      "sitemap.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Sitemap for the audit. Not shipped with the app.
-->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>http://localhost:4173/login</loc></url>
  <url>
    <loc>http://localhost:4173/dashboard</loc>
  </url>
</urlset>
`,
    );
    expect(await resolveUrls({ urlsFile: path })).toEqual(["http://localhost:4173/login", "http://localhost:4173/dashboard"]);
    expect(await resolveUrls({ sitemap: path })).toEqual(["http://localhost:4173/login", "http://localhost:4173/dashboard"]);
  });

  it("still reads a plain URL list one per line", async () => {
    const path = file("urls.txt", "# pages\nhttp://localhost:4173/login\n\nhttp://localhost:4173/users\n");
    expect(await resolveUrls({ urlsFile: path })).toEqual(["http://localhost:4173/login", "http://localhost:4173/users"]);
  });
});
