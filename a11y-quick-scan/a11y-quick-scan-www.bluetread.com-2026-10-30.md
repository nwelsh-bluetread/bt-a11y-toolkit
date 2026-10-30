# Accessibility Quick Scan — www.bluetread.com

**Quick scan:** automated checks only (axe-core, Lighthouse) of https://www.bluetread.com/. No manual testing was done. Scanners cover only part of WCAG: 3 criteria fail, and 52 still need a manual check.

- **Generated:** 2026-10-30T19:23:43.033Z
- **Platform:** web
- **Target WCAG level:** AA
- **Overall score:** 95% (issue load, not a pass mark)

## Summary

| Severity | Count |
| --- | --- |
| 🔴 Critical | 0 |
| 🟠 High | 2 |
| 🟡 Medium | 7 |
| 🟢 Low | 0 |

### How severity is decided

WCAG has no severity scale; it only says pass or fail. A criterion fails if it has any finding, whatever the severity. Severity sets the order to fix things in and how much each finding lowers the score.

| Severity | Means |
| --- | --- |
| Critical | Blocks the task: someone can't finish it at all (e.g. font scaling turned off app-wide). |
| High | A major barrier that's hard to work around (e.g. a button with no name, a field with no label). |
| Medium | A real problem with a workaround, or one that affects fewer people (e.g. a button that doesn't announce its role). |
| Low | Minor friction (e.g. heading-styled text not marked as a heading). |

| Finding from | How its severity is set |
| --- | --- |
| axe (web) | axe's own impact rating: critical → Critical, serious → High, moderate → Medium, minor → Low. |
| Lighthouse (web) | A fixed severity for each Lighthouse audit, set by the toolkit. |
| Manual testing | The severity the tester chose. An issue written without one is Low. A check marked failed with no description at all uses that check's default severity. |

| WCAG Level | Passing |
| --- | --- |
| A | 0% |
| AA | 0% |
| AAA | not assessed |

## Accessibility Scorecard

| Category | Score | Priority | Findings |
| --- | --- | --- | --- |
| Semantics | 40% | 🟡 Medium | 4 |
| Contrast | 70% | 🟠 High | 2 |
| Typography | 70% | 🟡 Medium | 2 |
| Navigation | 85% | 🟡 Medium | 1 |

## WCAG AA conformance: not yet met

WCAG conformance is all or nothing: to meet Level AA, every applicable Level A and AA criterion must pass. There is no partial pass. Criteria that don't apply (N/A or web only) count as met. So far 0 of 55 applicable criteria pass; 3 fail and 52 aren't verified yet.

The accessibility score is not a pass mark. It measures how many issues remain, weighted by severity, so it can be 0 when a few shared fixes would clear most failures, or in the 90s while one failure still blocks conformance.


## Findings

### 🟠 Elements must meet minimum color contrast ratio thresholds

- **Rule:** `axe:color-contrast`
- **Severity:** High
- **WCAG:** 1.4.3 Contrast (Minimum) (AA)
- **Element:** unknown (`.uui-max-width-large-2 > .uui-heading-subheading-3`)
- **Platforms:** Web
- **Source:** axe
- **Description:** Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds
- **Remediation:** https://dequeuniversity.com/rules/axe/4.14/color-contrast?application=playwright
- **Page:** https://www.bluetread.com/

### 🟠 Background and foreground colors do not have a sufficient contrast ratio.

- **Rule:** `lighthouse:color-contrast`
- **Severity:** High
- **WCAG:** 1.4.3 Contrast (Minimum) (AA)
- **Element:** unknown (`div.uui-container-large-7 > div.uui-padding-vertical-xhuge-6 > div.uui-max-width-large-2 > div.uui-heading-subheading-3`)
- **Platforms:** Web
- **Source:** lighthouse
- **Description:** Low-contrast text is difficult or impossible for many users to read. [Learn how to provide sufficient color contrast](https://dequeuniversity.com/rules/axe/4.12/color-contrast).

### 🟡 Heading levels should only increase by one

- **Rule:** `axe:heading-order`
- **Severity:** Medium
- **WCAG:** 
- **Element:** unknown (`.uui-layout34_content:nth-child(1) > .uui-heading-xsmall`)
- **Platforms:** Web
- **Source:** axe
- **Description:** Ensure the order of headings is semantically correct
- **Remediation:** https://dequeuniversity.com/rules/axe/4.14/heading-order?application=playwright
- **Page:** https://www.bluetread.com/

### 🟡 Document should not have more than one banner landmark

- **Rule:** `axe:landmark-no-duplicate-banner`
- **Severity:** Medium
- **WCAG:** 
- **Element:** unknown (`.rl_navbar2_component`)
- **Platforms:** Web
- **Source:** axe
- **Description:** Ensure the document has at most one banner landmark
- **Remediation:** https://dequeuniversity.com/rules/axe/4.14/landmark-no-duplicate-banner?application=playwright
- **Page:** https://www.bluetread.com/

### 🟡 Document should have one main landmark

- **Rule:** `axe:landmark-one-main`
- **Severity:** Medium
- **WCAG:** 
- **Element:** unknown (`html`)
- **Platforms:** Web
- **Source:** axe
- **Description:** Ensure the document has a main landmark
- **Remediation:** https://dequeuniversity.com/rules/axe/4.14/landmark-one-main?application=playwright
- **Page:** https://www.bluetread.com/

### 🟡 Landmarks should have a unique role or role/label/title (i.e. accessible name) combination

- **Rule:** `axe:landmark-unique`
- **Severity:** Medium
- **WCAG:** 
- **Element:** unknown (`.rl_navbar2_component`)
- **Platforms:** Web
- **Source:** axe
- **Description:** Ensure landmarks are unique
- **Remediation:** https://dequeuniversity.com/rules/axe/4.14/landmark-unique?application=playwright
- **Page:** https://www.bluetread.com/

### 🟡 All page content should be contained by landmarks

- **Rule:** `axe:region`
- **Severity:** Medium
- **WCAG:** 
- **Element:** unknown (`.uui-section_header10`)
- **Platforms:** Web
- **Source:** axe
- **Description:** Ensure all page content is contained by landmarks
- **Remediation:** https://dequeuniversity.com/rules/axe/4.14/region?application=playwright
- **Page:** https://www.bluetread.com/

### 🟡 Heading elements are not in a sequentially-descending order

- **Rule:** `lighthouse:heading-order`
- **Severity:** Medium
- **WCAG:** 1.3.1 Info and Relationships (A)
- **Element:** unknown (`div.uui-padding-vertical-xhuge > div.w-layout-grid > div.uui-layout34_content > h3.uui-heading-xsmall`)
- **Platforms:** Web
- **Source:** lighthouse
- **Description:** Properly ordered headings that do not skip levels convey the semantic structure of the page, making it easier to navigate and understand when using assistive technologies. [Learn more about heading order](https://dequeuniversity.com/rules/axe/4.12/heading-order).

### 🟡 Document does not have a main landmark.

- **Rule:** `lighthouse:landmark-one-main`
- **Severity:** Medium
- **WCAG:** 4.1.2 Name, Role, Value (A)
- **Element:** unknown (`html.w-mod-js`)
- **Platforms:** Web
- **Source:** lighthouse
- **Description:** One main landmark helps screen reader users navigate a web page. [Learn more about landmarks](https://dequeuniversity.com/rules/axe/4.12/landmark-one-main).

