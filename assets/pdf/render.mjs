#!/usr/bin/env node
// Render an accessibility audit JSON file into an executive-summary PDF.
// Usage: node render.mjs <report.json> [out.pdf] [--html]
// Zero dependencies: builds HTML, then prints it with headless Chrome/Chromium.
//
// Vendored from the a11y-report-pdf Claude skill so `bt-a11y report` can build the
// PDF on any machine. Keep the two copies in sync when changing the design.
// Local additions: `pageNoun` ("screen" for mobile apps) and merged findings keep
// every distinct `location`.

import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

// ---------- reference data ----------

const WCAG = {
  '1.1.1': ['Non-text Content', 'A', 'Images, icons and other non-text content have a text alternative.'],
  '1.2.1': ['Audio-only and Video-only (Prerecorded)', 'A', 'Recorded audio has a transcript; silent video has a text or audio description.'],
  '1.2.2': ['Captions (Prerecorded)', 'A', 'Recorded video with sound has captions.'],
  '1.2.3': ['Audio Description or Media Alternative (Prerecorded)', 'A', 'Recorded video has an audio description or a full text alternative.'],
  '1.2.4': ['Captions (Live)', 'AA', 'Live video with sound has captions.'],
  '1.2.5': ['Audio Description (Prerecorded)', 'AA', 'Recorded video describes important visual details in audio.'],
  '1.3.1': ['Info and Relationships', 'A', 'Headings, lists, tables, labels and groups are marked up so assistive technology understands the structure.'],
  '1.3.2': ['Meaningful Sequence', 'A', 'Content is read in a logical order.'],
  '1.3.3': ['Sensory Characteristics', 'A', "Instructions don't rely only on shape, size, position or sound."],
  '1.3.4': ['Orientation', 'AA', 'Content works in both portrait and landscape.'],
  '1.3.5': ['Identify Input Purpose', 'AA', 'Common fields (name, email, address) are marked so browsers can autofill them.'],
  '1.4.1': ['Use of Color', 'A', 'Color is never the only way information is shown.'],
  '1.4.2': ['Audio Control', 'A', 'Audio that plays automatically can be paused or muted.'],
  '1.4.3': ['Contrast (Minimum)', 'AA', 'Text has enough contrast with its background (4.5:1, or 3:1 for large text).'],
  '1.4.4': ['Resize Text', 'AA', 'Text can be zoomed to 200% without losing content or function.'],
  '1.4.5': ['Images of Text', 'AA', 'Real text is used instead of pictures of text.'],
  '1.4.10': ['Reflow', 'AA', 'Content fits a 320px-wide screen without scrolling in two directions.'],
  '1.4.11': ['Non-text Contrast', 'AA', 'Controls, focus indicators and meaningful graphics have 3:1 contrast.'],
  '1.4.12': ['Text Spacing', 'AA', 'Nothing breaks when users increase line, letter or word spacing.'],
  '1.4.13': ['Content on Hover or Focus', 'AA', "Tooltips and pop-ups can be dismissed, hovered over and don't vanish unexpectedly."],
  '2.1.1': ['Keyboard', 'A', 'Everything can be done with a keyboard alone.'],
  '2.1.2': ['No Keyboard Trap', 'A', 'Keyboard focus never gets stuck in one place.'],
  '2.1.4': ['Character Key Shortcuts', 'A', 'Single-key shortcuts can be turned off or remapped.'],
  '2.2.1': ['Timing Adjustable', 'A', 'Users can turn off, adjust or extend time limits.'],
  '2.2.2': ['Pause, Stop, Hide', 'A', 'Moving, blinking or auto-updating content can be paused or hidden.'],
  '2.3.1': ['Three Flashes or Below Threshold', 'A', 'Nothing flashes more than three times a second.'],
  '2.4.1': ['Bypass Blocks', 'A', 'Users can skip repeated content such as navigation.'],
  '2.4.2': ['Page Titled', 'A', 'Every page has a descriptive title.'],
  '2.4.3': ['Focus Order', 'A', 'Keyboard focus moves in a logical order.'],
  '2.4.4': ['Link Purpose (In Context)', 'A', "Each link's purpose is clear from its text or context."],
  '2.4.5': ['Multiple Ways', 'AA', 'There is more than one way to find a page, such as navigation and search.'],
  '2.4.6': ['Headings and Labels', 'AA', 'Headings and labels describe their topic or purpose.'],
  '2.4.7': ['Focus Visible', 'AA', 'Users can always see which element has keyboard focus.'],
  '2.4.11': ['Focus Not Obscured (Minimum)', 'AA', "Focused elements aren't hidden behind sticky headers or overlays."],
  '2.5.1': ['Pointer Gestures', 'A', 'Multi-finger or path gestures have a simple single-tap alternative.'],
  '2.5.2': ['Pointer Cancellation', 'A', 'Actions happen on release, so accidental taps can be cancelled.'],
  '2.5.3': ['Label in Name', 'A', "A control's accessible name includes its visible label."],
  '2.5.4': ['Motion Actuation', 'A', 'Features triggered by shaking or tilting have an alternative and can be turned off.'],
  '2.5.7': ['Dragging Movements', 'AA', 'Anything done by dragging can also be done with single clicks.'],
  '2.5.8': ['Target Size (Minimum)', 'AA', 'Click and tap targets are at least 24×24 px or well spaced.'],
  '3.1.1': ['Language of Page', 'A', 'The page declares its language.'],
  '3.1.2': ['Language of Parts', 'AA', 'Passages in a different language are marked.'],
  '3.2.1': ['On Focus', 'A', "Moving focus to an element doesn't trigger unexpected changes."],
  '3.2.2': ['On Input', 'A', "Changing a setting doesn't cause unexpected changes without warning."],
  '3.2.3': ['Consistent Navigation', 'AA', 'Navigation appears in the same order on every page.'],
  '3.2.4': ['Consistent Identification', 'AA', 'Things that do the same job are labelled the same way.'],
  '3.2.6': ['Consistent Help', 'A', 'Help options appear in the same place on every page.'],
  '3.3.1': ['Error Identification', 'A', 'Errors are clearly identified and described in text.'],
  '3.3.2': ['Labels or Instructions', 'A', 'Fields have labels or instructions.'],
  '3.3.3': ['Error Suggestion', 'AA', 'Error messages suggest how to fix the problem.'],
  '3.3.4': ['Error Prevention (Legal, Financial, Data)', 'AA', 'Important submissions can be reviewed, corrected or undone.'],
  '3.3.7': ['Redundant Entry', 'A', "Users aren't asked to re-enter information they already provided."],
  '3.3.8': ['Accessible Authentication (Minimum)', 'AA', "Logging in doesn't require solving puzzles or memorizing; paste and password managers work."],
  '4.1.2': ['Name, Role, Value', 'A', 'Every control exposes its name, role and state to assistive technology.'],
  '4.1.3': ['Status Messages', 'AA', 'Status updates are announced without moving focus.'],
};

