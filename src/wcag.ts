import type { WcagCriterion } from "./types.js";

/**
 * A curated subset of WCAG 2.2 success criteria most relevant to the checks in
 * this toolkit. Centralizing them here keeps rule definitions consistent and
 * makes it easy to map findings to criteria in reports and Jira tickets.
 */
export const WCAG: Record<string, WcagCriterion> = {
  "1.1.1": { id: "1.1.1", name: "Non-text Content", level: "A" },
  "1.3.1": { id: "1.3.1", name: "Info and Relationships", level: "A" },
  "1.4.1": { id: "1.4.1", name: "Use of Color", level: "A" },
  "1.4.3": { id: "1.4.3", name: "Contrast (Minimum)", level: "AA" },
  "1.4.4": { id: "1.4.4", name: "Resize Text", level: "AA" },
  "1.4.6": { id: "1.4.6", name: "Contrast (Enhanced)", level: "AAA" },
  "1.4.11": { id: "1.4.11", name: "Non-text Contrast", level: "AA" },
  "2.1.1": { id: "2.1.1", name: "Keyboard", level: "A" },
  "2.4.3": { id: "2.4.3", name: "Focus Order", level: "A" },
  "2.4.6": { id: "2.4.6", name: "Headings and Labels", level: "AA" },
  "2.4.7": { id: "2.4.7", name: "Focus Visible", level: "AA" },
  "2.5.5": { id: "2.5.5", name: "Target Size (Enhanced)", level: "AAA" },
  "2.5.8": { id: "2.5.8", name: "Target Size (Minimum)", level: "AA" },
  "3.3.1": { id: "3.3.1", name: "Error Identification", level: "A" },
  "3.3.2": { id: "3.3.2", name: "Labels or Instructions", level: "A" },
  "4.1.2": { id: "4.1.2", name: "Name, Role, Value", level: "A" },
  "4.1.3": { id: "4.1.3", name: "Status Messages", level: "AA" },
};

/** Convenience helper to reference one or more criteria by id. */
export function wcag(...ids: string[]): WcagCriterion[] {
  return ids.map((id) => {
    const criterion = WCAG[id];
    if (!criterion) {
      throw new Error(`Unknown WCAG criterion: ${id}`);
    }
    return criterion;
  });
}
