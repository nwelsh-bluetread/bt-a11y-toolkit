import { describe, it, expect } from "vitest";
import { estimateHours, estimateTotalHours, SEVERITY_HOURS } from "../src/effort.js";
import { wcag } from "../src/wcag.js";
import type { Finding, Severity } from "../src/types.js";

function finding(severity: Severity, ruleId: string = severity): Finding {
  return {
    ruleId,
    title: `${severity} issue`,
    description: "",
    severity,
    wcag: wcag("1.1.1"),
  };
}

describe("estimateHours", () => {
  it("returns the per-severity baseline for each finding", () => {
    for (const severity of ["critical", "high", "medium", "low"] as Severity[]) {
      expect(estimateHours(finding(severity))).toBe(SEVERITY_HOURS[severity]);
    }
  });

  it("weights more severe findings higher", () => {
    expect(estimateHours(finding("critical"))).toBeGreaterThan(estimateHours(finding("low")));
  });
});

describe("estimateTotalHours", () => {
  it("returns zero for no findings", () => {
    expect(estimateTotalHours([])).toBe(0);
  });

  it("sums the per-finding estimates", () => {
    const findings = [finding("critical"), finding("high", "b"), finding("low", "c")];
    expect(estimateTotalHours(findings)).toBe(
      SEVERITY_HOURS.critical + SEVERITY_HOURS.high + SEVERITY_HOURS.low,
    );
  });

  it("costs a de-duplicated set once, not once per engine", () => {
    const critical = finding("critical");
    const high = finding("high", "b");
    const deduped = [critical, high];
    // Merging engines yields the same deduped set, so the cost must not change.
    expect(estimateTotalHours(deduped)).toBe(estimateHours(critical) + estimateHours(high));
  });
});
