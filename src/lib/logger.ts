/**
 * Kindling logger. Level from PIT_LOG_LEVEL (server) or VITE_PIT_LOG_LEVEL
 * (browser). Writes one line per event to the process/browser console and a
 * ring buffer that Settings → Execution → App log tails.
 *
 * silent < error < warn < info < debug
 */

export const LOG_LEVELS = ["silent", "error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type EmitLevel = Exclude<LogLevel, "silent">;

export type LogFields = Record<string, unknown>;

export type LogRecord = {
  ts: string;
  level: EmitLevel;
  scope: string;
  msg: string;
  fields: LogFields;
  line: string;
};

const RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

function isSecretKey(key: string): boolean {
  const n = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).toLowerCase();
  return /(?:^|_)(token|pat|secret|password|passwd|authorization|api_?key|feature_?key|wd[_-]?pca[_-]?feature[_-]?key)$/.test(
    n,
  );
}
const BUFFER_CAP = 500;
const FIELD_CLIP = 240;

/**
 * Shared across Vite client chunks. WebLLM is a dynamic import, so a module
 * singleton would leave App log (main bundle) empty while exec.webllm writes
 * to a second copy.
 */
type PersistFn = (lines: string[]) => Promise<void>;

type LogStore = {
  buffer: LogRecord[];
  listeners: Set<(rec: LogRecord) => void>;
  forcedLevel: LogLevel | null;
  persist: PersistFn | null;
};

const STORE_KEY = "__kindlingLogStore";

function store(): LogStore {
  const g = globalThis as typeof globalThis & { [STORE_KEY]?: LogStore };
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = { buffer: [], listeners: new Set(), forcedLevel: null, persist: null };
  }
  return g[STORE_KEY]!;
}

function viteEnv(name: string): string | undefined {
  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    const v = env?.[name];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

function processEnv(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function parseLogLevel(raw: string | undefined | null): LogLevel | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(v) ? (v as LogLevel) : null;
}

export function getLogLevel(): LogLevel {
  const forced = store().forcedLevel;
  if (forced) return forced;
  return (
    parseLogLevel(processEnv("PIT_LOG_LEVEL")) ??
    parseLogLevel(processEnv("VITE_PIT_LOG_LEVEL")) ??
    parseLogLevel(viteEnv("VITE_PIT_LOG_LEVEL")) ??
    "info"
  );
}

/** Test hook. Pass null to read the env again. */
export function setLogLevel(level: LogLevel | null): void {
  store().forcedLevel = level;
}

/** debug includes info, warn, and error. info includes warn and error. */
export function isLevelEnabled(level: EmitLevel): boolean {
  const current = getLogLevel();
  if (current === "silent") return false;
  return RANK[level] <= RANK[current];
}

export function clip(value: string, max = FIELD_CLIP): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function redactValue(key: string, value: unknown): unknown {
  if (isSecretKey(key)) return "[redacted]";
  if (Array.isArray(value)) return value.map((item, i) => redactValue(String(i), item));
  if (value && typeof value === "object") {
    const out: LogFields = {};
    for (const [k, v] of Object.entries(value as LogFields)) out[k] = redactValue(k, v);
    return out;
  }
  if (typeof value === "string") return clip(value);
  return value;
}

export function redactFields(fields?: LogFields): LogFields {
  if (!fields) return {};
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    out[key] = redactValue(key, value);
  }
  return out;
}

