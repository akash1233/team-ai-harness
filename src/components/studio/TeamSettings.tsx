import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { useBoardStore } from "@/lib/board-store";
import { cn } from "@/lib/cn";
import type { AgentKind, AgentTarget, ColumnRole, DensityId, PipelineLayout, StepAgent, ThemeId, WebllmProfile } from "@/lib/types";
import { createDefaultExecution, executionLabel } from "@/lib/team-config";
import { AGENT_KINDS, resolveStep } from "@/lib/agents";
import { WEBLLM_PROFILES, stageUsesWebllm } from "@/lib/webllm";
import { WebllmFields } from "@/components/studio/settings/WebllmFields";
import { inspectCliBins, readAppLogs, testExecution } from "@/lib/discovery-agent";
import { getLogLevel, getLogLines, subscribeLogs } from "@/lib/logger";
import { Field, Code } from "@/components/studio/settings/field";
import { PricingFields } from "@/components/studio/settings/PricingFields";
import { mergePricing } from "@/lib/pricing";
import { ConnectTab } from "@/components/studio/ConnectTab";
import { createDefaultConnectors } from "@/lib/connectors";
import { pullJiraIssue } from "@/lib/connectors-api";
import { bindJiraKey, unbindJiraKey } from "@/lib/prompts";
import { SEND_SLACK_COLUMN_ID } from "@/lib/columns";
import { FlowSpecWarning } from "@/components/studio/FlowSpecWarning";

const TABS = ["Team", "Flows", "Pipeline", "Prompts", "Skills", "Connect", "WebLLM", "Execution", "Look"] as const;
type Tab = (typeof TABS)[number];

const ROLE_LABEL: Record<ColumnRole, string> = {
  "collect-input": "Team types this",
  prompt: "Agent runs",
  review: "Human review (skipped if auto-run)",
  plan: "Agent writes plan",
  approve: "Sign-off gate",
  terminal: "End of this flow",
};

const ROLES: ColumnRole[] = ["collect-input", "prompt", "review", "plan", "approve", "terminal"];
const STEP_AGENTS: { id: StepAgent; label: string }[] = [
  { id: "inherit", label: "Inherit" },
  { id: "manual", label: "Manual" },
  { id: "cursor", label: "Cursor" },
  { id: "claude", label: "Claude" },
  { id: "studio", label: "Studio" },
  { id: "cis", label: "CIS" },
  { id: "webllm", label: "WebLLM" },
];
const KIND_LABEL: Record<AgentKind, string> = {
  cursor: "Cursor",
  claude: "Claude",
  studio: "GenAI Studio",
  cis: "CIS",
  webllm: "WebLLM",
};

