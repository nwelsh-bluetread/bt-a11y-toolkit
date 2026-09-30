import type { Pa11yResults } from "../src/integrations/pa11y.js";

/**
 * A trimmed but realistic Pa11y results object mixing HTML_CodeSniffer (`htmlcs`)
 * and axe runner issues across several WCAG levels and severities.
 */
export const samplePa11yResults: Pa11yResults = {
  documentTitle: "Example",
  pageUrl: "https://example.com/",
  url: "https://example.com/",
  issues: [
    {
      code: "WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail",
      type: "error",
      typeCode: 1,
      message:
        "This element has insufficient contrast at this conformance level. Expected a contrast ratio of at least 4.5:1, but text has 2.1:1.",
      context: '<p class="muted">Low contrast</p>',
      selector: "html > body > p.muted",
      runner: "htmlcs",
    },
    {
      code: "WCAG2A.Principle1.Guideline1_1.1_1_1.H37",
      type: "error",
      typeCode: 1,
      message: "Img element missing an alt attribute.",
      context: '<img class="hero" src="hero.png">',
      selector: "html > body > img.hero",
      runner: "htmlcs",
    },
    {
      code: "WCAG2A.Principle4.Guideline4_1.4_1_2.H91.Button.Name",
      type: "error",
      typeCode: 1,
      message: "This button element does not have a name available to assistive technology.",
      context: '<button class="submit"></button>',
      selector: "html > body > button.submit",
      runner: "htmlcs",
    },
    {
      code: "WCAG2AA.Principle2.Guideline2_4.2_4_6.G130.NoContent",
      type: "warning",
      typeCode: 2,
      message: "Heading tag found with no content.",
      context: "<h2></h2>",
      selector: "html > body > h2",
      runner: "htmlcs",
    },
    {
      code: "WCAG2AA.Principle1.Guideline1_3.1_3_1.F68",
      type: "notice",
      typeCode: 3,
      message: "Check that the label element is associated with a form control.",
      context: "<label>Email</label>",
      selector: "html > body > label",
      runner: "htmlcs",
    },
    {
      // axe-runner style issue: the code is the axe rule id.
      code: "link-name",
      type: "error",
      typeCode: 1,
      message: "Links must have discernible text",
      context: '<a href="/about"></a>',
      selector: "html > body > a",
      runner: "axe",
    },
  ],
};
