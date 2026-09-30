# @bluetread/accessibility-toolkit

BlueTread's internal, repeatable accessibility testing toolkit. Every audit uses
this as a baseline: reusable automated a11y checks, WCAG-mapped scoring, a report
generator, and Jira ticket creation — for **web** and **React Native**
applications.

```bash
npm install @bluetread/accessibility-toolkit
```

> This repo backs all work for the Accessibility Product: unit tests, scripts,
> and the shared toolkit. See [`docs/DEVELOPMENT_CHECKLISTS.md`](docs/DEVELOPMENT_CHECKLISTS.md)
> for the full Phase 1–4 engagement checklists, and
> [`docs/MANUAL_TESTING.md`](docs/MANUAL_TESTING.md) for what to test by hand
> (by WCAG level) after the automated scans run.

## Why

Manual audits are slow and inconsistent. This toolkit turns the repeatable parts
of an assessment into pure, testable functions that run anywhere (CI, Metro, a
browser), so every engagement starts from the same baseline and produces the same
report shape.

## Time estimates (running on a real client site)

Rough per-engagement effort once the toolkit is wired up. "Tool time" is mostly
unattended machine time; "analyst time" is the human work of reviewing,
validating, and de-duplicating. Estimates assume a **medium site/app (~15–30 key
screens)** and scale roughly linearly with screen count.

### Step 1 — Web tool auditing (issue list + severity + combined score)

Automated scanners run per page; a crawler batches them across the site.

| Tool | Setup | Run time (per page) | Analyst review | Notes |
| --- | --- | --- | --- | --- |
| **Lighthouse** | ~15 min | ~30–60 sec | — | Headless, fully automated |
| **axe DevTools** (axe-core) | ~30 min | ~5–15 sec | — | Injected via Puppeteer/Playwright |
| **Pa11y** (HTML_CodeSniffer + axe) | ~15 min | ~5–15 sec | — | Dual-runner; catches issues axe alone misses |
| **WAVE** (API) | ~15 min | ~5–10 sec | — | Optional; needs paid API key |
| **Consolidate + dedupe + score** | — | seconds | ~2–4 hrs | Merge tools, validate severity, map WCAG |

**Step 1 total:** ~**3–5 hours** for a medium site (mostly analyst validation;
the scans themselves finish in minutes even across 30 pages).

### Step 2 — Test suites for code (interaction/state, e.g. `aria-expanded`)

Writing behavioral tests scanners can't do (focus traps, live regions, toggles).

| Activity | Estimate |
| --- | --- |
| Wire the shared matchers into the client repo | ~1–2 hrs |
| Author component interaction tests (per key component) | ~20–40 min each |
| Typical component set (10–20 components) | ~**6–12 hours** |

This is the most variable step — it depends on how many custom interactive
components the client has. Reusable components pay off fastest.

### Step 3 — Full report (automated, manual entered first)

| Activity | Estimate |
| --- | --- |
| Enter manual findings (screen reader, keyboard, gestures) | logged during manual testing |
| Generate consolidated report (automated) | ~**seconds** |
| Executive summary write-up / polish | ~2–4 hrs |

Once manual findings are entered as `Finding[]`, the scored report + scorecard +
Jira tickets generate near-instantly. The human time is the manual testing
itself (see [`docs/MANUAL_TESTING.md`](docs/MANUAL_TESTING.md)) and the exec
summary, not the report generation.

### Filtering (adds negligible time)

Filtering is a config/flag concern, not extra work:

| Filter | Cost |
| --- | --- |
| **Web vs Mobile** (`platforms` tag) | instant — same data, filtered view |
| **AA vs AAA** (`targetLevel`) | instant — re-scores from the same findings |
| **Run parts at a time** (individual `scan:*` / test scripts) | instant — each step is independent |

### Ballpark for a full medium-site engagement

| Phase | Effort |
| --- | --- |
| Step 1 — Web tool auditing | ~3–5 hrs |
| Step 2 — Code test suites | ~6–12 hrs |
| Step 3 — Manual testing + report | ~10–18 hrs (mostly manual AT testing) |
| **Total (Phase 1 assessment)** | **~20–35 hrs** |

> These are automation-inclusive estimates. They align with the ~34–40 hr Phase 1
> figure in [`docs/DEVELOPMENT_CHECKLISTS.md`](docs/DEVELOPMENT_CHECKLISTS.md) —
> the toolkit shifts hours away from repetitive scanning toward analysis and
> manual testing. Large or complex apps scale up; small apps scale down.

## Core concepts

Everything operates on a platform-agnostic `A11yNode` tree. Platform **adapters**
(you provide/serialize these) convert a React Native element tree or a web DOM
into `A11yNode`s, then the shared rules evaluate them identically.

```
A11yNode tree ──► rules ──► findings ──► scoring ──► report / Jira tickets
```

## How the toolkit works (end-to-end)

The toolkit is a **consolidation + reporting core**. Every source of findings —
the built-in rules, external scanners (axe / Lighthouse / Pa11y), and the human
manual pass — normalizes into the same `Finding` model, so they all merge into
one scored report and one trend history.

