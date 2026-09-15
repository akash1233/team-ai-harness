import { getFlowStage, flowStageMentionedKeys } from "./flow-spec.ts";
import { buildContext, mentionedKeys, type TeamContextDefaults } from "./flow-context.ts";
import type { Plan, Ticket, WorkflowColumn } from "./types.ts";

const SKIP_TEST_KEYS = new Set(["frymePhase", "grillPhase", "docs"]);

export function isStageTestable(column?: Pick<WorkflowColumn, "role"> | null): boolean {
  if (!column) return false;
  return column.role !== "terminal";
}

/** Tokens this stage interpolates — those are the values a stage test can seed or override. */
export function stageTestInputKeys(column: WorkflowColumn | undefined): string[] {
  if (!column) return [];
  const fromJson = flowStageMentionedKeys(getFlowStage(column.id)).filter((key) => !SKIP_TEST_KEYS.has(key));
  if (fromJson.length) return fromJson;
  const fromTemplate = mentionedKeys(column.promptTemplate).filter((key) => !SKIP_TEST_KEYS.has(key));
  if (fromTemplate.length) return fromTemplate;
  return column.role === "collect-input" ? [] : ["prev"];
}

export function isLongStageTestKey(key: string): boolean {
  return /transcript|spec|plan|agenda|brief|fryme|grill|slackMessage|jira$|prev|context|input/i.test(key);
}

/** Last-stage values for the tokens this stage reads. Test overrides live on ticket.stageTestVars. */
export function seedStageTestValues(
  ticket: Ticket,
  keys: string[],
  team?: TeamContextDefaults,
): Record<string, string> {
  const ctx = buildContext({ ...ticket, stageTestVars: undefined }, undefined, team);
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = ctx[key] ?? "";
  return out;
}

/**
 * Copy test overrides onto the ticket so File Jira / Notify / transcript
 * gates that read fields (not only {{vars}}) see the same values.
 */
export function applyStageTestVars(ticket: Ticket, values: Record<string, string>): Ticket {
  const vars = { ...ticket.vars };
  for (const [key, value] of Object.entries(values)) vars[key] = value;
  const next: Ticket = { ...ticket, vars, stageTestVars: { ...values } };

  if (values.transcript !== undefined) next.transcript = values.transcript;
  if (values.slackChannel !== undefined) {
    next.slackChannel = values.slackChannel.replace(/^#+/, "").trim();
    vars.slackChannel = next.slackChannel;
  }
  if (values["slack.channel"] !== undefined && values.slackChannel === undefined) {
    next.slackChannel = values["slack.channel"].replace(/^#+/, "").trim();
    vars.slackChannel = next.slackChannel;
  }
  if (values.slackChannelId !== undefined) {
    next.slackChannelId = values.slackChannelId.trim();
    vars.slackChannelId = next.slackChannelId;
  }
  if (values.plan !== undefined) {
    const parsed = parsePlanJson(values.plan);
    if (parsed?.steps.length) next.plan = parsed;
  }
  next.vars = vars;
  return next;
}

function parsePlanJson(text: string): Plan | undefined {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence?.[1]?.trim() ?? (trimmed.startsWith("{") ? trimmed : "");
  if (!candidate) return undefined;
  try {
    const parsed = JSON.parse(candidate) as Plan;
    if (parsed && Array.isArray(parsed.steps)) return parsed;
  } catch {
    return undefined;
  }
  return undefined;
}
