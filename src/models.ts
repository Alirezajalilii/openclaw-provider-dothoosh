import { normalizeOpenRouterModelPricing } from "openclaw/plugin-sdk/model-catalog-pricing";
import type { ModelApi, ModelDefinitionConfig } from "openclaw/plugin-sdk/provider-model-shared";
import {
  asOptionalRecord,
  asPositiveSafeInteger,
  filterStringEntries,
  normalizeOptionalString,
} from "openclaw/plugin-sdk/string-coerce-runtime";

/** OpenAI-compatible root (Chat Completions at /chat/completions, Responses at /responses). */
export const DOTHOOSH_BASE_URL = "https://gateway.dothoosh.com/v1";
/**
 * Anthropic Messages root beside an OpenAI root: `<origin>/anthropic`. The Anthropic transport
 * appends `/v1/messages`, which the gateway serves at
 * https://gateway.dothoosh.com/anthropic/v1/messages (`x-api-key` auth only).
 */
export function resolveDotHooshAnthropicBaseUrl(baseUrl: string = DOTHOOSH_BASE_URL): string {
  return `${baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "")}/anthropic`;
}
export const DOTHOOSH_ANTHROPIC_BASE_URL = resolveDotHooshAnthropicBaseUrl();
export const DOTHOOSH_PROVIDER_API = "openai-completions" satisfies ModelApi;
export const DOTHOOSH_DEFAULT_MODEL_ID = "deepseek-v4-pro";
export const DOTHOOSH_DEFAULT_MODEL_REF = `dothoosh/${DOTHOOSH_DEFAULT_MODEL_ID}`;

// Used only when a listing row omits its context window, and for the single offline seed row.
// A row that omits its output cap is bounded by its context window, the only limit the gateway
// states for it; no output cap is invented.
const DOTHOOSH_FALLBACK_CONTEXT_WINDOW = 200_000;

/** Which gateway listing a row came from; the Anthropic listing only holds Claude-route models. */
export type DotHooshRoute = "openai" | "anthropic";

function zeroCost() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function readModalities(
  architecture: Record<string, unknown> | undefined,
  direction: "input" | "output",
): string[] {
  const explicit = filterStringEntries(architecture?.[`${direction}_modalities`]);
  if (explicit.length > 0) {
    return explicit;
  }
  const modality = normalizeOptionalString(architecture?.modality);
  if (!modality) {
    return [];
  }
  const [input = "", output = ""] = modality.split("->", 2);
  return (direction === "input" ? input : output).split("+").filter(Boolean);
}

function readProtocols(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const protocol = normalizeOptionalString(
      typeof entry === "string" ? entry : asOptionalRecord(entry)?.protocol,
    );
    return protocol ? [protocol] : [];
  });
}

const TOKEN_PRICE_KEYS = ["prompt", "completion", "input_cache_read", "input_cache_write"] as const;

/** Per-million rates carry at most 6 decimals (per-token strings have 12), so rounding is exact. */
function roundRate(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function roundCost(cost: ModelDefinitionConfig["cost"]): ModelDefinitionConfig["cost"] {
  const rounded = {
    input: roundRate(cost.input),
    output: roundRate(cost.output),
    cacheRead: roundRate(cost.cacheRead),
    cacheWrite: roundRate(cost.cacheWrite),
  };
  return cost.tieredPricing
    ? {
        ...rounded,
        tieredPricing: cost.tieredPricing.map((tier) => ({
          ...tier,
          input: roundRate(tier.input),
          output: roundRate(tier.output),
          cacheRead: roundRate(tier.cacheRead),
          cacheWrite: roundRate(tier.cacheWrite),
        })),
      }
    : rounded;
}

/**
 * Per-token decimal-string prices (OpenRouter convention) become per-million rates. The
 * gateway's `pricing_tiers` carry the same keys plus `above_input_tokens`, which is the
 * prompt-length override shape `normalizeOpenRouterModelPricing` already understands. A tier
 * applies to the whole request once input tokens strictly exceed its threshold. Each tier is
 * expanded from the BASE price (not from the tier below) before normalizing; a tier that omits
 * the cache-write price bills it at that tier's own input price.
 */
function readCost(row: Record<string, unknown>): ModelDefinitionConfig["cost"] {
  const pricing = asOptionalRecord(row.pricing);
  if (!pricing) {
    return zeroCost();
  }
  const base = Object.fromEntries(TOKEN_PRICE_KEYS.map((key) => [key, pricing[key]]));
  const overrides = (Array.isArray(row.pricing_tiers) ? row.pricing_tiers : []).flatMap((raw) => {
    const { above_input_tokens: threshold, ...tierPrices } = asOptionalRecord(raw) ?? {};
    if (threshold === undefined) {
      return [];
    }
    const own = Object.fromEntries(TOKEN_PRICE_KEYS.map((key) => [key, tierPrices[key]]));
    const expanded: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(own)) {
      if (value !== undefined) {
        expanded[key] = value;
      }
    }
    if (own.input_cache_write === undefined && base.input_cache_write !== undefined) {
      expanded.input_cache_write = expanded.prompt;
    }
    return [{ min_prompt_tokens: threshold, ...expanded }];
  });
  const cost = normalizeOpenRouterModelPricing({ ...pricing, overrides });
  return cost ? roundCost(cost) : zeroCost();
}

