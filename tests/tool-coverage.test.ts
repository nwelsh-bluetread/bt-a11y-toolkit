import { describe, expect, it } from "vitest";
import { criteriaByTool, toolCoverage } from "../src/tool-coverage.js";
import { WCAG } from "../src/wcag.js";

describe("toolCoverage", () => {
  it("only names real WCAG 2.2 criteria", () => {
    for (const [tool, ids] of Object.entries(criteriaByTool())) {
      for (const id of ids) expect(WCAG[id], `${tool}: ${id}`).toBeDefined();
    }
  });

  it("lists every criterion once, with what checks it", () => {
    const rows = toolCoverage();
    expect(rows).toHaveLength(Object.keys(WCAG).length);
    expect(rows.find((r) => r.id === "2.5.8")).toMatchObject({ tools: ["axe", "lighthouse", "rn-code-scan", "device-target-size"] });
    expect(rows.find((r) => r.id === "2.4.5")).toMatchObject({ tools: [], manual: ["web"] });
    // Every A/AA criterion has a manual check, since no scanner can confirm a pass.
    expect(rows.filter((r) => r.level !== "AAA" && r.manual.length === 0)).toEqual([]);
  });
});
