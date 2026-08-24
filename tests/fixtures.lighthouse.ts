import type { LighthouseResult } from "../src/integrations/lighthouse.js";

/**
 * A trimmed but realistic Lighthouse Result (LHR) with a mix of failing,
 * passing, and non-applicable accessibility audits.
 */
export const sampleLhr: LighthouseResult = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  categories: {
    accessibility: {
      score: 0.82,
      auditRefs: [
        { id: "color-contrast", weight: 3 },
        { id: "image-alt", weight: 10 },
        { id: "button-name", weight: 10 },
        { id: "label", weight: 10 },
        { id: "document-title", weight: 3 },
        { id: "html-has-lang", weight: 3 },
        { id: "heading-order", weight: 2 },
        { id: "meta-refresh", weight: 10 },
      ],
    },
  },
  audits: {
    "color-contrast": {
      id: "color-contrast",
      title: "Background and foreground colors have a sufficient contrast ratio",
      description: "Low-contrast text is difficult or impossible for many users to read.",
      score: 0,
      scoreDisplayMode: "binary",
      details: {
        items: [
          { node: { selector: "p.muted", snippet: "<p class=\"muted\">" } },
          { node: { selector: "span.hint", snippet: "<span class=\"hint\">" } },
        ],
      },
    },
    "image-alt": {
      id: "image-alt",
      title: "Image elements have [alt] attributes",
      description: "Informative elements should have short, descriptive alternate text.",
      score: 0,
      scoreDisplayMode: "binary",
      details: { items: [{ node: { selector: "img.hero" } }] },
    },
    "button-name": {
      id: "button-name",
      title: "Buttons have an accessible name",
      score: 1,
      scoreDisplayMode: "binary",
    },
    label: {
      id: "label",
      title: "Form elements have associated labels",
      score: 1,
      scoreDisplayMode: "binary",
    },
    "document-title": {
      id: "document-title",
      title: "Document has a <title> element",
      score: 1,
      scoreDisplayMode: "binary",
    },
    "html-has-lang": {
      id: "html-has-lang",
      title: "<html> element has a [lang] attribute",
      score: 1,
      scoreDisplayMode: "binary",
    },
    "heading-order": {
      id: "heading-order",
      title: "Heading elements appear in a sequentially-descending order",
      score: 0,
      scoreDisplayMode: "binary",
      details: { items: [{ node: { selector: "h4" } }] },
    },
    "meta-refresh": {
      id: "meta-refresh",
      title: "The document does not use <meta http-equiv=\"refresh\">",
      score: null,
      scoreDisplayMode: "notApplicable",
    },
  },
};
