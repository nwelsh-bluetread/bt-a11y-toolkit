/**
 * Build docs/tool-coverage.pdf: which tool checks which WCAG 2.2 criterion.
 *
 * The data comes from src/tool-coverage.ts (the toolkit's own mappings), so
 * re-run this after adding scanner rules or checklist items:
 *
 *   npm run docs:tool-coverage            # docs/tool-coverage.pdf
 *   npm run docs:tool-coverage -- --html  # also keep the HTML
 *
 * Uses the audit-summary stylesheet and the same PDF/UA-1 fix-up as the
 * summary PDF, so it needs Chrome (and pikepdf, installed on first use).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensurePdfUaPython, verifyPdfUa } from "../src/pdf/pdfua.js";
import { compareIds, TOOLS, toolCoverage, toolRules, criteriaByTool, type CriterionCoverage, type ToolId } from "../src/tool-coverage.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "docs", "tool-coverage.pdf");
const htmlPath = join(root, "docs", "tool-coverage.html");
const keepHtml = process.argv.includes("--html");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const PRINCIPLES = ["Perceivable", "Operable", "Understandable", "Robust"];
const SHORT: Record<ToolId, string> = { axe: "axe", lighthouse: "Light­house", "rn-code-scan": "Code scan", "device-target-size": "Device" };
const AA = (c: CriterionCoverage) => c.level !== "AAA";

function render(): string {
  const rows = toolCoverage();
  const aa = rows.filter(AA);
  const web = (c: CriterionCoverage) => c.tools.some((t) => t === "axe" || t === "lighthouse");
  const mobile = (c: CriterionCoverage) => c.tools.some((t) => t === "rn-code-scan" || t === "device-target-size");
  const byTool = criteriaByTool();
  const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
  const today = new Date().toISOString().slice(0, 10);

  const tiles = [
    { n: aa.filter(web).length, label: "have an automated check on websites" },
    { n: aa.filter(mobile).length, label: "have an automated check on mobile apps" },
    { n: aa.filter((c) => c.tools.length === 0).length, label: "are manual-only (no tool checks them)" },
    { n: aa.filter((c) => c.manual.length > 0).length, label: "are in the manual checklist" },
  ];

  const yes = '<td class="c yes">✓</td>';
  const no = '<td class="c no">–</td>';
  const manualText = (c: CriterionCoverage) =>
    c.manual.length === 2 ? "Web + mobile" : c.manual[0] === "web" ? "Web only" : c.manual[0] === "mobile" ? "Mobile only" : "—";

  const table = (list: CriterionCoverage[], caption: string) => `
    <table class="cov">
      <caption>${esc(caption)}</caption>
      <thead><tr>
        <th scope="col">Criterion</th><th scope="col" class="c">Level</th>
        ${TOOLS.map((t) => `<th scope="col" class="c">${SHORT[t.id]}<span class="plat">${esc(t.platforms)}</span></th>`).join("")}
        <th scope="col">Manual checklist</th>
      </tr></thead>
      <tbody>${list
        .map(
          (c) => `<tr${c.tools.length === 0 ? ' class="manual-only"' : ""}>
          <th scope="row"><code>${c.id}</code> ${esc(c.name)}</th><td class="c">${c.level}</td>
          ${TOOLS.map((t) => (c.tools.includes(t.id) ? yes : no)).join("")}
          <td>${manualText(c)}</td></tr>`,
        )
        .join("")}</tbody>
    </table>`;

  const principleTables = PRINCIPLES.map((name, i) => table(aa.filter((c) => c.id.startsWith(`${i + 1}.`)), `${i + 1}. ${name}`)).join("");

  const { rn, lighthouse } = toolRules();
  const ids = (list: string[]) => [...list].sort(compareIds).map((id) => `<code>${id}</code>`).join(", ");
  const toolCards = TOOLS.map((t) => {
    const list = [...byTool[t.id]].sort(compareIds);
    const aaList = list.filter((id) => rows.find((r) => r.id === id)?.level !== "AAA");
    const aaaList = list.filter((id) => rows.find((r) => r.id === id)?.level === "AAA");
    return `
    <section class="card tool">
      <h3>${esc(t.name)} <span class="muted">· ${esc(t.platforms)}</span></h3>
      <p>${esc(t.about)}</p>
      <p class="fine"><strong>Run:</strong> <code>${esc(t.run)}</code></p>
      <p class="crit"><strong>${aaList.length} A/AA criteria:</strong> ${ids(aaList)}${aaaList.length ? `<br><strong>AAA (when the audit targets AAA):</strong> ${ids(aaaList)}` : ""}</p>
    </section>`;
  }).join("");

  const rnTable = `
    <table class="rules">
      <caption>React Native code scan rules</caption>
      <thead><tr><th scope="col">Rule</th><th scope="col">What it flags</th><th scope="col">Criteria</th></tr></thead>
      <tbody>${rn.map((r) => `<tr><td><code>${esc(r.id)}</code></td><td>${esc(r.title)}</td><td>${ids(r.wcag)}</td></tr>`).join("")}</tbody>
    </table>`;
  const lhTable = `
    <table class="rules">
      <caption>Lighthouse audits the toolkit maps to WCAG</caption>
      <thead><tr><th scope="col">Audit</th><th scope="col">Criteria</th><th scope="col">Audit</th><th scope="col">Criteria</th></tr></thead>
      <tbody>${pairs(lighthouse)
        .map(([a, b]) => `<tr><td><code>${esc(a.id)}</code></td><td>${ids(a.wcag)}</td>${b ? `<td><code>${esc(b.id)}</code></td><td>${ids(b.wcag)}</td>` : "<td>–</td><td>–</td>"}</tr>`)
        .join("")}</tbody>
    </table>`;

  const aaa = rows.filter((c) => c.level === "AAA");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Which tool checks which WCAG criterion · BlueTread Accessibility Toolkit</title>
<style>${baseCss()}${CSS}</style>
</head>
<body>
<main>
  <header class="masthead">
    <div>
      <p class="eyebrow">BlueTread Accessibility Toolkit · Reference</p>
      <h1>Which tool checks which WCAG criterion</h1>
      <p class="lede">Every WCAG 2.2 Level A and AA success criterion, and which part of the toolkit checks it: the automated scanners, the device measurement, or the manual checklist.</p>
    </div>
    <dl class="meta">
      <div><dt>Generated</dt><dd>${today}</dd></div>
      <div><dt>Toolkit version</dt><dd>${esc(version)}</dd></div>
      <div><dt>Standard</dt><dd>WCAG 2.2 A + AA</dd></div>
      <div><dt>Criteria</dt><dd>${aa.length}</dd></div>
    </dl>
  </header>

  <section class="tiles cov-tiles" aria-label="Summary for the ${aa.length} Level A and AA criteria">
    ${tiles.map((t) => `<div class="tile"><p class="big">${t.n}<span class="of"> / ${aa.length}</span></p><p>${esc(t.label)}</p></div>`).join("")}
  </section>

  <p class="takeaway"><span class="eyebrow">How to read this</span>A ✓ means the tool has rules for that criterion. It doesn't mean the tool fully tests it: a scanner can find some failures of a criterion but can never confirm it passes. That's why every criterion still needs the manual checklist, and why a scan alone never marks a criterion as passing.</p>

  <h2>By criterion</h2>
  <p class="fine key"><strong>axe</strong> and <strong>Lighthouse</strong> scan live web pages. <strong>Code scan</strong> reads React Native source for iOS and Android. <strong>Device</strong> measures touch targets on an Android phone. <strong>Manual checklist</strong> shows which products have a hands-on check for the criterion. Shaded rows have no automated check at all.</p>
  ${principleTables}

  <h2 class="page-break-before">By tool</h2>
  <div class="tools">${toolCards}</div>
  ${rnTable}
  ${lhTable}

  <h2>Level AAA</h2>
  <p class="fine">Only checked when the audit's target level is AAA. ${aaa.filter((c) => c.tools.length).length} of ${aaa.length} AAA criteria have an automated check: ${ids(aaa.filter((c) => c.tools.length).map((c) => c.id))}. The rest are manual only.</p>

  <footer class="fine">Generated from the toolkit's own mappings (src/tool-coverage.ts) on ${today}. Re-run <code>npm run docs:tool-coverage</code> after changing scanner rules or checklist items. 4.1.1 Parsing is obsolete in WCAG 2.2 and isn't listed.</footer>
</main>
</body>
</html>`;
}

function pairs<T>(list: T[]): Array<[T, T | undefined]> {
  const half = Math.ceil(list.length / 2);
  return list.slice(0, half).map((a, i) => [a, list[half + i]]);
}

/** The audit-summary stylesheet, so this document matches the PDFs clients get. */
function baseCss(): string {
  const source = readFileSync(join(root, "assets", "pdf", "render.mjs"), "utf8");
  return source.match(/const CSS = `([\s\S]*?)\n`;/)![1]!;
}