export function TeamSettings() {
  const toggleSettings = useBoardStore((s) => s.toggleSettings);
  const [tab, setTab] = useState<Tab>("Team");
  const [focusPromptId, setFocusPromptId] = useState<string | null>(null);

  function openPrompt(id: string) {
    setFocusPromptId(id);
    setTab("Prompts");
  }

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-center bg-fg/30 p-0 md:items-center md:p-6">
      <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-surface shadow-panel md:h-5/6 md:rounded-xl md:border md:border-border">
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="font-serif text-2xl font-medium tracking-tight">Kindling</h2>
            <p className="text-sm text-muted">Spark to spec. Settings feed every stage; each stage feeds the next.</p>
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
          {tab === "Pipeline" ? <PipelineTab onEditPrompt={openPrompt} /> : null}
          {tab === "Prompts" ? <PromptsTab focusId={focusPromptId} onFocus={setFocusPromptId} /> : null}
          {tab === "Skills" ? <DocsTab /> : null}
          {tab === "Connect" ? <ConnectTab /> : null}
          {tab === "WebLLM" ? <WebllmTab /> : null}
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
  const setCatalog = useBoardStore((s) => s.setCatalog);
  const removeCatalogIssue = useBoardStore((s) => s.removeCatalogIssue);
  const [member, setMember] = useState({ name: "", handle: "", role: "" });
  const [label, setLabel] = useState("");
  const [jiraKey, setJiraKey] = useState("");
  const [jiraMessage, setJiraMessage] = useState("");
  const connectors = config.connectors ?? createDefaultConnectors();

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
        <h3 className="mb-2 text-sm font-medium">Team Jira catalog</h3>
        {connectors.jira.token ? (
          <>
            <div className="flex gap-2">
              <Input className="font-mono" placeholder="X2-123" value={jiraKey} onChange={(e) => setJiraKey(e.target.value)} />
              <Button
                size="md"
                disabled={!jiraKey.trim()}
                onClick={async () => {
                  const r = await pullJiraIssue({ data: { jira: connectors.jira, key: jiraKey } });
                  if (r.ok && r.issue) {
                    setCatalog({ issues: [r.issue, ...connectors.issues.filter((i) => i.key !== r.issue!.key)] });
                    setJiraKey("");
                    setJiraMessage(`Pulled ${r.issue.key}`);
                  } else {
                    setJiraMessage(r.error || "Could not pull Jira issue");
                  }
                }}
              >
                Pull
              </Button>
            </div>
            {jiraMessage ? <p className="mt-1 text-2xs text-muted">{jiraMessage}</p> : null}
            {connectors.issues.length ? (
              <ul className="mt-2 flex flex-col gap-1">
                {connectors.issues.map((issue) => (
                  <li key={issue.key} className="flex min-h-11 items-center border border-border pl-2 text-sm">
                    <span className="mr-2 font-mono text-2xs">{issue.key}</span>
                    <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                    <button
                      type="button"
                      className="flex size-11 items-center justify-center text-subtle hover:text-danger"
                      aria-label={`Delete ${issue.key} from Team catalog`}
                      onClick={() => {
                        if (window.confirm(`Delete ${issue.key} from the Team catalog and remove it from all prompts? Existing ticket links will remain.`)) {
                          removeCatalogIssue(issue.key);
                        }
                      }}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-2xs text-muted">Pull a key here or sync issues on Connect.</p>
            )}
          </>
        ) : (
          <p className="text-2xs text-muted">Set a Jira PAT on Connect to pull issues into the team catalog.</p>
        )}
      </section>

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
  const addExampleFlow = useBoardStore((s) => s.addExampleFlow);
  const duplicateFlow = useBoardStore((s) => s.duplicateFlow);
  const removeFlow = useBoardStore((s) => s.removeFlow);
  const patchFlow = useBoardStore((s) => s.patchFlow);
  const flow = config.flows.find((f) => f.id === config.activeFlowId) ?? config.flows[0];
  if (!flow) return null;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        A flow is a pipeline. <strong className="font-medium text-fg">New flow</strong> starts blank. <strong className="font-medium text-fg">Example</strong> is Capture (human) → Draft (Cursor, {"{{brief}}"}) → Echo (prints {"{{agenda}}"} only). Duplicate copies the current one.
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
        <Button variant="secondary" size="md" onClick={() => addExampleFlow()}>
          Example: Capture → Cursor → Echo
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
        Keep running agent stages without stopping to review or edit each payload
      </label>
      <Field label="After Done, continue in">
        <select
          className="h-11 w-full rounded-md border border-border bg-inset px-2 text-sm"
          value={flow.continueInFlowId ?? ""}
          onChange={(e) => patchFlow({ continueInFlowId: e.target.value || undefined })}
        >
          <option value="">Stop here</option>
          {config.flows
            .filter((f) => f.id !== flow.id)
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
        </select>
      </Field>
      <p className="text-2xs text-muted">
        Edit stages for <span className="text-fg">{flow.name}</span> on the Pipeline tab. Prompts may use {"{{brief}}"} {"{{spec}}"} {"{{grill}}"} {"{{plan}}"} {"{{transcript}}"} {"{{prev}}"} {"{{ticket.title}}"}.
      </p>
    </div>
  );
}

function PipelineTab({ onEditPrompt }: { onEditPrompt: (id: string) => void }) {
  const columns = useBoardStore((s) => s.config.columns);
  const prompts = useBoardStore((s) => s.config.prompts) ?? [];
  const execution = useBoardStore((s) => s.config.execution);
  const updateColumn = useBoardStore((s) => s.updateColumn);
  const moveColumn = useBoardStore((s) => s.moveColumn);
  const addColumn = useBoardStore((s) => s.addColumn);
  const removeColumn = useBoardStore((s) => s.removeColumn);
  const addPrompt = useBoardStore((s) => s.addPrompt);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border bg-inset px-3 py-2 text-sm text-muted">
        <p>
          This tab only <strong className="font-medium text-fg">designs</strong> the flow. Run it on the board. Pin <strong className="font-medium text-fg">Who runs it</strong> to Cursor, Claude, Studio, CIS, or WebLLM. WebLLM stages also get a performance picker (Fast / Balanced / Quality). Notify stays on Cursor. The variable is the last agent reply only — no logs.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {columns.map((col, i) => (
          <li key={col.id} className="rounded-md border border-border bg-elevated p-3">
            <div className="flex flex-wrap items-end gap-2">
              <span className="mb-3 font-mono text-micro text-subtle">{String(i + 1).padStart(2, "0")}</span>
              <label className="flex min-w-32 flex-1 flex-col gap-1">
                <span className="text-micro text-subtle">Stage name</span>
                <Input
                  className="h-11"
                  value={col.label}
                  onChange={(e) => updateColumn(col.id, { label: e.target.value, name: e.target.value || col.name })}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-micro text-subtle">What this stage does</span>
                <select
                  className="h-11 rounded-md border border-border bg-inset px-2 text-sm"
                  value={col.role}
                  disabled={col.locked}
                  onChange={(e) => updateColumn(col.id, { role: e.target.value as ColumnRole })}
                  title={ROLE_LABEL[col.role]}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-micro text-subtle">Who runs it</span>
                <select
                  className="h-11 rounded-md border border-border bg-inset px-2 text-sm"
                  value={col.agent ?? "inherit"}
                  onChange={(e) => updateColumn(col.id, { agent: e.target.value as StepAgent })}
                >
                  {(col.id === SEND_SLACK_COLUMN_ID
                    ? STEP_AGENTS.filter((a) => a.id !== "webllm")
                    : STEP_AGENTS
                  ).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              {stageUsesWebllm(col, execution) ? (
                <label className="flex flex-col gap-1">
                  <span className="text-micro text-subtle">WebLLM performance</span>
                  <select
                    className="h-11 rounded-md border border-border bg-inset px-2 text-sm"
                    value={col.webllmProfile ?? ""}
                    onChange={(e) =>
                      updateColumn(col.id, {
                        webllmProfile: (e.target.value || undefined) as WebllmProfile | undefined,
                      })
                    }
                  >
                    <option value="">Workspace default ({execution.webllmProfile ?? "balanced"})</option>
                    {WEBLLM_PROFILES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label} — {p.summary}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {col.role === "prompt" || col.role === "plan" || col.role === "collect-input" ? (
                <label className="flex min-w-40 flex-1 flex-col gap-1">
                  <span className="text-micro text-subtle">Prompt</span>
                  <div className="flex gap-1">
                    <select
                      className="h-11 min-w-0 flex-1 rounded-md border border-border bg-inset px-2 text-sm"
                      value={col.promptRef ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "__new__") {
                          const id = addPrompt();
                          updateColumn(col.id, { promptRef: id });
                          onEditPrompt(id);
                          return;
                        }
                        updateColumn(col.id, { promptRef: v || undefined });
                      }}
                    >
                      <option value="">None</option>
                      {prompts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                      <option value="__new__">+ New prompt…</option>
                    </select>
                    {col.promptRef ? (
                      <button
                        type="button"
                        className="h-11 shrink-0 rounded-md border border-border px-3 text-2xs"
                        onClick={() => onEditPrompt(col.promptRef!)}
                      >
                        Edit
                      </button>
                    ) : null}
                  </div>
                </label>
              ) : null}
              <label className="flex w-36 flex-col gap-1">
                <span className="text-micro text-subtle">Variable</span>
                <Input
                  className="h-11 font-mono"
                  placeholder="agenda"
                  value={col.outputKey ?? ""}
                  onChange={(e) => updateColumn(col.id, { outputKey: e.target.value.trim() })}
                />
              </label>
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
              {!col.locked && columns.filter((c) => !c.locked).length > 1 ? (
                <button
                  type="button"
                  className="flex size-11 items-center justify-center rounded-md text-subtle hover:text-danger"
                  aria-label="Delete stage"
                  title="Delete stage"
                  onClick={() => {
                    if (window.confirm(`Delete stage “${col.name}”? Tickets here move to stage 01.`)) {
                      removeColumn(col.id);
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-2xs text-muted">
              {ROLE_LABEL[col.role]}
              {col.id === SEND_SLACK_COLUMN_ID ? (
                <>
                  {" · "}Cursor CLI posts via <span className="font-mono text-fg">slack-mcp</span> using{" "}
                  <span className="font-mono text-fg">{"{{slackMessage}}"}</span>
                </>
              ) : null}
              {col.outputKey ? (
                <>
                  {" · "}later stages read <span className="font-mono text-fg">{`{{${col.outputKey}}}`}</span>
                </>
              ) : (
                " · set a variable name so later stages can use this output"
              )}
            </p>
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


function PromptsTab({ focusId, onFocus }: { focusId: string | null; onFocus: (id: string) => void }) {
  const columns = useBoardStore((s) => s.config.columns);
  const prompts = useBoardStore((s) => s.config.prompts) ?? [];
  const docs = useBoardStore((s) => s.config.docs);
  const connectors = useBoardStore((s) => s.config.connectors) ?? createDefaultConnectors();
  const issues = connectors.issues;
  const addPrompt = useBoardStore((s) => s.addPrompt);
  const updatePrompt = useBoardStore((s) => s.updatePrompt);
  const removePrompt = useBoardStore((s) => s.removePrompt);
  const updateColumn = useBoardStore((s) => s.updateColumn);
  const setCatalog = useBoardStore((s) => s.setCatalog);
  const [id, setId] = useState(focusId || prompts[0]?.id || "");
  const [jiraKey, setJiraKey] = useState("");
  const [jiraMessage, setJiraMessage] = useState("");
  const [jiraBusy, setJiraBusy] = useState(false);
  const [addToCatalog, setAddToCatalog] = useState(true);
  const prompt = prompts.find((p) => p.id === (focusId || id)) ?? prompts.find((p) => p.id === id) ?? prompts[0];

  function select(next: string) {
    setId(next);
    onFocus(next);
  }

  function create() {
    const next = addPrompt();
    select(next);
  }

  const usedBy = columns.filter((c) => c.promptRef === prompt?.id);
  const promptOnlyKeys = (prompt?.jiraKeys ?? []).filter(
    (key) => !issues.some((issue) => issue.key.toUpperCase() === key.toUpperCase()),
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        A prompt is what the agent receives. Paste a skill into the body, or attach skills from the Skills tab — they are appended on run. Pipeline stages pick a prompt from this list.
      </p>
      <div className="flex flex-wrap gap-1">
        {prompts.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => select(p.id)}
            className={cn(
              "h-11 rounded-md px-3 text-sm",
              p.id === prompt?.id ? "bg-accent text-accent-fg" : "bg-inset text-muted",
            )}
          >
            {p.name}
          </button>
        ))}
        <button type="button" onClick={create} className="inline-flex h-11 items-center gap-1 rounded-md border border-border px-3 text-sm">
          <Plus className="size-4" />
          Add prompt
        </button>
      </div>
      {prompt ? (
        <>
          <Field label="Prompt name">
            <Input value={prompt.name} onChange={(e) => updatePrompt(prompt.id, { name: e.target.value })} />
          </Field>
          <Field label="Prompt body (skills can be pasted here)">
            {usedBy.length > 0 ? <FlowSpecWarning /> : null}
            <Textarea
              className="min-h-52 font-mono text-2xs"
              value={prompt.body}
              onChange={(e) => {
                updatePrompt(prompt.id, { body: e.target.value });
                for (const c of usedBy) updateColumn(c.id, { promptTemplate: e.target.value });
              }}
            />
          </Field>
          <fieldset className="rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">Skills to append on run</legend>
            <p className="mb-2 text-2xs text-muted">Same library as the Skills tab. Check ones this prompt should call.</p>
            {docs.length ? (
              <ul className="flex flex-col gap-1">
                {docs.map((d) => {
                  const on = (prompt.skillIds ?? []).includes(d.id);
                  return (
                    <li key={d.id}>
                      <label className="flex min-h-11 items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => {
                            const current = prompt.skillIds ?? [];
                            const skillIds = e.target.checked
                              ? [...current, d.id]
                              : current.filter((x) => x !== d.id);
                            updatePrompt(prompt.id, { skillIds });
                          }}
                        />
                        <span>{d.title}</span>
                        <span className="text-2xs text-muted">{d.kind}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-2xs text-muted">No skills yet. Add them on the Skills tab, or paste into the prompt body.</p>
            )}
          </fieldset>
          <fieldset className="rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">Jira issues to include on run</legend>
            <p className="mb-2 text-2xs text-muted">
              These are combined with the ticket issues and available as {"{{jira}}"} and per-key tokens.
            </p>
            {connectors.jira.token ? (
              <div className="mb-3 flex flex-col gap-2 border-b border-border pb-3">
                <div className="flex gap-2">
                  <Input
                    className="font-mono uppercase"
                    placeholder="X2-123"
                    value={jiraKey}
                    onChange={(e) => setJiraKey(e.target.value)}
                  />
                  <Button
                    size="md"
                    disabled={jiraBusy || !jiraKey.trim()}
                    onClick={async () => {
                      setJiraBusy(true);
                      setJiraMessage("");
                      try {
                        const result = await pullJiraIssue({ data: { jira: connectors.jira, key: jiraKey } });
                        if (!result.ok || !result.issue) {
                          setJiraMessage(result.error || "Could not pull Jira issue");
                          return;
                        }
                        updatePrompt(prompt.id, { jiraKeys: bindJiraKey(prompt.jiraKeys, result.issue.key) });
                        if (addToCatalog) {
                          setCatalog({
                            issues: [
                              result.issue,
                              ...issues.filter((issue) => issue.key.toUpperCase() !== result.issue!.key.toUpperCase()),
                            ],
                          });
                        }
                        setJiraKey("");
                        setJiraMessage(
                          `${result.issue.key} added to this prompt${addToCatalog ? " and the Team catalog" : " only"}`,
                        );
                      } catch (error) {
                        setJiraMessage(error instanceof Error ? error.message : "Could not pull Jira issue");
                      } finally {
                        setJiraBusy(false);
                      }
                    }}
                  >
                    {jiraBusy ? "Pulling…" : "Pull"}
                  </Button>
                </div>
                <label className="flex min-h-11 items-center gap-2 text-2xs text-muted">
                  <input
                    type="checkbox"
                    checked={addToCatalog}
                    onChange={(e) => setAddToCatalog(e.target.checked)}
                  />
                  Also add this Jira to the Team catalog
                </label>
                {jiraMessage ? <p className="text-2xs text-muted">{jiraMessage}</p> : null}
              </div>
            ) : (
              <p className="mb-3 text-2xs text-muted">Set a Jira PAT on Connect to pull another issue directly into this prompt.</p>
            )}
            {issues.length ? (
              <ul className="flex flex-col gap-1">
                {issues.map((issue) => {
                  const on = (prompt.jiraKeys ?? []).some((key) => key.toUpperCase() === issue.key.toUpperCase());
                  return (
                    <li key={issue.key} className="flex min-h-11 items-center">
                      <label className="flex min-w-0 flex-1 items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => {
                            updatePrompt(prompt.id, {
                              jiraKeys: e.target.checked
                                ? bindJiraKey(prompt.jiraKeys, issue.key)
                                : unbindJiraKey(prompt.jiraKeys, issue.key),
                            });
                          }}
                        />
                        <span className="font-mono text-2xs">{issue.key}</span>
                        <span className="truncate">{issue.title}</span>
                      </label>
                      {on ? (
                        <button
                          type="button"
                          className="flex size-11 shrink-0 items-center justify-center text-subtle hover:text-danger"
                          aria-label={`Remove ${issue.key} from this prompt`}
                          onClick={() => updatePrompt(prompt.id, { jiraKeys: unbindJiraKey(prompt.jiraKeys, issue.key) })}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-2xs text-muted">No Jira issues in the team catalog yet.</p>
            )}
            {promptOnlyKeys.length ? (
              <ul className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
                {promptOnlyKeys.map((key) => (
                  <li key={key} className="flex min-h-11 items-center gap-2 text-sm">
                    <span className="font-mono text-2xs">{key}</span>
                    <span className="min-w-0 flex-1 text-2xs text-muted">Prompt only</span>
                    <button
                      type="button"
                      className="flex size-11 items-center justify-center text-subtle hover:text-danger"
                      aria-label={`Remove ${key} from this prompt`}
                      onClick={() => updatePrompt(prompt.id, { jiraKeys: unbindJiraKey(prompt.jiraKeys, key) })}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </fieldset>
          <Field label="GenAI Studio prompt ID (optional override)">
            <Input
              className="font-mono"
              value={prompt.studioPromptId ?? ""}
              placeholder="Uses the workspace default"
              onChange={(e) => updatePrompt(prompt.id, { studioPromptId: e.target.value })}
            />
          </Field>
          <p className="text-2xs text-muted">
            Used by: {usedBy.length ? usedBy.map((c) => c.label).join(", ") : "no pipeline stage yet — pick this prompt on Pipeline."}
          </p>
          {!usedBy.length ? (
            <Button
              variant="ghost"
              size="sm"
              className="self-start text-danger"
              onClick={() => {
                removePrompt(prompt.id);
                const next = prompts.find((p) => p.id !== prompt.id);
                if (next) select(next.id);
              }}
            >
              Delete prompt
            </Button>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted">No prompts. Add one, then attach it to a pipeline stage.</p>
      )}
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
        Grill Me and any prompt can read these. Attach a skill to a prompt on the Prompts tab, or paste the skill body into the prompt itself.
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

type CliRow = {
  configured: string;
  path: string | null;
  realPath: string | null;
  version: string;
  identity: string;
};

function identityLabel(id: string): string {
  if (id === "cursor") return "Cursor CLI";
  if (id === "grok") return "Grok (not used for Notify)";
  if (id === "claude") return "Claude CLI";
  if (id === "missing") return "not found";
  return id;
}

function mergeLogLines(server: string[], client: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of [...client, ...server]) {
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

function AppConsoleLog({
  probe,
  busy,
}: {
  probe: {
    ok: boolean;
    via: string;
    text: string;
    error?: string;
    checks?: { ok: boolean; label: string; detail: string }[];
    log?: string;
  } | null;
  busy: string | null;
}) {
  const appConsole = useBoardStore((s) => s.appConsole);
  const [serverLines, setServerLines] = useState<string[]>([]);
  const [clientLines, setClientLines] = useState<string[]>(() => getLogLines());
  const [level, setLevel] = useState(getLogLevel());
  const [preEl, setPreEl] = useState<HTMLPreElement | null>(null);

  useEffect(() => {
    let stop = false;
    async function tick() {
      try {
        const report = await readAppLogs({ data: {} });
        if (!stop) {
          setServerLines(report.lines);
          setClientLines(getLogLines());
          setLevel(report.level);
        }
      } catch {
        if (!stop) {
          setClientLines(getLogLines());
          setLevel(getLogLevel());
        }
      }
    }
    void tick();
    const id = setInterval(() => void tick(), 500);
    const unsub = subscribeLogs((rec) => {
      setClientLines((prev) => (prev.includes(rec.line) ? prev : [...prev, rec.line]));
    });
    return () => {
      stop = true;
      clearInterval(id);
      unsub();
    };
  }, []);

  const lines = mergeLogLines(serverLines, [...clientLines, ...appConsole]);
  const live = probe?.log || probe?.error || "";
  const body = [
    lines.length ? lines.join("\n") : "",
    live ? `${lines.length ? "\n--- live test ---\n" : ""}${live}` : "",
  ]
    .filter(Boolean)
    .join("");

  useEffect(() => {
    if (preEl) preEl.scrollTop = preEl.scrollHeight;
  }, [preEl, body]);

  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3",
        probe && !probe.ok ? "border-danger" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">App log</h3>
        <span className="text-2xs text-muted">
          {probe
            ? busy
              ? probe.text
              : probe.ok
                ? `Pass · ${probe.via}`
                : `Fail · ${probe.via}`
            : null}
          {probe ? " · " : null}
          <span className="font-mono">PIT_LOG_LEVEL={level}</span>
        </span>
      </div>
      <p className="text-2xs text-muted">
        Every execution call (Cursor, Claude, HTTP, WebLLM, tests) writes here.{" "}
        <span className="font-mono">debug</span> includes info, warn, and error. Set{" "}
        <span className="font-mono">PIT_LOG_LEVEL</span> in <span className="font-mono">.env</span>, then restart{" "}
        <span className="font-mono">npm run dev</span>.
      </p>
      {probe?.checks?.length ? (
        <ul className="flex flex-col gap-1">
          {probe.checks.map((c) => (
            <li key={c.label} className="text-2xs">
              <span className={cn("font-medium", c.ok ? "text-fg" : "text-danger")}>
                {c.ok ? "Pass" : "Fail"} · {c.label}
              </span>
              {c.detail && c.detail.length < 200 ? (
                <span className="text-muted"> — {c.detail.split("\n")[0]}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <pre
        ref={setPreEl}
        className="max-h-80 min-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-inset p-3 font-mono text-2xs text-fg"
      >
        {body ||
          "No execution logs yet. Run a stage or Test Cursor.\nYou should see [kindling] INFO exec start, then the CLI path and ok/fail."}
      </pre>
      {probe && !probe.ok && /PATH|not on PATH|not on Node PATH/i.test(probe.error || probe.text || "") ? (
        <p className="text-2xs text-muted">
          Mac: add <span className="font-mono">~/.local/bin</span> to PATH, restart{" "}
          <span className="font-mono">npm run dev</span> from Terminal.
        </p>
      ) : null}
    </section>
  );
}

function CliBinsPanel({ exec }: { exec: ReturnType<typeof createDefaultExecution> }) {
  const [rows, setRows] = useState<{ cursor: CliRow; grokOnPath: CliRow | null; claude: CliRow } | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const report = await inspectCliBins({ data: { execution: exec } });
      setRows(report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not inspect CLIs");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exec.cursorCommand, exec.claudeCommand]);

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Resolved CLIs</h3>
        <button type="button" className="h-9 rounded-md border border-border px-3 text-2xs" onClick={() => void load()}>
          Re-detect
        </button>
      </div>
      <p className="text-2xs text-muted">
        Notify and other Cursor stages use the Cursor row, never Grok’s <span className="font-mono">agent</span> even if it is first on PATH.
      </p>
      {error ? <p className="text-2xs text-danger">{error}</p> : null}
      {rows ? (
        <ul className="flex flex-col gap-2 font-mono text-2xs">
          <CliBinLine title="Cursor (Notify uses this)" row={rows.cursor} />
          {rows.grokOnPath ? <CliBinLine title="Grok on PATH (ignored)" row={rows.grokOnPath} warn /> : null}
          <CliBinLine title="Claude" row={rows.claude} />
        </ul>
      ) : (
        <p className="text-2xs text-muted">Detecting binaries…</p>
      )}
    </section>
  );
}

function CliBinLine({ title, row, warn }: { title: string; row: CliRow; warn?: boolean }) {
  const path = row.path || "—";
  const real = row.realPath && row.realPath !== row.path ? ` → ${row.realPath}` : "";
  return (
    <li className={cn("rounded-md border px-2 py-1.5", warn ? "border-danger/50" : "border-border")}>
      <p className={cn("font-sans font-medium", warn ? "text-danger" : "text-fg")}>
        {title} · {identityLabel(row.identity)}
      </p>
      <p className="text-muted">cmd: {row.configured}</p>
      <p className="break-all text-fg">
        {path}
        {real}
      </p>
      {row.version ? <p className="text-muted">{row.version}</p> : null}
    </li>
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
            Confirm with <span className="font-mono">cursor-agent --version</span>. Kindling does not use Grok’s <span className="font-mono">agent</span> even if it is first on PATH.
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
            Use Test Cursor / Test Claude. You want a path plus a --version line. Uncheck connectivity-only to send a cheap Haiku/Composer ping.
          </p>
        </li>
        <li>
          <p className="font-medium">WebLLM (in this tab)</p>
          <p className="text-2xs text-muted">
            No CLI. Chrome or Edge with WebGPU. Pick Fast / Balanced / Quality below, then Test WebLLM. First run downloads the model into the browser; later runs are local.
          </p>
        </li>
      </ol>
    </section>
  );
}

function WebllmTab() {
  const config = useBoardStore((s) => s.config);
  const patchConfig = useBoardStore((s) => s.patchConfig);
  const exec = config.execution ?? createDefaultExecution();
  return (
    <WebllmFields
      exec={exec}
      onPatch={(partial) => patchConfig({ execution: { ...exec, ...partial } })}
    />
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
    log?: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("Reply with exactly: pong");
  const [connectOnly, setConnectOnly] = useState(false);
  const [mcpServer, setMcpServer] = useState("");

  function patch(partial: Partial<typeof exec>) {
    patchConfig({ execution: { ...exec, ...partial } });
  }

  async function testWebllm() {
    setBusy("webllm");
    setProbe({ ok: true, via: "webllm", text: "Starting…", log: "[kindling] WebLLM" });
    try {
      const { probeWebllm } = await import("@/lib/webllm-engine");
      const result = await probeWebllm({
        execution: exec,
        prompt,
        connectOnly,
        onLog: (log) =>
          setProbe({
            ok: true,
            via: "webllm",
            text: "Running…",
            log,
          }),
      });
      setProbe({
        ok: result.ok,
        via: result.via,
        text: result.ok ? result.text : result.error || "Failed",
        error: result.error,
        checks: result.checks,
        log: result.log,
      });
    } catch (err) {
      setProbe({
        ok: false,
        via: "webllm",
        text: "",
        error: err instanceof Error ? err.message : "WebLLM test failed",
      });
    } finally {
      setBusy(null);
    }
  }

  async function test(stepAgent: StepAgent, extra?: { mcp?: boolean }) {
    if (resolveStep({ agent: stepAgent }, exec).kind === "webllm") {
      await testWebllm();
      return;
    }
    const label = extra?.mcp ? `${stepAgent}-mcp` : stepAgent;
    setBusy(label);
    setProbe({ ok: true, via: stepAgent, text: "Starting…", log: "[kindling] starting" });
    try {
      const started = await testExecution({
        data: {
          execution: exec,
          stepAgent,
          mode: connectOnly ? "connect" : "run",
          prompt,
          mcp: extra?.mcp,
          mcpServer,
          phase: "start",
        },
      });
      setProbe({
        ok: started.ok,
        via: started.via,
        text: started.text,
        error: started.error,
        checks: started.checks,
        log: started.log,
      });
      if (!started.sessionDir || started.done) {
        if (started.sessionDir) {
          /* fall through */
        } else {
          return;
        }
      }
      if (!started.sessionDir) return;
      const dir = started.sessionDir;
      for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const poll = await testExecution({ data: { phase: "poll", sessionDir: dir } });
        const checks = [
          ...(started.checks ?? []),
          {
            ok: poll.done ? poll.ok : true,
            label: poll.done ? "Test run" : "Test run (streaming)",
            detail: poll.done
              ? (poll.ok ? (poll.log ?? "").slice(-1200) : poll.error || (poll.log ?? "").slice(-1200))
              : `streaming ${Math.round((i + 1) * 0.5)}s`,
          },
        ];
        setProbe({
          ok: poll.done ? poll.ok : true,
          via: started.via,
          text: poll.done ? (poll.ok ? "Test finished" : poll.error || "Failed") : `Streaming log… ${Math.round((i + 1) * 0.5)}s`,
          error: poll.done ? poll.error : undefined,
          checks,
          log: poll.log || started.log,
        });
        if (poll.done) return;
      }
      setProbe((prev) => ({
        ...(prev ?? { ok: false, via: started.via, text: "" }),
        ok: false,
        text: "Stopped polling after 40s",
        error: "Stopped polling after 40s",
      }));
    } catch (err) {
      setProbe({
        ok: false,
        via: stepAgent,
        text: "",
        error: err instanceof Error ? err.message : "Setup check failed",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        Kindling tests use print mode (<span className="font-mono">-p</span>) so they exit. Pipeline stages open a long Terminal TUI (<span className="font-mono">script -q -F</span>, prompt file, session id / workspace). Answer prompts there; close the window when done.
      </p>
      <CliBinsPanel exec={exec} />
      <MacAgentHints />
      {exec.demoFallbacks ? (
        <p className="rounded-md border border-border px-3 py-2 text-sm text-muted">
          Demo text is on. If the agent is missing, Run still produces canned output. Turn this off once Cursor, Claude, or Studio is hooked up.
        </p>
      ) : null}

      <section className="flex flex-col gap-3 rounded-md border border-border p-3">
        <h3 className="text-sm font-medium">How a call works</h3>
        <ol className="list-decimal space-y-1 pl-4 text-2xs text-muted">
          <li>The stage prompt is interpolated from Settings + ticket vars (<span className="font-mono">{"{{brief}}"}</span>, <span className="font-mono">{"{{spec}}"}</span>…).</li>
          <li>Kindling spawns the CLI in your workspace (or opens Terminal.app) with print-mode flags.</li>
          <li>Stdout is the stage result. That becomes the next stage’s variable. Studio/CIS are HTTP. WebLLM runs the model in this tab (WebGPU).</li>
        </ol>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={exec.runInTerminal !== false}
            onChange={(e) => patch({ runInTerminal: e.target.checked })}
          />
          Open Terminal.app and tee print-mode output into the app log
        </label>
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            className="mt-1"
            type="checkbox"
            checked={Boolean(exec.fullAgentMode)}
            onChange={(e) => patch({ fullAgentMode: e.target.checked })}
          />
          <span>
            Allow full agent / auto (yolo, dontAsk, -f). Leave off — Workday blocks this outside a dev container. Kindling uses print/ask only.
          </span>
        </label>
        <Field label="Workspace directory (trust root)">
          <Input
            className="font-mono"
            value={exec.workspaceDir ?? ""}
            placeholder="empty = the folder you launched npm run dev from"
            onChange={(e) => patch({ workspaceDir: e.target.value })}
          />
        </Field>
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-border p-3">
        <h3 className="text-sm font-medium">Agent test</h3>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" checked={connectOnly} onChange={(e) => setConnectOnly(e.target.checked)} />
          Connectivity only (skip the model ping)
        </label>
        <Field label="Test prompt">
          <Textarea
            className="min-h-20"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={connectOnly}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void test("cursor")}
            className="inline-flex h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-40"
          >
            {busy === "cursor" ? "Testing…" : "Test Cursor"}
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void test("claude")}
            className="inline-flex h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-40"
          >
            {busy === "claude" ? "Testing…" : "Test Claude"}
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void test("inherit")}
            className="inline-flex h-11 items-center rounded-md border border-border px-4 text-sm disabled:opacity-40"
          >
            {busy === "inherit" ? "Testing…" : `Test default (${executionLabel(exec)})`}
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void testWebllm()}
            className="inline-flex h-11 items-center rounded-md border border-border px-4 text-sm disabled:opacity-40"
          >
            {busy === "webllm" ? "Testing…" : "Test WebLLM"}
          </button>
        </div>
      </section>

      <AppConsoleLog probe={probe} busy={busy} />

      <section className="flex flex-col gap-3 rounded-md border border-border p-3">
        <h3 className="text-sm font-medium">MCP</h3>
        <p className="text-2xs text-muted">
          Same as the agent test: opens Terminal as a live session and captures the log. Connectivity-only runs{" "}
          <span className="font-mono">mcp list</span> (and <span className="font-mono">mcp get</span> if you name a server).
          Unchecked, it then asks the agent to use those MCP tools with your test prompt.
        </p>
        <Field label="MCP server name (optional)">
          <Input
            className="font-mono"
            value={mcpServer}
            placeholder="github"
            onChange={(e) => setMcpServer(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void test("claude", { mcp: true })}
            className="inline-flex h-11 items-center rounded-md border border-border px-4 text-sm disabled:opacity-40"
          >
            {busy === "claude-mcp" ? "Checking…" : "Test Claude MCP"}
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void test("cursor", { mcp: true })}
            className="inline-flex h-11 items-center rounded-md border border-border px-4 text-sm disabled:opacity-40"
          >
            {busy === "cursor-mcp" ? "Checking…" : "Test Cursor MCP"}
          </button>
        </div>
      </section>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Default for Inherit</legend>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
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

      <p className="rounded-md border border-border px-3 py-2 text-2xs text-muted">
        WebLLM status, cache, and extra models are on the <span className="font-medium text-fg">WebLLM</span> tab.
      </p>

      <section className="flex flex-col gap-3 rounded-md border border-border p-3">
        <h3 className="text-sm font-medium">Cursor</h3>
        <TargetToggle
          value={exec.cursorTarget}
          onChange={(cursorTarget) => patch({ cursorTarget })}
        />
        <Field label="Local command">
          <Input className="font-mono" value={exec.cursorCommand} onChange={(e) => patch({ cursorCommand: e.target.value })} />
        </Field>
        <p className="-mt-2 text-2xs text-muted">
          Resolved binary (and whether it is Cursor vs Grok) is in Resolved CLIs at the top of this tab. Prefer{" "}
          <span className="font-mono">cursor-agent</span> — <span className="font-mono">agent</span> on this Mac is Grok.
        </p>
        <Field label="Print-mode flags (non-interactive)">
          <Input
            className="font-mono"
            value={exec.cursorExtraArgs ?? ""}
            onChange={(e) => patch({ cursorExtraArgs: e.target.value })}
          />
        </Field>
        <Field label="Test model (cheapest ping)">
          <Input
            className="font-mono"
            value={exec.cursorTestModel ?? "auto"}
            placeholder="auto"
            onChange={(e) => patch({ cursorTestModel: e.target.value })}
          />
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
        <Field label="Print-mode flags (non-interactive)">
          <Input
            className="font-mono"
            value={exec.claudeExtraArgs ?? "--permission-mode default"}
            onChange={(e) => patch({ claudeExtraArgs: e.target.value })}
          />
        </Field>
        <Field label="Test model (cheapest ping)">
          <Input
            className="font-mono"
            value={exec.claudeTestModel ?? "haiku"}
            onChange={(e) => patch({ claudeTestModel: e.target.value })}
          />
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
      <Field label="Stage timeout (minutes) — non-interactive agent runs">
        <Input
          className="font-mono"
          value={String(Math.round((exec.stageTimeoutMs ?? 300000) / 60000))}
          onChange={(e) => patch({ stageTimeoutMs: (Number(e.target.value) || 5) * 60000 })}
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

