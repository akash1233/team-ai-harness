import { create } from "zustand";
import type { Flow, GrillQuestion, GrillRound, TeamConfig, TeamDoc, TeamMember, TeamPrompt, Ticket, WorkflowColumn } from "./types";
import type { LinkedJira, LinkedRepo } from "./connectors";
import { connectorVars, mergeConnectors } from "./connectors";
import {
  BLOCKED_COLUMN_ID,
  DISCOVERY_FLOW_ID,
  DONE_COLUMN_ID,
  FRY_COLUMN_ID,
  IDEATION_COLUMN_ID,
  nextColumnId,
  parkOrphanTickets,
  startColumnId,
  TRANSCRIPT_COLUMN_ID,
  WRITE_PLAN_COLUMN_ID,
  columnById,
} from "./columns";
import { createSampleTickets, STORAGE_KEY } from "./sample-data";
import {
  activeFlow,
  applyActiveFlow,
  createDefaultTeam,
  mergeTeamConfig,
  patchActiveFlow,
  writeFlowColumns,
} from "./team-config";
import { harvestVars } from "./flow-context";
import { promptIdForColumn, resolveStagePrompt } from "./prompts";
import { assignQuestions } from "./grill";
import { nextKey, uid } from "./format";
import { extractGrill, extractPlan, runDiscoveryAgent } from "./discovery-agent";

type BoardState = {
  tickets: Ticket[];
  config: TeamConfig;
  selectedId: string | null;
  activeStageId: string;
  settingsOpen: boolean;
  promptColumnId: string | null;
  activeMemberId: string;
  hydrated: boolean;
  hydrate: () => void;
  persist: () => void;
  select: (id: string | null) => void;
  setActiveStage: (id: string) => void;
  toggleSettings: (open?: boolean) => void;
  moveTicket: (id: string, columnId: string) => void;
  updateTicket: (id: string, patch: Partial<Ticket>) => void;
  addTicket: (input: {
    title: string;
    description: string;
    key?: string;
    linkedJira?: LinkedJira;
    linkedRepo?: LinkedRepo;
  }) => string;
  reset: () => void;
  resetTeam: () => void;
  openPrompt: (columnId: string | null) => void;
  advance: (id: string) => void;
  approve: (id: string) => void;
  block: (id: string, reason: string) => void;
  failTicket: (id: string, reason: string, columnId?: string, via?: string) => void;
  runColumn: (columnId: string) => Promise<void>;
  runTicket: (id: string) => Promise<void>;
  patchLiveLog: (id: string, log: string) => void;
  harvestLiveSession: (id: string, result: { ok: boolean; log: string; error?: string }) => Promise<void>;
  submitGrill: (id: string, answers: Record<number, string>) => Promise<void>;
  patchGrillQuestion: (ticketId: string, roundId: string, n: number, patch: Partial<GrillQuestion>) => void;
  setActiveMember: (id: string) => void;
  upsertDoc: (doc: TeamDoc) => void;
  removeDoc: (id: string) => void;
  addPrompt: () => string;
  updatePrompt: (id: string, patch: Partial<TeamPrompt>) => void;
  removePrompt: (id: string) => void;
  patchConfig: (patch: Partial<TeamConfig>) => void;
  updateColumn: (id: string, patch: Partial<WorkflowColumn>) => void;
  moveColumn: (id: string, dir: -1 | 1) => void;
  addColumn: () => void;
  removeColumn: (id: string) => void;
  testStage: (columnId: string) => Promise<void>;
  addMember: (member: Omit<TeamMember, "id">) => void;
  updateMember: (id: string, patch: Partial<Omit<TeamMember, "id">>) => void;
  removeMember: (id: string) => void;
  addLabel: (label: string) => void;
  removeLabel: (label: string) => void;
  continueAfter: (id: string) => Promise<void>;
  handoffTicket: (id: string, flowId: string) => Promise<void>;
  setActiveFlow: (id: string) => void;
  addFlow: () => void;
  duplicateFlow: (id?: string) => void;
  removeFlow: (id: string) => void;
  patchFlow: (patch: Partial<Flow>) => void;
  attachJira: (id: string, issue: LinkedJira) => void;
  attachRepo: (id: string, repo: LinkedRepo) => void;
  setCatalog: (patch: { issues?: LinkedJira[]; repos?: LinkedRepo[] }) => void;
};

