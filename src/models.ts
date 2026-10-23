import type { ModelApi, ModelDefinitionConfig } from "openclaw/plugin-sdk/provider-model-shared";

/** OpenAI-compatible root (Chat Completions at /chat/completions, Responses at /responses). */
export const DOTHOOSH_BASE_URL = "https://gateway.dothoosh.com/v1";
/**
 * Anthropic Messages root. The Anthropic transport appends `/v1/messages`, which the gateway
 * serves at https://gateway.dothoosh.com/anthropic/v1/messages (`x-api-key` auth only).
 */
export const DOTHOOSH_ANTHROPIC_BASE_URL = "https://gateway.dothoosh.com/anthropic";
export const DOTHOOSH_PROVIDER_API = "openai-completions" satisfies ModelApi;
export const DOTHOOSH_DEFAULT_MODEL_ID = "deepseek-v4-pro";
export const DOTHOOSH_DEFAULT_MODEL_REF = `dothoosh/${DOTHOOSH_DEFAULT_MODEL_ID}`;

type DotHooshRates = { input: number; output: number; cacheRead: number; cacheWrite: number };

/**
 * Long prompts are billed at the vendor's long-context tier, applied to the whole request.
 * `range` is a half-open prompt-token interval (uncached input plus cache reads and writes).
 */
type DotHooshCost = DotHooshRates & {
  tieredPricing?: Array<DotHooshRates & { range: [number, number] | [number] }>;
};

type DotHooshApi = "openai-completions" | "openai-responses" | "anthropic-messages";

type DotHooshCatalogEntry = {
  id: string;
  name: string;
  api: DotHooshApi;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  /** USD per million tokens, before DotHoosh's Toman conversion (checked 2026-10-19). */
  cost: DotHooshCost;
};

/** Adds the vendor's whole-request long-context tier: prompts of `fromTokens` or more use `long`. */
function withLongContextTier(base: DotHooshRates, fromTokens: number, long: DotHooshRates): DotHooshCost {
  return {
    ...base,
    tieredPricing: [
      { range: [0, fromTokens], ...base },
      { range: [fromTokens], ...long },
    ],
  };
}

// DotHoosh serves text input only, on every route.
// Claude models are served only through the Anthropic Messages route. GPT-6 models admit
// function tools only through the Responses route, so they use `openai-responses`.
export const DOTHOOSH_MODEL_CATALOG: readonly DotHooshCatalogEntry[] = [
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    api: "openai-completions",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    cost: { input: 1.694, output: 5.082, cacheRead: 0.0565, cacheWrite: 0 },
  },
  {
    id: "deepseek-flash",
    name: "DeepSeek V4.1 Flash",
    api: "openai-completions",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    cost: { input: 0.385, output: 1.54, cacheRead: 0.0077, cacheWrite: 0 },
  },
  {
    id: "kimi-k3",
    name: "Kimi K3",
    api: "openai-completions",
    reasoning: true,
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    cost: { input: 3.85, output: 19.25, cacheRead: 0.385, cacheWrite: 0 },
  },
  {
    id: "kimi-k2.7-code",
    name: "Kimi K2.7 Code",
    api: "openai-completions",
    reasoning: true,
    contextWindow: 262_144,
    maxTokens: 262_144,
    cost: { input: 1.2192, output: 5.1333, cacheRead: 0.2438, cacheWrite: 0 },
  },
  {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    api: "openai-completions",
    reasoning: true,
    contextWindow: 262_144,
    maxTokens: 262_144,
    cost: { input: 1.2192, output: 5.1333, cacheRead: 0.2053, cacheWrite: 0 },
  },
  {
    id: "gemini-4-argon",
    name: "Gemini 4 Argon",
    api: "openai-completions",
    reasoning: true,
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    cost: { input: 2.5667, output: 12.8333, cacheRead: 0.1283, cacheWrite: 0 },
  },
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    api: "openai-completions",
    reasoning: true,
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    cost: { input: 0.9625, output: 4.8125, cacheRead: 0.0963, cacheWrite: 0 },
  },
  {
    id: "gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash Lite",
    api: "openai-completions",
    reasoning: true,
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    cost: { input: 0.385, output: 3.2083, cacheRead: 0.0385, cacheWrite: 0 },
  },
  {
    id: "gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    api: "openai-responses",
    reasoning: true,
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    cost: withLongContextTier(
      { input: 2.5667, output: 12.8333, cacheRead: 0.1283, cacheWrite: 3.2083 },
      272_001,
      { input: 5.1333, output: 19.25, cacheRead: 0.2567, cacheWrite: 6.4167 },
    ),
  },
  {
    id: "gpt-6-astra",
    name: "GPT-6 Astra",
    api: "openai-responses",
    reasoning: true,
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    cost: withLongContextTier(
      { input: 12.8333, output: 64.1667, cacheRead: 1.2833, cacheWrite: 16.0417 },
      272_001,
      { input: 25.6667, output: 96.25, cacheRead: 2.5667, cacheWrite: 32.0833 },
    ),
  },
  {
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    api: "openai-responses",
    reasoning: true,
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    cost: withLongContextTier(
      { input: 0.1283, output: 0.6417, cacheRead: 0.0128, cacheWrite: 0.1604 },
      272_001,
      { input: 0.2567, output: 0.9625, cacheRead: 0.0257, cacheWrite: 0.3208 },
    ),
  },
  {
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    api: "anthropic-messages",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    cost: { input: 5.1333, output: 25.6667, cacheRead: 0.2567, cacheWrite: 6.4167 },
  },
  {
    id: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    api: "anthropic-messages",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    cost: { input: 2.5667, output: 12.8333, cacheRead: 0.1283, cacheWrite: 3.2083 },
  },
  {
    id: "claude-haiku-5-5",
    name: "Claude Haiku 5.5",
    api: "anthropic-messages",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    cost: withLongContextTier(
      { input: 0.1283, output: 0.6417, cacheRead: 0.0128, cacheWrite: 0.1604 },
      100_001,
      { input: 0.6417, output: 3.2083, cacheRead: 0.0642, cacheWrite: 0.8021 },
    ),
  },
  {
    id: "claude-fable-5-1",
    name: "Claude Fable 5.1",
    api: "anthropic-messages",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    cost: { input: 12.8333, output: 64.1667, cacheRead: 0.3208, cacheWrite: 16.0417 },
  },
];

export function buildDotHooshModelDefinition(entry: DotHooshCatalogEntry): ModelDefinitionConfig {
  const base = {
    id: entry.id,
    name: entry.name,
    reasoning: entry.reasoning,
    input: ["text" as const],
    cost: {
      ...entry.cost,
      ...(entry.cost.tieredPricing && {
        tieredPricing: entry.cost.tieredPricing.map((tier) => ({ ...tier })),
      }),
    },
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxTokens,
  };
  switch (entry.api) {
    case "anthropic-messages":
      return { ...base, api: entry.api, baseUrl: DOTHOOSH_ANTHROPIC_BASE_URL };
    case "openai-responses":
      // The gateway admits `store` only as false on Responses.
      return { ...base, api: entry.api, compat: { supportsStore: false } };
    case "openai-completions":
      return { ...base, compat: { supportsStore: false, supportsDeveloperRole: false } };
  }
}

export function buildDotHooshModelCatalog(): ModelDefinitionConfig[] {
  return DOTHOOSH_MODEL_CATALOG.map(buildDotHooshModelDefinition);
}
