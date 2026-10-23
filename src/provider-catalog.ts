import { buildLiveModelProviderConfig } from "openclaw/plugin-sdk/provider-catalog-live-runtime";
import { normalizeBaseUrl } from "openclaw/plugin-sdk/provider-http";
import type {
  ModelDefinitionConfig,
  ModelProviderConfig,
} from "openclaw/plugin-sdk/provider-model-shared";
import {
  buildDotHooshSeedModels,
  DOTHOOSH_BASE_URL,
  DOTHOOSH_PROVIDER_API,
  projectDotHooshRows,
  type DotHooshRoute,
} from "./models.js";

const DOTHOOSH_MODELS_CACHE_TTL_MS = 60_000;

export function buildDotHooshProvider(): ModelProviderConfig {
  return {
    baseUrl: DOTHOOSH_BASE_URL,
    api: DOTHOOSH_PROVIDER_API,
    models: buildDotHooshSeedModels(),
  };
}

/**
 * A listing that projects to no usable model (empty, all rows unusable) is an outage, not an
 * empty catalog: rejecting makes the live catalog "unavailable" so the previous catalog stays,
 * and keeps the empty result out of the live cache. Either listing failing rejects the whole
 * build, so a healthy route can never hide a broken one.
 */
function requireUsableRows(
  models: ModelDefinitionConfig[],
  route: DotHooshRoute,
): ModelDefinitionConfig[] {
  if (models.length === 0) {
    throw new Error(`dothoosh ${route} model listing has no usable models`);
  }
  return models;
}

/** The Anthropic listing sits beside the OpenAI root: `<origin>/anthropic/v1/models`. */
function resolveAnthropicModelsEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/v1$/, "")}/anthropic/v1/models`;
}

function buildHeaders(route: DotHooshRoute, apiKey: string | undefined): HeadersInit {
  if (!apiKey) {
    return { Accept: "application/json" };
  }
  return route === "anthropic"
    ? { Accept: "application/json", "x-api-key": apiKey }
    : { Accept: "application/json", Authorization: `Bearer ${apiKey}` };
}

/**
 * Reads both gateway listings. Models and prices come only from the gateway, so a new model or
 * a price change needs no release. A model on both listings keeps its OpenAI-route entry.
 */
export async function buildDotHooshLiveProvider(params: {
  apiKey?: string;
  discoveryApiKey?: string;
  baseUrl?: string;
  signal?: AbortSignal;
  /** Test seam: replaces the SSRF-guarded fetch the SDK uses for discovery. */
  fetchGuard?: Parameters<typeof buildLiveModelProviderConfig>[0]["fetchGuard"];
}): Promise<ModelProviderConfig> {
  const baseUrl = normalizeBaseUrl(params.baseUrl, DOTHOOSH_BASE_URL);
  const routes: Array<{ route: DotHooshRoute; endpoint: string }> = [
    { route: "openai", endpoint: `${baseUrl}/models` },
    { route: "anthropic", endpoint: resolveAnthropicModelsEndpoint(baseUrl) },
  ];
  const [openai, anthropic] = await Promise.all(
    routes.map(({ route, endpoint }) =>
      buildLiveModelProviderConfig<ModelDefinitionConfig>({
        discoveryMode: "strict",
        providerId: "dothoosh",
        endpoint,
        providerConfig: { baseUrl, api: DOTHOOSH_PROVIDER_API },
        models: [],
        apiKey: params.apiKey,
        discoveryApiKey: params.discoveryApiKey,
        fetchGuard: params.fetchGuard,
        signal: params.signal,
        ttlMs: DOTHOOSH_MODELS_CACHE_TTL_MS,
        auditContext: `dothoosh-model-discovery-${route}`,
        cacheKeyParts: ["dothoosh", route, endpoint],
        buildRequestHeaders: ({ apiKey, discoveryApiKey }) =>
          buildHeaders(route, discoveryApiKey ?? apiKey),
        projectRows: (rows) => requireUsableRows(projectDotHooshRows(rows, route), route),
      }),
    ),
  );
  const live = new Map(
    [...(anthropic?.models ?? []), ...(openai?.models ?? [])].map((model) => [model.id, model]),
  );
  // The authenticated listing owns model existence; the offline seed never reappears here.
  return {
    baseUrl,
    api: DOTHOOSH_PROVIDER_API,
    ...(params.apiKey ? { apiKey: params.apiKey } : {}),
    models: [...live.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}
