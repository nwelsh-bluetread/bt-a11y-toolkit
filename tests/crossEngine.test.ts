/**
 * Cross-engine de-duplication.
 *
 * Lighthouse and axe describe the same DOM element differently — axe emits the
 * shortest unique selector, Lighthouse a full ancestor path — so an exact
 * selector match never fires and every issue was being reported (and costed)
 * twice. These fixtures are the real selector/HTML pairs from the AdaptHealth
 * WebView scan that exposed it.
 */
import { describe, it, expect } from "vitest";
import { mergeAssessments, isSameElement, selectorTail } from "../src/integrations/combined.js";
import { estimateTotalHours } from "../src/effort.js";
import { formatMarkdown } from "../src/report.js";
import type { Assessment, Finding, Severity } from "../src/types.js";

const PAGE = "https://adapthealth.com/pages/myapp-privacy-policy";

interface FindingSpec {
  ruleId: string;
  source: "axe" | "lighthouse";
  category: string;
  wcag: string;
  severity?: Severity;
  selector: string;
  html?: string;
  failureSummary?: string;
  affectedElements?: number;
  page?: string;
}

function finding(spec: FindingSpec): Finding {
  return {
    ruleId: `${spec.source}:${spec.ruleId}`,
    title: spec.ruleId,
    description: spec.ruleId,
    severity: spec.severity ?? "high",
    wcag: [{ id: spec.wcag, name: "criterion", level: "AA" }],
    nodeId: spec.selector,
    category: spec.category,
    source: spec.source,
    evidence: {
      page: spec.page ?? PAGE,
      selectors: [spec.selector],
      elements: [{ selector: spec.selector, html: spec.html, failureSummary: spec.failureSummary }],
      html: spec.html,
      failureSummary: spec.failureSummary,
      ...(spec.affectedElements ? { affectedElements: spec.affectedElements } : {}),
    },
  };
}

function assessment(findings: Finding[]): Assessment {
  return {
    generatedAt: new Date().toISOString(),
    platform: "react-native",
    targetLevel: "AA",
    overallScore: 90,
    counts: { critical: 0, high: findings.length, medium: 0, low: 0 },
    wcag: { A: 95, AA: 95, AAA: 95 },
    categories: [],
    topIssues: [],
    findings,
  };
}

/** axe reports the shortest unique selector; Lighthouse the full path. */
const CONTRAST_AXE = finding({
  ruleId: "color-contrast",
  source: "axe",
  category: "Contrast",
  wcag: "1.4.3",
  selector: ".breadcrumb__link",
  html: '<a href="/" class="breadcrumb__link hover:tw-opacity-80 tw-transition-opacity tw-uppercase…',
  failureSummary: "Element has insufficient color contrast of 2.76",
});
const CONTRAST_LH = finding({
  ruleId: "color-contrast",
  source: "lighthouse",
  category: "Contrast",
  wcag: "1.4.3",
  selector: "div.banner-content-block__wrapper > nav.breadcrumb > div.tw-flex > a.breadcrumb__link",
  html: '<a href="/" class="breadcrumb__link hover:tw-opacity-80 tw-transition-opacity tw…" style="color: #007867;">',
});

/** Each engine latched onto a different class of the same input. */
const LABEL_AXE = finding({
  ruleId: "label",
  source: "axe",
  category: "Forms",
  severity: "critical",
  wcag: "3.3.2",
  selector: "embedpdf-container .bg-bg-input",
  html: '<input type="text" inputmode="numeric" pattern="[0-9]*" class="border-border-default bg-bg-input text-fg-primary focus:border-accent focus:ring-accent h-7 w-10…',
  failureSummary: "Element does not have an implicit (wrapped) <label>",
});
const LABEL_LH = finding({
  ruleId: "label",
  source: "lighthouse",
  category: "Forms",
  severity: "critical",
  wcag: "3.3.2",
  selector: "div.pointer-events-auto > div.border-border-default > div.flex > input.border-border-default",
  html: '<input type="text" inputmode="numeric" pattern="[0-9]*" class="border-border-default bg-bg-input text-fg-primary focus:border-accent focu…">',
});

/** No classes or id on either side, and axe adds a positional pseudo-class. */
const HEADING_AXE = finding({
  ruleId: "heading-order",
  source: "axe",
  category: "Typography",
  severity: "medium",
  wcag: "1.3.1",
  selector: "h3:nth-child(6)",
  html: "<h3>Our obligations</h3>",
  failureSummary: "Heading order invalid",
});
const HEADING_LH = finding({
  ruleId: "heading-order",
  source: "lighthouse",
  category: "Typography",
  severity: "medium",
  wcag: "1.3.1",
  selector: "main#MainContent > div#shopify-section-policy > div.privacy-policy__container > h3",
  html: "<h3>",
});

