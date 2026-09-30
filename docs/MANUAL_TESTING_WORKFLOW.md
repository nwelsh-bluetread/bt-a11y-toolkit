# Manual Accessibility Testing — Workflow

A step-by-step process for running a manual accessibility pass with the toolkit.
For the full catalogue of *what* to check per WCAG level, see
[`MANUAL_TESTING.md`](./MANUAL_TESTING.md). This document covers *how to run the
session* — and, critically, what must be agreed **before** testing starts.

---

## 0. Before you start — establish scope (required)

A manual pass is only meaningful against a known surface. **Do not begin testing
until the scope below is written down.**

> **If the user (or engagement brief) has not provided these, the assistant must
> list them first — derived from the app, sitemap, route table, or navigation —
> and ask the user to confirm or correct the list before any testing begins.**
> Never silently assume scope.

Enumerate, at minimum:

### Pages / screens
The concrete list of surfaces under test. For web, pull from the sitemap, router
config, or `urls.txt`; for mobile/RN, from the navigation stack / screen registry.

- [ ] Every page/screen to be tested, by name **and** route/URL
- [ ] Key **states** per screen (empty, loading, error, success, populated)
- [ ] **Modals, drawers, toasts, and overlays** (they're separate surfaces)
- [ ] Auth-gated vs. public screens, and any test credentials needed

### Gestures / interactions
The input methods and gestures the app relies on — each needs an accessible path.

- [ ] Taps / clicks and **long-press**
- [ ] **Swipe** (carousels, dismiss, swipe-to-delete, drawer open/close)
- [ ] **Drag-and-drop / reorder**
- [ ] **Pinch / zoom / rotate** and multi-finger gestures
- [ ] **Pull-to-refresh**, infinite scroll
- [ ] Custom or path-based gestures (signature, slider, map pan)
- [ ] Device motion / shake, and any **timeouts** the user must beat

### Test conditions
- [ ] Target **WCAG level** (A / AA / AAA) — drives which checks apply
- [ ] Platforms & assistive tech (VoiceOver, TalkBack, NVDA, keyboard-only)
- [ ] Form factors / viewports (mobile, tablet, desktop, 320px reflow)

If any item is unknown, list it as an explicit **open question** rather than
skipping it — an unconfirmed screen or gesture is a coverage gap, not a pass.

---

## 1. Run the automated pass first

Automated tooling clears the ~30–40% of issues that are measurable, so the manual
session focuses on meaning and experience.

```bash
npm run scan:all -- --sitemap https://example.com/sitemap.xml --format markdown --out report.md
```

Review the report's **Failing WCAG Criteria** and **hotspot** sections to prioritise
which screens to test manually first.

---

## 2. Walk each screen × gesture

For every screen from step 0, exercise each relevant gesture with assistive tech
active. Use the level-appropriate tables in
[`MANUAL_TESTING.md`](./MANUAL_TESTING.md) as the checklist.

Generate a ready-to-fill checklist with the pages as columns:

```bash
# Pages as columns, one row per manual WCAG check for the target level
npm run checklist -- generate --level AA /login /dashboard /settings \
  --gesture "swipe to delete" --gesture "pinch to zoom" --out manual.md

# Or pull the page list straight from a sitemap; CSV for a spreadsheet
npm run checklist -- generate --sitemap https://example.com/sitemap.xml \
  --format csv --out manual.csv
```

Fill each cell with `pass`, `fail`, or `n/a` (blank = not yet tested). While
testing:

- Confirm every gesture has a **non-gesture equivalent** (WCAG 2.5.1 / 2.1.1).
- Confirm **focus/reading order** matches the visual flow on each screen.
- Confirm **touch targets** meet the size minimum (measure the rendered size).

---

## 3. Ingest the completed checklist

Feed the filled-in checklist back to the toolkit. Every `fail` becomes a
`Finding` with `source: "manual"`, the **screen** as `evidence.page`, and the
mapped WCAG criteria — so it flows into the same scorecard, WCAG rollup, trend
history, and Jira tickets as automated results.

```bash
# Manual findings only
npm run checklist -- ingest ./manual.md --format markdown --out manual-report.md

# Manual + automated merged into ONE report with ALL findings
npm run checklist -- ingest ./manual.md --merge ./auto-assessment.json \
  --format markdown --out final-report.md
```

The ingest prints a per-page coverage summary (fail / pass / n/a / untested) so
uncovered scope is visible, not silently dropped.

---

## 4. Verify coverage

Before signing off, confirm every item from step 0 was actually exercised:

- [ ] Every listed page/screen visited (including states and overlays)
- [ ] Every listed gesture tested for an accessible path
- [ ] Every open question resolved (not left unconfirmed)

Uncovered scope is reported as a gap, not omitted. The ingest's per-page
`untested` count is your coverage check.

