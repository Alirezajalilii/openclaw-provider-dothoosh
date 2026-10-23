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
 * Anthropic Messages root. The Anthropic transport appends `/v1/messages`, which the gateway
 * serves at https://gateway.dothoosh.com/anthropic/v1/messages (`x-api-key` auth only).
 */
export const DOTHOOSH_ANTHROPIC_BASE_URL = "https://gateway.dothoosh.com/anthropic";
export const DOTHOOSH_PROVIDER_API = "openai-completions" satisfies ModelApi;
export const DOTHOOSH_DEFAULT_MODEL_ID = "deepseek-v4-pro";
export const DOTHOOSH_DEFAULT_MODEL_REF = `dothoosh/${DOTHOOSH_DEFAULT_MODEL_ID}`;

// Used only when a listing row omits its limits, and for the single offline seed row.
const DOTHOOSH_FALLBACK_CONTEXT_WINDOW = 200_000;
const DOTHOOSH_FALLBACK_MAX_TOKENS = 8192;

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

/**
 * Per-token decimal-string prices (OpenRouter convention) become per-million rates. The
 * gateway's `pricing_tiers` carry the same keys plus `above_input_tokens`, which is the
 * prompt-length override shape `normalizeOpenRouterModelPricing` already understands.
 */
function readCost(row: Record<string, unknown>): ModelDefinitionConfig["cost"] {
  const pricing = asOptionalRecord(row.pricing);
  if (!pricing) {
    return zeroCost();
  }
  const overrides = (Array.isArray(row.pricing_tiers) ? row.pricing_tiers : []).flatMap((raw) => {
    const { above_input_tokens: threshold, ...prices } = asOptionalRecord(raw) ?? {};
    return threshold === undefined ? [] : [{ min_prompt_tokens: threshold, ...prices }];
  });
  return normalizeOpenRouterModelPricing({ ...pricing, overrides }) ?? zeroCost();
}

function readApi(route: DotHooshRoute, protocols: string[]): ModelApi {
  if (route === "anthropic") {
    return "anthropic-messages";
  }
  // Chat Completions is the provider default; Responses only when that is the sole OpenAI route.
  return protocols.includes("openai-responses") && !protocols.includes("openai-chat-completions")
    ? "openai-responses"
    : DOTHOOSH_PROVIDER_API;
}

/** Maps one gateway listing row, or returns undefined for rows that are not usable text models. */
export function buildDotHooshLiveModel(
  value: unknown,
  route: DotHooshRoute,
): ModelDefinitionConfig | undefined {
  const row = asOptionalRecord(value);
  const id = normalizeOptionalString(row?.id);
  if (!row || !id) {
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
    contextWindow:
      asPositiveSafeInteger(topProvider?.context_length) ??
      asPositiveSafeInteger(row.context_length) ??
      asPositiveSafeInteger(row.context_window) ??
      DOTHOOSH_FALLBACK_CONTEXT_WINDOW,
    maxTokens:
      asPositiveSafeInteger(topProvider?.max_completion_tokens) ??
      asPositiveSafeInteger(row.max_output_tokens) ??
      DOTHOOSH_FALLBACK_MAX_TOKENS,
  };
  const supportsTools = Array.isArray(row.supported_parameters)
    ? { supportsTools: supportedParameters.includes("tools") }
    : {};
  switch (api) {
    case "anthropic-messages":
      return {
        ...base,
        api,
        baseUrl: DOTHOOSH_ANTHROPIC_BASE_URL,
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
): ModelDefinitionConfig[] {
  return rows.flatMap((row) => {
    const model = buildDotHooshLiveModel(row, route);
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
      maxTokens: DOTHOOSH_FALLBACK_MAX_TOKENS,
      compat: { supportsStore: false, supportsDeveloperRole: false },
    },
  ];
}
