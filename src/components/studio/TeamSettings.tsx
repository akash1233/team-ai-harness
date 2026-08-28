import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { useBoardStore } from "@/lib/board-store";
import { cn } from "@/lib/cn";
import type { AgentKind, AgentTarget, ColumnRole, DensityId, PipelineLayout, StepAgent, ThemeId } from "@/lib/types";
import { createDefaultExecution, executionLabel } from "@/lib/team-config";
import { AGENT_KINDS } from "@/lib/agents";
import { testExecution } from "@/lib/discovery-agent";
import { Field, Code } from "@/components/studio/settings/field";
import { PricingFields } from "@/components/studio/settings/PricingFields";
import { mergePricing } from "@/lib/pricing";

const TABS = ["Team", "Flows", "Pipeline", "Prompts", "Docs", "Execution", "Look"] as const;
type Tab = (typeof TABS)[number];

const ROLES: ColumnRole[] = ["collect-input", "prompt", "review", "plan", "approve", "terminal"];
const STEP_AGENTS: { id: StepAgent; label: string }[] = [
  { id: "inherit", label: "Inherit" },
  { id: "cursor", label: "Cursor" },
  { id: "claude", label: "Claude" },
  { id: "studio", label: "Studio" },
  { id: "cis", label: "CIS" },
];
const KIND_LABEL: Record<AgentKind, string> = {
  cursor: "Cursor",
  claude: "Claude",
  studio: "GenAI Studio",
  cis: "CIS",
};

export function TeamSettings() {
  const toggleSettings = useBoardStore((s) => s.toggleSettings);
  const [tab, setTab] = useState<Tab>("Team");

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-center bg-fg/30 p-0 md:items-center md:p-6">
      <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-surface shadow-panel md:h-5/6 md:rounded-xl md:border md:border-border">
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="font-serif text-2xl font-medium tracking-tight">Team AI Harness</h2>
            <p className="text-sm text-muted">Mac-first. Hook Cursor or Claude locally, then pin an agent on each stage.</p>
          </div>
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-md text-muted hover:bg-inset hover:text-fg"
            aria-label="Close settings"
            onClick={() => toggleSettings(false)}
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "h-11 rounded-md px-4 text-sm",
                tab === t ? "bg-accent text-accent-fg" : "text-muted hover:bg-inset hover:text-fg",
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {tab === "Team" ? <TeamTab /> : null}
          {tab === "Flows" ? <FlowsTab /> : null}
          {tab === "Pipeline" ? <PipelineTab /> : null}
          {tab === "Prompts" ? <PromptsTab /> : null}
          {tab === "Docs" ? <DocsTab /> : null}
          {tab === "Execution" ? <ExecutionTab /> : null}
          {tab === "Look" ? <LookTab /> : null}
        </div>
      </div>
    </div>
  );
}

