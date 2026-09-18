# Accessibility Scanning (Lighthouse + axe-core)

The toolkit runs two complementary engines against your **rendered** pages (real
browser, not source code) and maps every issue to WCAG success criteria,
severity, and a scorecard category.

- **Lighthouse** — Chrome's scored accessibility audits (~40 checks).
- **axe-core** — Deque's broader ruleset (~90+ rules) with `minor`/`moderate`/
  `serious`/`critical` impact levels and remediation links.
- **Combined** — runs both, then merges into one de-duplicated report for the
  widest coverage in a single deliverable.

---

## Lighthouse

### Set up and install

```bash
npm install -D lighthouse chrome-launcher
npm run scan:lighthouse -- http://localhost:3000
```

`npm run scan:lighthouse` runs a single page — the toolkit also provides a way to
run **every** page.

### Get URLs

```bash
npm run scan:lighthouse -- --urls ./urls.txt
# or crawl a sitemap:
npm run scan:lighthouse -- --sitemap http://localhost:3000/sitemap.xml
```

### Run Lighthouse on the URLs

Loads and renders each real page in a browser, not reading source code:

```bash
npm run scan:lighthouse -- --urls ./urls.txt --format markdown --out a11y-lighthouse.md
```

---

## axe-core

### Set up and install

```bash
npm install -D puppeteer @axe-core/puppeteer
npm run scan:axe -- http://localhost:3000
```

`npm run scan:axe` runs a single page; use `--urls` / `--sitemap` to run every
page. axe loads and renders each real page in a headless browser and inspects
the live DOM / accessibility tree.

### Get URLs

```bash
npm run scan:axe -- --urls ./urls.txt
# or crawl a sitemap:
npm run scan:axe -- --sitemap http://localhost:3000/sitemap.xml
```

### Run axe on the URLs

```bash
npm run scan:axe -- --urls ./urls.txt --format markdown --out a11y-axe.md
```

axe reports the exact measured contrast ratio and a `failureSummary` per element,
plus a `helpUrl` remediation link for every rule.

---

## Combined scan (Lighthouse + axe-core)

Runs **both** engines against the same page(s) and merges the results into one
report. Issues reported by both tools (e.g. a missing `img` alt on the same
element) are **de-duplicated** into a single finding tagged with every source
that flagged it (`source: "axe+lighthouse"`).

### Set up and install

```bash
npm install -D lighthouse chrome-launcher puppeteer @axe-core/puppeteer
```

### Run the combined scan

```bash
# Live — runs Lighthouse + axe on every page and merges the reports
npm run scan:all -- --urls ./urls.txt --format markdown --out a11y-report.md

# Offline — merge pre-computed engine outputs, no browser needed
npm run scan:all -- --lhr ./lighthouse.json --results ./axe.json
```

### How the merge works

| Aspect | Behaviour |
|---|---|
| De-duplication | Findings collapse when they describe the same element on the same page under the same criteria |
| Source tracking | Surviving finding records every tool in `source` and `evidence.sources` |
| Severity | The **higher** severity of the duplicate pair is kept |
| Overall score | Average of each engine's score |
| WCAG A/AA/AAA | Averaged across engines |
| Category scorecard | Recomputed from the merged finding set |
| Effort estimate | Derived from the merged findings, so a shared issue is costed once |

### Matching the same element across engines

The engines do not agree on how to name an element, so an exact selector match
would never fire — and every issue found by both would be reported, and costed,
twice. axe emits the shortest unique selector while Lighthouse emits a full
ancestor path:

```
axe:        .breadcrumb__link
lighthouse: div.banner-content-block__wrapper > nav.breadcrumb > div.tw-flex > a.breadcrumb__link
```

Findings in the same `page + category + criteria` bucket, from engines that have
not already been merged, are paired on the first of these that holds:

1. **Same DOM id** on the target element.
2. **A shared class** on the target element (the selector tail, with
   pseudo-classes and attribute selectors stripped, so `h3` matches
   `h3:nth-child(6)`).
3. **A common HTML prefix** of at least 12 characters — the engines truncate
   snippets at different lengths, so only a prefix is comparable. This is what
   pairs elements the two engines picked different classes for.
4. **The same tag name**, when neither side has any class or id to go on
   (`<h3>` vs `h3:nth-child(6)`).

Rule 4 is deliberately last and deliberately narrow: two genuinely different
anonymous `<h3>`s on one page, each found by only one engine, would merge. That
undercounts by one; the alternative double-counts everything.

## Concurrency (`--concurrency`)

