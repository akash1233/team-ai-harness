import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeSpend,
  DEFAULT_PRICING,
  estimateTokens,
  extractUsage,
  ratesFor,
} from "./pricing.ts";

test("Haiku 4.5 rates: 1k in / 2k out is one cent", () => {
  const spend = computeSpend(
    { inputTokens: 1000, outputTokens: 2000, estimated: false },
    DEFAULT_PRICING.cis,
  );
  assert.equal(spend, 0.011);
});

test("Sonnet 5 Claude rates: 100k in / 20k out", () => {
  const spend = computeSpend(
    { inputTokens: 100_000, outputTokens: 20_000, estimated: false },
    ratesFor("claude", DEFAULT_PRICING),
  );
  assert.equal(spend, 0.4);
});

test("estimateTokens uses charsPerToken", () => {
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcdefgh", 4), 2);
});

test("extractUsage reads Anthropic, OpenAI, and Bedrock shapes", () => {
  assert.deepEqual(extractUsage({ usage: { input_tokens: 10, output_tokens: 4 } }), {
    inputTokens: 10,
    outputTokens: 4,
    estimated: false,
  });
  assert.deepEqual(extractUsage({ usage: { prompt_tokens: 8, completion_tokens: 2 } }), {
    inputTokens: 8,
    outputTokens: 2,
    estimated: false,
  });
  assert.deepEqual(extractUsage({ data: { usage: { inputTokens: 3, outputTokens: 7 } } }), {
    inputTokens: 3,
    outputTokens: 7,
    estimated: false,
  });
});
