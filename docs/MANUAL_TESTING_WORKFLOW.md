# Manual Accessibility Testing Workflow

This is the end-to-end process for the **manual** half of an audit — the ~60–70%
of WCAG issues automation can't catch — and how to fold it into the same report
the toolkit produces for the automated scans.

- **What to test** and by what method (web + mobile).
- **What BrowserStack (and other automation) can do for you** vs. what stays hands-on.
- **How to record findings** so they merge into the toolkit's scorecard, WCAG
  rollup, effort estimate, and Jira tickets.

See also: [`MANUAL_TESTING.md`](MANUAL_TESTING.md) (the WCAG-by-level checklist)
and [`../examples/manual-testing-worksheet.md`](../examples/manual-testing-worksheet.md)
(the fillable worksheet).

---

## 1. The layered model

```
Automated (presence & thresholds)          Manual (meaning & experience)
────────────────────────────────           ─────────────────────────────
axe-core / Lighthouse (web)                 Screen reader walkthroughs
eslint-plugin-react-native-a11y (RN)        Keyboard / switch operation
Accessibility Scanner / XCUITest (mobile)   Gesture & touch alternatives
this toolkit's rules                        Cognitive / content judgement
                                            Reflow / zoom / orientation
        │                                              │
        └───────────────► one merged Assessment ◄──────┘
                (mergeAssessments → scorecard + Jira)
```

Automated tooling verifies a label *exists* and a contrast ratio *passes*. Only a
human can confirm the label is *meaningful*, the focus order makes *sense*, and a
status change is actually *announced*. Both halves normalize into the same
`Finding` model.

---

## 2. What to test manually

Work these **per primary user flow, per platform**. Full detail and WCAG mapping
is in [`MANUAL_TESTING.md`](MANUAL_TESTING.md); the short version:

### Web

1. **Screen reader** (NVDA or VoiceOver/Safari): name, role, state on every
   control; logical reading order; live-region announcements; error association;
   modal focus management.
2. **Keyboard only**: reach and operate everything; visible focus; no trap; Esc
   closes dialogs; expected key patterns for menus/tabs/comboboxes/sliders.
3. **Reflow / zoom**: 200% text, 320px reflow, text-spacing overrides, no
   clipping/overlap.
4. **Content / cognitive**: meaningful alt text, descriptive headings and links,
   actionable errors, no color-only meaning.

### Mobile (iOS / Android / React Native)

1. **VoiceOver (iOS)** and **TalkBack (Android)**: swipe order, names/roles/states,
   announcements, form errors, modal focus, dynamic content.
2. **External keyboard / switch control**: focusability and operation.
3. **Gestures & touch**: target size and spacing in practice; single-pointer
   alternative for complex gestures; pointer cancellation on release.
4. **Orientation & reflow**: portrait ⇄ landscape not locked; large font sizes
   don't truncate/overlap.

---

## 3. What can be automated (incl. BrowserStack)

BrowserStack doesn't replace manual AT testing, but it removes a lot of the
**setup, matrix, and evidence-gathering** toil. Split it like this:

| Task | Automatable? | Tool |
|------|:------------:|------|
| Run axe/Lighthouse across many pages | ✅ Fully | This toolkit's `scan:*` scripts |
| Run axe on **real devices/browsers** at scale | ✅ Fully | **BrowserStack Accessibility Testing** (axe engine on its device cloud) |
| Device/OS/browser **matrix** (iOS Safari, Android Chrome, older versions) | ✅ Provisioning | **BrowserStack App/Live & Automate** |
| Capture **screenshots/recordings** of each screen for evidence | ✅ Fully | BrowserStack sessions / Percy visual snapshots |
| Programmatic a11y assertions in CI (roles, names, states) | ✅ Fully | XCUITest `performAccessibilityAudit()`, Espresso `AccessibilityChecks`, this toolkit's matchers |
| Keyboard-operability *smoke* checks | ⚠️ Partial | Playwright/Appium scripted Tab traversal (finds traps, not judgement) |
| **Screen reader announcement quality** (does it make sense?) | ❌ Manual | VoiceOver / TalkBack / NVDA by a human |
| **Focus order makes sense** / meaningful alt text / clear errors | ❌ Manual | Human judgement |
| **Gesture alternatives**, reflow "feels right" | ❌ Manual | Human on device |

**Rule of thumb:** BrowserStack automates *where* you test (device matrix),
*collecting evidence*, and *running the same automated engines* consistently on
real hardware. It does **not** automate the *judgement* checks — those stay on
the worksheet.

### Suggested BrowserStack setup

1. Enable **BrowserStack Accessibility Testing** and point it at the same URL
   list you feed the toolkit (`urls.txt`). Export its axe results as JSON.
2. Import that JSON through the toolkit's axe integration (it's the same axe
   result shape) so device-cloud scans merge with local scans.
3. Use **App Live** sessions on real iOS/Android devices to do the VoiceOver /
   TalkBack passes when you don't have the physical device — recording the
   session as evidence for each finding.

---

## 4. Recording manual findings

Two fillable artifacts live in `examples/`:

| File | Use |
|------|-----|
| [`manual-testing-worksheet.md`](../examples/manual-testing-worksheet.md) | Human-friendly checklist to fill **while testing** |
| [`manual-findings.template.json`](../examples/manual-findings.template.json) | Machine-readable list the toolkit ingests |

Workflow: fill the **worksheet** as you test → transfer each ❌ into the **JSON
template** → run the converter.

### Each JSON entry

