import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/studio/settings/field";
import { useBoardStore } from "@/lib/board-store";
import { createDefaultConnectors } from "@/lib/connectors";
import {
  pullJiraIssue,
  syncGithubRepos,
  syncJiraIssues,
  testGithubConnection,
  testJiraConnection,
} from "@/lib/connectors-api";

export function ConnectTab() {
  const config = useBoardStore((s) => s.config);
  const patchConfig = useBoardStore((s) => s.patchConfig);
  const setCatalog = useBoardStore((s) => s.setCatalog);
  const connectors = config.connectors ?? createDefaultConnectors();
  const [jiraMsg, setJiraMsg] = useState("");
  const [ghMsg, setGhMsg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [pullKey, setPullKey] = useState("");

  function patchJira(partial: Partial<typeof connectors.jira>) {
    patchConfig({ connectors: { ...connectors, jira: { ...connectors.jira, ...partial } } });
  }
  function patchGithub(partial: Partial<typeof connectors.github>) {
    patchConfig({ connectors: { ...connectors, github: { ...connectors.github, ...partial } } });
  }

  async function testJira() {
    setBusy("jira-test");
    const r = await testJiraConnection({ data: { jira: connectors.jira } });
    setJiraMsg(r.ok ? `Pass · ${r.detail}` : `Fail · ${r.detail}`);
    setBusy(null);
  }
  async function syncJira() {
    setBusy("jira-sync");
    const r = await syncJiraIssues({ data: { jira: connectors.jira } });
    if (r.ok) {
      setCatalog({ issues: r.issues });
      setJiraMsg(`Synced ${r.issues.length} issues`);
    } else {
      setJiraMsg(`Fail · ${r.error}`);
    }
    setBusy(null);
  }
  async function pullOne() {
    setBusy("jira-pull");
    const r = await pullJiraIssue({ data: { jira: connectors.jira, key: pullKey } });
    if (r.ok && r.issue) {
      const issues = [r.issue, ...connectors.issues.filter((i) => i.key !== r.issue!.key)];
      setCatalog({ issues });
      setJiraMsg(`Pulled ${r.issue.key}`);
    } else {
      setJiraMsg(`Fail · ${r.error}`);
    }
    setBusy(null);
  }
  async function testGh() {
    setBusy("gh-test");
    const r = await testGithubConnection({ data: { github: connectors.github } });
    setGhMsg(r.ok ? `Pass · ${r.detail}` : `Fail · ${r.detail}`);
    setBusy(null);
  }
  async function syncGh() {
    setBusy("gh-sync");
    const r = await syncGithubRepos({ data: { github: connectors.github } });
    if (r.ok) {
      setCatalog({ repos: r.repos });
      setGhMsg(`Synced ${r.repos.length} repos`);
    } else {
      setGhMsg(`Fail · ${r.error}`);
    }
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        Point Kindling at your org Jira and GitHub Enterprise with a PAT. Sync issues and repos, then drop a Jira key or repo onto a pipeline ticket — that becomes <span className="font-mono">{"{{jira.key}}"}</span> / <span className="font-mono">{"{{repo}}"}</span> for every later stage.
      </p>

      <section className="flex flex-col gap-3 rounded-md border border-border p-3">
        <h3 className="text-sm font-medium">Jira</h3>
        <Field label="Base URL">
          <Input
            className="font-mono"
            placeholder="https://jira.company.com"
            value={connectors.jira.baseUrl}
            onChange={(e) => patchJira({ baseUrl: e.target.value })}
          />
        </Field>
        <Field label="PAT">
          <Input
            type="password"
            className="font-mono"
            placeholder="Jira personal access token"
            value={connectors.jira.token}
            onChange={(e) => patchJira({ token: e.target.value })}
            autoComplete="off"
          />
        </Field>
        <Field label="Project key">
          <Input
            className="font-mono"
            placeholder={config.jiraPrefix || "X2"}
            value={connectors.jira.project}
            onChange={(e) => patchJira({ project: e.target.value.toUpperCase() })}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={Boolean(busy)} onClick={() => void testJira()}>
            {busy === "jira-test" ? "Testing…" : "Test Jira"}
          </Button>
          <Button type="button" disabled={Boolean(busy)} onClick={() => void syncJira()}>
            {busy === "jira-sync" ? "Syncing…" : "Sync issues"}
          </Button>
        </div>
        <div className="flex gap-2">
          <Input
            className="font-mono"
            placeholder="X2-698"
            value={pullKey}
            onChange={(e) => setPullKey(e.target.value)}
          />
          <Button type="button" disabled={Boolean(busy) || !pullKey.trim()} onClick={() => void pullOne()}>
            {busy === "jira-pull" ? "Pulling…" : "Pull key"}
          </Button>
        </div>
        {jiraMsg ? <p className="text-2xs text-muted">{jiraMsg}</p> : null}
        {connectors.issues.length ? (
          <ul className="max-h-40 overflow-auto text-2xs">
            {connectors.issues.map((i) => (
              <li key={i.key} className="border-t border-border py-1">
                <span className="font-mono">{i.key}</span> {i.title}
                <span className="text-muted"> · {i.status}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-border p-3">
        <h3 className="text-sm font-medium">GitHub Enterprise</h3>
        <Field label="Host or API URL">
          <Input
            className="font-mono"
            placeholder="https://ghe.company.com"
            value={connectors.github.baseUrl}
            onChange={(e) => patchGithub({ baseUrl: e.target.value })}
          />
        </Field>
        <Field label="PAT">
          <Input
            type="password"
            className="font-mono"
            placeholder="GitHub Enterprise personal access token"
            value={connectors.github.token}
            onChange={(e) => patchGithub({ token: e.target.value })}
            autoComplete="off"
          />
        </Field>
        <Field label="Org (optional — blank = your repos)">
          <Input
            className="font-mono"
            value={connectors.github.org}
            onChange={(e) => patchGithub({ org: e.target.value })}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={Boolean(busy)} onClick={() => void testGh()}>
            {busy === "gh-test" ? "Testing…" : "Test GitHub"}
          </Button>
          <Button type="button" disabled={Boolean(busy)} onClick={() => void syncGh()}>
            {busy === "gh-sync" ? "Syncing…" : "Sync repos"}
          </Button>
        </div>
        {ghMsg ? <p className="text-2xs text-muted">{ghMsg}</p> : null}
        {connectors.repos.length ? (
          <ul className="max-h-40 overflow-auto text-2xs">
            {connectors.repos.map((r) => (
              <li key={r.fullName} className="border-t border-border py-1">
                <span className="font-mono">{r.fullName}</span>
                <span className="text-muted"> · {r.defaultBranch}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
