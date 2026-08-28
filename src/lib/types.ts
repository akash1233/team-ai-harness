export type TicketStatus = "idle" | "executing" | "blocked" | "done";

export type ColumnRole =
  | "collect-input"
  | "prompt"
  | "review"
  | "plan"
  | "approve"
  | "terminal";

export type RailTone = "run" | "review" | "gate" | "idle" | "blocked";

export type ThemeId = "paper" | "ink";
export type DensityId = "comfortable" | "compact";
export type PipelineLayout = "vertical" | "horizontal";

export type AgentRates = {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
};

export type PricingConfig = {
  charsPerToken: number;
  claude: AgentRates;
  cursor: AgentRates;
  studio: AgentRates;
  cis: AgentRates;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
};

export type ExecutionProvider = "local" | "studio" | "cis";
export type LocalAgent = "cursor" | "claude";
export type AgentKind = "cursor" | "claude" | "studio" | "cis";
export type AgentTarget = "local" | "remote";
export type StepAgent = "inherit" | AgentKind;

export type ExecutionConfig = {
  defaultAgent: AgentKind;
  cursorTarget: AgentTarget;
  claudeTarget: AgentTarget;
  cursorCommand: string;
  claudeCommand: string;
  localHttpUrl: string;
  cursorRemoteUrl: string;
  claudeRemoteUrl: string;
  studioBaseUrl: string;
  featureKey: string;
  promptId: string;
  cisProvider: string;
  cisModel: string;
  cisTaskType: string;
  timeoutMs: number;
  demoFallbacks: boolean;
  pricing: PricingConfig;
  /** Cheapest model used by Test run (Claude `--model`). */
  claudeTestModel?: string;
  /** Cheapest model used by Test run (Cursor `--model`). */
  cursorTestModel?: string;
  /** Project dir the CLI runs in (workspace trust). Empty = process cwd. */
  workspaceDir?: string;
  /** Extra print-mode flags. Cursor default: --trust -f */
  cursorExtraArgs?: string;
  /** Extra print-mode flags. Claude default: --permission-mode dontAsk */
  claudeExtraArgs?: string;
  /** Mac: open Terminal.app in the background so you can watch the session. */
  runInTerminal?: boolean;
  /**
   * Full agent / auto (yolo, dontAsk, -f). Workday blocks this outside a
   * dev container — leave off. Print/ask only.
   */
  fullAgentMode?: boolean;
  /** @deprecated hydrated from older workspaces */
  provider?: ExecutionProvider;
  /** @deprecated hydrated from older workspaces */
  localAgent?: LocalAgent;
};

export type AgentResponse = {
  id: string;
  at: string;
  columnId: string;
  summary: string;
  body: string;
  via?: string;
  ok?: boolean;
  error?: string;
  spend?: number;
  usage?: TokenUsage;
};

export type GrillQuestion = {
  n: number;
  question: string;
  recommended: string;
  answer: string;
  source?: string;
  assigneeId?: string;
  answeredBy?: string;
  answeredAt?: string;
};

export type GrillRound = {
  id: string;
  questions: GrillQuestion[];
  submitted: boolean;
};

export type PlanStep = {
  title: string;
  detail: string;
  references: string[];
  createdKey?: string;
};

export type Plan = {
  summary: string;
  findings: string[];
  scope: string[];
  outOfScope: string[];
  risks: string[];
  steps: PlanStep[];
};

export type SlackPost = {
  channel: string;
  channelId: string;
  ts: string;
};

export type JiraIssue = {
  key: string;
  title: string;
  kind: "epic" | "story";
};

export type WorkflowColumn = {
  id: string;
  name: string;
  label: string;
  role: ColumnRole;
  rail: RailTone;
  promptTemplate?: string;
  promptId?: string;
  agent?: StepAgent;
  /** Variable name this stage publishes, e.g. spec — usable later as {{spec}}. */
  outputKey?: string;
  /** Library prompt this stage runs. */
  promptRef?: string;
  enabled: boolean;
  locked?: boolean;
  custom?: boolean;
};

export type Flow = {
  id: string;
  name: string;
  description: string;
  columns: WorkflowColumn[];
  /** Move the ticket to the next stage after a successful run. */
  autoAdvance: boolean;
  /** Keep running agent stages, skipping review gates, until a human gate. */
  autoRun: boolean;
  /** When this flow hits Done, continue the ticket on another flow (vars travel). */
  continueInFlowId?: string;
};

export type TeamPrompt = {
  id: string;
  name: string;
  body: string;
  studioPromptId?: string;
  /** Skills from the library pasted into this prompt on run. */
  skillIds: string[];
};

export type TeamDoc = {
  id: string;
  title: string;
  kind: "skill" | "notes" | "spec";
  body: string;
};

export type TeamMember = {
  id: string;
  name: string;
  handle: string;
  role: string;
};

export type TeamConfig = {
  name: string;
  workflowName: string;
  jiraPrefix: string;
  defaultSlackChannel: string;
  defaultSlackChannelId: string;
  members: TeamMember[];
  labels: string[];
  columns: WorkflowColumn[];
  flows: Flow[];
  activeFlowId: string;
  docs: TeamDoc[];
  prompts: TeamPrompt[];
  theme: ThemeId;
  density: DensityId;
  pipelineLayout: PipelineLayout;
  showSpend: boolean;
  autoAdvance: boolean;
  execution: ExecutionConfig;
};

export type Ticket = {
  id: string;
  key: string;
  title: string;
  description: string;
  labels: string[];
  columnId: string;
  flowId: string;
  status: TicketStatus;
  blockedReason?: string;
  spend: number;
  runId: string;
  ownerId?: string;
  slackChannel: string;
  slackChannelId: string;
  slackMembers: string;
  slackPosted?: SlackPost;
  ideationNotes: string;
  transcript: string;
  outputs: Record<string, string>;
  /** Named values published by completed stages. Prompts read these as {{name}}. */
  vars: Record<string, string>;
  agentResponses: AgentResponse[];
  grillRounds: GrillRound[];
  fryComplete: boolean;
  plan: Plan | null;
  jiraCreated: JiraIssue[];
  createdAt: string;
};
