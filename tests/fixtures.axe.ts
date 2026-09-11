import type { AxeResults } from "../src/integrations/axe.js";

/**
 * A trimmed but realistic axe-core results object with a mix of violations and
 * passes across several rules and WCAG levels.
 */
export const sampleAxeResults: AxeResults = {
  url: "https://example.com/",
  testEngine: { name: "axe-core", version: "4.10.0" },
  violations: [
    {
      id: "color-contrast",
      impact: "serious",
      tags: ["cat.color", "wcag2aa", "wcag143"],
      description:
        "Ensures the contrast between foreground and background colors meets WCAG 2 AA contrast ratio thresholds",
      help: "Elements must meet minimum color contrast ratio thresholds",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/color-contrast",
      nodes: [
        {
          target: ["p.muted"],
          html: '<p class="muted">Low contrast</p>',
          failureSummary: "Fix any of the following: Element has insufficient color contrast of 2.1:1",
          impact: "serious",
        },
        {
          target: ["span.hint"],
          html: '<span class="hint">Hint</span>',
          impact: "serious",
        },
      ],
    },
    {
      id: "image-alt",
      impact: "critical",
      tags: ["cat.text-alternatives", "wcag2a", "wcag111"],
      description: "Ensures <img> elements have alternate text or a role of none or presentation",
      help: "Images must have alternate text",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/image-alt",
      nodes: [
        {
          target: ["img.hero"],
          html: '<img class="hero" src="hero.png">',
          impact: "critical",
        },
      ],
    },
    {
      id: "heading-order",
      impact: "moderate",
      tags: ["cat.semantics", "best-practice"],
      description: "Ensures the order of headings is semantically correct",
      help: "Heading levels should only increase by one",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/heading-order",
      nodes: [{ target: ["h4"], html: "<h4>Skipped level</h4>", impact: "moderate" }],
    },
    {
      id: "custom-unmapped-rule",
      impact: "minor",
      tags: ["cat.semantics", "wcag2aaa", "wcag248"],
      description: "A rule not present in AXE_RULE_MAP, mapped via its tags",
      help: "Section headings should be used to organize content",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/custom",
      nodes: [{ target: [["#frame", "div.section"]], html: "<div class=\"section\">", impact: "minor" }],
    },
  ],
  passes: [
    {
      id: "button-name",
      impact: null,
      tags: ["cat.name-role-value", "wcag2a", "wcag412"],
      description: "Ensures buttons have discernible text",
      help: "Buttons must have discernible text",
      nodes: [{ target: ["button.submit"], html: "<button class=\"submit\">Save</button>" }],
    },
    {
      id: "label",
      impact: null,
      tags: ["cat.forms", "wcag2a", "wcag412", "wcag332"],
      description: "Ensures every form element has a label",
      help: "Form elements must have labels",
      nodes: [{ target: ["input#email"], html: '<input id="email">' }],
    },
    {
      id: "document-title",
      impact: null,
      tags: ["cat.text-alternatives", "wcag2a", "wcag242"],
      description: "Ensures each HTML document contains a non-empty <title>",
      help: "Documents must have <title> element to aid in navigation",
      nodes: [{ target: ["title"], html: "<title>Example</title>" }],
    },
  ],
  incomplete: [],
  inapplicable: [
    {
      id: "video-caption",
      impact: null,
      tags: ["cat.text-alternatives", "wcag2a", "wcag122"],
      description: "Ensures <video> elements have captions",
      help: "<video> elements must have captions",
      nodes: [],
    },
  ],
};
