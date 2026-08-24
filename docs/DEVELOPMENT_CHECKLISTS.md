# Accessibility Product — Development Checklists

Source of truth for the four-phase accessibility engagement. Use these as
repeatable checklists per client. The toolkit in this repo automates the
repeatable technical portions (automated rules, scoring, reporting, Jira).

## Engagement overview

- **Discovery** — Define scope, goals, platforms, users, testing requirements.
- **Phase 1 — Assessment** — Evaluate with automated tools, code review, manual
  testing; map to WCAG; prioritize; deliver an executive report.
- **Phase 2 — Remediation** — Implement prioritized fixes; integrate a11y into
  the dev process.
- **Phase 3 — Verification** — Re-test to confirm fixes; measure improvement;
  document remaining risks.
- **Phase 4 — Ongoing Partnership** — Continuously monitor, test, and improve.

---

## Phase 1 — Accessibility Assessment

**Objective:** Evaluate current accessibility of the client's web/mobile app,
identify issues, map to WCAG, prioritize remediation, and provide an
executive-level readiness assessment. **Estimated effort:** 34–40 hours.

### 1. Audit preparation
- Confirm client and project scope; platforms (Web, iOS, Android).
- Identify apps, websites, major user flows, target users, journeys.
- Confirm target WCAG version, conformance level (A/AA/AAA), deadline.
- Document known requirements / existing issues.
- Obtain repo access, environment access, test accounts.
- Identify supported browsers, mobile OS versions, devices.

### 2. Define audit scope
Pages/screens, primary journeys, workflows, reusable components, forms,
navigation patterns, modals/dialogs, dynamic content, auth/login, error and
validation states, responsive/tablet layouts. Document exclusions.

### 3. Automated analysis
- **WAVE** — errors, alerts, contrast.
- **axe DevTools** — violations, incomplete, WCAG mapping.
- **Lighthouse** — accessibility scores, failed audits.
- **Consolidation** — combine, deduplicate, assign WCAG SC + severity.

### 4. Code review
Navigation, forms, modals/dialogs, typography & content, icons & images —
review the implementation for issues automation can't reliably detect.

### 5. React Native review (mobile only)
`accessibilityLabel`, `accessibilityRole`, `accessibilityHint`, `accessible`,
`accessibilityState`, `accessibilityValue`, `accessibilityActions`,
`accessibilityViewIsModal`, `importantForAccessibility`; interactive elements,
states, touch targets; VoiceOver/TalkBack behavior.

### 6. Manual testing
Screen readers (VoiceOver, TalkBack, NVDA) across primary flows, navigation,
buttons, forms, errors, modals, dynamic content, images/icons, focus order,
announcements.

### 7. Keyboard & interaction testing
Keyboard-only reachability, focus order/visibility/trapping, modal focus, menus,
forms, custom controls, escape behavior; pointer/touch, gestures, external
keyboard.

### 8. Visual & responsive testing
Color & contrast (text, UI components, disabled, color-only info, status,
charts); responsive behavior across sizes/orientation; increased text size.

### 9. WCAG evaluation — priority classification
- 🔴 **Critical** — prevents important tasks; major SR/nav failure; systemic.
- 🟠 **High** — significant barrier; important workflows; meaningful remediation.
- 🟡 **Medium** — issue with a workaround; limited scope.
- 🟢 **Low** — minor improvement; low impact.

### 10. Findings review & estimates
Consolidate, validate severity, identify quick wins vs high-effort, estimate
engineering hours, dependencies, recommended order, total effort.

### 11. Executive report
Executive summary, WCAG readiness, conformance level, risks, strengths, next
steps. **Scorecard** categories: Forms, Navigation, Screen Reader, Contrast,
Keyboard, Touch Targets, Semantics, Images/Icons, Typography, Responsive/Reflow.
Remediation estimate + sprint groupings. Business impact.

### 12. Deliverables
Assessment results, automated + manual results, code review findings,
WCAG-mapped + prioritized issue list, scorecard, remediation estimate,
executive summary, recommended next steps.

---

## Phase 2 — Accessibility Remediation

**Objective:** Implement prioritized improvements and integrate accessibility
into the client's workflow.

1. **Remediation planning** — review findings, confirm scope + target level,
   group findings, identify systemic issues / quick wins / dependencies,
   estimate effort, create milestones, sprints, tickets, acceptance criteria.
2. **Sprint planning** — Sprint 1 critical, Sprint 2 high-priority, Sprint 3
   remaining WCAG improvements + regression testing.
3. **Implementation** — components, forms, navigation, visual, mobile.
4. **Testing integration** — unit + component a11y tests, automated a11y in CI,
   linting, acceptance criteria, documentation. *(This toolkit.)*
5. **Developer education** — WCAG walkthroughs, SR + keyboard demos, guidelines.
6. **Sprint verification** — verify implementation, re-test, check regressions.
7. **Completion** — fixes done, tests added, docs updated, risks documented.

**Deliverables:** completed fixes, updated tests, dev guidelines, updated
tracker, progress report, remaining issue list, verification readiness report.

---

## Phase 3 — Accessibility Verification

**Objective:** Re-assess after remediation; verify fixes; measure progress;
document status.

1. Verification preparation (scope, level, build, env, devices).
2. Automated re-testing (WAVE, axe, Lighthouse) + compare to Phase 1.
3. Manual re-testing (screen readers, keyboard, mobile, responsive).
4. Finding verification (resolved / reopened, evidence).
5. Before & after analysis (counts by severity, scores, % resolved).
6. Compliance assessment (current estimated conformance; note this is **not** an
   official WCAG certification unless authorized).
7. Final verification report.
8. Completion + client review.

**Deliverables:** verification report, before/after scorecard, improvement
metrics, remaining issue list, WCAG assessment, conformance statement, next steps.

---

## Phase 4 — Ongoing Accessibility Partnership

**Objective:** Maintain accessibility as the app evolves.

1. Partnership setup (cadence, scope, contacts, process, target level).
2. Continuous automated testing (axe, Lighthouse, WAVE; track regressions).
3. New feature reviews.
4. Release reviews.
5. Periodic health checks.
6. Developer education.
7. Documentation maintenance.
8. Ongoing reporting (health score, findings by severity, regressions, progress).
9. Quarterly/annual review + roadmap.
10. Completion / renewal.

**Deliverables:** health reports, feature/release reviews, regression reports,
metrics, training/docs, roadmap, periodic assessment, recommendations.

---

## Proposed internal toolkit (this repo)

Published as an internal npm package:

```bash
npm install @bluetread/accessibility-toolkit
```

Reusable automated checks, an automated report generator (see README for the
report format), and a Jira remediation option to create tickets from findings.
