# Manual Accessibility Testing Worksheet

Fill this out per **primary user flow**, per **platform**. It pairs with the
automated scans — automation checks *presence & thresholds*; this worksheet
captures *meaning & experience* that only a human can judge.

- **Project:** _______________________
- **Target WCAG level:** ☐ A ☐ AA ☐ AAA
- **Platforms in scope:** ☐ Web ☐ iOS ☐ Android ☐ React Native
- **Assistive tech used:** ☐ VoiceOver ☐ TalkBack ☐ NVDA ☐ JAWS ☐ Keyboard ☐ Switch
- **Tester / date:** _______________________

> When you finish, transfer every ❌ (fail) into `manual-findings.template.json`
> and run the converter (see `docs/MANUAL_TESTING_WORKFLOW.md`) so these findings
> merge into the toolkit's scorecard, WCAG rollup, effort total, and Jira tickets.

---

## Flow under test: _______________________

Mark each check: ✅ pass · ❌ fail · ➖ n/a. Add a note for every ❌.

### 1. Screen reader (VoiceOver / TalkBack / NVDA)

| # | Check | WCAG | Result | Notes (what/where) |
|---|-------|------|:------:|--------------------|
| 1.1 | Every control announces a correct **name** | 4.1.2 | ☐ | |
| 1.2 | Every control announces its **role** (button, link, heading…) | 4.1.2 | ☐ | |
| 1.3 | **States** announced (selected, expanded, disabled, checked, busy) | 4.1.2 | ☐ | |
| 1.4 | Reading / focus **order is logical** | 1.3.2 / 2.4.3 | ☐ | |
| 1.5 | **Dynamic/status** messages announced without stealing focus | 4.1.3 | ☐ | |
| 1.6 | **Errors** announced and associated with the right field | 3.3.1 | ☐ | |
| 1.7 | **Modals**: focus moves in, is trapped, restores on close | 2.4.3 | ☐ | |
| 1.8 | **Alt text is meaningful**, not just present | 1.1.1 | ☐ | |

### 2. Keyboard / switch / external keyboard

| # | Check | WCAG | Result | Notes |
|---|-------|------|:------:|-------|
| 2.1 | All interactive elements **reachable & operable** | 2.1.1 | ☐ | |
| 2.2 | **Visible focus indicator** everywhere | 2.4.7 | ☐ | |
| 2.3 | **No keyboard trap**; focus never lost | 2.1.2 | ☐ | |
| 2.4 | Modals manage focus; **Esc** closes where applicable | 2.1.2 | ☐ | |
| 2.5 | Menus, tabs, sliders, comboboxes support **expected key patterns** | 2.1.1 | ☐ | |

### 3. Gestures & touch (mobile)

| # | Check | WCAG | Result | Notes |
|---|-------|------|:------:|-------|
| 3.1 | Targets reliably tappable; closely-spaced controls don't misfire | 2.5.8 | ☐ | |
| 3.2 | Complex gestures have a **single-pointer alternative** | 2.5.1 | ☐ | |
| 3.3 | **Pointer cancellation** — action on release; drag-off cancels | 2.5.2 | ☐ | |

### 4. Cognitive / content

| # | Check | WCAG | Result | Notes |
|---|-------|------|:------:|-------|
| 4.1 | **Heading structure** logical, matches visual hierarchy | 1.3.1 / 2.4.6 | ☐ | |
| 4.2 | **Link/button text** makes sense out of context | 2.4.4 | ☐ | |
| 4.3 | **Error messages** clear and actionable (suggest a fix) | 3.3.3 | ☐ | |
| 4.4 | Labels don't rely on **placeholder text** alone | 3.3.2 | ☐ | |

### 5. Visual & sensory

| # | Check | WCAG | Result | Notes |
|---|-------|------|:------:|-------|
| 5.1 | Info **not conveyed by color alone** | 1.4.1 | ☐ | |
| 5.2 | Contrast holds in **hover / focus / disabled** and over images | 1.4.3 / 1.4.11 | ☐ | |
| 5.3 | Meaning via **shape/position/sound** has a text equivalent | 1.3.3 | ☐ | |

### 6. Responsive / reflow / zoom

| # | Check | WCAG | Result | Notes |
|---|-------|------|:------:|-------|
| 6.1 | Text resize to **200%** — no clipping/overlap | 1.4.4 | ☐ | |
| 6.2 | **Text spacing** overrides don't break layout | 1.4.12 | ☐ | |
| 6.3 | **Reflow at 320px** — no horizontal scroll | 1.4.10 | ☐ | |
| 6.4 | **Orientation** works and isn't locked | 1.3.4 | ☐ | |

### 7. Motion, media & timing

| # | Check | WCAG | Result | Notes |
|---|-------|------|:------:|-------|
| 7.1 | **Captions/transcripts** for media | 1.2.2 | ☐ | |
| 7.2 | **Reduced-motion** respected; no unexpected autoplay | 2.3.3 / 2.2.2 | ☐ | |
| 7.3 | **Time limits** can be extended or turned off | 2.2.1 | ☐ | |

---

## Findings log (transfer ❌ items here)

One row per failure. Severity: `critical` / `high` / `medium` / `low`. These map
1:1 to fields in `manual-findings.template.json`.

| Title | Severity | WCAG | Category | Page/Screen | Method (AT) | Location / repro | Remediation | Est. hrs |
|-------|----------|------|----------|-------------|-------------|------------------|-------------|:--------:|
| | | | | | | | | |
| | | | | | | | | |
| | | | | | | | | |

> **Category** values that roll up cleanly in the scorecard: `Screen Reader`,
> `Keyboard`, `Forms`, `Semantics`, `Contrast`, `Images/Icons`, `Touch Targets`,
> `Navigation`, `Typography`, `Responsive`. Leave **Est. hrs** blank to let the
> toolkit estimate it.

---

## Sign-off

- [ ] All in-scope flows tested on all in-scope platforms
- [ ] Every ❌ transferred to `manual-findings.template.json`
- [ ] Converter run and findings merged into the combined report
- [ ] Report reviewed with the delivery lead

Tester signature: _______________________  Date: ____________