describe("selectorTail", () => {
  it("reduces an ancestor path to its target element", () => {
    const tail = selectorTail("div.wrap > nav.crumbs > a.breadcrumb__link");
    expect(tail.tag).toBe("a");
    expect([...tail.classes]).toEqual(["breadcrumb__link"]);
  });

  it("strips pseudo-classes", () => {
    expect(selectorTail("h3:nth-child(6)").tag).toBe("h3");
    expect(selectorTail("h3:nth-child(6)").classes.size).toBe(0);
  });

  it("strips attribute selectors", () => {
    const tail = selectorTail('input[type="text"].field');
    expect(tail.tag).toBe("input");
    expect([...tail.classes]).toEqual(["field"]);
  });

  it("reads ids", () => {
    expect(selectorTail("main#MainContent").id).toBe("MainContent");
  });

  it("handles a descendant combinator", () => {
    expect([...selectorTail("embedpdf-container .bg-bg-input").classes]).toEqual(["bg-bg-input"]);
  });
});

describe("isSameElement", () => {
  it("pairs findings that share a class", () => {
    expect(isSameElement(CONTRAST_AXE, CONTRAST_LH)).toBe(true);
  });

  it("pairs findings whose HTML snippets share a prefix", () => {
    expect(isSameElement(LABEL_AXE, LABEL_LH)).toBe(true);
  });

  it("pairs anonymous elements of the same tag", () => {
    expect(isSameElement(HEADING_AXE, HEADING_LH)).toBe(true);
  });

  it("does not pair different elements", () => {
    const other = finding({
      ruleId: "color-contrast",
      source: "lighthouse",
      category: "Contrast",
      wcag: "1.4.3",
      selector: "footer.site-footer > p.legal-text",
      html: '<p class="legal-text">© AdaptHealth</p>',
    });
    expect(isSameElement(CONTRAST_AXE, other)).toBe(false);
  });

  it("does not pair short HTML snippets of different tags", () => {
    const img = finding({
      ruleId: "image-alt",
      source: "lighthouse",
      category: "Images/Icons",
      wcag: "1.1.1",
      selector: "div > div > img",
      html: "<img>",
    });
    expect(isSameElement(HEADING_AXE, img)).toBe(false);
  });
});

describe("mergeAssessments cross-engine pairing", () => {
  const merged = mergeAssessments(
    [
      assessment([CONTRAST_AXE, LABEL_AXE, HEADING_AXE]),
      assessment([CONTRAST_LH, LABEL_LH, HEADING_LH]),
    ],
    { targetLevel: "AA" },
  );

  it("collapses six engine findings into three issues", () => {
    expect(merged.findings).toHaveLength(3);
  });

  it("tags every survivor with both engines", () => {
    for (const f of merged.findings) {
      expect(f.source).toBe("axe+lighthouse");
      expect(f.evidence?.sources).toEqual(["axe", "lighthouse"]);
    }
  });

  it("keeps axe's failure summary, which Lighthouse does not provide", () => {
    const contrast = merged.findings.find((f) => f.category === "Contrast");
    expect(contrast?.evidence?.failureSummary).toContain("2.76");
  });

  it("names both engines in the markdown report", () => {
    const md = formatMarkdown(merged);
    expect(md).toContain("**Reported by:** axe + lighthouse");
  });

  it("does not double-count remediation effort", () => {
    const single = estimateTotalHours([CONTRAST_AXE, LABEL_AXE, HEADING_AXE]);
    expect(estimateTotalHours(merged.findings)).toBe(single);
  });

  it("keeps the same issue on different pages separate", () => {
    const otherPage = mergeAssessments(
      [
        assessment([CONTRAST_AXE]),
        assessment([{ ...CONTRAST_AXE, evidence: { ...CONTRAST_AXE.evidence, page: `${PAGE}-es` } }]),
      ],
      { targetLevel: "AA" },
    );
    expect(otherPage.findings).toHaveLength(2);
  });

  it("keeps two distinct elements found by the same engine", () => {
    const second = finding({
      ruleId: "color-contrast",
      source: "axe",
      category: "Contrast",
      wcag: "1.4.3",
      selector: ".promo-banner__cta",
      html: '<a class="promo-banner__cta">Shop supplies</a>',
    });
    const sameEngine = mergeAssessments([assessment([CONTRAST_AXE, second])], {
      targetLevel: "AA",
    });
    expect(sameEngine.findings).toHaveLength(2);
  });

  it("takes the larger affected-element count when engines disagree", () => {
    const axeOne = finding({
      ruleId: "image-alt",
      source: "axe",
      category: "Images/Icons",
      wcag: "1.1.1",
      selector: ".pdf-page img",
      affectedElements: 1,
      html: '<img src="blob:https://adapthealth.com/abc" style="width: 100%">',
    });
    const lhSix = finding({
      ruleId: "image-alt",
      source: "lighthouse",
      category: "Images/Icons",
      wcag: "1.1.1",
      selector: "div > div > div > img.pdf-page",
      affectedElements: 6,
      html: '<img src="blob:https://adapthealth.com/abc" style="width: 100%">',
    });
    const images = mergeAssessments([assessment([axeOne]), assessment([lhSix])], {
      targetLevel: "AA",
    });
    expect(images.findings).toHaveLength(1);
    expect(images.findings[0]?.evidence?.affectedElements).toBe(6);
  });
});
