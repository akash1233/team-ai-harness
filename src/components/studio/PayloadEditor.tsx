import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useBoardStore } from "@/lib/board-store";
import { previewStagePrompt, type StagePayload } from "@/lib/discovery-agent";
import { columnById } from "@/lib/columns";
import { getFlowStage } from "@/lib/flow-spec";
import { resolveStagePrompt } from "@/lib/prompts";
import { FlowSpecWarning } from "@/components/studio/FlowSpecWarning";
import type { Ticket } from "@/lib/types";

export function useStagePayload(ticket: Ticket) {
  const config = useBoardStore((state) => state.config);
  const column = columnById(ticket.columnId, config.columns);
  const stage = getFlowStage(ticket.columnId);
  const resolved = resolveStagePrompt(column, config.prompts, config.docs);
  const [payload, setPayload] = useState<StagePayload | null>(null);
  const [baseline, setBaseline] = useState<StagePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fingerprint = JSON.stringify({
    columnId: ticket.columnId,
    title: ticket.title,
    description: ticket.description,
    labels: ticket.labels,
    slackChannel: ticket.slackChannel,
    slackChannelId: ticket.slackChannelId,
    outputs: ticket.outputs,
    vars: ticket.vars,
    transcript: ticket.transcript,
    linkedJiras: ticket.linkedJiras,
    linkedRepo: ticket.linkedRepo,
    plan: ticket.plan,
    grillRounds: ticket.grillRounds,
    prompt: stage?.prompt,
    columns: config.columns,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await previewStagePrompt({
        data: {
          ticket,
          columnId: ticket.columnId,
          promptId: resolved.studioPromptId,
          docs: resolved.docs,
          jira: config.connectors.jira,
          jiraKeys: resolved.jiraKeys,
          jiraIssues: config.connectors.issues.filter((issue) =>
            resolved.jiraKeys.some((key) => key.toUpperCase() === issue.key.toUpperCase()),
          ),
          columns: config.columns,
        },
      });
      setPayload(next);
      setBaseline(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare the stage payload");
    } finally {
      setLoading(false);
    }
  // fingerprint intentionally represents every value that changes the payload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    payload,
    setPayload,
    loading,
    error,
    dirty: Boolean(payload && baseline && (payload.system !== baseline.system || payload.user !== baseline.user)),
    regenerate: load,
  };
}

export function PayloadEditor({
  payload,
  onChange,
  loading,
  error,
  dirty,
  onRegenerate,
}: {
  payload: StagePayload | null;
  onChange: (payload: StagePayload) => void;
  loading: boolean;
  error: string;
  dirty: boolean;
  onRegenerate: () => void;
}) {
  const characters = useMemo(
    () => (payload ? payload.system.length + payload.user.length : 0),
    [payload],
  );

  return (
    <details className="border border-border bg-inset p-3" open>
      <summary className="cursor-pointer text-micro font-medium uppercase tracking-wide text-subtle">
        Payload to next stage · {characters.toLocaleString()} chars{dirty ? " · edited" : ""}
      </summary>
      {loading ? <p className="mt-2 text-2xs text-muted">Preparing all upstream data…</p> : null}
      {error ? <p className="mt-2 text-2xs text-danger">{error}</p> : null}
      {payload ? (
        <div className="mt-3 flex flex-col gap-3">
          {dirty ? <FlowSpecWarning /> : null}
          <label>
            <span className="mb-1 block text-2xs text-muted">System instructions</span>
            <Textarea
              className="min-h-24 font-mono text-2xs"
              value={payload.system}
              onChange={(event) => onChange({ ...payload, system: event.target.value })}
            />
          </label>
          <label>
            <span className="mb-1 block text-2xs text-muted">Data and prompt sent</span>
            <Textarea
              className="min-h-64 font-mono text-2xs"
              value={payload.user}
              onChange={(event) => onChange({ ...payload, user: event.target.value })}
            />
          </label>
          <Button type="button" variant="secondary" size="md" onClick={onRegenerate} disabled={loading}>
            <RotateCw className="size-3.5" />
            Regenerate from pipeline data
          </Button>
        </div>
      ) : null}
    </details>
  );
}