```
0. AI lists pages/screens + gestures            → you confirm scope
1. Automated scans      axe · Lighthouse · Pa11y → Assessment (per engine)
   Built-in rules       A11yNode tree → runAudit → Assessment
2. Manual checklist     generate (pages = columns) → auditor fills in
   Ingest checklist     fill → Finding[] (source: "manual")
3. Merge everything     mergeAssessments(auto + manual) → ONE report
                        (de-duped across engines, WCAG-scored, per-file locations)
4. Persist run          recordRun() → history.jsonl  (discrete data)
5. Compare over time    diffRuns / trends → new · fixed · regressed · MTTR · hotspots
6. File tickets         createJiraTickets(assessment)
```

Each stage is independent and runnable on its own — you never have to run the
whole pipeline to use one part. The stages map to the docs in
[`docs/MANUAL_TESTING_WORKFLOW.md`](docs/MANUAL_TESTING_WORKFLOW.md).

## Skills (capabilities) vs. unit tests

Two different things share the word "test", so this table separates them:

- **Skills** = what the toolkit can *do* — the capabilities/modules you invoke.
- **Unit tests** = the Vitest suites that *prove each skill works* in CI.

| Skill (capability) | Module | What it does | Unit tests |
| --- | --- | --- | --- |
| **Baseline rules** | `src/rules.ts` | 13 pure WCAG-mapped rules over an `A11yNode` tree (names, roles, images, touch targets, labels, state, contrast). | `tests/rules.test.ts` (19) |
| **Contrast math** | `src/contrast.ts` | WCAG contrast ratio, luminance, large-text + threshold helpers (no deps). | `tests/contrast.test.ts` (8) |
| **Audit runner & scoring** | `src/audit.ts` | Runs rules → score, WCAG rollup, scorecard, top issues. | `tests/audit.test.ts` (14) |
| **Report formatters** | `src/report.ts` | console / json / markdown, incl. score breakdown + failing-criteria-by-file. | covered via `tests/audit.test.ts` |
| **axe integration** | `src/integrations/axe.ts` | axe-core results → `Finding`/`Assessment`; single + multi-page. | `tests/axe.test.ts` (17) |
| **Lighthouse integration** | `src/integrations/lighthouse.ts` | Lighthouse LHR → `Finding`/`Assessment`; single + multi-page. | `tests/lighthouse.test.ts` (12) |
| **Pa11y integration** | `src/integrations/pa11y.ts` | Pa11y (HTML_CodeSniffer + axe runner) → findings. | `tests/pa11y.test.ts` (15) |
| **Cross-engine merge** | `src/integrations/combined.ts` | De-dupes findings across engines by selector/HTML; records every source. | `tests/combined.test.ts` (8), `tests/crossEngine.test.ts` (18) |
| **Manual checklist** | `src/manual.ts` | Generate a pages-as-columns checklist; ingest the filled copy → manual findings. | `tests/manual.test.ts` (16) |
| **History (discrete data)** | `src/history.ts` | Stable `fingerprint`, `recordRun`, `diffRuns` (new/fixed/regressed). | `tests/history.test.ts` (16) |
| **Trends** | `src/trends.ts` | Score trend, recurring issues, MTTR, hotspots over run history. | `tests/trends.test.ts` (6) |
| **Jira tickets** | `src/integrations/jira.ts` | Findings → Jira Cloud issues (ADF, priority, WCAG refs). | `tests/jira.test.ts` (5) |
| **React Native adapter** | `src/react-native/` | Serializes a `react-test-renderer` tree into `A11yNode`s. | `tests/reactNative.test.ts` (33) |
| **Test matchers** | `src/matchers/` | `toHaveA11yName`, `toHaveRole`, `toMeetTouchTargetSize`, … | covered via `tests/rules.test.ts` |
| **Form factors** | `src/formFactor.ts` | Mobile/tablet/desktop viewport + emulation presets for scans. | `tests/formFactor.test.ts` (7) |
| **Concurrency** | `src/concurrency.ts` | Bounded parallel page scanning. | `tests/concurrency.test.ts` (11) |
| **Sitemap crawl** | `src/sitemap.ts` | Reads `sitemap.xml` (+ index) into a URL list for batch scans. | `tests/sitemap.test.ts` (10) |
| **Effort estimation** | `src/effort.ts` | Remediation-hour estimates per finding/severity. | `tests/effort.test.ts` (5) |

> Run everything with `npm test` (~220 unit tests, all green). Run one skill's
> suite with `npx vitest run tests/<file>.test.ts`. The catalogue above is the
> fastest way to see *what exists* and *where its proof lives*.


## Auditing mobile-only apps (no web)

WAVE, Lighthouse, Pa11y, and axe DevTools all require a **web DOM**, so they do **not**
apply to native mobile apps. For a mobile-only project, ignore those tools and
use the mobile toolchain below. The audit is inherently **more manual** than web
— there is no DOM-style automated scanner for native mobile — so budget extra
time for VoiceOver/TalkBack testing.

### Pick the toolchain by stack

| Stack | Static / source | On-device automated | Manual (required) |
| --- | --- | --- | --- |
| **React Native** | `eslint-plugin-react-native-a11y` + this toolkit's RN adapter → rules | iOS Accessibility Inspector, Android Accessibility Scanner | VoiceOver + TalkBack |
| **Native iOS** (Swift/UIKit/SwiftUI) | — | Xcode Accessibility Inspector Audit, XCUITest `performAccessibilityAudit()` | VoiceOver |
| **Native Android** (Kotlin/Java/Compose) | — | Accessibility Scanner, Espresso `AccessibilityChecks.enable()` | TalkBack |
| **Flutter** | Flutter a11y lints | Semantics debugger + native tools | VoiceOver + TalkBack |