const SEVERITIES = [
  { key: 'critical', label: 'Critical', weight: 10 },
  { key: 'high', label: 'High', weight: 5 },
  { key: 'medium', label: 'Medium', weight: 2 },
  { key: 'low', label: 'Low', weight: 0.5 },
];
const SEV_RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s.key, i]));

const PRINCIPLES = [
  { key: 'P', plain: 'Everyone can take in the content by sight, sound, screen reader or zoom.', name: 'Perceivable', question: 'Can every user see or hear the content?',
    pass: ['Text alternatives for images and icons', 'Sufficient text and UI contrast', 'Content reflows and resizes without loss', 'Information not conveyed by color alone'] },
  { key: 'O', plain: 'Everyone can use every control and get around, with a mouse, keyboard or other device.', name: 'Operable', question: 'Can every user navigate and interact?',
    pass: ['Every control reachable and usable by keyboard', 'Clear, visible focus indicator throughout', 'No keyboard traps in menus, modals or date pickers', 'Skip link, logical focus order and descriptive page titles'] },
  { key: 'U', plain: 'Text, forms and behavior are clear and predictable, and help people fix mistakes.', name: 'Understandable', question: 'Is the content and behavior clear?',
    pass: ['Every field has a visible label', 'Errors explain what went wrong and how to fix it', 'Page language declared', 'Consistent labels and navigation'] },
  { key: 'R', plain: 'The app works reliably with assistive technology such as screen readers.', name: 'Robust', question: 'Does it work with assistive technology?',
    pass: ['Semantic HTML with valid, well-formed markup', 'Custom components expose correct name, role and state', 'Status updates are announced to screen readers', 'Landmarks identify page regions'] },
];

// ---------- helpers ----------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sevLabel = (k) => SEVERITIES[SEV_RANK[k]]?.label ?? k;
const badge = (k) => `<span class="badge sev-${k}">${esc(sevLabel(k))}</span>`;
const pageLabel = (p) => {
  try { const u = new URL(p); return u.pathname + u.search || '/'; } catch { return p; }
};
const shortPage = (p) => (isUrl(p) ? pageLabel(p).split('/').filter(Boolean)[0] ?? '/' : p.replace(/\s*\(.*\)$/, ''));
const isUrl = (s) => /^https?:\/\//.test(s ?? '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmtDate = (d) => {
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

function normalize(f) {
  const sev = String(f.severity).toLowerCase();
  const wcag = (f.wcag ?? []).map((w) => (typeof w === 'string' ? { id: w } : w))
    .map((w) => ({ ...w, name: w.name ?? WCAG[w.id]?.[0] ?? '', level: w.level ?? WCAG[w.id]?.[1] ?? '' }));
  const principle = f.principle ?? (wcag[0] ? 'POUR'[Number(wcag[0].id[0]) - 1] : 'R');
  return { ...f, severity: sev, wcag, principle, pages: [].concat(f.page ?? f.pages ?? []) };
}

