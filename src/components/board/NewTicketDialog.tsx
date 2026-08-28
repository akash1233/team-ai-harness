import { useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { useBoardStore } from "@/lib/board-store";
import { nextKey } from "@/lib/format";
import { createDefaultConnectors, type LinkedJira, type LinkedRepo } from "@/lib/connectors";

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
  const [issueKey, setIssueKey] = useState("");
  const [repoName, setRepoName] = useState("");
  const preview = nextKey(tickets.map((t) => t.key), prefix);
  const issue: LinkedJira | undefined = connectors.issues.find((i) => i.key === issueKey);
  const repo: LinkedRepo | undefined = connectors.repos.find((r) => r.fullName === repoName);

  function submit(e: FormEvent) {
    e.preventDefault();
    const summary = title.trim() || issue?.title;
    if (!summary) return;
    addTicket({
      title: summary,
      description: description.trim() || issue?.description || "",
      key: issue?.key,
      linkedJira: issue,
      linkedRepo: repo,
    });
    setTitle("");
    setDescription("");
    setIssueKey("");
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
            {connectors.issues.length ? (
              <label className="block">
                <span className="mb-1 block text-2xs text-muted">Jira issue</span>
                <select
                  className="h-11 w-full rounded-md border border-border bg-inset px-2 text-sm"
                  value={issueKey}
                  onChange={(e) => {
                    const next = connectors.issues.find((i) => i.key === e.target.value);
                    setIssueKey(e.target.value);
                    if (next) {
                      setTitle(next.title);
                      setDescription(next.description);
                    }
                  }}
                >
                  <option value="">None — type a summary</option>
                  {connectors.issues.map((i) => (
                    <option key={i.key} value={i.key}>
                      {i.key} {i.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
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