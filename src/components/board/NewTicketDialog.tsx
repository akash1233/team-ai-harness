import { useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { useBoardStore } from "@/lib/board-store";
import { nextKey } from "@/lib/format";
import { createDefaultConnectors, type LinkedJira, type LinkedRepo } from "@/lib/connectors";
import { pullJiraIssue } from "@/lib/connectors-api";

export function NewTicketDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const tickets = useBoardStore((s) => s.tickets);
  const addTicket = useBoardStore((s) => s.addTicket);
  const prefix = useBoardStore((s) => s.config.jiraPrefix);
  const flowName = useBoardStore((s) => s.config.workflowName);
  const connectors = useBoardStore((s) => s.config.connectors) ?? createDefaultConnectors();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const setCatalog = useBoardStore((s) => s.setCatalog);
  const [issueKeys, setIssueKeys] = useState<string[]>([]);
  const [pullKey, setPullKey] = useState("");
  const [pulling, setPulling] = useState(false);
  const [repoName, setRepoName] = useState("");
  const preview = nextKey(tickets.map((t) => t.key), prefix);
  const issues: LinkedJira[] = issueKeys.flatMap((key) => {
    const issue = connectors.issues.find((i) => i.key === key);
    return issue ? [issue] : [];
  });
  const issue = issues[0];
  const repo: LinkedRepo | undefined = connectors.repos.find((r) => r.fullName === repoName);

  function submit(e: FormEvent) {
    e.preventDefault();
    const summary = title.trim() || issue?.title;
    if (!summary) return;
    addTicket({
      title: summary,
      description: description.trim(),
      key: issue?.key,
      linkedJiras: issues,
      linkedRepo: repo,
    });
    setTitle("");
    setDescription("");
    setIssueKeys([]);
    setRepoName("");
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg/70" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface p-4 shadow-panel">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <Dialog.Title className="font-serif text-xl font-medium tracking-tight">New ticket</Dialog.Title>
              <Dialog.Description className="text-sm text-muted">
                Lands on {flowName} as {issue?.key || preview}. Drop in a synced Jira key and repo to seed context.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-sm p-1 text-subtle hover:text-fg">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <fieldset className="rounded-md border border-border p-2">
              <legend className="px-1 text-2xs text-muted">Jira issues</legend>
              {connectors.issues.map((i) => (
                <label key={i.key} className="flex min-h-9 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={issueKeys.includes(i.key)}
                    onChange={(e) => {
                      const next = e.target.checked ? [...issueKeys, i.key] : issueKeys.filter((key) => key !== i.key);
                      setIssueKeys(next);
                      if (e.target.checked && next.length === 1 && !title.trim()) {
                        setTitle(i.title);
                      }
                    }}
                  />
                  <span className="font-mono text-2xs">{i.key}</span>
                  <span className="truncate">{i.title}</span>
                </label>
              ))}
              {connectors.jira.token ? (
                <div className="mt-2 flex gap-1">
                  <Input className="font-mono" placeholder="X2-123" value={pullKey} onChange={(e) => setPullKey(e.target.value)} />
                  <Button
                    type="button"
                    size="md"
                    disabled={pulling || !pullKey.trim()}
                    onClick={async () => {
                      setPulling(true);
                      const r = await pullJiraIssue({ data: { jira: connectors.jira, key: pullKey } });
                      setPulling(false);
                      if (!r.ok || !r.issue) return;
                      setCatalog({ issues: [r.issue, ...connectors.issues.filter((i) => i.key !== r.issue!.key)] });
                      setIssueKeys((current) => current.includes(r.issue!.key) ? current : [...current, r.issue!.key]);
                      setPullKey("");
                    }}
                  >
                    {pulling ? "…" : "Pull"}
                  </Button>
                </div>
              ) : (
                <p className="mt-1 text-2xs text-muted">Set a Jira PAT on Connect to pull by key.</p>
              )}
            </fieldset>
            {connectors.repos.length ? (
              <label className="block">
                <span className="mb-1 block text-2xs text-muted">GitHub repo</span>
                <select
                  className="h-11 w-full rounded-md border border-border bg-inset px-2 text-sm"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                >
                  <option value="">None</option>
                  {connectors.repos.map((r) => (
                    <option key={r.fullName} value={r.fullName}>
                      {r.fullName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="block">
              <span className="mb-1 block text-2xs text-muted">Summary</span>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Add prompts in Jira BDD Assistant"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-2xs text-muted">Problem statement</span>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is broken, for whom, and how we will know it is fixed."
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={!title.trim() && !issue}>
                Create {issue?.key || preview}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}