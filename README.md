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

## Auditing mobile-only apps (no web)

WAVE, Lighthouse, and axe DevTools all require a **web DOM**, so they do **not**
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

The CLI has two commands: `audit` (audits an `A11yNode` tree JSON) and
`lighthouse` (runs Lighthouse against live pages or a saved result).

```bash
# Audit an exported node tree:
bt-a11y audit ./examples/login-screen.json --platform react-native
bt-a11y audit ./tree.json --format markdown --out a11y-report.md

# Lighthouse — one page, many pages, a URL list, or a whole sitemap:
bt-a11y lighthouse https://example.com
bt-a11y lighthouse https://example.com https://example.com/about
bt-a11y lighthouse --urls ./urls.txt
bt-a11y lighthouse --sitemap https://example.com/sitemap.xml --format markdown --out a11y.md

# Convert a saved Lighthouse result — no Chrome needed:
bt-a11y lighthouse --lhr ./lighthouse-result.json

# axe-core (via Playwright) — same page/URL-list/sitemap options:
bt-a11y axe https://example.com
bt-a11y axe --sitemap https://example.com/sitemap.xml
bt-a11y axe --axe ./axe-result.json      # convert a saved axe result, no browser
```

> **Why `bt-a11y lighthouse` / `bt-a11y axe`?** When you install this package
> into another repo, only the compiled `dist/` ships — the `scripts/` folder does
> not. So the `bt-a11y` binary is how consumers run scans. Live scans need
> optional deps:
> - Lighthouse: `npm install -D lighthouse chrome-launcher`
> - axe: `npm install -D playwright @axe-core/playwright && npx playwright install chromium`

> **Getting only a few URLs from a sitemap?** Many sites publish a *sitemap
> index* (a sitemap of sitemaps). `--sitemap` automatically detects a
> `<sitemapindex>` and follows every child sitemap, so you get all the real page
> URLs instead of just the handful of child-sitemap links.

Options:

| Flag | Description | Default |
| --- | --- | --- |
| `--platform` | `web` \| `ios` \| `android` \| `react-native` (audit) | `web` |
| `--urls` | URL list file, one per line (`lighthouse`/`axe`) | — |
| `--sitemap` | Scan every page in a sitemap or sitemap index (`lighthouse`/`axe`) | — |
| `--lhr` | Read a saved Lighthouse result JSON (`lighthouse`) | — |
| `--axe` | Read a saved axe result JSON (`axe`) | — |
| `--level` | Target WCAG level `A` \| `AA` \| `AAA` | `AA` |
| `--format` | `console` \| `json` \| `markdown` | `console` |
| `--out` | Write report to a file | stdout |
| `--min-target` | Minimum touch target size (px/dp, audit) | `24` (AA) / `44` (AAA) |
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

expect(buttonNode).toHaveAccessibleName();
expect(buttonNode).toHaveRole("button");
expect(iconNode).toBeHiddenFromAccessibility();
expect(touchNode).toMeetTouchTargetSize(44);
```

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
| `scan:lighthouse` | Standalone Lighthouse runner — one or many pages (see below). | `npm run scan:lighthouse -- <url> [<url> ...]` |
| `scan:axe` | Standalone axe-core runner (Playwright) — one or many pages. | `npm run scan:axe -- <url> [<url> ...]` |
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

### Test files (`tests/`)

Each file can be run on its own with `npx vitest run tests/<file>`.

| Test file | Covers | Run just this |
| --- | --- | --- |
| `tests/rules.test.ts` | The baseline automated rules (accessible name, roles, images, touch targets, labels, contrast, etc.). | `npx vitest run tests/rules.test.ts` |
| `tests/contrast.test.ts` | WCAG contrast math (`parseHex`, `contrastRatio`, large-text + threshold helpers). | `npx vitest run tests/contrast.test.ts` |
| `tests/audit.test.ts` | The audit runner, scoring, WCAG rollups, scorecard, and report formatters. | `npx vitest run tests/audit.test.ts` |
| `tests/jira.test.ts` | Jira payload building, severity filtering, and ticket creation (mocked fetch). | `npx vitest run tests/jira.test.ts` |
| `tests/lighthouse.test.ts` | Lighthouse → `Finding`/`Assessment` conversion and mappings. | `npm run test:lighthouse` |
| `tests/fixtures.ts` | Shared sample `A11yNode` tree used by rule/audit tests (not a test itself). | — |
| `tests/fixtures.lighthouse.ts` | Shared sample Lighthouse Result used by the Lighthouse test (not a test itself). | — |

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
  integrations/
    jira.ts          Jira ticket creation
    lighthouse.ts    Lighthouse LHR -> Finding/Assessment (pure)
  matchers/
    index.ts         Vitest/Jest assertion matchers
  cli.ts             bt-a11y command line
scripts/             Standalone, per-tool runners
  lighthouse.ts      npm run scan:lighthouse
tests/               Unit tests + fixtures
examples/            Sample A11yNode trees + Lighthouse result
docs/                Engagement checklists
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
axe-core / Lighthouse / WAVE (scans) ───────────────────────┤
Unit-test suites (interaction/state) ───────────────────────┼─► Finding[] ─► THIS TOOLKIT
Physical-device + manual SR findings ───────────────────────┘        consolidate → score →
                                                                     scorecard + WCAG + Jira report
```

## Roadmap

- Platform adapters (`@bluetread/accessibility-toolkit/adapters/react-native`, `/web`)
- Native mobile result imports (XCUITest `performAccessibilityAudit`, Android Espresso/ATF)
- Integrations with WAVE / axe / Lighthouse result imports for consolidation
- BrowserStack result import (`integrations/browserstack.ts`)
- CI reporter (GitHub Actions annotations)
- Before/after comparison for Phase 3 verification

## License

UNLICENSED — internal BlueTread use only.