### Three-layer workflow

1. **Static / source analysis** (automated, no device) — for React Native,
   `eslint-plugin-react-native-a11y` flags missing `accessibilityLabel`,
   `accessibilityRole`, and `accessibilityState` in source, and this toolkit's
   RN adapter serializes the element tree into `A11yNode`s so the existing
   [baseline rules](#baseline-automated-rules) run on mobile.
2. **On-device automated scans** — Xcode Accessibility Inspector / XCUITest on
   iOS; Accessibility Scanner / Espresso on Android. These catch labels,
   contrast, touch-target size, and traits per screen.
3. **Manual assistive-tech testing** (catches what automation can't) — walk every
   primary flow with **VoiceOver** (iOS) and **TalkBack** (Android): focus order,
   announcements, form errors, modal focus, dynamic content.

### Example: React Native app, no web access

```
Discovery ─► confirm RN version, screens, flows, test accounts

Phase 1 Assessment:
  1. Static   → eslint-plugin-react-native-a11y (CI)
  2. Toolkit  → RN adapter → A11yNode → baseline rules → Finding[] → report + Jira
  3. iOS      → Accessibility Inspector Audit + XCUITest performAccessibilityAudit
  4. Android  → Accessibility Scanner + Espresso checks
  5. Manual   → VoiceOver + TalkBack through all flows
  6. Consolidate all Finding[] → scorecard + executive report
```

Every layer normalizes into the same `Finding` model, so a mobile-only
engagement still produces one unified scorecard, WCAG rollup, and Jira tickets —
no web tooling involved. (The React Native adapter and native result-import
modules are on the [roadmap](#roadmap).)

## Quick start (library)

```ts
import { runAudit, formatConsole, formatMarkdown } from "@bluetread/accessibility-toolkit";

const tree = /* A11yNode from your adapter */;

const assessment = runAudit(tree, { platform: "react-native", targetLevel: "AA" });

console.log(formatConsole(assessment));
// Accessibility Assessment
// ────────────────────────────
// Overall Score: 62%
// Critical: 8
// ...
```

## Quick start (CLI)

The CLI audits a JSON file describing an `A11yNode` tree.

```bash
bt-a11y audit ./examples/login-screen.json --platform react-native
bt-a11y audit ./tree.json --format markdown --out a11y-report.md
```

Options:

| Flag | Description | Default |
| --- | --- | --- |
| `--platform` | `web` \| `ios` \| `android` \| `react-native` | `web` |
| `--level` | Target WCAG level `A` \| `AA` \| `AAA` | `AA` |
| `--format` | `console` \| `json` \| `markdown` | `console` |
| `--out` | Write report to a file | stdout |
| `--min-target` | Minimum touch target size (px/dp) | `24` (AA) / `44` (AAA) |
| `--jira` | Create Jira tickets from findings | off |
| `--min-severity` | Only ticket findings at/above this severity | all |

## Baseline automated rules

Each rule maps to WCAG success criteria and is a pure function over the node tree.

| Rule id | Check | WCAG |
| --- | --- | --- |
| `interactive-accessible-name` | Interactive elements have an accessible name | 4.1.2 |
| `button-role` | Buttons expose `role="button"` | 4.1.2 |
| `image-accessibility` | Images/icons have alt text or are hidden | 1.1.1 |
| `touch-target-size` | Touch targets meet minimum size (24px AA / 44px AAA) | 2.5.8 / 2.5.5 |
| `input-label` | Inputs have labels | 3.3.2, 1.3.1 |
| `required-state` | Required fields expose their state | 3.3.2 |
| `disabled-state` | Disabled controls expose disabled state | 4.1.2 |
| `selected-state` | Selected controls expose selected state | 4.1.2 |
| `expanded-state` | Expandable controls expose expanded state | 4.1.2 |
| `status-announcement` | Important status changes are announced | 4.1.3 |
| `decorative-hidden` | Decorative elements are hidden from AT | 1.1.1 |
| `custom-component-props` | Custom components forward a11y props | 4.1.2 |
| `text-contrast` | Text meets minimum contrast | 1.4.3 / 1.4.6 |

## Test matchers

Assert accessibility on individual nodes inside unit tests:

```ts
import { expect } from "vitest";
import { a11yMatchers } from "@bluetread/accessibility-toolkit/matchers";

expect.extend(a11yMatchers);

expect(buttonNode).toHaveA11yName();
expect(buttonNode).toHaveRole("button");
expect(iconNode).toBeHiddenFromAccessibility();
expect(touchNode).toMeetTouchTargetSize(44);
```

> The name matcher is `toHaveA11yName`, not `toHaveAccessibleName`:
> `@testing-library/react-native` auto-registers an element-based
> `toHaveAccessibleName` when a test imports it, which would silently
> override the toolkit's node-based matcher.

## React Native adapter

The matchers and `runAudit` operate on `A11yNode`s, so a rendered React Native
tree has to be serialized first. That is what
`@bluetread/accessibility-toolkit/react-native` does — point it at a
`react-test-renderer` instance, which is what `@testing-library/react-native`
hands back:

```tsx
import { render } from "@testing-library/react-native";
import { runAudit } from "@bluetread/accessibility-toolkit";
import { toA11yNode, toA11yTree } from "@bluetread/accessibility-toolkit/react-native";

// One element, for matcher assertions.
expect(toA11yNode(screen.getByTestId("save"))).toHaveA11yName();

// The whole screen, for a scored audit.
const assessment = runAudit(toA11yTree(render(<OrdersScreen />)), {
  platform: "react-native",
  targetLevel: "AA",
});
expect(assessment.findings.filter((f) => f.severity === "critical")).toEqual([]);
```

The adapter takes no dependency on `react` or `react-native` — it is
structurally typed against the renderer and ships its own style flattener — so
it is unit-testable in plain Node. Two things worth knowing:

- **Sizes are only known when declared.** `react-test-renderer` never performs
  layout, so `size` is populated from explicit `width`/`height` (plus
  `hitSlop`) and is `undefined` for anything sized by flex or padding. The
  touch-target rule skips those; verify them on-device with the Accessibility
  Inspector / Accessibility Scanner.
- **Style handles.** `StyleSheet.create` returns plain objects in current React
  Native, which the built-in flattener handles. If your RN version returns
  opaque registry ids, pass the real flattener:
  `toA11yTree(rendered, { flatten: StyleSheet.flatten })`.

## What unit tests catch that scanners can't

axe and WAVE are **snapshot scanners**: they inspect one rendered DOM state, at
one moment, and check static attributes. They are blind to anything requiring
**interaction, state changes, time, or knowledge of intent**. The unit-test
suite exists to cover exactly that gap.

> **axe / WAVE** — "Is the accessibility attribute present in this DOM snapshot?"
> **Unit tests** — "Does the component behave accessibly when state changes, time passes, or the user interacts?"

### 1. State that only exists after interaction

A scanner sees the page as it loads and can't click anything.

- **Accordion / disclosure** — does `aria-expanded` actually flip `false`→`true`
  when toggled?
- **Modal focus trap** — open a dialog, tab to the last element, tab again → does
  focus wrap back inside?
- **Menu / dropdown** — after opening, is focus moved to the first item? On `Esc`,
  does it close and return focus to the trigger?

```ts
fireEvent.click(getByRole("button", { name: "Details" }));
expect(getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "true");
```

### 2. Dynamic announcements

axe can confirm a `role="alert"` **exists**, but not that your code **puts the
error text into it at the right time**.

- Submit an invalid form → does the error message land in the live region so it's
  announced?
- A "Saved" toast — does it appear in an `aria-live` region *when the save
  completes*, not just exist empty in the DOM?

### 3. Focus management across flows

- After deleting a row, does focus move somewhere sensible (not to `<body>`,
  which strands screen-reader users)?
- After a route change in an SPA, is focus moved to the new page's heading?

### 4. Correct dynamic labels / values

axe checks a label **exists**; it can't verify it's the **right** label as data
changes.

- A "Like" button that toggles to "Unlike" — does the accessible name update with
  state?
- A slider whose `aria-valuenow` must track the actual value as you drag.
- A count badge — is "3 unread messages" announced, or just a bare "3"?

### 5. Conditional / edge-state rendering

Scanners test whatever state happens to be on screen.

- The **error state** of an input (only rendered after validation fails) — assert
  `aria-invalid` + `aria-describedby` point to the error.
- Loading / empty / disabled variants a page scan would never happen to catch.

### 6. Intent / meaning

- axe **can't tell** if an image is decorative or meaningful — it just warns
  "alt missing." A test for your `Avatar` component encodes the rule: *avatars
  must have the user's name as alt*.
- Whether a heading level is *correct* for the hierarchy vs. just *present*.

This is why the [baseline rules](#baseline-automated-rules) include behavioral
checks like `expanded-state`, `selected-state`, `status-announcement`, and
`custom-component-props` — the state/behavior checks a scanner structurally
cannot perform.

## Jira ticket creation

Turn findings into Jira Cloud issues (Atlassian Document Format descriptions,
priority mapped from severity, WCAG references included):

```ts
import { runAudit, createJiraTickets } from "@bluetread/accessibility-toolkit";

const assessment = runAudit(tree, { platform: "web" });

await createJiraTickets(assessment, {
  baseUrl: process.env.JIRA_BASE_URL!,
  email: process.env.JIRA_EMAIL!,
  apiToken: process.env.JIRA_API_TOKEN!,
  projectKey: "A11Y",
}, { minSeverity: "high" });
```

Or from the CLI with `--jira` (reads `JIRA_*` env vars).

## History & trends (discrete data tracking)

Each scan produces a stateless `Assessment`. To answer *"is this the same issue
we saw last week?"*, *"what did we fix?"*, and *"what regressed?"*, the toolkit
turns every run into a durable, comparable **run record** keyed by a stable
finding **fingerprint**.

### How it works

- **`fingerprint(finding)`** — a deterministic hash of the WCAG criteria +
  file/page + normalized selector. It deliberately **excludes the engine**, so
  the same issue found by axe *and* Pa11y fingerprints identically (corroboration
  doesn't fork the identity).
- **`recordRun(assessment, meta)`** — converts an `Assessment` into a
  serializable `RunRecord` (with `commitSha`, `branch`, timestamps, and a
  fingerprint per finding). Storage-agnostic — append it to a JSONL ledger,
  SQLite, or an artifact bucket.
- **`diffRuns(prev, next, priorFingerprints?)`** — classifies every finding as
  **new / fixed / regressed / persisting**, plus a score delta. Passing prior
  fingerprints distinguishes a true regression (fixed, then back) from a brand-new
  issue.
- **`mergeRunHistory(runs)` / `allFingerprints(runs)`** — carry `firstSeen`
  forward so issue **age** is accurate across the whole history.

### Trend analytics (`src/trends.ts`)

Pure functions over a chronological list of run records:

| Function | Answers |
| --- | --- |
| `scoreTrend(runs)` | Are we getting better or worse? (per-run score deltas) |
| `recurringIssues(runs)` | Which issues get fixed then keep coming back? (systemic signal) |
| `mttrByCategory(runs)` / `mttrBySeverity(runs)` | Mean/median **time-to-remediation** — empirical fix times |
| `hotspots(runs, limit)` | Which files/pages accumulate the most distinct issues? |

```ts
import { recordRun, diffRuns, allFingerprints, scoreTrend } from "@bluetread/accessibility-toolkit";

// After each scan, persist the run:
const record = recordRun(assessment, { commitSha, branch, label: "nightly" });
appendFileSync(".a11y-history/history.jsonl", JSON.stringify(record) + "\n");

// Compare to the previous run:
const diff = diffRuns(prev, next, allFingerprints(earlierRuns));
// → diff.new / diff.fixed / diff.regressed / diff.scoreDelta

// Chart the score over time:
scoreTrend(allRuns); // [{ runId, overallScore, delta }, ...]
```

Because manual findings ingest with `source: "manual"` and the same fingerprint
scheme, the trend history covers the **full** picture — automated *and* human
findings, tracked identically over time.


## Scripts & tests reference

Everything you can run, what it does, and how. All arguments after `--` are
passed through to the underlying script.

### npm scripts

| Script | What it does | Run |
| --- | --- | --- |
| `build` | Compiles `src/` to `dist/` (JS + type declarations) via `tsc`. | `npm run build` |
| `dev` | Same as `build` but in watch mode — rebuilds on save. Useful with `npm link`. | `npm run dev` |
| `clean` | Deletes the `dist/` output folder. | `npm run clean` |
| `typecheck` | Type-checks `src` + `scripts` + `tests` with no emit. Fast correctness gate. | `npm run typecheck` |
| `lint` | Runs ESLint across the repo. | `npm run lint` |
| `lint:fix` | Runs ESLint and auto-fixes what it can. | `npm run lint:fix` |
| `test` | Runs **all** unit tests once (Vitest). | `npm test` |
| `test:watch` | Runs all tests in watch mode, re-running on change. | `npm run test:watch` |
| `test:coverage` | Runs all tests and produces a coverage report (`text` + `html`). | `npm run test:coverage` |
| `test:lighthouse` | Runs **only** the Lighthouse integration tests. | `npm run test:lighthouse` |
| `test:axe` | Runs **only** the axe integration tests. | `npm run test:axe` |
| `test:pa11y` | Runs **only** the Pa11y integration tests. | `npm run test:pa11y` |
| `scan:lighthouse` | Standalone Lighthouse runner — one or many pages (see below). | `npm run scan:lighthouse -- <url> [<url> ...]` |
| `scan:axe` | Standalone axe-core runner — one or many pages. | `npm run scan:axe -- <url> [<url> ...]` |
| `scan:pa11y` | Standalone Pa11y runner (HTML_CodeSniffer + axe runner). | `npm run scan:pa11y -- <url> [<url> ...]` |
| `scan:all` | Runs Lighthouse **and** axe on the same pages, merged into one report. | `npm run scan:all -- <url> [<url> ...]` |
| `checklist` | Generate a manual checklist (pages as columns) or ingest a filled one. | `npm run checklist -- generate\|ingest ...` |
| `prepublishOnly` | Cleans + builds before `npm publish`. Runs automatically on publish. | (automatic) |

### CLI (`bt-a11y`)

Audits a JSON file describing an `A11yNode` tree (from a platform adapter).
Available after `npm run build` as `node dist/cli.js` or, once installed, `bt-a11y`.

```bash
# Audit a node tree, print the console report:
node dist/cli.js audit ./examples/login-screen.json --platform react-native

# Write a Markdown report to a file:
node dist/cli.js audit ./tree.json --format markdown --out a11y-report.md

# Create Jira tickets from findings (reads JIRA_* env vars):
node dist/cli.js audit ./tree.json --jira --min-severity high
```

See [CLI options](#quick-start-cli) above for the full flag list.

### Standalone tool runners (`scripts/`)

These run independently of each other so you only run the tool you need.

#### `scripts/lighthouse.ts` — `npm run scan:lighthouse`

Runs a Lighthouse accessibility scan (or reads a saved result), converts it
through the toolkit, and prints/writes a report. Can also file Jira tickets.
Pass **multiple URLs** (or a URL list / sitemap) to scan every page and get one
combined report.

```bash
# Live scan (needs Chrome + optional deps):
npm install -D lighthouse chrome-launcher
npm run scan:lighthouse -- https://example.com

# Scan MANY pages -> one combined score/report:
npm run scan:lighthouse -- https://example.com https://example.com/about https://example.com/contact

# Scan every URL listed in a file (one URL per line, `#` comments allowed):
npm run scan:lighthouse -- --urls ./urls.txt

# Scan every page in a sitemap.xml:
npm run scan:lighthouse -- --sitemap https://example.com/sitemap.xml

# Convert a saved Lighthouse result — no Chrome needed:
npm run scan:lighthouse -- --lhr ./examples/sample-lighthouse-result.json

# Choose a format and write to a file:
npm run scan:lighthouse -- https://example.com --format markdown --out lh.md

# Save the raw Lighthouse result for offline/later runs:
npm run scan:lighthouse -- https://example.com --save-lhr ./lhr.json

# File Jira tickets from the findings:
npm run scan:lighthouse -- https://example.com --jira --min-severity high
```

When scanning multiple pages, every finding is tagged with the page it came
from (`evidence.page`), the overall score is the **average** of the per-page
accessibility scores, and the WCAG rollups aggregate every audit across all
pages. A page that fails to load is skipped with a warning rather than aborting
the whole run.

| Flag | Description | Default |
| --- | --- | --- |
| `<url> [<url> ...]` | One or more URLs to scan live (requires `lighthouse` + `chrome-launcher`). | — |
| `--urls <file>` | Read URLs to scan from a file (one per line, `#` comments ignored). | — |
| `--sitemap <url>` | Fetch a `sitemap.xml` and scan every `<loc>` URL in it. | — |
| `--lhr <file>` | Read a saved Lighthouse Result JSON instead of scanning. No Chrome needed. | — |
| `--level <A\|AA\|AAA>` | Target WCAG level. | `AA` |
| `--format <console\|json\|markdown>` | Report format. | `console` |
| `--out <file>` | Write the report to a file. | stdout |
| `--save-lhr <file>` | Save the raw Lighthouse result(s). | — |
| `--jira` | Create Jira tickets from findings (needs `JIRA_*` env vars). | off |
| `--min-severity <critical\|high\|medium\|low>` | Only ticket findings at/above this severity. | all |

#### `scripts/axe.ts` — `npm run scan:axe`

Runs an axe-core scan (via Puppeteer) or converts a saved axe result, then
prints/writes a report. Same URL / sitemap / multi-page / Jira options as the
Lighthouse runner.

```bash
# Live scan (needs optional deps):
npm install -D puppeteer @axe-core/puppeteer
npm run scan:axe -- https://example.com

# Many pages -> one combined report:
npm run scan:axe -- --sitemap https://example.com/sitemap.xml --format markdown --out axe.md

# Convert a saved axe result — no browser needed:
npm run scan:axe -- --results ./examples/sample-axe-result.json
```

#### `scripts/pa11y.ts` — `npm run scan:pa11y`

Runs a Pa11y scan. Pa11y supports **two runners** — HTML_CodeSniffer (`htmlcs`,
the default) and `axe` — and you can run both in one pass for broader coverage.
HTML_CodeSniffer catches issues axe alone misses (and vice-versa), and the
results de-dupe against the other engines via `mergeAssessments`.

```bash
# Live scan (needs the optional dep):
npm install -D pa11y
npm run scan:pa11y -- https://example.com

# Run BOTH runners for the widest coverage:
npm run scan:pa11y -- https://example.com --runner axe --runner htmlcs

# Many pages -> one combined report:
npm run scan:pa11y -- --sitemap https://example.com/sitemap.xml --format markdown --out pa11y.md

# Convert a saved Pa11y result (issue array or full object) — no browser needed:
npm run scan:pa11y -- --results ./pa11y-result.json
```

| Flag | Description | Default |
| --- | --- | --- |
| `<url> [<url> ...]` | One or more URLs to scan live (requires `pa11y`). | — |
| `--runner <htmlcs\|axe>` | Test runner; repeat the flag to run several. | `htmlcs` |
| `--urls <file>` / `--sitemap <url>` | Batch URLs from a file or sitemap. | — |
| `--results <file>` | Read a saved Pa11y result instead of scanning. No browser needed. | — |
| `--level <A\|AA\|AAA>` | Target WCAG level (maps to `WCAG2A/AA/AAA`). | `AA` |
| `--format <console\|json\|markdown>` | Report format. | `console` |
| `--out <file>` | Write the report to a file. | stdout |
| `--jira` / `--min-severity <…>` | File Jira tickets (needs `JIRA_*` env vars). | off / all |

#### `scripts/scan.ts` — `npm run scan:all`

Runs **Lighthouse and axe** against the same page(s) and merges their results
into one de-duplicated report — the widest single-command coverage.

```bash
npm run scan:all -- --sitemap https://example.com/sitemap.xml --format markdown --out a11y-report.md
```

#### `scripts/checklist.ts` — `npm run checklist`

Generates a manual checklist (pages as columns) or ingests a filled-in one, so
manual findings merge with the automated report. See
[Manual checklist](#skills-capabilities-vs-unit-tests) and
[`docs/MANUAL_TESTING_WORKFLOW.md`](docs/MANUAL_TESTING_WORKFLOW.md).

```bash
# Generate a blank AA checklist for three screens:
npm run checklist -- generate --level AA /login /dashboard /settings --out manual.md

# Ingest the completed checklist AND merge with the automated scan:
npm run checklist -- ingest ./manual.md --merge ./auto-assessment.json --out final-report.md
```



Each file can be run on its own with `npx vitest run tests/<file>`.

| Test file | Covers | Run just this |
| --- | --- | --- |
| `tests/rules.test.ts` | The 13 baseline rules (names, roles, images, touch targets — incl. exact-size/adjacent-cluster cases, labels, contrast). | `npx vitest run tests/rules.test.ts` |
| `tests/contrast.test.ts` | WCAG contrast math (`parseHex`, `contrastRatio`, large-text + threshold helpers). | `npx vitest run tests/contrast.test.ts` |
| `tests/audit.test.ts` | The audit runner, scoring, WCAG rollups, scorecard, and report formatters. | `npx vitest run tests/audit.test.ts` |
| `tests/jira.test.ts` | Jira payload building, severity filtering, and ticket creation (mocked fetch). | `npx vitest run tests/jira.test.ts` |
| `tests/lighthouse.test.ts` | Lighthouse → `Finding`/`Assessment` conversion and mappings. | `npm run test:lighthouse` |
| `tests/axe.test.ts` | axe-core → `Finding`/`Assessment`, WCAG-tag decoding, single + multi-page. | `npx vitest run tests/axe.test.ts` |
| `tests/pa11y.test.ts` | Pa11y (HTML_CodeSniffer + axe runner) → findings; code parsing. | `npx vitest run tests/pa11y.test.ts` |
| `tests/combined.test.ts` | Cross-engine de-dupe (`mergeAssessments`, `isSameElement`, `selectorTail`). | `npx vitest run tests/combined.test.ts` |
| `tests/crossEngine.test.ts` | End-to-end pairing of the same issue across axe/Lighthouse/Pa11y. | `npx vitest run tests/crossEngine.test.ts` |
| `tests/manual.test.ts` | Manual checklist generate + ingest; verdict parsing; round-trip. | `npx vitest run tests/manual.test.ts` |
| `tests/history.test.ts` | Fingerprinting, `recordRun`, `diffRuns`, `mergeRunHistory`. | `npx vitest run tests/history.test.ts` |
| `tests/trends.test.ts` | Score trend, recurring issues, MTTR, hotspots. | `npx vitest run tests/trends.test.ts` |
| `tests/reactNative.test.ts` | RN adapter: node/tree serialization, roles, sizing, state, colors. | `npx vitest run tests/reactNative.test.ts` |
| `tests/formFactor.test.ts` | Form-factor presets and viewport/emulation settings. | `npx vitest run tests/formFactor.test.ts` |
| `tests/concurrency.test.ts` | Bounded parallel scanning (`mapWithConcurrency`, `resolveConcurrency`). | `npx vitest run tests/concurrency.test.ts` |
| `tests/sitemap.test.ts` | `sitemap.xml` (+ index) parsing into a URL list. | `npx vitest run tests/sitemap.test.ts` |
| `tests/fixtures*.ts` | Shared sample trees / axe / Lighthouse / Pa11y results (not tests themselves). | — |

### Common workflows

```bash
# Fast pre-commit gate:
npm run typecheck && npm run lint && npm test

# Iterate on a single area:
npm run test:watch            # everything, re-run on change
npx vitest tests/rules.test.ts  # just the rules, watch mode

# Try the toolkit against sample data (no external tools required):
node dist/cli.js audit ./examples/login-screen.json --platform react-native
npm run scan:lighthouse -- --lhr ./examples/sample-lighthouse-result.json
```

## Adding a new tool integration

The toolkit is the shared **core**. Each external tool (Lighthouse, axe, WAVE, …)
gets its own thin, independently-runnable script plus its own test — so you run
only what you need, not everything at once. To add one, follow this pattern:

1. `src/integrations/<tool>.ts` — a **pure** function converting the tool's
   output into the toolkit's `Finding`/`Assessment` model. No heavy deps, fully
   unit-testable.
2. `scripts/<tool>.ts` — a standalone runner; add a `"scan:<tool>"` npm script.
3. `tests/<tool>.test.ts` — its own test; add a `"test:<tool>"` npm script.

Because every tool normalizes into the same `Finding` model, results from
multiple sources can later be consolidated and deduplicated into one report.

Programmatic use (Lighthouse example):

```ts
import { lighthouseToAssessment, formatConsole } from "@bluetread/accessibility-toolkit";

const assessment = lighthouseToAssessment(lhr); // lhr = a Lighthouse Result
console.log(formatConsole(assessment));
```

## Project structure

```
src/
  types.ts           A11yNode, Finding, Rule, Assessment types
  wcag.ts            Curated WCAG 2.2 criteria map
  utils.ts           Tree traversal + node predicates
  contrast.ts        WCAG contrast math (no deps)
  rules.ts           The 13 baseline automated rules
  audit.ts           Audit runner, scoring, scorecard, WCAG rollups
  report.ts          console / json / markdown formatters
  manual.ts          Manual checklist generate + ingest (pages as columns)
  history.ts         Run records, fingerprints, run diffing (discrete data)
  trends.ts          Score trend, recurring issues, MTTR, hotspots
  effort.ts          Remediation-hour estimates
  formFactor.ts      Mobile/tablet/desktop viewport + emulation presets
  concurrency.ts     Bounded parallel page scanning
  sitemap.ts         sitemap.xml crawl → URL list
  integrations/
    jira.ts          Jira ticket creation
    lighthouse.ts    Lighthouse LHR  -> Finding/Assessment (pure)
    axe.ts           axe-core result -> Finding/Assessment (pure)
    pa11y.ts         Pa11y result    -> Finding/Assessment (pure)
    combined.ts      Cross-engine merge + de-dupe
  matchers/
    index.ts         Vitest/Jest assertion matchers
  react-native/
    index.ts         RN renderer tree -> A11yNode adapter
  cli.ts             bt-a11y command line
scripts/             Standalone, per-tool runners
  lighthouse.ts      npm run scan:lighthouse
  axe.ts             npm run scan:axe
  pa11y.ts           npm run scan:pa11y
  scan.ts            npm run scan:all (Lighthouse + axe merged)
  checklist.ts       npm run checklist (generate | ingest)
tests/               Unit tests + fixtures
examples/            Sample A11yNode trees + axe / Lighthouse results
docs/                Engagement checklists + manual testing workflow
```

## Tooling ecosystem (beyond this repo)

This toolkit is the **consolidation + reporting core**. It doesn't try to be a
device lab or replace commercial platforms — it ingests their output into one
branded, WCAG-scored, Jira-integrated report. Here's what a full engagement
stack looks like around it.

### What BrowserStack Accessibility premium would add

BrowserStack Accessibility is built on **axe-core** and adds a real-device cloud
and dashboards on top. Useful additions:

- **Real-device screen readers** — VoiceOver / TalkBack / JAWS on real hardware,
  no physical lab required for the bulk of testing.
- **Website Scanner** — scheduled, recurring axe scans across many URLs.
- **Workflow Analyzer** — record a journey (login → checkout) and scan each step,
  reaching **authenticated / multi-step** pages a plain URL scan can't.
- **Assisted / guided manual tests** — structured pass/fail capture for the
  manual bucket.
- **Real-device / browser matrix** — thousands of device/OS/browser combos for
  cross-platform coverage.
- **Dashboards & trends** — historical tracking and WCAG mapping.
- **CI/CD SDK** — Cypress / Playwright / Selenium / Jest integration.

**Cost:** paid SaaS, contact-sales/enterprise pricing (no free tier for the
accessibility product). Roughly **~$100+/user/month** billed annually at the low
end, scaling up by seats and device-cloud usage — get a current quote from
BrowserStack for exact numbers.

**Caveats:** it's axe-core underneath (same ~30–40% automated ceiling), it's
strongest on web (native app automation is still limited), and its reports live
in **its** dashboard — the branded, consolidated, multi-source report is still
this toolkit's job. It reduces but doesn't fully retire the need for **1–2
physical devices** for nuanced screen-reader gestures and final sign-off.

### What else you'd likely need (outside this repo + BrowserStack)

| Need | Option(s) | Notes |
| --- | --- | --- |
| **1–2 physical devices** | One modern iPhone + one Android | For fluid SR gestures, haptics, and final conformance sign-off — the "last mile" the cloud can't fully replicate |
| **Desktop screen readers** | NVDA (free), JAWS (paid), VoiceOver (macOS built-in) | For web SR testing not run through a cloud |
| **WAVE API** | WebAIM WAVE API | Optional; credit-based (~$0.01–0.04/credit). Only if a client wants WAVE specifically |
| **axe DevTools Pro** | Deque | Optional; adds guided tests + extra rules beyond free axe-core |
| **Color/contrast tooling** | TPGi Colour Contrast Analyser, Stark | For designer-side and edge-state contrast checks |
| **Jira (or tracker)** | Jira Cloud | Already integrated in this toolkit for ticket creation |
| **Design review** | Figma + a contrast/a11y plugin | Catch issues pre-build during Discovery |
| **CI runner** | GitHub Actions / GitLab CI | To run scans + unit tests automatically per PR |
| **Native test infra** | Xcode + XCUITest, Android Studio + Espresso, Maestro/Detox | For scripted on-device audits on mobile projects |
| **Human expertise** | Trained a11y tester(s) | The screen-reader *experience* and cognitive/usability judgment can't be automated |

### How it fits together

```
BrowserStack (real-device scans, SR on real HW, auth flows) ─┐
axe-core / Lighthouse / Pa11y / WAVE (scans) ───────────────┤
Unit-test suites (interaction/state) ───────────────────────┼─► Finding[] ─► THIS TOOLKIT
Physical-device + manual SR findings ───────────────────────┘        consolidate → score →
                                                                     scorecard + WCAG + Jira report
```

## Roadmap

- Platform adapters (`@bluetread/accessibility-toolkit/adapters/react-native`, `/web`)
- Native mobile result imports (XCUITest `performAccessibilityAudit`, Android Espresso/ATF)
- WAVE result import for consolidation (axe, Lighthouse, and Pa11y are already integrated)
- BrowserStack result import (`integrations/browserstack.ts`)
- CI reporter (GitHub Actions annotations)
- Before/after comparison for Phase 3 verification

## License

UNLICENSED — internal BlueTread use only.
