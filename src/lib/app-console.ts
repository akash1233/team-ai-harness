/** Window bus so WebLLM's lazy chunk and the board share one App log. */

const KEY = "__kindlingAppConsole";

type Sink = (line: string) => void;

const MAX_DEV_LINE = 400;

export function consoleLine(line: string): string {
  const first = line.trim().split("\n")[0] ?? "";
  return first.length > MAX_DEV_LINE ? `${first.slice(0, MAX_DEV_LINE)}…` : first;
}

function postToDevServer(line: string): void {
  if (typeof window === "undefined") return;
  const text = consoleLine(line);
  if (!text.startsWith("[kindling]")) return;
  void fetch("/__kindling/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lines: [text] }),
    keepalive: true,
  }).catch(() => {
    /* dev server not listening */
  });
}

export function emitAppConsole(line: string): void {
  const text = consoleLine(line);
  if (!text) return;
  const g = globalThis as typeof globalThis & { [KEY]?: Sink };
  try {
    g[KEY]?.(text);
  } catch {
    /* UI not ready */
  }
  postToDevServer(text);
}

export function setAppConsoleSink(sink: Sink | null): void {
  const g = globalThis as typeof globalThis & { [KEY]?: Sink };
  if (sink) g[KEY] = sink;
  else delete g[KEY];
}
