import { create } from "zustand";
import type { GrillQuestion, GrillRound, TeamConfig, TeamDoc, TeamMember, Ticket, WorkflowColumn } from "./types";
import {
  BLOCKED_COLUMN_ID,
  DONE_COLUMN_ID,
  FRY_COLUMN_ID,
  IDEATION_COLUMN_ID,
  nextColumnId,
  TRANSCRIPT_COLUMN_ID,
  WRITE_PLAN_COLUMN_ID,
  columnById,
} from "./columns";
import { createSampleTickets, STORAGE_KEY } from "./sample-data";
import { createDefaultTeam, mergeTeamConfig } from "./team-config";
import { assignQuestions } from "./grill";
import { nextKey, uid } from "./format";
import { runDiscoveryAgent } from "./discovery-agent";

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
  addTicket: (input: { title: string; description: string; key?: string }) => string;
  reset: () => void;
  resetTeam: () => void;
  openPrompt: (columnId: string | null) => void;
  advance: (id: string) => void;
  approve: (id: string) => void;
  block: (id: string, reason: string) => void;
  runColumn: (columnId: string) => Promise<void>;
  runTicket: (id: string) => Promise<void>;
  submitGrill: (id: string, answers: Record<number, string>) => Promise<void>;
  patchGrillQuestion: (ticketId: string, roundId: string, n: number, patch: Partial<GrillQuestion>) => void;
  setActiveMember: (id: string) => void;
  upsertDoc: (doc: TeamDoc) => void;
  removeDoc: (id: string) => void;
  patchConfig: (patch: Partial<TeamConfig>) => void;
  updateColumn: (id: string, patch: Partial<WorkflowColumn>) => void;
  moveColumn: (id: string, dir: -1 | 1) => void;
  addColumn: () => void;
  removeColumn: (id: string) => void;
  addMember: (member: Omit<TeamMember, "id">) => void;
  removeMember: (id: string) => void;
  addLabel: (label: string) => void;
  removeLabel: (label: string) => void;
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
            tickets: parsed.tickets,
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

  addTicket: ({ title, description, key }) => {
    const id = uid("ticket");
    const runId = uid();
    const { tickets, config } = get();
    const keys = tickets.map((t) => t.key);
    const start =
      config.columns.find((c) => c.enabled && c.role === "collect-input")?.id ?? IDEATION_COLUMN_ID;
    const ticket: Ticket = {
      id,
      key: key?.trim() || nextKey(keys, config.jiraPrefix),
      title: title.trim(),
      description: description.trim(),
      labels: config.labels[0] ? [config.labels[0]] : ["discovery"],
      columnId: start,
      status: "idle",
      spend: 0,
      runId,
      slackChannel: config.defaultSlackChannel,
      slackChannelId: config.defaultSlackChannelId,
      slackMembers: "",
      ideationNotes: "",
      transcript: "",
      outputs: {},
      agentResponses: [],
      grillRounds: [],
      fryComplete: false,
      plan: null,
      jiraCreated: [],
      createdAt: new Date().toISOString(),
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
      tickets: withTicket(get().tickets, id, {
        columnId: BLOCKED_COLUMN_ID,
        status: "blocked",
        blockedReason: reason,
      }),
      activeStageId: BLOCKED_COLUMN_ID,
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
          })),
        });
        get().advance(id);
        return;
      }
      if (col.id === TRANSCRIPT_COLUMN_ID) {
        if (!ticket.transcript.trim()) return;
        set({
          tickets: withTicket(get().tickets, id, (t) => ({
            ...t,
            outputs: { ...t.outputs, [TRANSCRIPT_COLUMN_ID]: t.transcript },
          })),
        });
        get().advance(id);
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
      const result = await runDiscoveryAgent({
        data: {
          ticket: latest,
          columnId: latest.columnId,
          promptTemplate: liveCol?.promptTemplate,
          promptId: liveCol?.promptId,
          execution: get().config.execution,
          stepAgent: liveCol?.agent,
          docs: get().config.docs,
        },
      });

      if (!result.ok) {
        get().block(id, result.error);
        return;
      }
      if (result.blocked) {
        get().block(id, result.blocked);
        return;
      }

      const spendDelta = result.spend ?? 0.08;
      const response = {
        id: uid("resp"),
        at: new Date().toISOString(),
        columnId: latest.columnId,
        summary: result.via ? `${result.summary} · ${result.via}` : result.summary,
        body: result.text,
        via: result.via,
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
          return {
            ...t,
            status: "idle",
            spend: Math.round((t.spend + spendDelta) * 100) / 100,
            runId: result.runId || t.runId,
            outputs:
              t.columnId === FRY_COLUMN_ID && !result.grill?.frontierEmpty
                ? t.outputs
                : { ...t.outputs, [t.columnId]: result.text },
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

      if (after.columnId === FRY_COLUMN_ID) {
        if (after.fryComplete && get().config.autoAdvance) get().advance(id);
        get().persist();
        return;
      }
      if (!get().config.autoAdvance) {
        get().persist();
        return;
      }
      if (after.columnId === WRITE_PLAN_COLUMN_ID && after.plan) {
        get().advance(id);
        return;
      }
      get().advance(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Agent failed";
      get().block(id, message);
    }
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
      const result = await runDiscoveryAgent({
        data: {
          ticket: latest,
          columnId: FRY_COLUMN_ID,
          grillSubmit: true,
          promptTemplate: liveCol?.promptTemplate,
          promptId: liveCol?.promptId,
          execution: get().config.execution,
          stepAgent: liveCol?.agent,
          docs: get().config.docs,
        },
      });
      if (!result.ok) {
        get().block(id, result.error);
        return;
      }
      const spendDelta = result.spend ?? 0.06;
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
          return {
            ...t,
            status: "idle",
            spend: Math.round((t.spend + spendDelta) * 100) / 100,
            grillRounds: nextRounds,
            fryComplete: Boolean(result.grill?.frontierEmpty),
            outputs: conclusions ? { ...t.outputs, [FRY_COLUMN_ID]: conclusions } : t.outputs,
            agentResponses: [response, ...t.agentResponses],
          };
        }),
      });
      const after = get().tickets.find((t) => t.id === id);
      if (after?.fryComplete && get().config.autoAdvance) get().advance(id);
      else get().persist();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Grill failed";
      get().block(id, message);
    }
  },

  patchConfig: (patch) => {
    set({ config: { ...get().config, ...patch } });
    get().persist();
  },

  updateColumn: (id, patch) => {
    set({
      config: {
        ...get().config,
        columns: get().config.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      },
    });
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
    set({ config: { ...get().config, columns: cols } });
    get().persist();
  },

  addColumn: () => {
    const id = `custom-${uid("col")}`;
    const col: WorkflowColumn = {
      id,
      name: "New stage",
      label: "Custom",
      role: "prompt",
      rail: "run",
      enabled: true,
      custom: true,
      agent: "inherit",
      promptTemplate: "Produce a concise operator-facing result for this stage.",
    };
    const cols = [...get().config.columns];
    const doneAt = cols.findIndex((c) => c.id === DONE_COLUMN_ID);
    cols.splice(doneAt < 0 ? cols.length : doneAt, 0, col);
    set({ config: { ...get().config, columns: cols } });
    get().persist();
  },

  removeColumn: (id) => {
    const col = get().config.columns.find((c) => c.id === id);
    if (!col || col.locked) return;
    set({
      config: { ...get().config, columns: get().config.columns.filter((c) => c.id !== id) },
    });
    get().persist();
  },

  addMember: (member) => {
    set({
      config: {
        ...get().config,
        members: [...get().config.members, { ...member, id: uid("mem") }],
      },
    });
    get().persist();
  },

  removeMember: (id) => {
    set({
      config: { ...get().config, members: get().config.members.filter((m) => m.id !== id) },
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
}));
