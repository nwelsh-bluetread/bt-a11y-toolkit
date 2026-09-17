import { describe, it, expect } from "vitest";
import {
  estimateFindingHours,
  estimateTotalHours,
  withEffortEstimates,
  affectedElementCount,
  formatHours,
} from "../src/effort.js";
import type { Finding } from "../src/types.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: "interactive-accessible-name",
    title: "Test finding",
    description: "desc",
    severity: "medium",
    wcag: [],
    category: "Semantics",
    ...overrides,
  };
}

describe("estimateFindingHours", () => {
  it("uses the category base cost, adjusted by severity", () => {
    // Semantics base 0.5 * medium 1 = 0.5
    expect(estimateFindingHours(finding({ category: "Semantics", severity: "medium" }))).toBe(0.5);
    // Forms base 1 * critical 1.5 = 1.5
    expect(
      estimateFindingHours(
        finding({ ruleId: "some-forms-rule", category: "Forms", severity: "critical" }),
      ),
    ).toBe(1.5);
  });

  it("honors rule-specific overrides over category", () => {
    // custom-component-props override 1.5 * high 1.25 = 1.875 -> rounds to 2 (quarter)
    expect(
      estimateFindingHours(
        finding({ ruleId: "custom-component-props", category: "Semantics", severity: "high" }),
      ),
    ).toBe(2);
  });

  it("matches scanner-prefixed rule ids against the bare rule name", () => {
    // axe:label -> label override 1 * critical 1.5 = 1.5
    expect(
      estimateFindingHours(finding({ ruleId: "axe:label", category: "Forms", severity: "critical" })),
    ).toBe(1.5);
  });

  it("scales up with additional affected elements", () => {
    const one = estimateFindingHours(
      finding({ category: "Contrast", severity: "high", evidence: { affectedElements: 1 } }),
    );
    const many = estimateFindingHours(
      finding({ category: "Contrast", severity: "high", evidence: { affectedElements: 5 } }),
    );
    expect(many).toBeGreaterThan(one);
  });

  it("caps the per-element scaling so shared fixes plateau", () => {
    const at12 = estimateFindingHours(
      finding({ category: "Forms", severity: "high", evidence: { affectedElements: 12 } }),
    );
    const at50 = estimateFindingHours(
      finding({ category: "Forms", severity: "high", evidence: { affectedElements: 50 } }),
    );
    expect(at50).toBe(at12);
  });

  it("never returns less than a quarter hour", () => {
    expect(estimateFindingHours(finding({ category: "Images/Icons", severity: "low" }))).toBeGreaterThanOrEqual(0.25);
  });
});

describe("affectedElementCount", () => {
  it("reads affectedElements, then elements, then selectors, defaulting to 1", () => {
    expect(affectedElementCount(finding({ evidence: { affectedElements: 4 } }))).toBe(4);
    expect(affectedElementCount(finding({ evidence: { elements: [{}, {}] } }))).toBe(2);
    expect(affectedElementCount(finding({ evidence: { selectors: ["a", "b", "c"] } }))).toBe(3);
    expect(affectedElementCount(finding())).toBe(1);
  });
});

describe("estimateTotalHours", () => {
  it("sums per-finding estimates", () => {
    const findings = [
      finding({ category: "Images/Icons", severity: "low" }), // 0.25 * 0.75 -> 0.25 (floor)
      finding({ category: "Forms", severity: "critical", ruleId: "x" }), // 1 * 1.5 = 1.5
    ];
    expect(estimateTotalHours(findings)).toBe(1.75);
  });

  it("prefers a pre-computed estimatedHours when present", () => {
    expect(estimateTotalHours([finding({ estimatedHours: 3 })])).toBe(3);
  });
});

describe("withEffortEstimates", () => {
  it("populates estimatedHours without mutating input", () => {
    const input = finding({ category: "Forms", severity: "critical", ruleId: "x" });
    const [out] = withEffortEstimates([input]);
    expect(out?.estimatedHours).toBe(1.5);
    expect(input.estimatedHours).toBeUndefined();
  });
});

describe("formatHours", () => {
  it("formats sub-day values as hours", () => {
    expect(formatHours(0.5)).toBe("0.5h");
    expect(formatHours(2)).toBe("2h");
  });

  it("formats day-scale values with a day approximation", () => {
    expect(formatHours(8)).toBe("~1 day (8h)");
    expect(formatHours(16)).toBe("~2 days (16h)");
  });
});
