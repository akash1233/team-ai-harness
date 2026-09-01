export type LinkedJira = {
  key: string;
  title: string;
  status: string;
  type?: string;
  url: string;
  description: string;
};

export type LinkedRepo = {
  fullName: string;
  name: string;
  url: string;
  defaultBranch: string;
  description: string;
};

export type JiraConnection = {
  baseUrl: string;
  email: string;
  token: string;
  project: string;
};

export type GithubConnection = {
  baseUrl: string;
  token: string;
  org: string;
};

export type ConnectorsConfig = {
  jira: JiraConnection;
  github: GithubConnection;
  issues: LinkedJira[];
  repos: LinkedRepo[];
};

export function createDefaultConnectors(): ConnectorsConfig {
  return {
    jira: { baseUrl: "", email: "", token: "", project: "" },
    github: { baseUrl: "", token: "", org: "" },
    issues: [],
    repos: [],
  };
}

export function mergeConnectors(saved?: Partial<ConnectorsConfig>): ConnectorsConfig {
  const d = createDefaultConnectors();
  if (!saved) return d;
  return {
    jira: { ...d.jira, ...saved.jira },
    github: { ...d.github, ...saved.github },
    issues: Array.isArray(saved.issues) ? saved.issues : d.issues,
    repos: Array.isArray(saved.repos) ? saved.repos : d.repos,
  };
}

export function jiraHost(baseUrl: string): string {
  return (baseUrl || "").trim().replace(/\/+$/, "").replace(/\/browse$/i, "");
}

export function githubApiBase(baseUrl: string): string {
  const raw = (baseUrl || "").trim().replace(/\/+$/, "");
  if (!raw) return "https://api.github.com";
  if (/api\.github\.com/i.test(raw)) return "https://api.github.com";
  if (/\/api\/v3$/i.test(raw)) return raw;
  return `${raw}/api/v3`;
}

export function jiraIssueUrl(baseUrl: string, key: string): string {
  const host = jiraHost(baseUrl);
  return host ? `${host}/browse/${key}` : key;
}

export function flattenAdf(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(flattenAdf).join("");
  if (typeof node === "object") {
    const n = node as { type?: string; text?: string; content?: unknown };
    const inner = flattenAdf(n.content);
    if (n.type === "paragraph" || n.type === "heading") return `${inner}\n`;
    return (n.text ?? "") + inner;
  }
  return "";
}

export function connectorVars(issue?: LinkedJira | null, repo?: LinkedRepo | null): Record<string, string> {
  const vars: Record<string, string> = {};
  if (issue) {
    vars["jira.key"] = issue.key;
    vars["jira.title"] = issue.title;
    vars["jira.status"] = issue.status;
    vars["jira.url"] = issue.url;
    vars["jira.description"] = issue.description;
    vars.jira = `${issue.key} ${issue.title}\n${issue.description}`.trim();
  }
  if (repo) {
    vars.repo = repo.fullName;
    vars["repo.fullName"] = repo.fullName;
    vars["repo.url"] = repo.url;
    vars["repo.branch"] = repo.defaultBranch;
    vars["repo.description"] = repo.description;
  }
  return vars;
}

export function hydrateLinkedJiras(linkedJiras?: LinkedJira[], linkedJira?: LinkedJira): LinkedJira[] {
  return Array.isArray(linkedJiras) ? linkedJiras : linkedJira ? [linkedJira] : [];
}

/** Compact one-line-per-issue references for messages posted outside the app. */
export function formatJiraRefs(issues: LinkedJira[]): string {
  return issues.map((issue) => [issue.key, issue.title, issue.url && `— ${issue.url}`].filter(Boolean).join(" ")).join("\n");
}

export function mergeJiraIssues(...groups: LinkedJira[][]): LinkedJira[] {
  const seen = new Set<string>();
  return groups.flat().filter((issue) => {
    const key = issue.key.toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
