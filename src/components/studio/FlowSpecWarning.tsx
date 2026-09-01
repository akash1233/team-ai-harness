import { useState } from "react";
import { TriangleAlert, X } from "lucide-react";

/**
 * Shown wherever a user edits a prompt/payload in the app. Stage prompts now
 * come from flows/*.flow.json, so in-app edits only live for the session.
 */
export function FlowSpecWarning() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-inset px-3 py-2 text-2xs text-muted">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-subtle" />
      <p className="flex-1 leading-relaxed">
        Heads up — edits made here are <span className="font-medium text-fg">session-only</span> and
        will be wiped on the next server restart. To keep them, update{" "}
        <span className="font-mono text-fg">flows/discovery.flow.json</span> in the repo.
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        className="text-subtle hover:text-fg"
        onClick={() => setDismissed(true)}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
