import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { ExecutionConfig } from "@/lib/types";
import { WEBLLM_PROFILES, normalizeWebllmModelIds } from "@/lib/webllm";
import type { WebllmRuntimeStatus } from "@/lib/webllm-engine";
import { Field } from "./field";

export function WebllmFields({
  exec,
  onPatch,
}: {
  exec: ExecutionConfig;
  onPatch: (partial: Partial<ExecutionConfig>) => void;
}) {
  const [status, setStatus] = useState<WebllmRuntimeStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const [pick, setPick] = useState("");

  const extras = exec.webllmExtraModelIds ?? [];
  const extraSet = useMemo(() => new Set(extras), [extras]);

  const catalog = status?.catalog ?? [];
  const defaults = catalog.filter((e) => e.isDefault);
  const others = catalog.filter((e) => !e.isDefault);
  const selectable = others.filter((e) => !extraSet.has(e.modelId));

  async function refresh() {
    setBusy("status");
    try {
      const { getWebllmStatus } = await import("@/lib/webllm-engine");
      const next = await getWebllmStatus(exec);
      setStatus(next);
      setPick((current) => {
        if (current) return current;
        return next.catalog.find((entry) => !entry.isDefault)?.modelId ?? "";
      });
    } catch (err) {
      setStatus(null);
      setLog(err instanceof Error ? err.message : "Could not read WebLLM status");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void refresh();
    // Refresh when the active model changes; catalog itself is package-static.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exec.webllmModelId, exec.webllmProfile]);

  async function pull(modelId: string, useAfter = false) {
    const id = modelId.trim();
    if (!id) return;
    setBusy(`pull:${id}`);
    setLog(`Pulling ${id}…`);
    try {
      const { pullWebllmModel, getWebllmStatus } = await import("@/lib/webllm-engine");
      const result = await pullWebllmModel(id, (p) => setLog(p.text.slice(0, 400)));
      if (!result.ok) {
        setLog(result.error || "Pull failed");
        return;
      }
      const extra = normalizeWebllmModelIds([...extras, id]);
      onPatch({
        webllmExtraModelIds: extra,
        ...(useAfter ? { webllmModelId: id } : {}),
      });
      setStatus(await getWebllmStatus({ ...exec, webllmExtraModelIds: extra, webllmModelId: useAfter ? id : exec.webllmModelId }));
      setLog(`Cached ${id}. Later pipeline runs reuse this browser cache.`);
    } catch (err) {
      setLog(err instanceof Error ? err.message : "Pull failed");
    } finally {
      setBusy(null);
    }
  }

  async function unload() {
    setBusy("unload");
    try {
      const { unloadWebllmEngine, getWebllmStatus } = await import("@/lib/webllm-engine");
      await unloadWebllmEngine();
      setStatus(await getWebllmStatus(exec));
      setLog("Unloaded the in-memory engine. Cached weights stay in the browser.");
    } finally {
      setBusy(null);
    }
  }

  function useModel(modelId: string) {
    onPatch({ webllmModelId: modelId });
    setLog(`Workspace model set to ${modelId}. Stages pinned to a Fast/Balanced/Quality profile still use that profile.`);
  }

  function dropExtra(modelId: string) {
    const next = extras.filter((id) => id !== modelId);
    onPatch({
      webllmExtraModelIds: next,
      webllmModelId: exec.webllmModelId === modelId ? "" : exec.webllmModelId,
    });
  }

  const gpuOk = status?.webgpu === true;
  const loaded = status?.loadedModelId;

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border p-3">
      <h3 className="text-sm font-medium">WebLLM</h3>
      <p className="text-2xs text-muted">
        In-browser inference over WebGPU. Pin a pipeline stage to WebLLM, or set Inherit to WebLLM. Notify stays on Cursor.
        Fast / Balanced / Quality are the shipped defaults. Pull adds any other model from the installed WebLLM catalog into this browser.
      </p>

      <div className="rounded-md border border-border bg-inset px-3 py-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-sm font-medium">Status</h4>
          <button
            type="button"
            className="h-9 rounded-md border border-border px-3 text-2xs disabled:opacity-40"
            disabled={Boolean(busy)}
            onClick={() => void refresh()}
          >
            {busy === "status" ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <ul className="flex flex-col gap-1 text-2xs">
          <StatusLine ok={status ? gpuOk : null} label="WebGPU" detail={status?.webgpuDetail ?? "Checking…"} />
          <StatusLine
            ok={null}
            label="Active"
            detail={status ? `${status.activeLabel} · ${status.activeModelId}` : "—"}
          />
          <StatusLine ok={null} label="In memory" detail={loaded ?? "none (weights may still be cached)"} />
          <StatusLine
            ok={status ? !status.error && status.catalogCount > 0 : null}
            label="Catalog"
            detail={
              status?.error
                ? status.error
                : status
                  ? `${status.catalogCount} LLMs · ${status.packageVersion}${status.modelVersion ? ` · libs ${status.modelVersion}` : ""}`
                  : "Open this tab in Chrome/Edge to read the catalog."
            }
          />
        </ul>
        {loaded ? (
          <button
            type="button"
            className="mt-2 h-9 rounded-md border border-border px-3 text-2xs disabled:opacity-40"
            disabled={Boolean(busy)}
            onClick={() => void unload()}
          >
            Unload from GPU
          </button>
        ) : null}
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Performance (defaults)</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {WEBLLM_PROFILES.map((p) => {
            const cached = defaults.find((e) => e.modelId === p.modelId)?.cached;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPatch({ webllmProfile: p.id, webllmModelId: "" })}
                className={cn(
                  "flex h-auto flex-col items-start gap-1 rounded-md border px-3 py-2 text-left",
                  (exec.webllmProfile ?? "balanced") === p.id && !exec.webllmModelId?.trim()
                    ? "border-accent"
                    : "border-border",
                )}
              >
                <span className="text-sm font-medium">{p.label}</span>
                <span className="text-2xs text-muted">{p.summary}</span>
                <span className="font-mono text-2xs text-subtle">
                  {cached === true ? "cached" : cached === false ? "not pulled" : "…"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {WEBLLM_PROFILES.map((p) => (
            <button
              key={`pull-${p.id}`}
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void pull(p.modelId)}
              className="h-9 rounded-md border border-border px-3 text-2xs disabled:opacity-40"
            >
              {busy === `pull:${p.modelId}` ? `Pulling ${p.label}…` : `Pull ${p.label}`}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Pull more models</legend>
        <p className="mb-2 text-2xs text-muted">
          Catalog is every LLM shipped with this WebLLM package — not only Fast/Balanced/Quality. Pull downloads weights into the browser cache. Use sets the workspace override (stages that pin Fast/Balanced/Quality keep that pin).
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-2xs text-muted">Catalog model</span>
            <select
              className="h-11 w-full rounded-md border border-border bg-inset px-2 font-mono text-2xs"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">Select a model…</option>
              {selectable.map((e) => (
                <option key={e.modelId} value={e.modelId}>
                  {e.modelId}
                  {e.vramMb ? ` · ${Math.round(e.vramMb)} MB` : ""}
                  {e.cached ? " · cached" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={Boolean(busy) || !pick}
              onClick={() => void pull(pick)}
            >
              {busy === `pull:${pick}` ? "Pulling…" : "Pull"}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={Boolean(busy) || !pick}
              onClick={() => void pull(pick, true)}
            >
              Pull and use
            </Button>
          </div>
        </div>
        {extras.length ? (
          <ul className="mt-3 flex flex-col gap-1">
            {extras.map((id) => {
              const entry = catalog.find((e) => e.modelId === id);
              const active = exec.webllmModelId?.trim() === id;
              return (
                <li key={id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1.5">
                  <span className="min-w-0 flex-1 font-mono text-2xs">{id}</span>
                  <span className="text-2xs text-muted">{entry?.cached ? "cached" : "not in cache"}</span>
                  <button
                    type="button"
                    className={cn("h-9 rounded-md border px-3 text-2xs", active ? "border-accent" : "border-border")}
                    onClick={() => useModel(id)}
                  >
                    {active ? "In use" : "Use"}
                  </button>
                  <button
                    type="button"
                    className="h-9 rounded-md border border-border px-3 text-2xs"
                    onClick={() => dropExtra(id)}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-2xs text-muted">No extra models yet. Pull one from the catalog.</p>
        )}
      </fieldset>

      <Field label="Workspace model override (blank = use the Performance profile)">
        <Input
          className="font-mono"
          value={exec.webllmModelId ?? ""}
          placeholder={WEBLLM_PROFILES.find((p) => p.id === (exec.webllmProfile ?? "balanced"))?.modelId}
          onChange={(e) => onPatch({ webllmModelId: e.target.value })}
        />
      </Field>
      {log ? <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-inset p-2 font-mono text-2xs">{log}</pre> : null}
    </section>
  );
}

function StatusLine({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  const mark = ok == null ? "·" : ok ? "Pass" : "Fail";
  return (
    <li>
      <span className={cn("font-medium", ok === false ? "text-danger" : "text-fg")}>
        {mark} {label}
      </span>
      <span className="text-muted"> — {detail}</span>
    </li>
  );
}
