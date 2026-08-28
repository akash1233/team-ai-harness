export function formatSpend(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

export function channelLabel(name: string): string {
  const trimmed = name.replace(/^#+/, "").trim();
  return trimmed ? `#${trimmed}` : "";
}

export function nextKey(keys: string[], prefix = "X2"): string {
  let max = 700;
  for (const key of keys) {
    const m = key.match(/^([A-Z0-9]+)-(\d+)$/i);
    if (m && m[1].toUpperCase() === prefix && m[2]) {
      max = Math.max(max, Number(m[2]));
    }
  }
  return `${prefix}-${max + 1}`;
}

export function uid(prefix = "id"): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}
