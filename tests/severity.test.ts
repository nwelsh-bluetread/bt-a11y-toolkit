import { describe, expect, it } from "vitest";
import { formatMarkdown } from "../src/report.js";
import { severityGuideMarkdown, severitySourcesFor } from "../src/severity.js";
import type { Finding } from "../src/types.js";

const finding = (source: string): Finding => ({ ruleId: "r", title: "t", description: "", severity: "high", wcag: [], source });

describe("severity guide", () => {
  it("lists only the sources this audit's findings came from, plus manual testing", () => {
    expect(severitySourcesFor([finding("rn-code-scan")]).map((s) => s.source)).toEqual(["Code scan", "Manual testing"]);
    expect(severitySourcesFor([finding("axe"), finding("device")]).map((s) => s.source)).toEqual(["axe (web)", "On-device measurement", "Manual testing"]);
  });

  it("explains every severity level in markdown", () => {
    const md = severityGuideMarkdown([finding("rn-code-scan")]).join("\n");
    expect(md).toContain("### How severity is decided");
    for (const level of ["Critical", "High", "Medium", "Low"]) expect(md).toMatch(new RegExp(`^\\| ${level} \\|`, "m"));
    expect(md).toContain("| Code scan |");
    expect(md).not.toContain("Lighthouse");
  });

  it("is part of report.md", () => {
    const md = formatMarkdown({
      findings: [finding("rn-code-scan")],
      counts: { critical: 0, high: 1, medium: 0, low: 0 },
      categories: [],
      wcag: {},
      overallScore: 90,
    } as never);
    expect(md).toContain("### How severity is decided");
  });
});