// Merge findings that share a rule (same issue reported on several pages).
function groupFindings(findings) {
  const map = new Map();
  for (const f of findings) {
    const key = f.group ?? f.rule ?? f.title;
    const g = map.get(key);
    if (!g) { map.set(key, { ...f, count: 1, pages: [...f.pages], locations: f.location ? [f.location] : [] }); continue; }
    g.count++;
    for (const p of f.pages) if (!g.pages.includes(p)) g.pages.push(p);
    if (f.location && !g.locations.includes(f.location)) g.locations.push(f.location);
    if (SEV_RANK[f.severity] < SEV_RANK[g.severity]) g.severity = f.severity;
  }
  return [...map.values()].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.count - a.count);
}

const countBy = (list) => Object.fromEntries(SEVERITIES.map((s) => [s.key, list.filter((f) => f.severity === s.key).length]));

// ---------- HTML ----------

function render(data) {
  const findings = data.findings.map(normalize);
  const totals = countBy(findings);
  const total = findings.length;
  const byP = Object.fromEntries(PRINCIPLES.map((p) => [p.key, findings.filter((f) => f.principle === p.key)]));
  const failing = PRINCIPLES.filter((p) => byP[p.key].length);
  const maxP = Math.max(1, ...PRINCIPLES.map((p) => byP[p.key].length));
  const level = data.targetLevel ?? 'AA';
  const appName = data.title ?? `${data.client ?? '[Client Name]'} Web App`;
  const noun = data.pageNoun ?? 'page';
  const Noun = noun[0].toUpperCase() + noun.slice(1);

  const allPages = [...new Set(findings.flatMap((f) => f.pages))];
  const urlPages = allPages.filter(isUrl);
  const scope = data.scope ?? `${plural(urlPages.length, 'page')}${allPages.length > urlPages.length ? ' + global shell' : ''}`;
  const inferredUsed = findings.some((f) => f.wcagInferred);

  const meta = [
    ['Audit date', fmtDate(data.auditDate ?? data.generated ?? new Date().toISOString())],
    ['Target', data.standard ?? `WCAG 2.2 ${level}`],
    ['Scope', scope],
    ['Prepared by', data.preparedBy ?? 'BlueTread'],
  ];

  const tiles = [{ n: total, label: 'Total issues' }, ...SEVERITIES.map((s) => ({ n: totals[s.key], label: s.label, sev: s.key }))];

  const principleCard = (p) => {
    const list = byP[p.key];
    const groups = groupFindings(list);
    const pass = list.length === 0;
    const summary = data.principleSummaries?.[p.key] ?? (pass ? 'No issues found.' : '');
    const body = pass
      ? `<ul class="checks">${(data.passNotes?.[p.key] ?? p.pass).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
      : `<ul class="issues">${groups.slice(0, 4).map((g) => `
          <li>${badge(g.severity)}<span class="issue-title">${esc(g.short ?? g.title)}${g.count > 1 ? ` <span class="muted">(×${g.count})</span>` : ''}</span>
          <code>${esc(g.wcag[0]?.id ?? '')}${g.wcagInferred ? '*' : ''}</code></li>`).join('')}</ul>
          ${groups.length > 4 ? `<p class="more">+ ${plural(groups.length - 4, 'more issue type')} in the detailed findings</p>` : ''}`;
    return `
      <section class="card principle">
        <header>
          <span class="letter" aria-hidden="true">${p.key}</span>
          <div><h3>${p.name}</h3><p class="question">${p.question}</p></div>
          <span class="status ${pass ? 'pass' : 'fail'}">${pass ? 'Pass' : 'Needs remediation'}</span>
        </header>
        <p class="summary">${esc(summary)} ${pass ? '' : `${plural(list.length, 'issue')} found.`}</p>
        ${body}
      </section>`;
  };

  const bars = PRINCIPLES.map((p) => {
    const c = countBy(byP[p.key]);
    const n = byP[p.key].length;
    const segs = SEVERITIES.filter((s) => c[s.key]).map((s) =>
      `<span class="seg sev-${s.key}" style="width:${(c[s.key] / maxP) * 100}%" title="${s.label}: ${c[s.key]}"></span>`).join('');
    const desc = n ? SEVERITIES.filter((s) => c[s.key]).map((s) => `${c[s.key]} ${s.label.toLowerCase()}`).join(' · ') : 'No issues found';
    // The breakdown is printed as text, so the segment colors are never the only cue (WCAG 1.4.1).
    return `<div class="bar-row" role="listitem">
      <span class="bar-name">${p.name}</span>
      <span class="track" aria-hidden="true">${segs}</span>
      <span class="bar-n">${n}</span>
      <span class="bar-desc">${desc}</span></div>`;
  }).join('');

  const phases = data.phases ?? [
    { title: 'Remove blockers', items: groupFindings(findings.filter((f) => f.severity === 'critical')).map((g) => g.short ?? g.title) },
    { title: 'Fix high-impact barriers', items: groupFindings(findings.filter((f) => f.severity === 'high')).map((g) => g.short ?? g.title) },
    { title: 'Polish and harden', items: groupFindings(findings.filter((f) => ['medium', 'low'].includes(f.severity))).map((g) => g.short ?? g.title) },
  ].filter((p) => p.items.length);

  const topGroups = groupFindings(findings).slice(0, data.topPriorityCount ?? 5);

  const levels = level === 'A' ? ['A'] : ['A', 'AA'];
  // Called from the template, after `criteria` below is built.
  const reference = () => PRINCIPLES.map((p, pi) => {
    const rows = Object.entries(WCAG).filter(([id, [, lv]]) => id.startsWith(`${pi + 1}.`) && levels.includes(lv));
    return `
    <section class="card wide ref">
      <h3><span class="letter sm" aria-hidden="true">${p.key}</span> ${p.name}</h3>
      <table><thead><tr><th scope="col">Criterion</th><th scope="col">Level</th><th scope="col">What it means</th><th scope="col">This audit</th></tr></thead>
      <tbody>${rows.map(([id, [name, lv, desc]]) => {
        const c = criteria.get(id);
        return `<tr><td><code>${id}</code>${c?.inferred ? '*' : ''} ${esc(name)}</td><td>${lv}</td><td>${esc(desc)}</td>
          <td>${c ? `${badge(c.severity)}<span class="ref-n">${plural(c.n, 'finding')}</span>` : '<span class="muted">—</span>'}</td></tr>`;
      }).join('')}</tbody></table>
    </section>`;
  }).join('');

  // ----- detail pages -----

  const levelPassing = data.levelPassing ? `
    <div class="card">
      <h3>WCAG level pass rate</h3>
      ${Object.entries(data.levelPassing).map(([lv, pct]) => `
        <div class="meter-row"><span class="bar-name">Level ${esc(lv)}</span>
          <span class="track"><span class="seg meter" style="width:${pct}%"></span></span><span class="bar-n">${pct}%</span></div>`).join('')}
      <p class="fine">Share of automatically testable success criteria at each level with no failing checks.</p>
    </div>` : '';

  const deduction = SEVERITIES.map((s) => ({ ...s, n: totals[s.key], d: totals[s.key] * s.weight }));
  const scoreTable = data.overallScore != null ? `
    <div class="card">
      <h3>How the ${esc(data.overallScore)}% score is calculated</h3>
      <table><thead><tr><th scope="col">Severity</th><th scope="col" class="num">Findings</th><th scope="col" class="num">Weight</th><th scope="col" class="num">Deduction</th></tr></thead>
      <tbody>${deduction.map((s) => `<tr><td>${badge(s.key)}</td><td class="num">${s.n}</td><td class="num">${s.weight}</td><td class="num">−${s.d}</td></tr>`).join('')}
      <tr class="total"><td>Raw total</td><td class="num">${total}</td><td class="num muted">—</td><td class="num">−${deduction.reduce((a, s) => a + s.d, 0)}</td></tr></tbody></table>
      <p class="fine">The score starts at 100. The raw deduction is normalized against the number of elements evaluated, so small pages aren't over-penalized, then subtracted from 100 and clamped to 0–100.</p>
    </div>` : '';

  const criteria = new Map();
  for (const f of findings) for (const w of f.wcag) {
    const c = criteria.get(w.id) ?? { ...w, severity: f.severity, n: 0, pages: new Set(), inferred: false };
    c.n++; f.pages.forEach((p) => c.pages.add(p));
    if (SEV_RANK[f.severity] < SEV_RANK[c.severity]) c.severity = f.severity;
    if (f.wcagInferred) c.inferred = true;
    criteria.set(w.id, c);
  }
  const criteriaRows = [...criteria.values()].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const criteriaTable = `
    <section class="card wide">
      <h3>Failing WCAG success criteria</h3>
      <table><thead><tr><th scope="col">Criterion</th><th scope="col">Level</th><th scope="col">Worst severity</th><th scope="col" class="num">Findings</th><th scope="col">Fails on</th></tr></thead>
      <tbody>${criteriaRows.map((c) => `<tr><td><code>${esc(c.id)}</code>${c.inferred ? '*' : ''} ${esc(c.name)}</td><td>${esc(c.level)}</td><td>${badge(c.severity)}</td><td class="num">${c.n}</td>
        <td class="pages">${[...c.pages].map((p) => esc(pageLabel(p))).join('<br>')}</td></tr>`).join('')}</tbody></table>
    </section>`;

  const scorecard = data.scorecard ? `
    <section class="card wide">
      <h3>Scorecard by category</h3>
      <table><thead><tr><th scope="col">Category</th><th scope="col">Score</th><th scope="col">Priority</th><th scope="col" class="num">Findings</th></tr></thead>
      <tbody>${data.scorecard.map((r) => `<tr><td>${esc(r.category)}</td>
        <td><span class="mini-track" aria-hidden="true"><span style="width:${r.score}%"></span></span> ${r.score}%</td>
        <td>${badge(String(r.priority).toLowerCase())}</td><td class="num">${r.findings}</td></tr>`).join('')}</tbody></table>
    </section>` : '';

  const detail = PRINCIPLES.filter((p) => byP[p.key].length).map((p) => `
    <h3 class="detail-h">${p.name} <span class="muted">· ${plural(byP[p.key].length, 'finding')}</span></h3>
    ${groupFindings(byP[p.key]).map((g) => `
      <article class="finding">
        <header>${badge(g.severity)}<h4>${esc(g.title)}</h4></header>
        <dl>
          <dt>WCAG</dt><dd>${g.wcag.map((w) => `<code>${esc(w.id)}</code>${g.wcagInferred ? '*' : ''} ${esc(w.name)} (${esc(w.level)})`).join(' · ') || '—'}</dd>
          <dt>${g.pages.length > 1 ? `${Noun}s` : Noun}</dt><dd>${g.pages.map((x) => esc(pageLabel(x))).join(', ')}</dd>
          ${g.element ? `<dt>Element</dt><dd><code>${esc(g.element)}</code></dd>` : ''}
          ${g.locations?.length ? `<dt>Location</dt><dd>${g.locations.map(esc).join('<br>')}</dd>` : ''}
          <dt>Issue</dt><dd>${esc(g.description)}</dd>
          ${g.remediation ? `<dt>Fix</dt><dd>${isUrl(g.remediation) ? `See <a href="${esc(g.remediation)}">rule documentation</a>.` : esc(g.remediation)}</dd>` : ''}
          <dt>Source</dt><dd class="muted">${esc(g.reportedBy ?? '')}${g.rule ? ` · <code>${esc(g.rule)}</code>` : ''}${g.count > 1 ? ` · reported ${g.count}×` : ''}</dd>
        </dl>
      </article>`).join('')}`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(appName)} · Accessibility Audit Summary</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>${CSS}</style>
</head>
<body>
<main>
  <header class="masthead">
    <div>
      <p class="eyebrow">Accessibility audit · Executive summary</p>
      <h1>${esc(appName)}</h1>
      <p class="lede">${esc(data.subtitle ?? `Assessed against WCAG 2.2 Level ${level}. Results are organized by the four POUR principles, the foundation of WCAG:`)}</p>
    </div>
    <dl class="meta">${meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <dl class="pour">${PRINCIPLES.map((p) => `<div><dt><span class="letter sm" aria-hidden="true">${p.key}</span>${p.name}</dt><dd>${esc(data.pourDescriptions?.[p.key] ?? p.plain)}</dd></div>`).join('')}</dl>
  </header>

  <section class="tiles" aria-label="Overall results">
    <div class="tile status-tile">
      ${data.overallScore != null ? `
      <p class="eyebrow">Accessibility score</p>
      <p class="score-big"><strong>${esc(data.overallScore)}</strong><span>/ 100</span><span class="conf-pill">${total ? 'Not yet conformant' : 'Conformant (automated)'}</span></p>
      <span class="score-track" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, Number(data.overallScore)))}%"></span></span>
      <p class="score-note">${esc(data.scoreNote ?? 'Starts at 100; every issue lowers it, weighted by severity.')} ${failing.length} of 4 principles need remediation for Level ${level}.</p>` : `
      <p class="eyebrow">Overall status</p>
      <p class="status-big">${total ? 'Not yet conformant' : 'Conformant (automated)'}</p>
      <p>${failing.length} of 4 principles need remediation before the app meets Level ${level}.</p>`}
    </div>
    ${tiles.map((t) => `<div class="tile"><p class="big">${t.n}</p><p>${t.sev ? `<span class="dot sev-${t.sev}" aria-hidden="true"></span>` : ''}${t.label}</p></div>`).join('')}
  </section>

  ${data.keyTakeaway ? `<p class="takeaway"><span class="eyebrow">Key takeaway</span>${esc(data.keyTakeaway)}</p>` : ''}

  <div class="cover-grid">
    <section class="card chart">
      <div class="chart-head"><h2>Issues by principle</h2></div>
      <div role="list">${bars}</div>
      <ul class="legend" aria-hidden="true">${SEVERITIES.map((s) => `<li><span class="dot sev-${s.key}"></span>${s.label}</li>`).join('')}</ul>
    </section>
    <section class="card priorities">
      <h2>Top priorities</h2>
      <ol>${topGroups.map((g) => `
        <li>${badge(g.severity)}<div><p class="p-title">${esc(g.short ?? g.title)}</p>
          <p class="p-meta">WCAG ${esc(g.wcag.map((w) => w.id).join(', '))} · ${esc(g.pages.length > 1 ? plural(g.pages.length, noun) : shortPage(g.pages[0] ?? ''))}</p></div></li>`).join('')}</ol>
    </section>
  </div>

  <section class="cover-phases" aria-label="Remediation path at a glance">
    <h2>Remediation path</h2>
    <ol>${phases.map((p, i) => `<li><span class="eyebrow mono">Phase ${i + 1}${p.duration ? ` · ${esc(p.duration)}` : ''}</span><strong>${esc(p.title)}</strong><span class="muted">${plural(p.items.length, 'fix')}</span></li>`).join('')}</ol>
  </section>

  <div class="page-break"></div>
  <h2>Results by principle</h2>
  <div class="grid">${PRINCIPLES.map(principleCard).join('')}</div>
  ${inferredUsed ? '<p class="fine">* Criterion not mapped by the source tool; assigned by the reviewer.</p>' : ''}

  <div class="page-break"></div>
  <h2>WCAG 2.2 Level ${level} reference</h2>
  <p class="ref-intro">Every success criterion required for Level ${level}, in plain language, with what this audit found.${data.targetLevel === 'AAA' ? ' Level AAA criteria are not listed.' : ''} A blank result means nothing surfaced in this audit's testing; it isn't a guarantee of conformance.</p>
  ${reference()}

  <section class="keep">
  <h2>Recommended remediation path</h2>
  <div class="phases">${phases.map((p, i) => `
    <section class="card phase">
      <p class="eyebrow mono">Phase ${i + 1}${p.duration ? ` · ${esc(p.duration)}` : ''}</p>
      <h3>${esc(p.title)}</h3>
      <ul>${p.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    </section>`).join('')}</div>
  </section>

  <h2>Detailed results</h2>
  <div class="grid">${levelPassing}${scoreTable}</div>
  ${criteriaTable}
  ${scorecard}

  <h2>Findings</h2>
  <p class="fine">Issues reported on several ${noun}s by the same rule are merged into one entry.${inferredUsed ? ' * marks a criterion assigned by the reviewer.' : ''}</p>
  ${detail}

  <footer class="fine">${esc(data.footer ?? 'Automated scanners cover roughly 30–40% of WCAG success criteria. Findings marked "manual" come from hands-on keyboard and screen reader testing. Full conformance requires manual review of every flow.')}
  ${data.generated ? ` Report generated ${esc(data.generated)}.` : ''}</footer>
</main>
</body>
</html>`;
}

