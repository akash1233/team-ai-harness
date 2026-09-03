import type { AgentKind, AgentRates, PricingConfig, TokenUsage } from "./types";

/** Anthropic list prices (Aug 2026): Sonnet 5 $2/$10, Haiku 4.5 $1/$5 per million tokens. */
const WEBLLM_RATES: AgentRates = { inputUsdPerMTok: 0, outputUsdPerMTok: 0 };

export const DEFAULT_PRICING: PricingConfig = {
  charsPerToken: 4,
  claude: { inputUsdPerMTok: 2, outputUsdPerMTok: 10 },
  cursor: { inputUsdPerMTok: 2, outputUsdPerMTok: 10 },
  studio: { inputUsdPerMTok: 2, outputUsdPerMTok: 10 },
  cis: { inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
  webllm: { ...WEBLLM_RATES },
};

export function mergePricing(saved?: Partial<PricingConfig> | null): PricingConfig {
  const d = DEFAULT_PRICING;
  if (!saved) {
    return {
      ...d,
      claude: { ...d.claude },
      cursor: { ...d.cursor },
      studio: { ...d.studio },
      cis: { ...d.cis },
      webllm: { ...WEBLLM_RATES },
    };
  }
  return {
    charsPerToken: Number(saved.charsPerToken) > 0 ? Number(saved.charsPerToken) : d.charsPerToken,
    claude: mergeRates(d.claude, saved.claude),
    cursor: mergeRates(d.cursor, saved.cursor),
    studio: mergeRates(d.studio, saved.studio),
    cis: mergeRates(d.cis, saved.cis),
    webllm: mergeRates(WEBLLM_RATES, saved.webllm),
  };
}

function mergeRates(base: AgentRates, patch?: Partial<AgentRates>): AgentRates {
  return {
    inputUsdPerMTok: numOr(patch?.inputUsdPerMTok, base.inputUsdPerMTok),
    outputUsdPerMTok: numOr(patch?.outputUsdPerMTok, base.outputUsdPerMTok),
  };
}

function numOr(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function ratesFor(kind: AgentKind, pricing: PricingConfig): AgentRates {
  if (kind === "claude") return pricing.claude;
  if (kind === "studio") return pricing.studio;
  if (kind === "cis") return pricing.cis;
  if (kind === "webllm") return pricing.webllm ?? WEBLLM_RATES;
  return pricing.cursor;
}

export function estimateTokens(text: string, charsPerToken = 4): number {
  const n = Math.max(0, text.length);
  const d = charsPerToken > 0 ? charsPerToken : 4;
  return Math.ceil(n / d);
}

export function computeSpend(usage: TokenUsage, rates: AgentRates): number {
  const usd =
    (usage.inputTokens * rates.inputUsdPerMTok + usage.outputTokens * rates.outputUsdPerMTok) / 1_000_000;
  return Math.round(usd * 10000) / 10000;
}

export function extractUsage(body: unknown): TokenUsage | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as Record<string, unknown>;
  const parsed = parseUsage(rec.usage) ?? parseUsage(rec.token_usage) ?? parseUsage(rec.tokenUsage) ?? parseUsage(rec);
  if (parsed) return { ...parsed, estimated: false };
  for (const nested of [rec.data, rec.body, rec.payload, rec.result, rec.prediction]) {
    if (nested && nested !== body) {
      const hit = extractUsage(nested);
      if (hit) return hit;
    }
  }
  return null;
}

function parseUsage(value: unknown): { inputTokens: number; outputTokens: number } | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const input = asCount(r.input_tokens ?? r.prompt_tokens ?? r.inputTokens ?? r.promptTokens);
  const output = asCount(r.output_tokens ?? r.completion_tokens ?? r.outputTokens ?? r.completionTokens);
  if (input == null && output == null) return null;
  return { inputTokens: input ?? 0, outputTokens: output ?? 0 };
}

function asCount(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

export function usageFromText(input: string, output: string, charsPerToken = 4): TokenUsage {
  return {
    inputTokens: estimateTokens(input, charsPerToken),
    outputTokens: estimateTokens(output, charsPerToken),
    estimated: true,
  };
}
