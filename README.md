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

expect(buttonNode).toHaveAccessibleName();
expect(buttonNode).toHaveRole("button");
expect(iconNode).toBeHiddenFromAccessibility();
expect(touchNode).toMeetTouchTargetSize(44);
```

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
| `scan:lighthouse` | Standalone Lighthouse runner (see below). | `npm run scan:lighthouse -- <url>` |
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

```bash
# Live scan (needs Chrome + optional deps):
npm install -D lighthouse chrome-launcher
npm run scan:lighthouse -- https://example.com

# Convert a saved Lighthouse result — no Chrome needed:
npm run scan:lighthouse -- --lhr ./examples/sample-lighthouse-result.json

# Choose a format and write to a file:
npm run scan:lighthouse -- https://example.com --format markdown --out lh.md

# Save the raw Lighthouse result for offline/later runs:
npm run scan:lighthouse -- https://example.com --save-lhr ./lhr.json

# File Jira tickets from the findings:
npm run scan:lighthouse -- https://example.com --jira --min-severity high
```

| Flag | Description | Default |
| --- | --- | --- |
| `<url>` | URL to scan live (requires `lighthouse` + `chrome-launcher`). | — |
| `--lhr <file>` | Read a saved Lighthouse Result JSON instead of scanning. No Chrome needed. | — |
| `--level <A\|AA\|AAA>` | Target WCAG level. | `AA` |
| `--format <console\|json\|markdown>` | Report format. | `console` |
| `--out <file>` | Write the report to a file. | stdout |
| `--save-lhr <file>` | Save the raw Lighthouse result. | — |
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

## Roadmap

- Platform adapters (`@bluetread/accessibility-toolkit/adapters/react-native`, `/web`)
- Native mobile result imports (XCUITest `performAccessibilityAudit`, Android Espresso/ATF)
- Integrations with WAVE / axe / Lighthouse result imports for consolidation
- CI reporter (GitHub Actions annotations)
- Before/after comparison for Phase 3 verification

## License

UNLICENSED — internal BlueTread use only.
