export type WebllmRuntimePhase = "queued" | "load" | "generate" | "error";

export type WebllmRuntimeJob = {
  id: string;
  modelId: string;
  phase: WebllmRuntimePhase;
  pct?: number;
  text: string;
  ticketKey?: string;
  columnLabel?: string;
};

export type WebllmRuntimeState = {
  active: WebllmRuntimeJob | null;
  queue: WebllmRuntimeJob[];
};

export type WebllmJobMeta = {
  ticketKey?: string;
  columnLabel?: string;
};

let seq = 0;
let state: WebllmRuntimeState = { active: null, queue: [] };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getWebllmRuntime(): WebllmRuntimeState {
  return { active: state.active, queue: state.queue.slice() };
}

/** Short copy for the board. Detail belongs in App log. */
export function webllmPublicStatus(job: WebllmRuntimeJob | null): { label: string; pct?: number } {
  if (!job) return { label: "" };
  if (job.phase === "queued") return { label: "Waiting" };
  if (job.phase === "load") return { label: "Downloading", pct: job.pct };
  if (job.phase === "generate") return { label: "Writing" };
  if (job.phase === "error") return { label: "Couldn't finish" };
  return { label: "Working" };
}

export function subscribeWebllmRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function enqueueWebllmJob(
  job: Omit<WebllmRuntimeJob, "id" | "phase"> & { phase?: WebllmRuntimePhase },
): string {
  const id = `webllm-${++seq}`;
  const next: WebllmRuntimeJob = {
    ...job,
    id,
    phase: state.active ? "queued" : (job.phase ?? "load"),
  };
  if (!state.active) state = { active: next, queue: [] };
  else state = { ...state, queue: [...state.queue, next] };
  emit();
  return id;
}

export function updateWebllmJob(id: string, patch: Partial<Omit<WebllmRuntimeJob, "id">>): void {
  if (state.active?.id === id) {
    state = { ...state, active: { ...state.active, ...patch } };
    emit();
    return;
  }
  let changed = false;
  const queue = state.queue.map((job) => {
    if (job.id !== id) return job;
    changed = true;
    return { ...job, ...patch };
  });
  if (changed) {
    state = { ...state, queue };
    emit();
  }
}

export function finishWebllmJob(id: string): void {
  if (state.active?.id === id) {
    const [head, ...rest] = state.queue;
    state = {
      active: head ? { ...head, phase: head.phase === "queued" ? "load" : head.phase } : null,
      queue: rest,
    };
  } else {
    state = { ...state, queue: state.queue.filter((job) => job.id !== id) };
  }
  emit();
}

export function resetWebllmRuntime(): void {
  seq = 0;
  state = { active: null, queue: [] };
  emit();
}