Scans are serial by default — one page, both engines, then the next. At roughly
45–60s per page that puts a 200-page property out of reach, so pass
`--concurrency` to run several pages at once:

```bash
npm run scan:all -- --urls ./urls.txt --concurrency 6
```

Results are collected in **input order**, not completion order, so reports are
byte-identical regardless of how the pages happen to finish. Each worker
launches its own Chrome, so concurrency is bounded by RAM more than CPU — 4–8 is
a reasonable range on a laptop, and the flag is capped at 16. Only the
accessibility category runs, which is not timing-sensitive, so parallel pages do
not skew results the way a Lighthouse performance run would.

### Example output

```
Overall score: 88% (WCAG AA target)

Critical: 0 🔴
High: 3 🟠 — color contrast
Medium: 26 🟡 — mostly missing iframe titles + a few ARIA attribute issues
Low: 4 🟢 — landmark/region best-practice items
```

**The real issues…**

- **Color contrast (High)** — `h3.ant-typography` inside Ant Design card headers
  (`div.ant-card-head-title`) fails the 1.4.3 AA contrast ratio (reported by both
  engines; axe includes the measured ratio, e.g. "insufficient color contrast of
  2.1:1"). Likely a theme token for card-header text.
- **Missing iframe titles (Medium, ×many)** — an `<iframe>` (rendered inside
  `div.css-dev-only-do-not-override-*`) has no `title` attribute (WCAG 4.1.2).
  Repeats across pages, so it's one shared component. The
  `css-dev-only-do-not-override` class suggests Ant Design / emotion in dev mode —
  possibly the Refine devtools panel or an embedded frame.

---

## Form factor (`--form-factor`)

Both engines are pinned to the **same** emulated device, defaulting to `mobile`
(Moto G Power, 412×823 @ 1.75x — Lighthouse's own default device).

This matters more than it sounds. Lighthouse emulates mobile by default, while
Puppeteer — which drives axe — defaults to an 800×600 desktop window. Left
unset, the two engines audit *different renderings of the same URL*, so on a
responsive site they see different DOM and disagree for reasons unrelated to
their rulesets. The same four AdaptHealth pages produce **18 findings at mobile
and 26 at desktop**.

```bash
# Pages consumed inside a mobile app WebView (the default)
npm run scan:all -- --urls ./urls.txt --form-factor mobile --platform react-native

# A desktop web property
npm run scan:all -- --urls ./urls.txt --form-factor desktop --platform web
```

Pick the form factor your users actually have. Scanning both is a reasonable
belt-and-braces move for responsive sites, since breakpoint-specific issues only
appear at one of them — run the command twice with different `--out` files.

`--platform` only labels the assessment and its findings; it does not change
which rules run. Use `react-native` when the pages are WebView content inside a
mobile app so the report doesn't read as a desktop web audit.

## Common options (all scan scripts)

| Flag | Description |
|---|---|
| `<url> [<url> ...]` | One or more pages to scan |
| `--urls <file>` | Read URLs from a file (one per line, `#` comments allowed) |
| `--sitemap <url>` | Crawl a sitemap.xml for URLs (follows sitemap index files) |
| `--form-factor <mobile\|desktop>` | Device emulation for **both** engines (default: `mobile`) |
| `--concurrency <n>` | Pages to scan in parallel (default: `1`, max `16`) |
| `--platform <web\|ios\|android\|react-native>` | Platform recorded on the assessment and its findings (default: `web`) |
| `--level <A\|AA\|AAA>` | Target WCAG conformance level (default: `AA`) |
| `--format <console\|json\|markdown>` | Report format (default: `console`) |
| `--out <file>` | Write the report to a file |
| `--jira` | Create Jira tickets from findings |
| `--min-severity <critical\|high\|medium\|low>` | Only ticket issues at/above this severity |

`--jira` requires the `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, and
`JIRA_PROJECT_KEY` environment variables.

### Engine-specific offline flags

| Script | Offline input |
|---|---|
| `scan:lighthouse` | `--lhr <lhr.json>` |
| `scan:axe` | `--results <axe.json>` |
| `scan:all` | `--lhr <lhr.json> --results <axe.json>` |

---

## Programmatic use

All three flows are available from the package API for use in another repo:

```ts
import {
  lighthouseToAssessment,
  axeToAssessment,
  mergeAssessments,
  formatMarkdown,
} from "@bluetread/accessibility-toolkit";
import { writeFileSync } from "node:fs";

const combined = mergeAssessments(
  [lighthouseToAssessment(lhr), axeToAssessment(axeResults)],
  { targetLevel: "AA" },
);

writeFileSync("a11y-report.md", formatMarkdown(combined));
```
