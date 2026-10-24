import { createHash } from "node:crypto";
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
  resolveDotHooshAnthropicBaseUrl,
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
 * Rows of one listing. A well-formed empty list is legitimate: the gateway filters both listings
 * by the key's model allow-list, so a key may have no models on one route. Rows that exist but
 * project to nothing usable (no id, not text, all unavailable) are an outage, not an empty route.
 */
function requireUsableRows(
  rows: readonly unknown[],
  models: ModelDefinitionConfig[],
  route: DotHooshRoute,
): ModelDefinitionConfig[] {
  if (rows.length > 0 && models.length === 0) {
    throw new Error(`dothoosh ${route} model listing has no usable models`);
  }
  return models;
}

/** The Anthropic listing sits beside the OpenAI root: `<origin>/anthropic/v1/models`. */
function resolveAnthropicModelsEndpoint(baseUrl: string): string {
  return `${resolveDotHooshAnthropicBaseUrl(baseUrl)}/v1/models`;
}

// Last good rows per route and credential. A listing failure on one route keeps that route's
// previous rows so the other route's fresh models are never dropped; they are never shared
// between credentials because each key's allow-list shapes what its listings return.
const LAST_GOOD_ROW_LIMIT = 32;
const lastGoodRows = new Map<string, ModelDefinitionConfig[]>();

function lastGoodKey(
  route: DotHooshRoute,
  endpoint: string,
  credentials: Array<string | undefined>,
): string {
  const digest = createHash("sha256")
    .update(credentials.map((c) => c ?? "").join("\0"))
    .digest("hex");
  return `${route}|${endpoint}|${digest}`;
}

function rememberRows(key: string, models: ModelDefinitionConfig[]): void {
  lastGoodRows.delete(key);
  lastGoodRows.set(key, models);
  for (const oldest of lastGoodRows.keys()) {
    if (lastGoodRows.size <= LAST_GOOD_ROW_LIMIT) {
      break;
    }
    lastGoodRows.delete(oldest);
  }
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
 *
 * Outage rules: losing both routes, both routes empty, or a route whose rows are all unusable
 * rejects the build (the previous catalog stays). A transport, HTTP, error-envelope or non-JSON
 * failure on one route reuses that route's last good rows while the other route's fresh rows
 * are used; with no last good rows it rejects.
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
  const outcomes = await Promise.all(
    routes.map(async ({ route, endpoint }) => {
      const key = lastGoodKey(route, endpoint, [params.apiKey, params.discoveryApiKey]);
      try {
        const provider = await buildLiveModelProviderConfig<ModelDefinitionConfig>({
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
          projectRows: (rows) =>
            requireUsableRows(rows, projectDotHooshRows(rows, route, baseUrl), route),
        });
        rememberRows(key, provider.models);
        return { models: provider.models, failure: undefined };
      } catch (error) {
        return { models: lastGoodRows.get(key), failure: { error } };
      }
    }),
  );
  const failures = outcomes.filter((outcome) => outcome.failure);
  const unrecoverable = failures.find((outcome) => outcome.models === undefined);
  if (failures.length === outcomes.length || unrecoverable) {
    throw (unrecoverable ?? failures[0])?.failure?.error;
  }
  const [openai, anthropic] = outcomes;
  // A model on both listings keeps its OpenAI-route entry (it is added last).
  const rows = [...(anthropic?.models ?? []), ...(openai?.models ?? [])];
  if (rows.length === 0) {
    throw new Error("dothoosh model listings have no usable models on either route");
  }
  const live = new Map(rows.map((model) => [model.id, model]));
  // The authenticated listing owns model existence; the offline seed never reappears here.
  return {
    baseUrl,
    api: DOTHOOSH_PROVIDER_API,
    ...(params.apiKey ? { apiKey: params.apiKey } : {}),
    models: [...live.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}
