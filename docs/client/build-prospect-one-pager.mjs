#!/usr/bin/env node
// Build the prospective-client one-pager (docs/client/prospect-one-pager.pdf).
// Reuses the audit-summary stylesheet from the a11y-report-pdf skill so the two
// documents always look the same, then prints with headless Chrome and runs the
// same PDF/UA post-processing.
// Usage: node docs/client/build-prospect-one-pager.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

const SKILL = join(homedir(), '.claude/skills/a11y-report-pdf');
const here = new URL('.', import.meta.url).pathname;
const out = join(here, 'prospect-one-pager.pdf');
const htmlPath = join(here, 'prospect-one-pager.html');

const reportCss = readFileSync(join(SKILL, 'scripts/render.mjs'), 'utf8').match(/const CSS = `([\s\S]*?)\n`;/)[1];

const CSS = `
@page { size: Letter; margin: 0.32in 0.5in 0.28in; }
h1 { font-size: 24pt; }
.masthead { grid-template-columns: 1fr; padding-bottom: 5px; }
.lede { max-width: none; }
h2.section { font-size: 13pt; margin: 4px 0 3px; }
.why { display: grid; grid-template-columns: 1fr 1.9fr 1fr 1fr; gap: 16px; }
.why p b { color: var(--ink); font-weight: 600; }
.why section { border-top: 3px solid var(--high); padding-top: 6px; }
.why h3 { font-size: 10.5pt; line-height: 1.2; margin-bottom: 3px; }
.why p { font-size: 8pt; line-height: 1.4; color: var(--muted); }
.section-intro { font-size: 8.5pt; line-height: 1.4; margin: -2px 0 5px; }
.levels { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; list-style: none; margin: 0; padding: 0; }
.levels > li { padding: 5px 12px; border-top: 4px solid var(--critical); background: var(--card); border-radius: 0 0 8px 8px; font-size: 8pt; line-height: 1.4; }
.levels > li:nth-child(2) { border-top-color: var(--high); }
.levels > li:nth-child(3) { border-top-color: var(--medium); }
.levels h3 { font-size: 12pt; display: flex; justify-content: space-between; align-items: baseline; }
.levels .q { font-weight: 600; font-size: 8.5pt; margin: 1px 0 3px; }
.levels h3 .rec { font-family: var(--sans); vertical-align: 3px; }
.levels ul { margin: 4px 0 0; padding-left: 14px; }
.levels ul li { margin: 1px 0; }
.levels .who { margin-top: 5px; padding-top: 4px; border-top: 1px solid var(--line); }
.rec { display: inline-block; font-size: 7pt; font-weight: 600; background: var(--high); color: #fff; border-radius: 999px; padding: 1px 7px; margin-left: 4px; vertical-align: 1px; }
.bottom { display: grid; grid-template-columns: 1.55fr 1fr; gap: 10px; margin-top: 2px; }
.sample { padding: 8px 12px; }
.sample .tiles { grid-template-columns: 1.5fr repeat(4, 1fr); gap: 6px; margin: 4px 0 6px; }
.sample .tile { padding: 6px 8px; font-size: 7pt; border-radius: 8px; white-space: nowrap; }
.sample .tile .big { font-size: 16pt; margin-bottom: 2px; }
.sample .score-big strong { font-size: 22pt; }
.sample .score-big > span:not(.conf-pill) { font-size: 9pt; }
.sample .conf-pill { font-size: 6.5pt; padding: 2px 7px; margin-top: 3px; }
.sample .priorities li { padding: 4px 0; }
.steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; list-style: none; margin: 0; padding: 0; }
.steps li { padding: 5px 11px; border-top: 3px solid var(--critical); background: var(--card); border-radius: 0 0 8px 8px; }
.steps li:nth-child(2) { border-top-color: var(--high); } .steps li:nth-child(3) { border-top-color: var(--medium); } .steps li:nth-child(4) { border-top-color: var(--low); }
.step-n { font-size: 8pt; color: var(--muted); margin-right: 2px; }
.steps h3 { font-size: 10.5pt; margin-bottom: 2px; }
.steps p { font-size: 8pt; line-height: 1.35; color: var(--muted); }
.weights { padding: 8px 12px; }
.weights table { margin-top: 4px; font-size: 8pt; }
.weights td { padding: 3px 6px; vertical-align: middle; }
.weights .fine { margin-top: 5px; font-size: 7pt; line-height: 1.35; }
.faq { display: grid; grid-template-columns: 1.25fr 1fr 1fr; gap: 6px 18px; }
.faq h3 { font-family: var(--sans); font-size: 8.5pt; font-weight: 600; line-height: 1.3; }
.faq p { font-size: 8pt; line-height: 1.35; color: var(--muted); margin-top: 1px; }
.cta { margin-top: 5px; display: flex; justify-content: space-between; align-items: center; padding: 6px 14px; background: var(--ink); color: #fff; border-radius: 10px; font-size: 9pt; }
.cta .disclaimer { font-size: 7pt; color: #c9cbd0; white-space: nowrap; margin-left: 12px; }
.cta strong { font-family: var(--serif); font-size: 11pt; font-weight: 600; }
`;

