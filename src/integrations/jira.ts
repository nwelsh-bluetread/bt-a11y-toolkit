import type { Assessment, Finding, Severity } from "../types.js";

/** Configuration for the Jira Cloud REST API. */
export interface JiraConfig {
  /** e.g. "https://your-org.atlassian.net" */
  baseUrl: string;
  /** Atlassian account email used with the API token. */
  email: string;
  /** Atlassian API token (https://id.atlassian.com/manage-profile/security/api-tokens). */
  apiToken: string;
  /** Project key, e.g. "A11Y". */
  projectKey: string;
  /** Issue type name. Defaults to "Bug". */
  issueType?: string;
  /**
   * Optional map from toolkit severity to a Jira priority name.
   * e.g. { critical: "Highest", high: "High", medium: "Medium", low: "Low" }
   */
  priorityBySeverity?: Partial<Record<Severity, string>>;
  /** Labels applied to every created issue. Defaults to ["accessibility"]. */
  labels?: string[];
}

/** A minimal fetch signature so this is injectable/testable without globals. */
export type FetchLike = (
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface JiraTicketPayload {
  fields: Record<string, unknown>;
}

export interface CreatedTicket {
  key: string;
  id: string;
  self: string;
  finding: Finding;
}

const DEFAULT_PRIORITY: Record<Severity, string> = {
  critical: "Highest",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Build a Jira issue payload (Atlassian Document Format description) from a finding. */
export function buildTicketPayload(finding: Finding, config: JiraConfig): JiraTicketPayload {
  const priorityName = config.priorityBySeverity?.[finding.severity] ?? DEFAULT_PRIORITY[finding.severity];
  const wcagText = finding.wcag.map((c) => `${c.id} ${c.name} (${c.level})`).join(", ");
  const labels = [...(config.labels ?? ["accessibility"]), `a11y-${finding.severity}`, `rule-${finding.ruleId}`];

  return {
    fields: {
      project: { key: config.projectKey },
      issuetype: { name: config.issueType ?? "Bug" },
      summary: `[A11y] ${finding.title}${finding.nodeType ? ` — ${finding.nodeType}` : ""}`,
      priority: { name: priorityName },
      labels,
      description: adf([
        heading("Description"),
        paragraph(finding.description),
        ...(finding.remediation ? [heading("Remediation"), paragraph(finding.remediation)] : []),
        heading("Details"),
        bulletList([
          `Rule: ${finding.ruleId}`,
          `Severity: ${finding.severity}`,
          `WCAG: ${wcagText}`,
          ...(finding.nodeId ? [`Element: ${finding.nodeType ?? "unknown"} (${finding.nodeId})`] : []),
        ]),
      ]),
    },
  };
}

/**
 * Create Jira tickets for each finding in an assessment.
 *
 * `fetchImpl` defaults to the global `fetch` (Node 18+). Provide a stub in tests.
 */
export async function createJiraTickets(
  assessment: Assessment,
  config: JiraConfig,
  options: { minSeverity?: Severity; fetchImpl?: FetchLike } = {},
): Promise<CreatedTicket[]> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  if (!fetchImpl) {
    throw new Error("No fetch implementation available. Pass options.fetchImpl.");
  }

  const findings = filterBySeverity(assessment.findings, options.minSeverity);
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  const url = `${config.baseUrl.replace(/\/$/, "")}/rest/api/3/issue`;
  const created: CreatedTicket[] = [];

  for (const finding of findings) {
    const payload = buildTicketPayload(finding, config);
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Jira issue creation failed (${res.status}): ${text}`);
    }
    const body = (await res.json()) as { key: string; id: string; self: string };
    created.push({ key: body.key, id: body.id, self: body.self, finding });
  }

  return created;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function filterBySeverity(findings: Finding[], minSeverity?: Severity): Finding[] {
  if (!minSeverity) return findings;
  const threshold = SEVERITY_RANK[minSeverity];
  return findings.filter((f) => SEVERITY_RANK[f.severity] <= threshold);
}

// --- Minimal Atlassian Document Format (ADF) helpers ---

function adf(content: unknown[]): unknown {
  return { type: "doc", version: 1, content };
}

function heading(text: string): unknown {
  return { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text }] };
}

function paragraph(text: string): unknown {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function bulletList(items: string[]): unknown {
  return {
    type: "bulletList",
    content: items.map((text) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    })),
  };
}