function persistNow(
  state: Pick<BoardState, "tickets" | "config" | "selectedId" | "activeStageId" | "activeMemberId">,
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tickets: state.tickets,
        config: state.config,
        selectedId: state.selectedId,
        activeStageId: state.activeStageId,
        activeMemberId: state.activeMemberId,
      }),
    );
  } catch {
    /* ignore quota */
  }
}

function withTicket(tickets: Ticket[], id: string, patch: Partial<Ticket> | ((t: Ticket) => Ticket)) {
  return tickets.map((t) => {
    if (t.id !== id) return t;
    return typeof patch === "function" ? patch(t) : { ...t, ...patch };
  });
}

function stampTicket(t: Ticket, flowId = DISCOVERY_FLOW_ID): Ticket {
  return {
    ...t,
    flowId: t.flowId || flowId,
    vars: t.vars ?? {},
  };
}

export const useBoardStore = create<BoardState>((set, get) => ({
  tickets: createSampleTickets(),
  config: createDefaultTeam(),
  selectedId: null,
  activeStageId: FRY_COLUMN_ID,
  settingsOpen: false,
  promptColumnId: null,
  activeMemberId: "m-maya",
  hydrated: false,

  hydrate: () => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<
          Pick<BoardState, "tickets" | "config" | "selectedId" | "activeStageId" | "activeMemberId">
        >;
        if (Array.isArray(parsed.tickets) && parsed.tickets.length > 0) {
          const config = parsed.config ? mergeTeamConfig(parsed.config) : createDefaultTeam();
          set({
            tickets: parkOrphanTickets(
              parsed.tickets.map((t) => stampTicket(t, config.activeFlowId)),
              config.columns,
            ),
            config,
            selectedId: parsed.selectedId ?? null,
            activeStageId: parsed.activeStageId ?? FRY_COLUMN_ID,
            activeMemberId: parsed.activeMemberId ?? config.members[0]?.id ?? "m-maya",
            hydrated: true,
          });
          return;
        }
      }
    } catch {
      /* use samples */
    }
    set({ hydrated: true });
  },

  persist: () => {
    const { tickets, config, selectedId, activeStageId, activeMemberId } = get();
    persistNow({ tickets, config, selectedId, activeStageId, activeMemberId });
  },

  select: (id) => {
    const ticket = get().tickets.find((t) => t.id === id);
    set({
      selectedId: id,
      activeStageId: ticket?.columnId ?? get().activeStageId,
    });
    get().persist();
  },

  setActiveStage: (id) => {
    set({ activeStageId: id, selectedId: null });
    get().persist();
  },

  toggleSettings: (open) => {
    set({ settingsOpen: open ?? !get().settingsOpen });
  },

  moveTicket: (id, columnId) => {
    set({
      tickets: withTicket(get().tickets, id, (t) => ({
        ...t,
        columnId,
        status: columnId === DONE_COLUMN_ID ? "done" : t.status === "done" ? "idle" : t.status,
        blockedReason: columnId === BLOCKED_COLUMN_ID ? t.blockedReason : undefined,
      })),
      activeStageId: columnId,
    });
    get().persist();
  },

  updateTicket: (id, patch) => {
    set({ tickets: withTicket(get().tickets, id, patch) });
    get().persist();
  },

  addTicket: ({ title, description, key, linkedJira, linkedRepo }) => {
    const id = uid("ticket");
    const runId = uid();
    const { tickets, config } = get();
    const keys = tickets.map((t) => t.key);
    const start = startColumnId(config.columns);
    const extra = connectorVars(linkedJira, linkedRepo);
    const ticket: Ticket = {
      id,
      key: linkedJira?.key || key?.trim() || nextKey(keys, config.jiraPrefix),
      title: title.trim(),
      description: description.trim() || linkedJira?.description || "",
      labels: config.labels[0] ? [config.labels[0]] : ["discovery"],
      columnId: start,
      flowId: config.activeFlowId,
      status: "idle",
      spend: 0,
      runId,
      slackChannel: config.defaultSlackChannel,
      slackChannelId: config.defaultSlackChannelId,
      slackMembers: "",
      ideationNotes: "",
      transcript: "",
      outputs: {},
      vars: extra,
      agentResponses: [],
      grillRounds: [],
      fryComplete: false,
      plan: null,
      jiraCreated: [],
      createdAt: new Date().toISOString(),
      linkedJira,
      linkedRepo,
    };
    set({
      tickets: [ticket, ...tickets],
      selectedId: id,
      activeStageId: start,
    });
    get().persist();
    return id;
  },

  reset: () => {
    const samples = createSampleTickets();
    set({
      tickets: samples,
      selectedId: null,
      activeStageId: FRY_COLUMN_ID,
      promptColumnId: null,
    });
    get().persist();
  },

  resetTeam: () => {
    set({
      tickets: createSampleTickets(),
      config: createDefaultTeam(),
      selectedId: null,
      activeStageId: FRY_COLUMN_ID,
      promptColumnId: null,
      settingsOpen: false,
    });
    get().persist();
  },

  openPrompt: (columnId) => set({ promptColumnId: columnId }),

  advance: (id) => {
    const t = get().tickets.find((x) => x.id === id);
    if (!t) return;
    const next = nextColumnId(t.columnId, get().config.columns);
    if (!next) return;
    get().moveTicket(id, next);
  },

  approve: (id) => get().advance(id),

  block: (id, reason) => {
    set({
      tickets: withTicket(get().tickets, id, (t) => ({
        ...t,
        columnId: BLOCKED_COLUMN_ID,
        status: "blocked",
        blockedReason: reason,
        agentResponses: [
          {
            id: uid("resp"),
            at: new Date().toISOString(),
            columnId: t.columnId,
            summary: "Moved to Blocked",
            body: reason,
            ok: false,
            error: reason,
          },
          ...t.agentResponses,
        ],
      })),
      activeStageId: BLOCKED_COLUMN_ID,
    });
    get().persist();
  },

  failTicket: (id, reason, columnId, via) => {
    const ticket = get().tickets.find((t) => t.id === id);
    const col = columnId || ticket?.columnId || "";
    set({
      tickets: withTicket(get().tickets, id, (t) => ({
        ...t,
        status: "blocked",
        blockedReason: reason,
        agentResponses: [
          {
            id: uid("resp"),
            at: new Date().toISOString(),
            columnId: col || t.columnId,
            summary: via ? `Failed · ${via}` : "Failed",
            body: reason,
            via,
            ok: false,
            error: reason,
          },
          ...t.agentResponses,
        ],
        sessionDir: undefined,
      })),
    });
    get().persist();
  },

  runColumn: async (columnId) => {
    const col = columnById(columnId, get().config.columns);
    if (!col) return;
    const ticket =
      get().tickets.find((t) => t.id === get().selectedId && t.columnId === columnId) ??
      get().tickets.find((t) => t.columnId === columnId && t.status !== "executing");
    if (!ticket) return;
    if (col.role === "review" || col.role === "approve") {
      get().approve(ticket.id);
      return;
    }
    if (col.role === "collect-input" || col.role === "terminal") return;
    await get().runTicket(ticket.id);
  },

  runTicket: async (id) => {
    const ticket = get().tickets.find((t) => t.id === id);
    if (!ticket || ticket.status === "executing") return;
    const col = columnById(ticket.columnId, get().config.columns);
    if (!col) return;

    if (col.role === "collect-input") {
      if (col.id === IDEATION_COLUMN_ID) {
        const channel = ticket.slackChannel.trim();
        const members = ticket.slackMembers.trim();
        if (!channel && !members) return;
        const output = [
          channel ? `Slack channel: #${channel.replace(/^#+/, "")}` : "",
          ticket.slackChannelId ? `Channel ID: ${ticket.slackChannelId}` : "",
          members ? `Team members: ${members}` : "",
          ticket.ideationNotes ? `Notes: ${ticket.ideationNotes}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        set({
          tickets: withTicket(get().tickets, id, (t) => ({
            ...t,
            outputs: { ...t.outputs, [IDEATION_COLUMN_ID]: output },
            vars: harvestVars({ ...t, vars: t.vars ?? {} }, col, output),
          })),
        });
        await get().continueAfter(id);
        return;
      }
      if (col.id === TRANSCRIPT_COLUMN_ID) {
        if (!ticket.transcript.trim()) return;
        set({
          tickets: withTicket(get().tickets, id, (t) => ({
            ...t,
            outputs: { ...t.outputs, [TRANSCRIPT_COLUMN_ID]: t.transcript },
            vars: harvestVars({ ...t, vars: t.vars ?? {} }, col, t.transcript),
          })),
        });
        await get().continueAfter(id);
        return;
      }
    }

    if (col.role === "review" || col.role === "approve") {
      get().approve(id);
      return;
    }

    set({ tickets: withTicket(get().tickets, id, { status: "executing" }) });

    try {
      const latest = get().tickets.find((t) => t.id === id);
      if (!latest) return;
      const liveCol = columnById(latest.columnId, get().config.columns);
      const resolved = resolveStagePrompt(liveCol, get().config.prompts, get().config.docs);
      const result = await runDiscoveryAgent({
        data: {
          ticket: latest,
          columnId: latest.columnId,
          promptTemplate: resolved.body,
          promptId: resolved.studioPromptId,
          execution: get().config.execution,
          stepAgent: liveCol?.agent,
          docs: resolved.docs,
        },
      });

      if (!result.ok) {
        get().failTicket(id, result.error, latest.columnId, result.via);
        return;
      }
      if (result.sessionDir) {
        set({
          tickets: withTicket(get().tickets, id, {
            status: "executing",
            sessionDir: result.sessionDir,
            liveLog: result.text,
          }),
        });
        get().persist();
        return;
      }
      if (result.blocked) {
        get().failTicket(id, result.blocked, latest.columnId, result.via);
        return;
      }

      const spendDelta = result.spend ?? 0;
      const response = {
        id: uid("resp"),
        at: new Date().toISOString(),
        columnId: latest.columnId,
        summary: result.via ? `${result.summary} · ${result.via}` : result.summary,
        body: result.text,
        via: result.via,
        ok: true,
        spend: spendDelta,
        usage: result.usage,
      };

      set({
        tickets: withTicket(get().tickets, id, (t) => {
          const grillRounds: GrillRound[] =
            result.grill && result.grill.questions.length > 0
              ? [
                  ...t.grillRounds,
                  {
                    id: uid("round"),
                    submitted: false,
                    questions: assignQuestions(
                      result.grill.questions.map((q) => ({
                        n: q.n,
                        question: q.question,
                        recommended: q.recommended,
                        answer: "",
                        source: q.source,
                      })),
                      get().config.members,
                    ),
                  },
                ]
              : t.grillRounds;
          const body =
            t.columnId === FRY_COLUMN_ID && !result.grill?.frontierEmpty ? "" : result.text;
          const nextVars = {
            ...(body ? harvestVars({ ...t, vars: t.vars ?? {} }, liveCol, body) : t.vars ?? {}),
          };
          if (result.plan) nextVars.plan = JSON.stringify(result.plan, null, 2);
          if (result.grill?.frontierEmpty && result.text) nextVars.grill = result.text;
          return {
            ...t,
            status: "idle",
            spend: Math.round((t.spend + spendDelta) * 100) / 100,
            runId: result.runId || t.runId,
            outputs:
              t.columnId === FRY_COLUMN_ID && !result.grill?.frontierEmpty
                ? t.outputs
                : { ...t.outputs, [t.columnId]: result.text },
            vars: nextVars,
            agentResponses: [response, ...t.agentResponses],
            grillRounds,
            fryComplete: result.grill?.frontierEmpty ? true : t.fryComplete,
            plan: result.plan ?? t.plan,
            slackPosted: result.slack ?? t.slackPosted,
            jiraCreated: result.jira ?? t.jiraCreated,
          };
        }),
      });

      const after = get().tickets.find((t) => t.id === id);
      if (!after) return;
      await get().continueAfter(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Agent failed";
      get().failTicket(id, message, get().tickets.find((t) => t.id === id)?.columnId ?? "");
    }
  },

  patchLiveLog: (id, log) => {
    const t = get().tickets.find((x) => x.id === id);
    if (!t || t.liveLog === log) return;
    set({ tickets: withTicket(get().tickets, id, { liveLog: log }) });
  },

  harvestLiveSession: async (id, result) => {
    const ticket = get().tickets.find((t) => t.id === id);
    if (!ticket) return;
    if (!result.ok) {
      get().failTicket(id, result.error || "Stage session failed", ticket.columnId, "Terminal");
      set({ tickets: withTicket(get().tickets, id, { sessionDir: undefined }) });
      get().persist();
      return;
    }
    const liveCol = columnById(ticket.columnId, get().config.columns);
    const text = result.log.trim();
    const grill = ticket.columnId === FRY_COLUMN_ID ? extractGrill(text) : undefined;
    const plan = ticket.columnId === WRITE_PLAN_COLUMN_ID ? extractPlan(text) : undefined;
    const body = ticket.columnId === FRY_COLUMN_ID && grill && !grill.frontierEmpty ? "" : text;
    const nextVars = {
      ...(body ? harvestVars({ ...ticket, vars: ticket.vars ?? {} }, liveCol, body) : ticket.vars ?? {}),
    };
    if (plan) nextVars.plan = JSON.stringify(plan, null, 2);
    if (grill?.frontierEmpty && text) nextVars.grill = text;
    set({
      tickets: withTicket(get().tickets, id, (t) => ({
        ...t,
        status: "idle",
        sessionDir: undefined,
        liveLog: text,
        outputs:
          t.columnId === FRY_COLUMN_ID && grill && !grill.frontierEmpty
            ? t.outputs
            : { ...t.outputs, [t.columnId]: text },
        vars: nextVars,
        agentResponses: [
          {
            id: uid("resp"),
            at: new Date().toISOString(),
            columnId: t.columnId,
            summary: "Long stage · Terminal",
            body: text,
            via: "Terminal",
            ok: true,
          },
          ...t.agentResponses,
        ],
        grillRounds:
          grill && grill.questions.length
            ? [
                ...t.grillRounds,
                {
                  id: uid("round"),
                  submitted: false,
                  questions: assignQuestions(
                    grill.questions.map((q) => ({
                      n: q.n,
                      question: q.question,
                      recommended: q.recommended,
                      answer: "",
                      source: q.source,
                    })),
                    get().config.members,
                  ),
                },
              ]
            : t.grillRounds,
        fryComplete: grill?.frontierEmpty ? true : t.fryComplete,
        plan: plan ?? t.plan,
      })),
    });
    get().persist();
    await get().continueAfter(id);
  },

  submitGrill: async (id, answers) => {
    const ticket = get().tickets.find((t) => t.id === id);
    if (!ticket) return;
    const last = ticket.grillRounds[ticket.grillRounds.length - 1];
    if (!last || last.submitted) return;

    const filled: GrillQuestion[] = last.questions.map((q) => ({
      ...q,
      answer: (answers[q.n] ?? q.answer ?? q.recommended).trim(),
    }));

    set({
      tickets: withTicket(get().tickets, id, (t) => ({
        ...t,
        grillRounds: t.grillRounds.map((r) =>
          r.id === last.id ? { ...r, questions: filled, submitted: true } : r,
        ),
        status: "executing",
      })),
    });

    try {
      const latest = get().tickets.find((t) => t.id === id);
      if (!latest) return;
      const liveCol = columnById(FRY_COLUMN_ID, get().config.columns);
      const resolved = resolveStagePrompt(liveCol, get().config.prompts, get().config.docs);
      const result = await runDiscoveryAgent({
        data: {
          ticket: latest,
          columnId: FRY_COLUMN_ID,
          grillSubmit: true,
          promptTemplate: resolved.body,
          promptId: resolved.studioPromptId,
          execution: get().config.execution,
          stepAgent: liveCol?.agent,
          docs: resolved.docs,
        },
      });
      if (!result.ok) {
        get().failTicket(id, result.error, FRY_COLUMN_ID, result.via);
        return;
      }
      const spendDelta = result.spend ?? 0;
      const response = {
        id: uid("resp"),
        at: new Date().toISOString(),
        columnId: FRY_COLUMN_ID,
        summary: result.via
          ? `${result.grill?.frontierEmpty ? "Fryme complete" : "Grill round"} · ${result.via}`
          : result.grill?.frontierEmpty
            ? "Fryme complete"
            : "Grill round",
        body: result.text,
        via: result.via,
        ok: true,
        spend: spendDelta,
        usage: result.usage,
      };
      set({
        tickets: withTicket(get().tickets, id, (t) => {
          const nextRounds =
            result.grill && result.grill.questions.length > 0 && !result.grill.frontierEmpty
              ? [
                  ...t.grillRounds,
                  {
                    id: uid("round"),
                    submitted: false,
                    questions: assignQuestions(
                      result.grill.questions.map((q) => ({
                        n: q.n,
                        question: q.question,
                        recommended: q.recommended,
                        answer: "",
                        source: q.source,
                      })),
                      get().config.members,
                    ),
                  },
                ]
              : t.grillRounds;
          const conclusions = result.grill?.frontierEmpty ? result.text : t.outputs[FRY_COLUMN_ID];
          const vars = { ...t.vars };
          if (conclusions) vars.grill = conclusions;
          return {
            ...t,
            status: "idle",
            spend: Math.round((t.spend + spendDelta) * 100) / 100,
            grillRounds: nextRounds,
            fryComplete: Boolean(result.grill?.frontierEmpty),
            outputs: conclusions ? { ...t.outputs, [FRY_COLUMN_ID]: conclusions } : t.outputs,
            vars,
            agentResponses: [response, ...t.agentResponses],
          };
        }),
      });
      const after = get().tickets.find((t) => t.id === id);
      if (after) await get().continueAfter(id);
      else get().persist();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Grill failed";
      get().failTicket(id, message, FRY_COLUMN_ID);
    }
  },

  patchConfig: (patch) => {
    let config = { ...get().config, ...patch };
    if (patch.autoAdvance !== undefined) {
      config = patchActiveFlow(config, { autoAdvance: patch.autoAdvance });
    }
    set({ config });
    get().persist();
  },

  updateColumn: (id, patch) => {
    const columns = get().config.columns.map((c) => (c.id === id ? { ...c, ...patch } : c));
    set({ config: writeFlowColumns(get().config, columns) });
    get().persist();
  },

  moveColumn: (id, dir) => {
    const cols = [...get().config.columns];
    const i = cols.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cols.length) return;
    if (cols[i]?.locked || cols[j]?.locked) return;
    const a = cols[i];
    const b = cols[j];
    if (!a || !b) return;
    cols[i] = b;
    cols[j] = a;
    set({ config: writeFlowColumns(get().config, cols) });
    get().persist();
  },

  addColumn: () => {
    const id = `custom-${uid("col")}`;
    const promptId = promptIdForColumn(id);
    const col: WorkflowColumn = {
      id,
      name: "New stage",
      label: "Custom",
      role: "prompt",
      rail: "run",
      enabled: true,
      custom: true,
      agent: "inherit",
      outputKey: id.replace(/[^a-zA-Z0-9]+/g, "_"),
      promptRef: promptId,
      promptTemplate:
        "Produce a concise operator-facing result for this stage.\n\nPrevious:\n{{prev}}\n\n{{context}}",
    };
    const prompt: TeamPrompt = {
      id: promptId,
      name: "Custom",
      body: col.promptTemplate || "",
      skillIds: [],
    };
    const cols = [...get().config.columns];
    const doneAt = cols.findIndex((c) => c.id === DONE_COLUMN_ID);
    cols.splice(doneAt < 0 ? cols.length : doneAt, 0, col);
    set({
      config: writeFlowColumns({ ...get().config, prompts: [...(get().config.prompts ?? []), prompt] }, cols),
    });
    get().persist();
  },

  removeColumn: (id) => {
    const col = get().config.columns.find((c) => c.id === id);
    if (!col || col.locked) return;
    const remaining = get().config.columns.filter((c) => c.id !== id);
    if (remaining.length === 0) return;
    const start = startColumnId(remaining);
    set({
      config: writeFlowColumns(get().config, remaining),
      tickets: get().tickets.map((t) => (t.columnId === id ? { ...t, columnId: start } : t)),
    });
    get().persist();
  },

  testStage: async (columnId) => {
    const col = columnById(columnId, get().config.columns);
    if (!col) return;
    const flowId = get().config.activeFlowId;
    let ticket =
      get().tickets.find((t) => t.id === get().selectedId) ??
      get().tickets.find((t) => (t.flowId || DISCOVERY_FLOW_ID) === flowId);
    if (!ticket) {
      const id = get().addTicket({
        title: `Test · ${col.name}`,
        description: "Scratch ticket so this stage can run.",
      });
      ticket = get().tickets.find((t) => t.id === id);
    }
    if (!ticket) return;
    if (ticket.columnId !== columnId) get().moveTicket(ticket.id, columnId);
    get().toggleSettings(false);
    if (col.role === "collect-input" || col.role === "terminal") return;
    if (col.role === "review" || col.role === "approve") {
      get().approve(ticket.id);
      return;
    }
    await get().runTicket(ticket.id);
  },

  addMember: (member) => {
    const id = uid("mem");
    set({
      config: {
        ...get().config,
        members: [...get().config.members, { ...member, id }],
      },
      activeMemberId: get().config.members.length === 0 ? id : get().activeMemberId,
    });
    get().persist();
  },

  updateMember: (id, patch) => {
    set({
      config: {
        ...get().config,
        members: get().config.members.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      },
    });
    get().persist();
  },

  removeMember: (id) => {
    const members = get().config.members.filter((m) => m.id !== id);
    set({
      config: { ...get().config, members },
      activeMemberId: get().activeMemberId === id ? members[0]?.id ?? "" : get().activeMemberId,
    });
    get().persist();
  },

  addLabel: (label) => {
    const value = label.trim().toLowerCase();
    if (!value || get().config.labels.includes(value)) return;
    set({ config: { ...get().config, labels: [...get().config.labels, value] } });
    get().persist();
  },

  removeLabel: (label) => {
    set({
      config: { ...get().config, labels: get().config.labels.filter((l) => l !== label) },
    });
    get().persist();
  },

  setActiveMember: (id) => {
    set({ activeMemberId: id });
    get().persist();
  },

  patchGrillQuestion: (ticketId, roundId, n, patch) => {
    const member = get().config.members.find((m) => m.id === get().activeMemberId);
    set({
      tickets: withTicket(get().tickets, ticketId, (t) => ({
        ...t,
        grillRounds: t.grillRounds.map((r) =>
          r.id !== roundId
            ? r
            : {
                ...r,
                questions: r.questions.map((q) => {
                  if (q.n !== n) return q;
                  const next = { ...q, ...patch };
                  if (patch.answer !== undefined && patch.answer.trim()) {
                    next.answeredBy = member?.name ?? q.answeredBy;
                    next.answeredAt = new Date().toISOString();
                  }
                  return next;
                }),
              },
        ),
      })),
    });
    get().persist();
  },

  upsertDoc: (doc) => {
    const docs = get().config.docs;
    const i = docs.findIndex((d) => d.id === doc.id);
    const next = i < 0 ? [...docs, doc] : docs.map((d, idx) => (idx === i ? doc : d));
    set({ config: { ...get().config, docs: next } });
    get().persist();
  },

  removeDoc: (id) => {
    set({ config: { ...get().config, docs: get().config.docs.filter((d) => d.id !== id) } });
    get().persist();
  },

  addPrompt: () => {
    const id = `prompt-${uid()}`;
    const prompt: TeamPrompt = {
      id,
      name: "New prompt",
      body: "Produce a concise operator-facing result.\n\nPrevious:\n{{prev}}\n\n{{context}}",
      skillIds: [],
    };
    set({ config: { ...get().config, prompts: [...(get().config.prompts ?? []), prompt] } });
    get().persist();
    return id;
  },

  updatePrompt: (id, patch) => {
    const prompts = (get().config.prompts ?? []).map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p));
    set({ config: { ...get().config, prompts } });
    get().persist();
  },

  removePrompt: (id) => {
    const columns = get().config.columns.map((c) => (c.promptRef === id ? { ...c, promptRef: undefined } : c));
    set({
      config: writeFlowColumns(
        { ...get().config, prompts: (get().config.prompts ?? []).filter((p) => p.id !== id) },
        columns,
      ),
    });
    get().persist();
  },

  continueAfter: async (id) => {
    const flow = activeFlow(get().config);
    const ticket = get().tickets.find((t) => t.id === id);
    if (!ticket) return;
    const col = columnById(ticket.columnId, get().config.columns);
    if (col?.id === FRY_COLUMN_ID && !ticket.fryComplete) {
      get().persist();
      return;
    }
    if (!flow.autoAdvance) {
      get().persist();
      return;
    }

    let guard = 0;
    while (guard++ < 24) {
      const current = get().tickets.find((t) => t.id === id);
      if (!current) return;
      const nextId = nextColumnId(current.columnId, get().config.columns);
      if (!nextId || nextId === current.columnId) {
        get().persist();
        return;
      }
      get().advance(id);
      const moved = get().tickets.find((t) => t.id === id);
      if (!moved) return;
      const next = columnById(moved.columnId, get().config.columns);
      if (!next || next.role === "terminal") {
        const handoff = flow.continueInFlowId;
        if (handoff && handoff !== flow.id) {
          await get().handoffTicket(id, handoff);
          return;
        }
        get().persist();
        return;
      }
      if (next.role === "review" && flow.autoRun) continue;
      if (next.role === "collect-input" || next.role === "approve") {
        get().persist();
        return;
      }
      if (flow.autoRun && (next.role === "prompt" || next.role === "plan")) {
        get().persist();
        await get().runTicket(id);
        return;
      }
      get().persist();
      return;
    }
  },

  handoffTicket: async (id, flowId) => {
    const config = get().config;
    const ticket = get().tickets.find((t) => t.id === id);
    const target = config.flows.find((f) => f.id === flowId);
    if (!ticket || !target || ticket.flowId === flowId) {
      get().persist();
      return;
    }
    const start =
      target.columns.find((c) => {
        if (!c.enabled || c.role === "terminal" || c.role === "review" || c.role === "approve") return false;
        if (c.role === "collect-input") {
          if (c.id === IDEATION_COLUMN_ID && (ticket.vars?.brief || ticket.slackChannel || ticket.slackMembers)) return false;
          if (c.id === TRANSCRIPT_COLUMN_ID && (ticket.vars?.transcript || ticket.transcript)) return false;
        }
        return true;
      })?.id ?? target.columns.find((c) => c.enabled)?.id;
    if (!start) {
      get().persist();
      return;
    }
    const nextConfig = applyActiveFlow(config, flowId);
    set({
      config: nextConfig,
      tickets: withTicket(get().tickets, id, {
        flowId,
        columnId: start,
        status: "idle",
      }),
      activeStageId: start,
      selectedId: id,
    });
    get().persist();
    const col = columnById(start, nextConfig.columns);
    if (target.autoRun && (col?.role === "prompt" || col?.role === "plan")) {
      await get().runTicket(id);
    }
  },

  setActiveFlow: (id) => {
    const config = applyActiveFlow(get().config, id);
    const start = config.columns.find((c) => c.enabled)?.id ?? config.columns[0]?.id;
    set({
      config,
      selectedId: null,
      activeStageId: start ?? get().activeStageId,
    });
    get().persist();
  },

  addFlow: () => {
    const id = `flow-${uid()}`;
    const stageId = `stage-${uid("col")}`;
    const flow: Flow = {
      id,
      name: "New flow",
      description: "",
      columns: [
        {
          id: stageId,
          name: "Stage 01",
          label: "Stage 01",
          role: "prompt",
          rail: "run",
          enabled: true,
          custom: true,
          agent: "inherit",
          outputKey: "output",
        },
      ],
      autoAdvance: false,
      autoRun: false,
    };
    const config = applyActiveFlow({ ...get().config, flows: [...get().config.flows, flow] }, id);
    set({ config, selectedId: null, activeStageId: stageId });
    get().persist();
  },

  duplicateFlow: (id) => {
    const src = get().config.flows.find((f) => f.id === (id ?? get().config.activeFlowId)) ?? activeFlow(get().config);
    const copy: Flow = {
      ...src,
      id: `flow-${uid()}`,
      name: `${src.name} copy`,
      columns: src.columns.map((c) => ({ ...c })),
    };
    const config = applyActiveFlow({ ...get().config, flows: [...get().config.flows, copy] }, copy.id);
    const start = config.columns.find((c) => c.enabled)?.id ?? config.columns[0]?.id;
    set({ config, selectedId: null, activeStageId: start ?? get().activeStageId });
    get().persist();
  },

  removeFlow: (id) => {
    const { config } = get();
    if (config.flows.length <= 1) return;
    const flows = config.flows.filter((f) => f.id !== id);
    const nextId = config.activeFlowId === id ? flows[0]!.id : config.activeFlowId;
    const next = applyActiveFlow({ ...config, flows }, nextId);
    const start = next.columns.find((c) => c.enabled)?.id ?? next.columns[0]?.id;
    set({
      config: next,
      tickets: get().tickets.filter((t) => t.flowId !== id),
      selectedId: null,
      activeStageId: start ?? get().activeStageId,
    });
    get().persist();
  },

  patchFlow: (patch) => {
    set({ config: patchActiveFlow(get().config, patch) });
    get().persist();
  },

  attachJira: (id, issue) => {
    set({
      tickets: withTicket(get().tickets, id, (t) => ({
        ...t,
        key: issue.key || t.key,
        title: t.title || issue.title,
        description: t.description || issue.description,
        linkedJira: issue,
        vars: { ...t.vars, ...connectorVars(issue, t.linkedRepo) },
      })),
    });
    get().persist();
  },

  attachRepo: (id, repo) => {
    set({
      tickets: withTicket(get().tickets, id, (t) => ({
        ...t,
        linkedRepo: repo,
        vars: { ...t.vars, ...connectorVars(t.linkedJira, repo) },
      })),
    });
    get().persist();
  },

  setCatalog: (patch) => {
    const connectors = get().config.connectors ?? mergeConnectors();
    set({
      config: {
        ...get().config,
        connectors: {
          ...connectors,
          issues: patch.issues ?? connectors.issues,
          repos: patch.repos ?? connectors.repos,
        },
      },
    });
    get().persist();
  },
}));