```jsonc
{
  "title": "Focus order skips the form",
  "description": "What you observed and why it fails.",
  "severity": "critical",            // critical | high | medium | low
  "wcag": ["1.3.2", "2.4.3"],        // success-criterion ids
  "category": "Screen Reader",       // scorecard bucket
  "page": "https://app/checkout",    // or a screen name for mobile
  "method": "VoiceOver (iOS 18)",    // how it was found
  "location": "Checkout > Shipping", // where / repro steps
  "remediation": "Fix the order…",   // suggested fix
  "estimatedHours": 3,               // optional; auto-estimated if omitted
  "platforms": ["ios", "react-native"]
}
```

---

## 5. Merging manual results into the toolkit output

`manualFindingsToAssessment()` turns the filled template into an `Assessment`,
and `mergeAssessments()` folds it into the automated report — one scorecard, one
WCAG rollup, one effort total, one set of Jira tickets, tagged by `source`.

```ts
import {
  axeToAssessment,
  manualFindingsToAssessment,
  mergeAssessments,
  formatMarkdown,
} from "@bluetread/accessibility-toolkit";
import { readFileSync, writeFileSync } from "node:fs";

const axe = axeToAssessment(JSON.parse(readFileSync("axe.json", "utf8")));
const manual = manualFindingsToAssessment(
  JSON.parse(readFileSync("examples/manual-findings.template.json", "utf8")),
  { targetLevel: "AA", platform: "web" },
);

const combined = mergeAssessments([axe, manual], { targetLevel: "AA" });
writeFileSync("a11y-report.md", formatMarkdown(combined));
```

For a **mobile-only** engagement (no web scanners), the manual assessment can be
merged with the React Native tree audit instead:

```ts
import { runAudit, manualFindingsToAssessment, mergeAssessments } from "@bluetread/accessibility-toolkit";

const rn = runAudit(tree, { platform: "react-native", targetLevel: "AA" });
const manual = manualFindingsToAssessment(entries, { platform: "react-native" });
const combined = mergeAssessments([rn, manual], { targetLevel: "AA" });
```

Manual findings carry `source: "manual"`, appear in the **Findings** section with
their **Page**, **method**, and **Est. remediation**, and roll into the
**Pages Scanned** list. Because the effort estimator understands the manual
categories (Screen Reader, Keyboard, etc.), the report's total remediation
estimate now covers both automated and manual work.

---

## 6. Time estimates (testing effort, per platform)

These estimate the **time to run the manual tests** — separate from the
*remediation* hours the toolkit puts on each finding. The floor is a
**one-page/one-screen site**; larger sites scale by page/screen count.

> **Formula (per platform):**
> `total = setup + Σ_area( base + (pages − 1) × perPage )`
> where `pages ≥ 1`. A one-page site pays only `setup + Σ base`.

| Test area | Base (1st page) | Each extra page | Applies to |
|-----------|:---------------:|:---------------:|------------|
| Environment / AT setup (once per platform) | 0.5 h | — | Web + Mobile |
| Screen reader walkthrough | 0.75 h | 0.25 h | Web + Mobile |
| Keyboard / switch operation | 0.5 h | 0.2 h | Web + Mobile |
| Gestures & touch | 0.35 h | 0.15 h | Mobile |
| Cognitive / content review | 0.35 h | 0.2 h | Web + Mobile |
| Visual & sensory | 0.35 h | 0.15 h | Web + Mobile |
| Responsive / reflow / zoom | 0.35 h | 0.15 h | Web |
| Motion, media & timing | 0.25 h | 0.1 h | Web + Mobile |
| Logging & transferring findings | 0.25 h | 0.15 h | Web + Mobile |

### Worked examples

**One-page website (minimum, web, single AT):**
`0.5 (setup) + 0.75 + 0.5 + 0.35 + 0.35 + 0.35 + 0.25 + 0.25 ≈ 3.3 h`
→ budget **~3–4 hours** for a thorough single-page manual pass.

**10-page website (web, single AT):** each scaling area adds `9 × perPage`:
`3.3 (page 1) + 9 × (0.25+0.2+0.2+0.15+0.15+0.1+0.15) ≈ 3.3 + 9 × 1.2 = ~14 h`.

**Mobile app, ~8 screens, both VoiceOver + TalkBack:** run the mobile column
twice (once per OS/AT). Roughly `2 × (setup + Σ base + 7 × Σ perPage)` ≈
`2 × (0.5 + 2.65 + 7 × 1.05) ≈ 2 × 10.5 = ~21 h`.

> **Notes**
> - Multiply by the number of **AT/OS combinations** you cover (e.g. VoiceOver
>   *and* TalkBack, or NVDA *and* VoiceOver on web).
> - "Pages" for mobile = distinct **screens/states**, not routes.
> - These are *testing* hours. Add the report's **remediation** estimate (the
>   per-finding hours) for total engagement effort.
> - BrowserStack reduces **setup** and evidence-capture time but not the
>   per-page AT walkthrough time — those are hands-on judgement.

---

## 7. Quick checklist

- [ ] Automated scans run (toolkit `scan:*`, and/or BrowserStack Accessibility).
- [ ] BrowserStack device matrix chosen; sessions recorded for evidence.
- [ ] Worksheet completed per flow, per platform, with the right AT.
- [ ] ❌ items transferred into `manual-findings.template.json`.
- [ ] `manualFindingsToAssessment` + `mergeAssessments` run.
- [ ] Combined report generated and reviewed; Jira tickets filed.
