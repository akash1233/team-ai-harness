import type { JiraIssue, Plan } from "./types.ts";

export const JIRA_BROWSE_HOST = "https://jira2.workday.com/browse";

const ISSUE_KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
const BROWSE_KEY = /\/browse\/([A-Z][A-Z0-9]+-\d+)/gi;

export type FileJiraMcpExtract = {
  found: boolean;
  display: string;
  issues: JiraIssue[];
};

export type FileJiraExtractOpts = {
  project?: string;
  excludeKeys?: string[];
};

function stripLogNoise(text: string): string {
  return text
    .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

export function jiraProjectFromKey(key: string | undefined): string {
  const match = (key ?? "").trim().match(/^([A-Z][A-Z0-9]+)-\d+$/i);
  return match?.[1]?.toUpperCase() ?? "";
}

export function planStepKind(title: string): "epic" | "story" {
  return /^\s*epic\b/i.test(title.trim()) ? "epic" : "story";
}

export function formatFiledJiraDisplay(issues: JiraIssue[]): string {
  if (!issues.length) return "";
  return [
    "Created:",
    ...issues.map((issue) => {
      const link = `[${issue.key}](${JIRA_BROWSE_HOST}/${issue.key})`;
      const kind = issue.kind === "epic" ? "Epic" : "Story";
      return `- ${kind} ${link} ${issue.title}`;
    }),
  ].join("\n");
}

function uniqueKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of keys) {
    const normalized = key.toUpperCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function collectKeys(plain: string, opts?: FileJiraExtractOpts): string[] {
  const exclude = new Set((opts?.excludeKeys ?? []).map((key) => key.toUpperCase()));
  const project = (opts?.project ?? "").trim().toUpperCase();
  const found: string[] = [];
  for (const match of plain.matchAll(BROWSE_KEY)) {
    if (match[1]) found.push(match[1]);
  }
  for (const match of plain.matchAll(ISSUE_KEY)) {
    if (match[1]) found.push(match[1]);
  }
  return uniqueKeys(found).filter((key) => {
    if (exclude.has(key)) return false;
    if (project && jiraProjectFromKey(key) !== project) return false;
    return true;
  });
}

function titleForKey(plain: string, key: string, step?: Plan["steps"][number]): string {
  if (step?.title.trim()) return step.title.trim();
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const line = plain.split("\n").find((row) => new RegExp(`\\b${escaped}\\b`).test(row));
  if (!line) return key;
  return line
    .replace(new RegExp(`\\[?${escaped}\\]?`, "g"), "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s*[-*]\s*/, "")
    .replace(/^\s*(Epic|Story)\s*/i, "")
    .replace(/\(\s*epic\s+[A-Z][A-Z0-9]+-\d+\s*\)/i, "")
    .trim() || key;
}

function looksLikeCreateResult(plain: string): boolean {
  return (
    /\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(plain) ||
    /^\s*Created:/m.test(plain) ||
    /filed\s+\d+\s+(jira\s+)?issues?/i.test(plain) ||
    /"ticketKey"\s*:/i.test(plain)
  );
}

/** Pull created epic/story keys from a File Jira Terminal log. */
export function extractFileJiraMcpResult(
  log: string,
  plan?: Plan | null,
  opts?: FileJiraExtractOpts,
): FileJiraMcpExtract {
  const plain = stripLogNoise(log);
  if (!plain.trim()) return { found: false, display: "", issues: [] };

  const keys = collectKeys(plain, opts);
  if (!keys.length || !looksLikeCreateResult(plain)) {
    return { found: false, display: "", issues: [] };
  }

  const steps = plan?.steps ?? [];
  const issues: JiraIssue[] = keys.map((key, index) => {
    const step = steps.length === keys.length ? steps[index] : steps.find((item) => item.createdKey?.toUpperCase() === key);
    return {
      key,
      title: titleForKey(plain, key, step),
      kind: planStepKind(step?.title ?? titleForKey(plain, key)),
    };
  });

  return {
    found: true,
    display: formatFiledJiraDisplay(issues),
    issues,
  };
}

export function fileJiraMcpSucceeded(log: string, opts?: FileJiraExtractOpts): boolean {
  return extractFileJiraMcpResult(log, null, opts).found;
}
