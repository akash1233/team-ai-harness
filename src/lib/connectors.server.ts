import {
  flattenAdf,
  githubApiBase,
  jiraHost,
  jiraIssueUrl,
  type GithubConnection,
  type JiraConnection,
  type LinkedJira,
  type LinkedRepo,
} from "./connectors";

function authHeader(kind: "jira" | "github", email: string, token: string): string {
  if (kind === "github") return `Bearer ${token}`;
  if (email.trim()) return `Basic ${Buffer.from(`${email.trim()}:${token}`).toString("base64")}`;
  return `Bearer ${token}`;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text.slice(0, 400) };
  }
}

export async function probeJira(conn: JiraConnection): Promise<{ ok: boolean; detail: string }> {
  const host = jiraHost(conn.baseUrl);
  const token = conn.token.trim();
  if (!host || !token) return { ok: false, detail: "Set Jira base URL and token." };
  try {
    const res = await fetch(`${host}/rest/api/2/myself`, {
      headers: { Authorization: authHeader("jira", conn.email, token), Accept: "application/json" },
    });
    const body = (await readJson(res)) as { displayName?: string; name?: string; errorMessages?: string[] };
    if (!res.ok) {
      return { ok: false, detail: body.errorMessages?.join("; ") || `HTTP ${res.status}` };
    }
    return { ok: true, detail: `Signed in as ${body.displayName || body.name || "ok"}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "Jira request failed" };
  }
}

export async function listJiraIssues(conn: JiraConnection): Promise<{ ok: boolean; issues: LinkedJira[]; error?: string }> {
  const host = jiraHost(conn.baseUrl);
  const token = conn.token.trim();
  if (!host || !token) return { ok: false, issues: [], error: "Set Jira base URL and token." };
  const project = conn.project.trim();
  const jql = project ? `project = ${project} ORDER BY updated DESC` : "ORDER BY updated DESC";
  try {
    const url = `${host}/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=30&fields=summary,status,description,issuetype`;
    const res = await fetch(url, {
      headers: { Authorization: authHeader("jira", conn.email, token), Accept: "application/json" },
    });
    const body = (await readJson(res)) as {
      errorMessages?: string[];
      issues?: Array<{
        key: string;
        fields?: {
          summary?: string;
          status?: { name?: string };
          issuetype?: { name?: string };
          description?: unknown;
        };
      }>;
    };
    if (!res.ok) return { ok: false, issues: [], error: body.errorMessages?.join("; ") || `HTTP ${res.status}` };
    const issues: LinkedJira[] = (body.issues ?? []).map((i) => ({
      key: i.key,
      title: i.fields?.summary || i.key,
      status: i.fields?.status?.name || "",
      type: i.fields?.issuetype?.name,
      url: jiraIssueUrl(host, i.key),
      description: flattenAdf(i.fields?.description).trim(),
    }));
    return { ok: true, issues };
  } catch (err) {
    return { ok: false, issues: [], error: err instanceof Error ? err.message : "Jira search failed" };
  }
}

export async function getJiraIssue(conn: JiraConnection, key: string): Promise<{ ok: boolean; issue?: LinkedJira; error?: string }> {
  const host = jiraHost(conn.baseUrl);
  const token = conn.token.trim();
  const id = key.trim().toUpperCase();
  if (!host || !token) return { ok: false, error: "Set Jira base URL and token." };
  if (!id) return { ok: false, error: "Issue key required." };
  try {
    const res = await fetch(`${host}/rest/api/2/issue/${encodeURIComponent(id)}?fields=summary,status,description,issuetype`, {
      headers: { Authorization: authHeader("jira", conn.email, token), Accept: "application/json" },
    });
    const body = (await readJson(res)) as {
      key?: string;
      errorMessages?: string[];
      fields?: { summary?: string; status?: { name?: string }; issuetype?: { name?: string }; description?: unknown };
    };
    if (!res.ok) return { ok: false, error: body.errorMessages?.join("; ") || `HTTP ${res.status}` };
    const issueKey = body.key || id;
    return {
      ok: true,
      issue: {
        key: issueKey,
        title: body.fields?.summary || issueKey,
        status: body.fields?.status?.name || "",
        type: body.fields?.issuetype?.name,
        url: jiraIssueUrl(host, issueKey),
        description: flattenAdf(body.fields?.description).trim(),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Jira get failed" };
  }
}

export async function probeGithub(conn: GithubConnection): Promise<{ ok: boolean; detail: string }> {
  const api = githubApiBase(conn.baseUrl);
  const token = conn.token.trim();
  if (!token) return { ok: false, detail: "Set a GitHub Enterprise token." };
  try {
    const res = await fetch(`${api}/user`, {
      headers: {
        Authorization: authHeader("github", "", token),
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    const body = (await readJson(res)) as { login?: string; message?: string };
    if (!res.ok) return { ok: false, detail: body.message || `HTTP ${res.status}` };
    return { ok: true, detail: `Signed in as ${body.login || "ok"} · ${api}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "GitHub request failed" };
  }
}

export async function listGithubRepos(conn: GithubConnection): Promise<{ ok: boolean; repos: LinkedRepo[]; error?: string }> {
  const api = githubApiBase(conn.baseUrl);
  const token = conn.token.trim();
  if (!token) return { ok: false, repos: [], error: "Set a GitHub Enterprise token." };
  const org = conn.org.trim();
  const path = org ? `/orgs/${encodeURIComponent(org)}/repos` : "/user/repos";
  try {
    const res = await fetch(`${api}${path}?per_page=40&sort=updated`, {
      headers: {
        Authorization: authHeader("github", "", token),
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    const body = await readJson(res);
    if (!res.ok) {
      const msg = typeof body === "object" && body && "message" in body ? String((body as { message: string }).message) : `HTTP ${res.status}`;
      return { ok: false, repos: [], error: msg };
    }
    const list = Array.isArray(body) ? body : [];
    const repos: LinkedRepo[] = list.map((r) => {
      const row = r as { full_name?: string; name?: string; html_url?: string; default_branch?: string; description?: string | null };
      return {
        fullName: row.full_name || row.name || "",
        name: row.name || row.full_name || "",
        url: row.html_url || "",
        defaultBranch: row.default_branch || "main",
        description: row.description || "",
      };
    });
    return { ok: true, repos };
  } catch (err) {
    return { ok: false, repos: [], error: err instanceof Error ? err.message : "GitHub list failed" };
  }
}
