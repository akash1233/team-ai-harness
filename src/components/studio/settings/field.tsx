import type { ReactNode } from "react";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-2xs text-muted">{label}</span>
      {children}
    </label>
  );
}

export function Code({ children }: { children: string }) {
  return (
    <pre className="mt-1 overflow-auto rounded-sm bg-inset px-2 py-2 font-mono text-2xs leading-relaxed text-fg">
      {children}
    </pre>
  );
}