const CSS = `
h1 { font-size: 26pt; }
.cov-tiles { grid-template-columns: repeat(4, 1fr); }
.tile .of { font-size: 11pt; color: var(--muted); font-weight: 400; }
.takeaway { margin-top: 12px; }
.key { margin-bottom: 8px; }
table.cov, table.rules { margin: 4px 0 14px; }
caption { text-align: left; font-family: var(--serif); font-weight: 600; font-size: 12pt; padding: 6px 0 4px; }
table.cov { table-layout: fixed; }
table.cov thead th:first-child { width: 2.75in; }
table.cov thead th:last-child { width: 1in; }
table.cov th[scope="row"] { font-weight: 500; font-size: 8.5pt; text-transform: none; letter-spacing: 0; color: var(--ink); padding: 5px 4px 5px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
table.cov th[scope="row"] code { color: var(--muted); margin-right: 3px; }
th.c, td.c { text-align: center; width: 0.62in; }
td.yes { color: var(--pass-ink); font-weight: 700; font-size: 10pt; }
td.no { color: #b5bcc6; }
.plat { display: block; font-size: 6.5pt; text-transform: none; letter-spacing: 0; font-weight: 400; }
tr.manual-only td, tr.manual-only th { background: var(--card); }
.page-break-before { break-before: page; }
.tools { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px; }
.tool { padding: 10px 12px; break-inside: avoid; }
.tool h3 { font-size: 11.5pt; margin-bottom: 4px; }
.tool p { font-size: 8.5pt; margin-bottom: 4px; }
.tool .crit { line-height: 1.6; }
table.rules td, table.rules th { font-size: 8pt; padding: 4px 6px; }
`;

