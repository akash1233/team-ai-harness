export type WebllmRuntimePhase = "queued" | "load" | "generate" | "done" | "error";

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
let doneTimer: ReturnType<typeof setTimeout> | null = null;
let state: WebllmRuntimeState = { active: null, queue: [] };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getWebllmRuntime(): WebllmRuntimeState {
  return { active: state.active, queue: state.queue.slice() };
}

/** Download bar never reads 100% until the job is actually done. */
export function loadDisplayPct(mlcPct?: number): number | undefined {
  if (mlcPct == null) return undefined;
  return Math.min(90, Math.max(0, mlcPct));
}

/** Short copy for the board. Detail belongs in App log. */
export function webllmPublicStatus(job: WebllmRuntimeJob | null): { label: string; pct?: number; indeterminate?: boolean } {
  if (!job) return { label: "" };
  if (job.phase === "queued") return { label: "Waiting", indeterminate: true };
  if (job.phase === "load") {
    const pct = loadDisplayPct(job.pct);
    return { label: pct != null && pct >= 90 ? "Preparing" : "Downloading", pct };
  }
  if (job.phase === "generate") return { label: "Writing", indeterminate: true };
  if (job.phase === "done") return { label: "Done", pct: 100 };
  if (job.phase === "error") return { label: "Couldn't finish" };
  return { label: "Working", indeterminate: true };
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
  if (doneTimer) {
    clearTimeout(doneTimer);
    doneTimer = null;
  }
  if (state.active?.id !== id) {
    state = { ...state, queue: state.queue.filter((job) => job.id !== id) };
    emit();
    return;
  }
  const [head, ...rest] = state.queue;
  if (head) {
    state = {
      active: { ...head, phase: head.phase === "queued" ? "load" : head.phase },
      queue: rest,
    };
    emit();
    return;
  }
  state = { active: { ...state.active, phase: "done", pct: 100, text: "Done" }, queue: [] };
  emit();
  const finished = id;
  doneTimer = setTimeout(() => {
    doneTimer = null;
    if (state.active?.id === finished && state.active.phase === "done") {
      state = { active: null, queue: state.queue };
      emit();
    }
  }, 900);
}

export function resetWebllmRuntime(): void {
  if (doneTimer) {
    clearTimeout(doneTimer);
    doneTimer = null;
  }
  seq = 0;
  state = { active: null, queue: [] };
  emit();
}
