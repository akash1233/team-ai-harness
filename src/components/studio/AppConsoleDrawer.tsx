import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useBoardStore } from "@/lib/board-store";
import { cn } from "@/lib/cn";

export function AppConsoleDrawer() {
  const lines = useBoardStore((s) => s.appConsole);
  const [open, setOpen] = useState(true);
  const preRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (open && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [lines, open]);

  const last = lines[lines.length - 1];

  return (
    <section className="shrink-0 border-t border-border bg-inset">
      <button
        type="button"
        className="flex h-9 w-full items-center gap-2 px-3 text-left md:px-5"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="size-3.5 text-subtle" /> : <ChevronUp className="size-3.5 text-subtle" />}
        <span className="text-2xs font-medium uppercase tracking-widest text-subtle">App log</span>
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted">
          {last ?? "Execution lines appear here — including WebLLM."}
        </span>
        <span className="font-mono text-2xs text-subtle">{lines.length}</span>
      </button>
      {open ? (
        <pre
          ref={preRef}
          className={cn(
            "max-h-40 overflow-auto whitespace-pre-wrap border-t border-border px-3 py-2 font-mono text-2xs leading-relaxed text-fg md:px-5",
          )}
        >
          {lines.length ? lines.join("\n") : "No execution lines yet."}
        </pre>
      ) : null}
    </section>
  );
}
