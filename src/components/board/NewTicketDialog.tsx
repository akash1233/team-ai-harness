import { useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { useBoardStore } from "@/lib/board-store";
import { nextKey } from "@/lib/format";

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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const preview = nextKey(tickets.map((t) => t.key), prefix);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    addTicket({ title, description });
    setTitle("");
    setDescription("");
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
                Lands on {flowName} in the first collect stage as {preview}.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-sm p-1 text-subtle hover:text-fg">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <form onSubmit={submit} className="flex flex-col gap-3">
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
              <Button type="submit" variant="primary" disabled={!title.trim()}>
                Create {preview}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