function TeamTab() {
  const config = useBoardStore((s) => s.config);
  const patchConfig = useBoardStore((s) => s.patchConfig);
  const addMember = useBoardStore((s) => s.addMember);
  const updateMember = useBoardStore((s) => s.updateMember);
  const removeMember = useBoardStore((s) => s.removeMember);
  const addLabel = useBoardStore((s) => s.addLabel);
  const removeLabel = useBoardStore((s) => s.removeLabel);
  const [member, setMember] = useState({ name: "", handle: "", role: "" });
  const [label, setLabel] = useState("");

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Team name">
          <Input value={config.name} onChange={(e) => patchConfig({ name: e.target.value })} />
        </Field>
        <Field label="Workflow name">
          <Input value={config.workflowName} onChange={(e) => patchConfig({ workflowName: e.target.value })} />
        </Field>
        <Field label="Jira prefix">
          <Input
            className="font-mono uppercase"
            value={config.jiraPrefix}
            onChange={(e) => patchConfig({ jiraPrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
          />
        </Field>
        <Field label="Default Slack channel">
          <Input
            value={config.defaultSlackChannel}
            onChange={(e) => patchConfig({ defaultSlackChannel: e.target.value.replace(/^#+/, "") })}
          />
        </Field>
        <Field label="Default channel ID">
          <Input
            className="font-mono"
            value={config.defaultSlackChannelId}
            onChange={(e) => patchConfig({ defaultSlackChannelId: e.target.value })}
          />
        </Field>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-medium">People</h3>
        <p className="mb-2 text-2xs text-muted">
          Edit names, Slack handles, and roles. They drive Working as, Grill assignment, and who to notify.
        </p>
        <ul className="flex flex-col gap-2">
          {config.members.map((m) => (
            <li key={m.id} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[1fr_8rem_8rem_auto]">
              <Input
                value={m.name}
                aria-label={`${m.name} name`}
                onChange={(e) => updateMember(m.id, { name: e.target.value })}
              />
              <Input
                className="font-mono"
                value={m.handle}
                aria-label={`${m.name} handle`}
                onChange={(e) =>
                  updateMember(m.id, {
                    handle: e.target.value.startsWith("@") ? e.target.value : `@${e.target.value.replace(/^@+/, "")}`,
                  })
                }
              />
              <Input
                value={m.role}
                aria-label={`${m.name} role`}
                onChange={(e) => updateMember(m.id, { role: e.target.value })}
              />
              <button
                type="button"
                className="flex size-11 items-center justify-center text-subtle hover:text-danger"
                aria-label={`Remove ${m.name}`}
                onClick={() => removeMember(m.id)}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <Input placeholder="Name" value={member.name} onChange={(e) => setMember({ ...member, name: e.target.value })} />
          <Input placeholder="@handle" value={member.handle} onChange={(e) => setMember({ ...member, handle: e.target.value })} />
          <Input placeholder="Role" value={member.role} onChange={(e) => setMember({ ...member, role: e.target.value })} />
          <Button
            variant="secondary"
            size="md"
            disabled={!member.name.trim()}
            onClick={() => {
              addMember({
                name: member.name.trim(),
                handle: member.handle.trim() || `@${member.name.trim().split(" ")[0]?.toLowerCase()}`,
                role: member.role.trim() || "Operator",
              });
              setMember({ name: "", handle: "", role: "" });
            }}
          >
            <Plus className="size-4" />
            Add
          </Button>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-medium">Labels</h3>
        <div className="flex flex-wrap gap-2">
          {config.labels.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => removeLabel(l)}
              className="h-9 rounded-full bg-inset px-3 text-2xs text-muted hover:text-danger"
            >
              {l} ×
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Input
            placeholder="new-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                addLabel(label);
                setLabel("");
              }
            }}
          />
          <Button
            size="md"
            onClick={() => {
              addLabel(label);
              setLabel("");
            }}
          >
            Add
          </Button>
        </div>
      </section>
    </div>
  );
}

function FlowsTab() {
  const config = useBoardStore((s) => s.config);
  const tickets = useBoardStore((s) => s.tickets);
  const setActiveFlow = useBoardStore((s) => s.setActiveFlow);
  const addFlow = useBoardStore((s) => s.addFlow);
  const duplicateFlow = useBoardStore((s) => s.duplicateFlow);
  const removeFlow = useBoardStore((s) => s.removeFlow);
  const patchFlow = useBoardStore((s) => s.patchFlow);
  const flow = config.flows.find((f) => f.id === config.activeFlowId) ?? config.flows[0];
  if (!flow) return null;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        A flow is a pipeline. Tickets stay on the flow they were created in. Agent stages publish named variables the next stage reads as {"{{spec}}"}, {"{{grill}}"}, {"{{prev}}"}.
      </p>
      <div className="flex flex-wrap gap-1">
        {config.flows.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setActiveFlow(f.id)}
            className={cn(
              "h-11 rounded-md px-3 text-sm",
              f.id === flow.id ? "bg-accent text-accent-fg" : "bg-inset text-muted hover:text-fg",
            )}
          >
            {f.name}
            <span className={cn("ml-2 font-mono text-micro", f.id === flow.id ? "text-accent-fg/80" : "text-subtle")}>
              {tickets.filter((t) => t.flowId === f.id).length}
            </span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="md" onClick={() => addFlow()}>
          <Plus className="size-4" />
          New flow
        </Button>
        <Button variant="ghost" size="md" onClick={() => duplicateFlow(flow.id)}>
          Duplicate
        </Button>
        <Button
          variant="ghost"
          size="md"
          disabled={config.flows.length <= 1}
          onClick={() => removeFlow(flow.id)}
        >
          Delete
        </Button>
      </div>
      <Field label="Name">
        <Input value={flow.name} onChange={(e) => patchFlow({ name: e.target.value })} />
      </Field>
      <Field label="What this flow does">
        <Textarea rows={3} value={flow.description} onChange={(e) => patchFlow({ description: e.target.value })} />
      </Field>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={flow.autoAdvance}
          onChange={(e) => patchFlow({ autoAdvance: e.target.checked })}
        />
        After a run, move the ticket to the next stage
      </label>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={flow.autoRun}
          onChange={(e) => patchFlow({ autoRun: e.target.checked })}
        />
        Keep running agent stages (skip reviews) until a human gate — notes, grill answers, or sign-off
      </label>
      <p className="text-2xs text-muted">
        Edit stages for <span className="text-fg">{flow.name}</span> on the Pipeline tab. Prompts may use {"{{brief}}"} {"{{spec}}"} {"{{grill}}"} {"{{plan}}"} {"{{transcript}}"} {"{{prev}}"} {"{{ticket.title}}"}.
      </p>
    </div>
  );
}

function PipelineTab() {
  const columns = useBoardStore((s) => s.config.columns);
  const updateColumn = useBoardStore((s) => s.updateColumn);
  const moveColumn = useBoardStore((s) => s.moveColumn);
  const addColumn = useBoardStore((s) => s.addColumn);
  const removeColumn = useBoardStore((s) => s.removeColumn);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Stages for the active flow. Each runnable stage publishes a variable the next step can read. Auto-run skips reviews until a human gate.
      </p>
      <ul className="flex flex-col gap-2">
        {columns.map((col, i) => (
          <li key={col.id} className="rounded-md border border-border bg-elevated p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-micro text-subtle">{String(i + 1).padStart(2, "0")}</span>
              <Input
                className="h-11 min-w-32 flex-1"
                value={col.label}
                onChange={(e) => updateColumn(col.id, { label: e.target.value, name: e.target.value || col.name })}
              />
              <select
                className="h-11 rounded-md border border-border bg-inset px-2 text-sm"
                value={col.role}
                disabled={col.locked}
                onChange={(e) => updateColumn(col.id, { role: e.target.value as ColumnRole })}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <select
                className="h-11 rounded-md border border-border bg-inset px-2 text-sm"
                value={col.agent ?? "inherit"}
                onChange={(e) => updateColumn(col.id, { agent: e.target.value as StepAgent })}
                aria-label={`${col.label} agent`}
              >
                {STEP_AGENTS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              <Input
                className="h-11 w-28"
                placeholder="{{var}}"
                value={col.outputKey ?? ""}
                onChange={(e) => updateColumn(col.id, { outputKey: e.target.value.trim() })}
                aria-label={`${col.label} variable`}
              />
              <label className="flex h-11 items-center gap-2 px-2 text-sm">
                <input
                  type="checkbox"
                  checked={col.enabled}
                  onChange={(e) => updateColumn(col.id, { enabled: e.target.checked })}
                />
                On
              </label>
              <button
                type="button"
                className="flex size-11 items-center justify-center rounded-md hover:bg-inset disabled:opacity-30"
                disabled={i === 0 || col.locked}
                aria-label="Move up"
                onClick={() => moveColumn(col.id, -1)}
              >
                <ChevronUp className="size-4" />
              </button>
              <button
                type="button"
                className="flex size-11 items-center justify-center rounded-md hover:bg-inset disabled:opacity-30"
                disabled={i === columns.length - 1 || col.locked}
                aria-label="Move down"
                onClick={() => moveColumn(col.id, 1)}
              >
                <ChevronDown className="size-4" />
              </button>
              {col.custom ? (
                <button
                  type="button"
                  className="flex size-11 items-center justify-center rounded-md text-subtle hover:text-danger"
                  aria-label="Remove stage"
                  onClick={() => removeColumn(col.id)}
                >
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <Button variant="secondary" size="md" onClick={() => addColumn()}>
        <Plus className="size-4" />
        Add stage
      </Button>
    </div>
  );
}

function PromptsTab() {
  const columns = useBoardStore((s) => s.config.columns);
  const updateColumn = useBoardStore((s) => s.updateColumn);
  const promptable = columns.filter((c) => c.role === "prompt" || c.role === "plan" || c.role === "collect-input");
  const [id, setId] = useState(promptable[0]?.id ?? "");
  const col = columns.find((c) => c.id === id) ?? promptable[0];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Templates go to the agent on Run. Use {"{{brief}}"}, {"{{spec}}"}, {"{{grill}}"}, {"{{plan}}"}, {"{{transcript}}"}, {"{{prev}}"}, {"{{ticket.title}}"} — filled from earlier stages on this ticket.
      </p>
      <div className="flex flex-wrap gap-1">
        {promptable.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setId(c.id)}
            className={cn(
              "h-11 rounded-md px-3 text-sm",
              c.id === col?.id ? "bg-accent text-accent-fg" : "bg-inset text-muted",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      {col ? (
        <>
          <Field label={`${col.name} prompt`}>
            <Textarea
              className="min-h-52 font-mono text-2xs"
              value={col.promptTemplate ?? ""}
              onChange={(e) => updateColumn(col.id, { promptTemplate: e.target.value })}
            />
          </Field>
          <Field label="GenAI Studio prompt ID (optional override)">
            <Input
              className="font-mono"
              value={col.promptId ?? ""}
              placeholder="Uses the workspace default"
              onChange={(e) => updateColumn(col.id, { promptId: e.target.value })}
            />
          </Field>
        </>
      ) : null}
    </div>
  );
}

function DocsTab() {
  const docs = useBoardStore((s) => s.config.docs);
  const upsertDoc = useBoardStore((s) => s.upsertDoc);
  const removeDoc = useBoardStore((s) => s.removeDoc);
  const [title, setTitle] = useState("");

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Grill Me reads these documents with the Synthesize spec. Put the Cursor or Claude skill here so the team is grilling one contract.
      </p>
      {docs.map((doc) => (
        <section key={doc.id} className="rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <Input
              className="h-11 flex-1"
              value={doc.title}
              onChange={(e) => upsertDoc({ ...doc, title: e.target.value })}
            />
            <select
              className="h-11 rounded-md border border-border bg-inset px-2 text-sm"
              value={doc.kind}
              onChange={(e) => upsertDoc({ ...doc, kind: e.target.value as typeof doc.kind })}
            >
              <option value="skill">skill</option>
              <option value="notes">notes</option>
              <option value="spec">spec</option>
            </select>
            {doc.id.startsWith("doc-") && doc.id !== "doc-grill-me" ? (
              <button
                type="button"
                className="flex size-11 items-center justify-center rounded-md text-subtle hover:text-danger"
                aria-label={`Remove ${doc.title}`}
                onClick={() => removeDoc(doc.id)}
              >
                <Trash2 className="size-4" />
              </button>
            ) : null}
          </div>
          <Textarea
            className="mt-2 min-h-36 font-mono text-2xs"
            value={doc.body}
            onChange={(e) => upsertDoc({ ...doc, body: e.target.value })}
          />
        </section>
      ))}
      <div className="flex gap-2">
        <Input placeholder="New doc title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Button
          variant="secondary"
          size="md"
          onClick={() => {
            const t = title.trim();
            if (!t) return;
            upsertDoc({ id: `doc-${Date.now()}`, title: t, kind: "notes", body: "" });
            setTitle("");
          }}
        >
          <Plus className="size-4" />
          Add doc
        </Button>
      </div>
    </div>
  );
}

function MacAgentHints() {
  return (
    <section className="rounded-md border border-border p-3">
      <h3 className="text-sm font-medium">Mac — hook the agents</h3>
      <p className="mt-1 text-2xs text-muted">
        Run these in Terminal.app or iTerm, then restart <span className="font-mono">npm run dev</span> in that same shell. Finder or a VS Code task will not see your zsh PATH.
      </p>
      <ol className="mt-3 flex list-decimal flex-col gap-3 pl-4 text-sm">
        <li>
          <p className="font-medium">Cursor Agent</p>
          <Code>curl https://cursor.com/install -fsS | bash</Code>
          <Code>{`echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc`}</Code>
          <p className="mt-1 text-2xs text-muted">
            Confirm with <span className="font-mono">which agent</span>. If you only have <span className="font-mono">cursor-agent</span>, set Cursor command below to{" "}
            <span className="font-mono">cursor-agent -p --output-format text</span>.
          </p>
        </li>
        <li>
          <p className="font-medium">Claude Code</p>
          <Code>curl -fsSL https://claude.ai/install.sh | bash</Code>
          <p className="mt-1 text-2xs text-muted">
            Or <span className="font-mono">brew install --cask claude-code</span>. Confirm with <span className="font-mono">which claude</span>.
          </p>
        </li>
        <li>
          <p className="font-medium">Test, then turn off demo text</p>
          <p className="text-2xs text-muted">
            Use Test setup. You want a path plus a --version line, not “not on PATH”. Then uncheck demo fallbacks.
          </p>
        </li>
      </ol>
    </section>
  );
}

function ExecutionTab() {
  const config = useBoardStore((s) => s.config);
  const patchConfig = useBoardStore((s) => s.patchConfig);
  const exec = config.execution ?? createDefaultExecution();
  const [probe, setProbe] = useState<{
    ok: boolean;
    via: string;
    text: string;
    error?: string;
    checks?: { ok: boolean; label: string; detail: string }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  function patch(partial: Partial<typeof exec>) {
    patchConfig({ execution: { ...exec, ...partial } });
  }

  async function test() {
    setBusy(true);
    setProbe({ ok: true, via: executionLabel(exec), text: "Checking setup…" });
    try {
      const result = await testExecution({ data: { execution: exec, stepAgent: "inherit" } });
      setProbe(result);
    } catch (err) {
      setProbe({
        ok: false,
        via: executionLabel(exec),
        text: "",
        error: err instanceof Error ? err.message : "Setup check failed",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        Test setup checks that the default agent is installed and callable from this app — not a Discovery ticket. Pipeline still pins Cursor, Claude, Studio, or CIS per stage.
      </p>
      <MacAgentHints />
      {exec.demoFallbacks ? (
        <p className="rounded-md border border-border px-3 py-2 text-sm text-muted">
          Demo text is on. If the agent is missing, Run still produces canned output. Turn this off once Cursor, Claude, or Studio is hooked up.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void test()}
          className="inline-flex h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-40"
        >
          {busy ? "Checking…" : "Test setup"}
        </button>
        <span className="text-2xs text-muted">Checks {executionLabel(exec)}.</span>
      </div>
      {probe ? (
        <div
          role="status"
          className={cn(
            "rounded-md border px-3 py-2 text-sm",
            probe.ok ? "border-border text-fg" : "border-danger text-danger",
          )}
        >
          <p className="font-medium">{probe.ok ? `Setup looks good · ${probe.via}` : `Setup incomplete · ${probe.via}`}</p>
          {probe.checks?.length ? (
            <ul className="mt-2 flex flex-col gap-2">
              {probe.checks.map((c) => (
                <li key={c.label} className="text-2xs">
                  <span className={cn("font-medium", c.ok ? "text-fg" : "text-danger")}>{c.ok ? "Pass" : "Fail"} · {c.label}</span>
                  <span className="mt-0.5 block text-muted">{c.detail}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1">{probe.ok ? probe.text || "ok" : probe.error || "Failed"}</p>
          )}
          {!probe.ok && /PATH|not on PATH|not on Node PATH/i.test(probe.error || probe.text || "") ? (
            <p className="mt-2 text-2xs text-muted">
              Mac: add <span className="font-mono">~/.local/bin</span> to <span className="font-mono">~/.zshrc</span>, open a new Terminal, run <span className="font-mono">npm run dev</span> from there. If the binary is <span className="font-mono">cursor-agent</span>, change the Cursor command below.
            </p>
          ) : null}
        </div>
      ) : null}

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Default for Inherit</legend>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {AGENT_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => patch({ defaultAgent: kind, provider: kind === "studio" || kind === "cis" ? kind : "local", localAgent: kind === "claude" ? "claude" : "cursor" })}
              className={cn("h-11 rounded-md border text-sm", exec.defaultAgent === kind ? "border-accent" : "border-border")}
            >
              {KIND_LABEL[kind]}
            </button>
          ))}
        </div>
      </fieldset>

      <section className="flex flex-col gap-3 rounded-md border border-border p-3">
        <h3 className="text-sm font-medium">Cursor</h3>
        <TargetToggle
          value={exec.cursorTarget}
          onChange={(cursorTarget) => patch({ cursorTarget })}
        />
        <Field label="Local command">
          <Input className="font-mono" value={exec.cursorCommand} onChange={(e) => patch({ cursorCommand: e.target.value })} />
        </Field>
        <Field label="Remote URL">
          <Input
            className="font-mono"
            value={exec.cursorRemoteUrl}
            placeholder="https://agents.example/cursor"
            onChange={(e) => patch({ cursorRemoteUrl: e.target.value })}
          />
        </Field>
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-border p-3">
        <h3 className="text-sm font-medium">Claude</h3>
        <TargetToggle
          value={exec.claudeTarget}
          onChange={(claudeTarget) => patch({ claudeTarget })}
        />
        <Field label="Local command">
          <Input className="font-mono" value={exec.claudeCommand} onChange={(e) => patch({ claudeCommand: e.target.value })} />
        </Field>
        <Field label="Remote URL">
          <Input
            className="font-mono"
            value={exec.claudeRemoteUrl}
            placeholder="https://agents.example/claude"
            onChange={(e) => patch({ claudeRemoteUrl: e.target.value })}
          />
        </Field>
      </section>

      <Field label="Local HTTP sidecar (optional, OpenAI-compatible)">
        <Input
          className="font-mono"
          value={exec.localHttpUrl}
          placeholder="http://127.0.0.1:11434/v1"
          onChange={(e) => patch({ localHttpUrl: e.target.value })}
        />
      </Field>

      <section className="flex flex-col gap-3 rounded-md border border-border p-3">
        <h3 className="text-sm font-medium">GenAI Studio / CIS</h3>
        <Field label="Base URL">
          <Input
            className="font-mono"
            value={exec.studioBaseUrl}
            placeholder="https://your-genai-studio-host"
            onChange={(e) => patch({ studioBaseUrl: e.target.value })}
          />
        </Field>
        <Field label="wd-pca-feature-key (user ID)">
          <Input
            className="font-mono"
            value={exec.featureKey}
            placeholder="dharmendra.singh"
            onChange={(e) => patch({ featureKey: e.target.value })}
          />
        </Field>
        <Field label="Default prompt ID">
          <Input className="font-mono" value={exec.promptId} onChange={(e) => patch({ promptId: e.target.value })} />
        </Field>
        <Field label="CIS model">
          <Input className="font-mono" value={exec.cisModel} onChange={(e) => patch({ cisModel: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="CIS provider">
            <Input value={exec.cisProvider} onChange={(e) => patch({ cisProvider: e.target.value })} />
          </Field>
          <Field label="Task type">
            <Input className="font-mono" value={exec.cisTaskType} onChange={(e) => patch({ cisTaskType: e.target.value })} />
          </Field>
        </div>
      </section>

      <PricingFields
        pricing={exec.pricing ?? mergePricing()}
        onChange={(pricing) => patch({ pricing })}
      />
      <Field label="Timeout (ms)">
        <Input
          className="font-mono"
          value={String(exec.timeoutMs)}
          onChange={(e) => patch({ timeoutMs: Number(e.target.value) || 120000 })}
        />
      </Field>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={exec.demoFallbacks}
          onChange={(e) => patch({ demoFallbacks: e.target.checked })}
        />
        Use demo text if the agent is offline
      </label>
    </div>
  );
}

function TargetToggle({ value, onChange }: { value: AgentTarget; onChange: (v: AgentTarget) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(["local", "remote"] as AgentTarget[]).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={cn("h-11 rounded-md border capitalize", value === t ? "border-accent" : "border-border")}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function LookTab() {
  const config = useBoardStore((s) => s.config);
  const patchConfig = useBoardStore((s) => s.patchConfig);
  const resetTeam = useBoardStore((s) => s.resetTeam);

  return (
    <div className="flex flex-col gap-6">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Pipeline</legend>
        <div className="grid grid-cols-2 gap-2">
          {([
            ["vertical", "Vertical", "One stage at a time. Rail on the left."],
            ["horizontal", "Horizontal", "Sticky-note board. Every stage, every field."],
          ] as const satisfies ReadonlyArray<readonly [PipelineLayout, string, string]>).map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              onClick={() => patchConfig({ pipelineLayout: id })}
              className={cn(
                "h-24 rounded-lg border px-4 text-left",
                config.pipelineLayout === id ? "border-accent" : "border-border",
              )}
            >
              <span className="font-serif text-lg">{label}</span>
              <span className="mt-1 block text-2xs text-muted">{hint}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Theme</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["paper", "ink"] as ThemeId[]).map((theme) => (
            <button
              key={theme}
              type="button"
              onClick={() => patchConfig({ theme })}
              className={cn(
                "h-20 rounded-lg border px-4 text-left",
                config.theme === theme ? "border-accent" : "border-border",
              )}
            >
              <span className="font-serif text-lg capitalize">{theme}</span>
              <span className="mt-1 block text-2xs text-muted">
                {theme === "paper" ? "Cream studio" : "Charcoal studio"}
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Density</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["comfortable", "compact"] as DensityId[]).map((density) => (
            <button
              key={density}
              type="button"
              onClick={() => patchConfig({ density })}
              className={cn(
                "h-14 rounded-lg border px-4 text-left capitalize",
                config.density === density ? "border-accent" : "border-border",
              )}
            >
              {density}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={config.showSpend}
          onChange={(e) => patchConfig({ showSpend: e.target.checked })}
        />
        Show spend on tickets
      </label>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={config.autoAdvance}
          onChange={(e) => patchConfig({ autoAdvance: e.target.checked })}
        />
        Auto-advance after a successful run (active flow)
      </label>
      <Button variant="ghost" size="md" onClick={() => resetTeam()}>
        Restore default team + sample tickets
      </Button>
    </div>
  );
}