const CSS = `
@page { size: Letter; margin: 0.55in 0.55in 0.6in; }
:root {
  --bg: #fff; --ink: #1d1f22; --muted: #5d6066; --line: #dbe3ec; --card: #f6f9fc;
  --critical: #0b2e59; --high: #2c64a8; --medium: #9cc2ea; --low: #e1eaf4;
  --pass-bg: #e8eef4; --pass-ink: #1f4e79; --fail-bg: #d3e3f6; --fail-ink: #0b2e59;
  --serif: 'Fraunces', 'Iowan Old Style', Georgia, serif;
  --sans: 'Inter', -apple-system, 'Helvetica Neue', Arial, sans-serif;
  --mono: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
}
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 9.5pt/1.45 var(--sans); }
main { max-width: 7.4in; margin: 0 auto; }
h1, h2, h3 { font-family: var(--serif); font-weight: 600; margin: 0; letter-spacing: -0.01em; }
h1 { font-size: 30pt; line-height: 1.02; }
h2 { font-size: 17pt; margin: 22px 0 10px; }
h3 { font-size: 13pt; }
p { margin: 0; }
code, .mono { font-family: var(--mono); font-size: 8pt; }
a { color: var(--pass-ink); }
.eyebrow { font-size: 7.5pt; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
.muted { color: var(--muted); font-weight: 400; }
.fine { font-size: 8pt; color: var(--muted); margin-top: 6px; }

.masthead { display: grid; grid-template-columns: 1.7fr 1fr; gap: 12px 24px; padding-bottom: 14px; border-bottom: 1.5px solid var(--ink); }
.lede { color: var(--ink); margin-top: 10px; max-width: 3.9in; }
.pour { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: 2px 0 0; }
.pour dt { font-weight: 600; font-size: 9pt; display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
.pour dd { margin: 0; font-size: 8pt; color: var(--muted); line-height: 1.4; }
.letter.sm { width: 18px; height: 18px; font-size: 8.5pt; }
.meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin: 6px 0 0; align-content: start; }
.meta dt { font-size: 8pt; color: var(--muted); }
.meta dd { margin: 0; font-weight: 600; font-size: 8.5pt; }

.tiles { display: grid; grid-template-columns: 2.6fr repeat(5, 1fr); gap: 8px; margin-top: 14px; break-inside: avoid; }
.tile { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; font-size: 8.5pt; }
.tile .big { font-family: var(--serif); font-size: 24pt; font-weight: 600; line-height: 1.1; margin-bottom: 4px; }
.tile.status-tile { background: var(--ink); color: #fff; border: 0; }
.status-tile .eyebrow { color: #c9cbd0; }
.status-big { font-family: var(--serif); font-size: 15pt; font-weight: 600; line-height: 1.1; margin-bottom: 4px; white-space: nowrap; }
.score-big { display: flex; align-items: baseline; gap: 0 6px; margin: 0 0 6px; flex-wrap: wrap; }
.score-big strong { font-family: var(--serif); font-size: 34pt; font-weight: 600; line-height: 0.95; }
.score-big > span:not(.conf-pill) { font-size: 11pt; color: #c9cbd0; }
.score-big::after { content: ''; flex-basis: 100%; order: 1; }
.conf-pill { order: 2; align-self: flex-start; margin-top: 6px; font-size: 7.5pt; font-weight: 600; background: var(--fail-bg); color: var(--fail-ink); border-radius: 999px; padding: 3px 9px; white-space: nowrap; }
.score-track { display: block; height: 7px; background: #3a3d42; border-radius: 4px; overflow: hidden; margin-bottom: 7px; }
.score-track span { display: block; height: 100%; background: #9cc2ea; }
.score-note { font-size: 8pt; color: #e4e5e8; line-height: 1.4; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; vertical-align: 0; }
.dot.sev-low { outline: 1px solid #a9bcd2; outline-offset: -1px; }

.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; break-inside: avoid; }
.card.wide { margin-top: 10px; break-inside: auto; }
.card h3 + * { margin-top: 8px; }
.principle header { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: start; margin-bottom: 10px; }
.letter { width: 28px; height: 28px; border-radius: 50%; background: var(--ink); color: #fff; display: grid; place-items: center; font-family: var(--serif); font-weight: 600; font-size: 12pt; }
.question { font-size: 8pt; color: var(--muted); }
.status { font-size: 7.5pt; font-weight: 600; border-radius: 999px; padding: 3px 9px; white-space: nowrap; }
.status.pass { background: var(--pass-bg); color: var(--pass-ink); }
.status.fail { background: var(--fail-bg); color: var(--fail-ink); }
.summary { margin-bottom: 10px; }
.issues, .checks, .phase ul { list-style: none; margin: 0; padding: 0; }
.issues li { display: grid; grid-template-columns: 58px 1fr auto; gap: 8px; align-items: start; padding: 4px 0; font-size: 8.5pt; }
.issues code { color: var(--muted); }
.checks li { padding: 3px 0 3px 18px; position: relative; font-size: 8.5pt; }
.checks li::before { content: '✓'; position: absolute; left: 0; color: var(--pass-ink); font-weight: 600; }
.more { font-size: 8pt; color: var(--muted); margin-top: 6px; }

.badge { display: inline-block; text-align: center; font-size: 7pt; font-weight: 600; border-radius: 4px; padding: 2px 6px; min-width: 52px; }
.sev-critical { background: var(--critical); color: #fff; }
.sev-high { background: var(--high); color: #fff; }
.sev-medium { background: var(--medium); color: #0b2e59; }
.sev-low { background: var(--low); color: #1d2f45; }

.chart { margin-top: 18px; }
.chart h2 { margin: 0; }
.chart-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.legend { list-style: none; display: flex; gap: 12px; margin: 0; padding: 0; font-size: 8pt; }
.bar-row, .meter-row { display: grid; grid-template-columns: 1.1in 1fr 28px; gap: 10px; align-items: center; padding: 6px 0; }
.bar-name { font-weight: 600; font-size: 8.5pt; }
.bar-n { text-align: right; font-weight: 600; }
.track { display: flex; height: 18px; background: #e6ecf3; border-radius: 4px; overflow: hidden; }
.seg { height: 100%; } .seg + .seg { border-left: 2px solid #fff; } .seg.sev-low { box-shadow: inset 0 0 0 1px #7d97b5; }
.bar-desc { grid-column: 2 / -1; margin-top: -7px; font-size: 7.5pt; color: var(--muted); }
.seg.meter { background: var(--pass-ink); }
.none { font-size: 7.5pt; color: var(--pass-ink); padding: 2px 8px; align-self: center; }

.phases { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.phase h3 { font-size: 11.5pt; margin-bottom: 8px; }
.phase li { font-size: 8pt; padding: 3px 0 3px 12px; position: relative; border-top: 1px solid var(--line); }
.phase li::before { content: '–'; position: absolute; left: 0; color: var(--muted); }

.page-break { break-before: page; }
.ref-intro { font-size: 8.5pt; color: var(--muted); margin: -4px 0 8px; }
.ref { padding: 10px 14px; }
.ref h3 { display: flex; align-items: center; gap: 6px; font-size: 11.5pt; }
.ref table { font-size: 8pt; table-layout: fixed; }
.ref th:nth-child(1) { width: 34%; } .ref th:nth-child(2) { width: 7%; } .ref th:nth-child(4) { width: 17%; }
.ref td { padding: 4px 6px; }
.ref .badge { min-width: 0; margin-right: 4px; }
.ref-n { font-size: 7.5pt; color: var(--muted); white-space: nowrap; }
.keep { break-inside: avoid; }
h2 { break-after: avoid; }
.takeaway { margin-top: 12px; padding: 10px 16px; border-left: 4px solid var(--critical); background: var(--fail-bg); border-radius: 0 8px 8px 0; font-family: var(--serif); font-size: 12pt; line-height: 1.35; }
.takeaway .eyebrow { display: block; font-family: var(--sans); color: var(--fail-ink); }
.cover-grid { display: grid; grid-template-columns: 1.1fr 1fr; gap: 10px; margin-top: 12px; }
.cover-grid h2 { font-size: 14pt; margin: 0 0 10px; }
.cover-grid .chart { margin-top: 0; }
.cover-grid .chart-head { margin-bottom: 4px; }
.cover-grid .bar-row { grid-template-columns: 0.95in 1fr 22px; }
.cover-grid .legend { margin-top: 8px; flex-wrap: wrap; }
.priorities ol { list-style: none; margin: 0; padding: 0; counter-reset: pri; }
.priorities li { display: grid; grid-template-columns: 56px 1fr; gap: 8px; padding: 5px 0; border-top: 1px solid var(--line); align-items: start; }
.priorities li:first-child { border-top: 0; padding-top: 0; }
.p-title { font-weight: 600; font-size: 8.5pt; line-height: 1.3; }
.p-meta { font-size: 7.5pt; color: var(--muted); margin-top: 1px; }
.cover-phases { margin-top: 12px; break-inside: avoid; }
.cover-phases h2 { font-size: 14pt; margin: 0 0 8px; }
.cover-phases ol { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.cover-phases li { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-top: 3px solid var(--ink); background: var(--card); border-radius: 0 0 8px 8px; font-size: 9pt; }
.cover-phases li:nth-child(2) { border-top-color: #6b6e74; }
.cover-phases li:nth-child(3) { border-top-color: #b3b5ba; }
.cover-phases .muted { font-size: 8pt; }
table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
th { text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 600; padding: 4px 6px; border-bottom: 1px solid var(--ink); }
td { padding: 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
tr { break-inside: avoid; }
.num { text-align: right; }
tr.total td { font-weight: 600; border-bottom: 0; }
td.pages { font-family: var(--mono); font-size: 7.5pt; color: var(--muted); }
.mini-track { display: inline-block; width: 60px; height: 6px; background: #e6ecf3; border-radius: 3px; vertical-align: middle; margin-right: 6px; overflow: hidden; }
.mini-track span { display: block; height: 100%; background: var(--pass-ink); }

.detail-h { margin: 18px 0 8px; font-size: 14pt; break-after: avoid; }
.finding { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; break-inside: avoid; }
.finding header { display: flex; gap: 10px; align-items: baseline; margin-bottom: 8px; }
.finding h4 { margin: 0; font-size: 10pt; font-weight: 600; }
.finding dl { display: grid; grid-template-columns: 0.75in 1fr; gap: 4px 10px; margin: 0; font-size: 8.5pt; }
.finding dt { color: var(--muted); font-weight: 600; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.04em; padding-top: 1px; }
.finding dd { margin: 0; }
footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid var(--line); }
`;