function readApi(route: DotHooshRoute, protocols: string[]): ModelApi {
  if (route === "anthropic") {
    return "anthropic-messages";
  }
  // Responses whenever the gateway serves the model there: GPT-6 chat completions admit function
  // tools only in narrow cases, Responses always. Chat-only and chat plus Anthropic models stay
  // on Chat Completions, the provider default.
  return protocols.includes("openai-responses") ? "openai-responses" : DOTHOOSH_PROVIDER_API;
}

/** Maps one gateway listing row, or returns undefined for rows that are not usable text models. */
export function buildDotHooshLiveModel(
  value: unknown,
  route: DotHooshRoute,
  baseUrl: string = DOTHOOSH_BASE_URL,
): ModelDefinitionConfig | undefined {
  const row = asOptionalRecord(value);
  const id = normalizeOptionalString(row?.id);
  if (!row || !id) {
    return undefined;
  }
  // An unavailable model is not routed by the gateway, so it must not be selectable here.
  if (normalizeOptionalString(row.status) === "unavailable") {
    return undefined;
  }
  const architecture = asOptionalRecord(row.architecture);
  const outputModalities = readModalities(architecture, "output");
  if (outputModalities.length > 0 && !outputModalities.includes("text")) {
    return undefined;
  }
  const supportedParameters = filterStringEntries(row.supported_parameters);
  const topProvider = asOptionalRecord(row.top_provider);
  const api = readApi(route, readProtocols(row.protocols));
  const contextWindow =
    asPositiveSafeInteger(topProvider?.context_length) ??
    asPositiveSafeInteger(row.context_length) ??
    asPositiveSafeInteger(row.context_window) ??
    DOTHOOSH_FALLBACK_CONTEXT_WINDOW;
  const base = {
    id,
    name: normalizeOptionalString(row.name) ?? normalizeOptionalString(row.display_name) ?? id,
    reasoning:
      supportedParameters.includes("reasoning") ||
      supportedParameters.includes("include_reasoning"),
    input: readModalities(architecture, "input").includes("image")
      ? (["text", "image"] as Array<"text" | "image">)
      : (["text"] as Array<"text" | "image">),
    cost: readCost(row),
    contextWindow,
    maxTokens:
      asPositiveSafeInteger(topProvider?.max_completion_tokens) ??
      asPositiveSafeInteger(row.max_output_tokens) ??
      contextWindow,
  };
  const supportsTools = Array.isArray(row.supported_parameters)
    ? { supportsTools: supportedParameters.includes("tools") }
    : {};
  switch (api) {
    case "anthropic-messages":
      return {
        ...base,
        api,
        baseUrl: resolveDotHooshAnthropicBaseUrl(baseUrl),
        ...(supportsTools.supportsTools === undefined ? {} : { compat: supportsTools }),
      };
    case "openai-responses":
      // The gateway admits `store` only as false on Responses.
      return { ...base, api, compat: { supportsStore: false, ...supportsTools } };
    default:
      return {
        ...base,
        compat: { supportsStore: false, supportsDeveloperRole: false, ...supportsTools },
      };
  }
}

/** Projects a gateway listing into model definitions, dropping rows without a usable id. */
export function projectDotHooshRows(
  rows: readonly unknown[],
  route: DotHooshRoute,
  baseUrl: string = DOTHOOSH_BASE_URL,
): ModelDefinitionConfig[] {
  return rows.flatMap((row) => {
    const model = buildDotHooshLiveModel(row, route, baseUrl);
    return model ? [model] : [];
  });
}

/**
 * Offline seed: only the onboarding default, so config setup works before any fetch. Its
 * limits and zero price are placeholders; the live listing replaces the whole row.
 */
export function buildDotHooshSeedModels(): ModelDefinitionConfig[] {
  return [
    {
      id: DOTHOOSH_DEFAULT_MODEL_ID,
      name: DOTHOOSH_DEFAULT_MODEL_ID,
      reasoning: true,
      input: ["text"],
      cost: zeroCost(),
      contextWindow: DOTHOOSH_FALLBACK_CONTEXT_WINDOW,
      maxTokens: DOTHOOSH_FALLBACK_CONTEXT_WINDOW,
      compat: { supportsStore: false, supportsDeveloperRole: false },
    },
  ];
}
