# Manual Accessibility Testing

Automated tooling (this toolkit, Lighthouse, axe, WAVE, native scanners) catches
only **~30–40% of WCAG issues** — presence and measurable thresholds. The rest
requires a human to judge **meaning and experience**. This document lists what to
test manually after the automated scans and tests have run, organized by WCAG
level.

> **Rule of thumb**
> **Automated = presence & thresholds** (label exists, contrast ratio, target size).
> **Manual = meaning & experience** (does it make sense, is it operable with AT).

## How WCAG levels stack

- **A** — minimum / blocking barriers.
- **AA** — the standard target (ADA, Section 508, EN 301 549). **Includes all A.**
- **AAA** — enhanced. Rarely a full target; usually cherry-picked. **Includes A + AA.**

So if the engagement targets **AA**, test every **A + AA** item below. Only test
**AAA** items when the client explicitly sets AAA as the target (often for
specific criteria, not the whole app).

Log every manual finding as a `Finding` with `source: "manual"` so it flows into
the same scorecard, WCAG rollup, and Jira tickets as the automated results.

---

## Level A — must pass (minimum)

| Manual check | WCAG SC | How to test |
| --- | --- | --- |
| Screen reader announces name, role, and value | 4.1.2 | VoiceOver / TalkBack / NVDA on every control |
| Reading & focus order is logical | 1.3.2 / 2.4.3 | Swipe/Tab through each screen; order matches visual flow |
| Everything operable by keyboard; no keyboard trap | 2.1.1 / 2.1.2 | Keyboard-only pass (web); external keyboard (mobile) |
| Alt text is **meaningful**, not just present | 1.1.1 | Listen to how images/icons are announced |
| Information not conveyed by color alone | 1.4.1 | Check errors, required fields, statuses, chart series |
| Errors are identified and described in text | 3.3.1 | Trigger validation; confirm error is announced & associated |
| Labels/instructions present for inputs | 3.3.2 | Confirm each field has a spoken label |
| Captions for prerecorded video/audio | 1.2.2 | Play media; verify captions |
| Content meaning doesn't rely on shape/position/sound alone | 1.3.3 | "Tap the round button" style instructions have text equivalents |

## Level AA — standard target (also requires all A)

| Manual check | WCAG SC | How to test |
| --- | --- | --- |
| Visible focus indicator on every control | 2.4.7 | Tab/navigate; confirm focus is always visible |
| Text contrast 4.5:1 (3:1 large); UI/graphics 3:1 | 1.4.3 / 1.4.11 | Check hover, focus, disabled, over images/gradients |
| Reflow at 320px width, no horizontal scroll | 1.4.10 | Zoom/narrow viewport; content stacks, nothing clipped |
| Text resizes to 200% without loss | 1.4.4 | Increase system/browser text size |
| Text spacing overrides don't break layout | 1.4.12 | Apply spacing bookmarklet / OS setting |
| Status messages announced without stealing focus | 4.1.3 | Trigger toasts/loading/results; confirm polite announcement |
| Headings & labels are descriptive | 2.4.6 | Review heading text and control labels for clarity |
| Orientation not locked (unless essential) | 1.3.4 | Rotate device portrait ⇄ landscape |
| Touch target minimum 24×24 | 2.5.8 | Measure small/closely-spaced controls |
| Link/button purpose clear in context | 2.4.4 | "Read more" etc. makes sense to a screen reader user |
| Consistent navigation & identification | 3.2.3 / 3.2.4 | Nav and components behave the same across screens |
| Error suggestions provided when known | 3.3.3 | Validation tells the user how to fix it |

## Level AAA — enhanced (only if targeted; also requires A + AA)

| Manual check | WCAG SC | How to test |
| --- | --- | --- |
| Enhanced contrast 7:1 (4.5:1 large) | 1.4.6 | Re-measure text contrast to the higher bar |
| Touch target 44×44 (enhanced) | 2.5.5 | Measure interactive targets |
| Motion from interaction can be disabled | 2.3.3 | Respect reduced-motion; no unavoidable animation |
| Sign language for prerecorded audio | 1.2.6 | Verify signed track where required |
| No timing / re-authentication data loss | 2.2.3 / 2.2.5 | Remove or extend time limits |
| Context-sensitive help available | 3.3.5 | Help text/affordances present where needed |

---

## Manual test areas checklist

Work these per **primary user flow**, per platform.

### Screen reader (iOS VoiceOver / Android TalkBack / Web NVDA)
- [ ] Names read correctly for all controls
- [ ] Roles announced (button, link, heading, image, etc.)
- [ ] States announced (selected, expanded, disabled, checked, busy)
- [ ] Reading / focus order is logical
- [ ] Dynamic content & status messages announced (no focus steal)
- [ ] Errors announced and associated with the correct field
- [ ] Modals: focus moves in, is trapped, restores on close

### Keyboard / switch / external keyboard
- [ ] All interactive elements reachable and operable
- [ ] Visible focus indicator everywhere
- [ ] No unexpected focus trap; focus never lost
- [ ] Modals manage focus; `Esc` closes where applicable
- [ ] Menus, tabs, sliders, comboboxes support expected key patterns

### Gestures & touch (mobile)
- [ ] Targets reliably tappable; closely-spaced controls don't misfire
- [ ] Complex gestures (swipe/pinch/drag) have a single-pointer alternative
- [ ] Pointer cancellation — action on release; drag-off cancels

### Cognitive / content
- [ ] Alt text is meaningful
- [ ] Heading structure logical and matches visual hierarchy
- [ ] Link/button text makes sense out of context
- [ ] Error messages are clear and actionable
- [ ] Labels don't rely on placeholder text alone

### Visual & sensory
- [ ] Info not conveyed by color alone
- [ ] Contrast holds in hover/focus/disabled and over images
- [ ] Meaning via shape/position/sound has a text equivalent

### Responsive / reflow / zoom
- [ ] Text resize to 200% — no clipping/overlap
- [ ] Text spacing overrides don't break layout
- [ ] Reflow at 320px — no horizontal scroll
- [ ] Orientation works and isn't locked
- [ ] No truncated/overlapping content at large font sizes

### Motion, media & timing
- [ ] Captions/transcripts for media
- [ ] Reduced-motion respected; no unexpected autoplay
- [ ] Time limits can be extended or turned off

---

## Toolkit note: touch-target thresholds are level-aware

`runAudit` sets the touch-target minimum from the target level automatically:

- **A / AA → 24×24** (WCAG 2.5.8, Target Size Minimum)
- **AAA → 44×44** (WCAG 2.5.5, Target Size Enhanced)

Findings are mapped to the matching success criterion, so a 30px target passes
an **AA** audit but is flagged under **AAA**. Override with
`runAudit(tree, { minTouchTargetSize: N })` or the CLI `--min-target N`.
