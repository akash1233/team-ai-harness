import { cn } from "@/lib/cn";
import { formatSpend, formatWhen } from "@/lib/format";
import type { AgentResponse, WorkflowColumn } from "@/lib/types";

function stageName(columnId: string, columns: WorkflowColumn[]) {
  return columns.find((c) => c.id === columnId)?.label ?? columnId;
}

export function RunLog({
  responses,
  columns,
  compact = false,
}: {
  responses: AgentResponse[];
  columns: WorkflowColumn[];
  compact?: boolean;
}) {
  if (responses.length === 0) {
    return <p className="text-sm text-muted">No agent log yet for this stage.</p>;
  }
  return (
    <ol className="flex flex-col gap-2">
      {responses.map((r) => {
        const failed = r.ok === false;
        return (
          <li
            key={r.id}
            className={cn(
              "rounded-md border px-3 py-2",
              failed ? "border-danger/50 bg-danger/5" : "border-border bg-inset",
            )}
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className={cn("text-micro font-medium uppercase tracking-wide", failed ? "text-danger" : "text-subtle")}>
                {failed ? "Failed" : "Ran"}
              </span>
              <span className="text-2xs text-muted">{stageName(r.columnId, columns)}</span>
              {r.via ? <span className="font-mono text-micro text-subtle">{r.via}</span> : null}
              {typeof r.spend === "number" ? (
                <span className="font-mono text-micro text-subtle">{formatSpend(r.spend)}</span>
              ) : null}
              {r.usage ? (
                <span className="font-mono text-micro text-subtle">
                  {r.usage.inputTokens}/{r.usage.outputTokens} tok{r.usage.estimated ? " est." : ""}
                </span>
              ) : null}
              <span className="ml-auto font-mono text-micro text-subtle">{formatWhen(r.at)}</span>
            </div>
            <p className={cn("mt-1 text-sm", failed ? "text-danger" : "text-fg")}>{r.summary}</p>
            {r.input ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-micro font-medium uppercase tracking-wide text-subtle">
                  Prompt sent
                </summary>
                <pre
                  className={cn(
                    "mt-1 overflow-auto whitespace-pre-wrap font-mono text-2xs leading-relaxed text-muted",
                    compact ? "max-h-24" : "max-h-80",
                  )}
                >
                  {r.input}
                </pre>
              </details>
            ) : null}
            <p className="mt-2 text-micro font-medium uppercase tracking-wide text-subtle">Output</p>
            <pre
              className={cn(
                "mt-1 overflow-auto whitespace-pre-wrap font-mono text-2xs leading-relaxed",
                failed ? "text-danger" : "text-muted",
                compact ? "max-h-24" : "max-h-80",
              )}
            >
              {r.error || r.body || "(empty)"}
            </pre>
          </li>
        );
      })}
    </ol>
  );
}