// ---------- PDF ----------

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  const pw = join(homedir(), 'Library/Caches/ms-playwright');
  if (existsSync(pw)) for (const d of readdirSync(pw).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
    candidates.push(join(pw, d, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'), join(pw, d, 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium'));
  }
  return candidates.find((c) => c && existsSync(c));
}

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
if (!input) { console.error('Usage: node render.mjs <report.json> [out.pdf] [--html]'); process.exit(1); }
const out = resolve(args.filter((a) => !a.startsWith('--'))[1] ?? input.replace(/\.json$/i, '') + '.pdf');
const htmlPath = out.replace(/\.pdf$/i, '') + '.html';

writeFileSync(htmlPath, render(JSON.parse(readFileSync(input, 'utf8'))));
const chrome = findChrome();
if (!chrome) { console.error(`No Chrome/Chromium found. Set CHROME_PATH. HTML written to ${htmlPath}`); process.exit(2); }
execFileSync(chrome, [
  '--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--export-tagged-pdf', '--generate-pdf-document-outline',
  '--virtual-time-budget=15000', `--print-to-pdf=${out}`, pathToFileURL(htmlPath).href,
], { stdio: ['ignore', 'ignore', 'pipe'] });
// Chrome's tagged PDF still misses a few PDF/UA-1 requirements; pdfua_fix.py (pikepdf) closes them.
const html = readFileSync(htmlPath, 'utf8');
const links = Object.fromEntries([...html.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1].replace(/&amp;/g, '&'), m[2]]));
const linksPath = out.replace(/\.pdf$/i, '') + '.links.json';
const decode = (t) => t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const headings = [...html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g)].map((m) => decode(m[1]));
writeFileSync(linksPath, JSON.stringify({ links, headings }));
const here = fileURLToPath(new URL('.', import.meta.url));
const python = [process.env.PDFUA_PYTHON, join(here, '../.venv/bin/python'), join(homedir(), '.claude/skills/a11y-report-pdf/.venv/bin/python'), 'python3'].find((p) => {
  if (!p) return false;
  try { execFileSync(p, ['-c', 'import pikepdf'], { stdio: 'ignore' }); return true; } catch { return false; }
});
if (python) {
  console.log(execFileSync(python, [join(here, 'pdfua_fix.py'), out, linksPath], { encoding: 'utf8' }).trim());
} else {
  console.warn('Warning: pikepdf not found, so the PDF is tagged but NOT PDF/UA conformant.\n' +
    `  Fix: python3 -m venv ${join(here, '../.venv')} && ${join(here, '../.venv/bin/pip')} install pikepdf`);
}
unlinkSync(linksPath);
console.log(`PDF: ${out}${args.includes('--html') ? `\nHTML: ${htmlPath}` : ''}`);
if (!args.includes('--html')) unlinkSync(htmlPath);