writeFileSync(htmlPath, render());
const chrome = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((c) => c && existsSync(c));
if (!chrome) {
  console.error(`No Chrome found (set CHROME_PATH). HTML written to ${htmlPath}`);
  process.exit(2);
}
execFileSync(chrome, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--export-tagged-pdf", "--generate-pdf-document-outline", `--print-to-pdf=${out}`, pathToFileURL(htmlPath).href], {
  stdio: ["ignore", "ignore", "pipe"],
});

// Same PDF/UA-1 fix-up as the summary PDF (assets/pdf/pdfua_fix.py).
const html = readFileSync(htmlPath, "utf8");
const decode = (t: string) => t.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const linksPath = out.replace(/\.pdf$/, ".links.json");
writeFileSync(linksPath, JSON.stringify({ links: {}, headings: [...html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g)].map((m) => decode(m[1]!)) }));
try {
  const python = await ensurePdfUaPython((l) => console.log(`  ${l}`));
  console.log(execFileSync(python, [join(root, "assets", "pdf", "pdfua_fix.py"), out, linksPath], { encoding: "utf8" }).trim());
} catch (err) {
  console.warn(`⚠ PDF/UA fix-up skipped: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  unlinkSync(linksPath);
}
if (!keepHtml) unlinkSync(htmlPath);

const check = await verifyPdfUa(out);
console.log(`PDF: ${out}`);
if (check.status === "pass") console.log("✓ PDF/UA-1: PASS (veraPDF)");
else if (check.status === "fail") {
  console.error(`✗ PDF/UA-1: FAIL — ${check.failedRules} rule(s) failed (${check.details})`);
  process.exitCode = 1;
}
