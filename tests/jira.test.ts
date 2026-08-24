import { describe, it, expect, vi } from "vitest";
import { buildTicketPayload, createJiraTickets, filterBySeverity } from "../src/integrations/jira.js";
import type { Finding } from "../src/types.js";
import type { Assessment } from "../src/types.js";
import { wcag } from "../src/wcag.js";

const finding: Finding = {
  ruleId: "input-label",
  title: "Inputs must have labels",
  description: "Every form input must have a label.",
  severity: "critical",
  wcag: wcag("3.3.2"),
  nodeId: "input-1",
  nodeType: "textinput",
  remediation: "Add a label.",
};

const config = {
  baseUrl: "https://example.atlassian.net",
  email: "a@b.com",
  apiToken: "token",
  projectKey: "A11Y",
};

describe("buildTicketPayload", () => {
  it("maps a finding to a Jira issue payload", () => {
    const payload = buildTicketPayload(finding, config);
    expect(payload.fields.project).toEqual({ key: "A11Y" });
    expect(payload.fields.summary).toContain("Inputs must have labels");
    expect(payload.fields.priority).toEqual({ name: "Highest" });
    expect(payload.fields.labels).toContain("rule-input-label");
  });
});

describe("filterBySeverity", () => {
  const findings: Finding[] = [
    { ...finding, severity: "critical" },
    { ...finding, severity: "medium" },
    { ...finding, severity: "low" },
  ];

  it("returns all when no threshold", () => {
    expect(filterBySeverity(findings)).toHaveLength(3);
  });

  it("filters at/above threshold", () => {
    expect(filterBySeverity(findings, "medium")).toHaveLength(2);
    expect(filterBySeverity(findings, "critical")).toHaveLength(1);
  });
});

describe("createJiraTickets", () => {
  it("POSTs an issue per finding using the injected fetch", async () => {
    const assessment = { findings: [finding] } as Assessment;
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ key: "A11Y-1", id: "1", self: "url" }),
      text: async () => "",
    });

    const created = await createJiraTickets(assessment, config, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(created[0]?.key).toBe("A11Y-1");
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toMatch(/^Basic /);
  });

  it("throws on a non-ok response", async () => {
    const assessment = { findings: [finding] } as Assessment;
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({}),
      text: async () => "bad request",
    });
    await expect(createJiraTickets(assessment, config, { fetchImpl })).rejects.toThrow(/400/);
  });
});