function formatField(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (!value) return '""';
    return /[\s="]/.test(value) ? JSON.stringify(value) : value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
}

export function formatLogLine(rec: Omit<LogRecord, "line">): string {
  const bits = [`[kindling] ${rec.ts} ${rec.level.toUpperCase().padEnd(5)} ${rec.scope} ${rec.msg}`];
  for (const [key, value] of Object.entries(rec.fields)) {
    bits.push(`${key}=${formatField(value)}`);
  }
  return bits.join(" ");
}

function emitToConsole(level: EmitLevel, line: string): void {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function setLogPersist(fn: PersistFn | null): void {
  store().persist = fn;
}

function write(level: EmitLevel, scope: string, msg: string, fields?: LogFields): LogRecord | null {
  if (!isLevelEnabled(level)) return null;
  const recBase = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg,
    fields: redactFields(fields),
  };
  const rec: LogRecord = { ...recBase, line: formatLogLine(recBase) };
  const { buffer, listeners } = store();
  buffer.push(rec);
  if (buffer.length > BUFFER_CAP) buffer.splice(0, buffer.length - BUFFER_CAP);
  emitToConsole(level, rec.line);
  for (const listener of listeners) listener(rec);
  const sink = (globalThis as typeof globalThis & { __kindlingAppConsole?: (line: string) => void }).__kindlingAppConsole;
  try {
    sink?.(rec.line);
  } catch {
    /* UI not mounted */
  }
  const persist = store().persist;
  if (typeof window !== "undefined" && persist) void persist([rec.line]);
  return rec;
}

/** Live UI (App log). Returns unsubscribe. */
export function subscribeLogs(listener: (rec: LogRecord) => void): () => void {
  const { listeners } = store();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Merge browser WebLLM lines into the server ring buffer (no second console emit). */
export function ingestLogLines(lines: string[]): void {
  const { buffer } = store();
  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;
    const rec: LogRecord = {
      ts: new Date().toISOString(),
      level: "info",
      scope: "client",
      msg: text,
      fields: {},
      line: text,
    };
    buffer.push(rec);
    if (buffer.length > BUFFER_CAP) buffer.splice(0, buffer.length - BUFFER_CAP);
  }
}

export function getLogBuffer(): LogRecord[] {
  return store().buffer.slice();
}

export function getLogLines(): string[] {
  return store().buffer.map((r) => r.line);
}

export function clearLogBuffer(): void {
  store().buffer.length = 0;
}

export type Logger = {
  scope: string;
  fields: LogFields;
  child(fields: LogFields, scope?: string): Logger;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
};

function mergeFields(base: LogFields, extra?: LogFields): LogFields {
  return extra ? { ...base, ...extra } : { ...base };
}

export function createLogger(scope: string, fields: LogFields = {}): Logger {
  return {
    scope,
    fields,
    child(extra, nextScope) {
      return createLogger(nextScope ?? scope, mergeFields(fields, extra));
    },
    debug(msg, extra) {
      write("debug", scope, msg, mergeFields(fields, extra));
    },
    info(msg, extra) {
      write("info", scope, msg, mergeFields(fields, extra));
    },
    warn(msg, extra) {
      write("warn", scope, msg, mergeFields(fields, extra));
    },
    error(msg, extra) {
      write("error", scope, msg, mergeFields(fields, extra));
    },
  };
}

export const log = createLogger("kindling");

/** Push recent lines to the server App log so they survive a tab freeze/OOM. */
export async function persistRecentLogs(n = 40): Promise<void> {
  const persist = store().persist;
  if (!persist) return;
  const lines = getLogLines().slice(-n);
  if (!lines.length) return;
  try {
    await persist(lines);
  } catch {
    /* tab may already be dying */
  }
}

function shortId(): string {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `c${Date.now().toString(16)}`;
  return id.replace(/-/g, "").slice(0, 8);
}

export type ExecCall = {
  id: string;
  log: Logger;
  ok(extra?: LogFields): void;
  fail(error: string, extra?: LogFields): void;
};

/** One structured start/ok/fail span for an execution call. */
export function startCall(scope: string, fields?: LogFields): ExecCall {
  const id = shortId();
  const log = createLogger(scope, { call: id, ...fields });
  const t0 = Date.now();
  log.info("start");
  return {
    id,
    log,
    ok(extra) {
      log.info("ok", { ms: Date.now() - t0, ...extra });
    },
    fail(error, extra) {
      log.error("fail", { ms: Date.now() - t0, error, ...extra });
    },
  };
}