const badge = (k, label) => `<span class="badge sev-${k}">${label}</span>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Web Accessibility, in Plain Terms · BlueTread</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>${reportCss}${CSS}</style>
</head>
<body>
<main>
  <header class="masthead">
    <div>
      <p class="eyebrow">BlueTread · Accessibility services</p>
      <h1>Accessibility, in plain terms</h1>
      <p class="lede">Accessibility means everyone can use your website or app, including people who are blind, deaf, have low vision or can't use a mouse. About 1 in 4 U.S. adults has a disability (CDC).</p>
    </div>
  </header>

  <h2 class="section">Why</h2>
  <div class="why">
    <section>
      <h3>Complaints and lawsuits</h3>
      <p>Thousands of U.S. accessibility lawsuits are filed every year. An audit shows where you stand.</p>
    </section>
    <section>
      <h3>New legal deadlines</h3>
      <p><b>ADA Title II</b> (Apr 2027–28): state and local governments, public universities, special districts. <b>EU Accessibility Act</b> (2025): businesses selling to EU consumers. <b>Section 508</b>: federal agencies and vendors.</p>
    </section>
    <section>
      <h3>Contracts and RFPs</h3>
      <p>Buyers ask for a VPAT or proof of WCAG AA before they sign.</p>
    </section>
    <section>
      <h3>A better product</h3>
      <p>Clear, accessible design means fewer support tickets and more completed checkouts.</p>
    </section>
  </div>

  <h2 class="section">A, AA and AAA: what the levels mean</h2>
  <p class="section-intro">Criteria come from <b>WCAG 2.2</b>, the W3C&rsquo;s web standard: <b>86 pass/fail criteria</b> in three levels, each including the levels below it.</p>
  <ol class="levels">
    <li>
      <h3>Level A</h3>
      <p class="q">Can people use it at all?</p>
      <p>The bare minimum (31 criteria).</p>
      <ul><li>Works with a keyboard alone</li><li>Images have text descriptions</li><li>Videos have captions</li></ul>
      <p class="who"><b>Effort:</b> lowest (code fixes).<br><b>Return:</b> removes blockers; rarely enough alone for legal or contract needs.</p>
    </li>
    <li>
      <h3>Level AA <span class="rec">Recommended</span></h3>
      <p class="q">Can people use it comfortably?</p>
      <p>What laws and contracts cite (24 more).</p>
      <ul><li>Text has enough contrast to read</li><li>Works when zoomed to 200%</li><li>Keyboard focus is always visible</li></ul>
      <p class="who"><b>Added effort:</b> moderate (design and front-end, done with A).<br><b>Return:</b> meets laws and contracts; the biggest drop in legal risk.</p>
    </li>
    <li>
      <h3>Level AAA</h3>
      <p class="q">Is it the best it can be?</p>
      <p>The highest level (31 more criteria).</p>
      <ul><li>Stronger contrast (7:1)</li><li>Sign language for video</li><li>Plain language, no time limits</li></ul>
      <p class="who"><b>Added effort:</b> high, ongoing (content, media, brand colors).<br><b>Return:</b> diminishing site-wide (the W3C doesn't advise it); worth it for key flows in healthcare, government, education.</p>
    </li>
  </ol>

  <h2 class="section">How we score your product</h2>
  <ol class="steps">
    <li><h3><span class="step-n mono">1</span> Scan</h3><p>Automated tools and scripts check every page of your product.</p></li>
    <li><h3><span class="step-n mono">2</span> Test by hand</h3><p>Tools catch 30–40% of issues, so we also test with screen readers.</p></li>
    <li><h3><span class="step-n mono">3</span> Verify and rate</h3><p>Every issue is confirmed, mapped to WCAG and rated.</p></li>
    <li><h3><span class="step-n mono">4</span> Score</h3><p>Start at 100, subtract points per issue.</p></li>
  </ol>

  <h2 class="section">What you get from an audit</h2>
  <div class="bottom">
    <section class="card sample" aria-label="Sample report excerpt">
      <div class="tiles">
        <div class="tile status-tile">
          <p class="eyebrow">Score</p>
          <p class="score-big"><strong>71</strong><span>/ 100</span><span class="conf-pill">Not yet conformant</span></p>
        </div>
        <div class="tile"><p class="big">1</p><p><span class="dot sev-critical" aria-hidden="true"></span>Critical</p></div>
        <div class="tile"><p class="big">2</p><p><span class="dot sev-high" aria-hidden="true"></span>High</p></div>
        <div class="tile"><p class="big">3</p><p><span class="dot sev-medium" aria-hidden="true"></span>Medium</p></div>
        <div class="tile"><p class="big">6</p><p><span class="dot sev-low" aria-hidden="true"></span>Low</p></div>
      </div>
      <div class="priorities">
        <ol>
          <li>${badge('critical', 'Critical')}<span><span class="p-title" style="display:block">Checkout can't be completed with a keyboard</span><span class="p-meta" style="display:block">WCAG 2.1.1 · checkout</span></span></li>
          <li>${badge('high', 'High')}<span><span class="p-title" style="display:block">Form errors aren't announced to screen readers</span><span class="p-meta" style="display:block">WCAG 3.3.1, 4.1.3 · sign-up</span></span></li>
        </ol>
      </div>
    </section>
    <section class="card weights">
      <h3>Points per issue</h3>
      <table>
        <thead><tr><th scope="col">Severity</th><th scope="col" class="num">Points</th><th scope="col">Means</th></tr></thead>
        <tbody>
          <tr><td>${badge('critical', 'Critical')}</td><td class="num">−10</td><td>Blocks a key task</td></tr>
          <tr><td>${badge('high', 'High')}</td><td class="num">−5</td><td>Major barrier</td></tr>
          <tr><td>${badge('medium', 'Medium')}</td><td class="num">−2</td><td>Has a workaround</td></tr>
          <tr><td>${badge('low', 'Low')}</td><td class="num">−0.5</td><td>Minor annoyance</td></tr>
        </tbody>
      </table>
      <p class="fine">Scaled to your product's size. The score tracks progress; conformance means zero failures.</p>
    </section>
  </div>

  <h2 class="section">Common questions</h2>
  <div class="faq">
    <section>
      <h3>Can't we just use a plugin?</h3>
      <p>Plugins and scanners catch only 30–40% of issues. We add hands-on keyboard and screen reader testing.</p>
    </section>
    <section>
      <h3>Do you fix issues, or just find them?</h3>
      <p>Both. You get developer-ready tickets and a phased plan; we fix or support your team, then re-test.</p>
    </section>
    <section>
      <h3>What do you need from us?</h3>
      <p>Your key pages or sitemap, test accounts for each user role, staging access, and code access.</p>
    </section>
  </div>

  <div class="cta">
    <p><strong>Not sure where you stand?</strong> Start with a short discovery call to scope your audit.</p>
  </div>
</main>
</body>
</html>`;

writeFileSync(htmlPath, html);

const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
  .find((c) => c && existsSync(c));
if (!chrome) { console.error(`No Chrome found. Set CHROME_PATH. HTML written to ${htmlPath}`); process.exit(2); }
execFileSync(chrome, [
  '--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--export-tagged-pdf',
  '--virtual-time-budget=15000', `--print-to-pdf=${out}`, pathToFileURL(htmlPath).href,
], { stdio: ['ignore', 'ignore', 'pipe'] });

const headings = [...html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
const extras = join(here, 'prospect-one-pager.extras.json');
writeFileSync(extras, JSON.stringify({ headings }));
const python = join(SKILL, '.venv/bin/python');
console.log(execFileSync(existsSync(python) ? python : 'python3', [join(SKILL, 'scripts/pdfua_fix.py'), out, extras], { encoding: 'utf8' }).trim());
execFileSync('rm', [extras]);
console.log(`PDF: ${out}`);
