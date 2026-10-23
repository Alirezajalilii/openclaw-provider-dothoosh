// The published `openclaw` package (2026.10.x) ships no type declarations for these
// plugin-sdk subpaths, so they are declared minimally here. Runtime behavior comes from
// the real SDK; remove this file once upstream exports `types` for them.
declare module "openclaw/plugin-sdk/provider-model-shared" {
  export type ModelApi = "openai-completions" | "openai-responses" | "anthropic-messages" | (string & {});
  export type ModelDefinitionConfig = {
    id: string;
    name: string;
    api?: ModelApi;
    baseUrl?: string;
    reasoning: boolean;
    input: string[];
    contextWindow: number;
    maxTokens: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      tieredPricing?: Array<{
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        range: [number, number] | [number];
      }>;
    };
    compat?: Record<string, unknown>;
    [key: string]: unknown;
  };
  export type ModelProviderConfig = {
    baseUrl: string;
    api?: ModelApi;
    apiKey?: string;
    models: ModelDefinitionConfig[];
    [key: string]: unknown;
  };
}
declare module "openclaw/plugin-sdk/provider-catalog-shared" {
  export type ProviderCatalogContext = {
    config: { models?: { providers?: Record<string, { baseUrl?: string }> } };
    env: Record<string, string | undefined>;
    resolveProviderApiKey: (providerId: string) => {
      apiKey?: string;
      discoveryApiKey?: string;
      profileId?: string;
    };
    resolveProviderAuth: (...args: never[]) => unknown;
    [key: string]: unknown;
  };
}
declare module "openclaw/plugin-sdk/provider-onboard" {
  type Config = {
    models?: { providers?: Record<string, { models: Array<{ id: string }>; baseUrl?: string; api?: string }> };
    agents?: { defaults?: { models?: Record<string, unknown>; model?: unknown } };
    [key: string]: unknown;
  };
  type Applier = (cfg: Config) => Config;
  export function createModelCatalogPresetAppliers<A extends unknown[] = []>(
    preset: unknown,
  ): { applyConfig: Applier; applyProviderConfig: Applier };
  export function createProviderConnectionPresetAppliers<A extends unknown[] = []>(
    preset: unknown,
  ): { applyConfig: Applier };
}
declare module "openclaw/plugin-sdk/provider-entry" {
  export function defineSingleProviderPluginEntry(options: Record<string, unknown>): {
    id: string;
    register: (api: unknown) => unknown;
    [key: string]: unknown;
  };
}
declare module "openclaw/plugin-sdk/model-catalog-pricing" {
  export function normalizeOpenRouterModelPricing(value: unknown):
    | {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        tieredPricing?: Array<{
          input: number;
          output: number;
          cacheRead: number;
          cacheWrite: number;
          range: [number, number] | [number];
        }>;
      }
    | undefined;
}
declare module "openclaw/plugin-sdk/provider-http" {
  export function normalizeBaseUrl(baseUrl: string | undefined, defaultBaseUrl: string): string;
}
declare module "openclaw/plugin-sdk/provider-catalog-live-runtime" {
  import type { ModelDefinitionConfig, ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";
  export function buildLiveModelProviderConfig<T extends ModelDefinitionConfig>(params: {
    discoveryMode?: "strict";
    providerId: string;
    endpoint: string;
    providerConfig: Omit<ModelProviderConfig, "models">;
    models: readonly T[];
    apiKey?: string;
    discoveryApiKey?: string;
    fetchGuard?: (params: { url: string; init?: RequestInit; [key: string]: unknown }) => Promise<unknown>;
    signal?: AbortSignal;
    ttlMs?: number;
    auditContext?: string;
    cacheKeyParts?: readonly unknown[];
    buildRequestHeaders?: (ctx: { apiKey?: string; discoveryApiKey?: string }) => HeadersInit;
    projectRows?: (rows: readonly unknown[], fallback: ModelProviderConfig) => readonly T[];
  }): Promise<ModelProviderConfig>;
  export function runLiveProviderCatalog(params: {
    providerId: string;
    profileId?: string;
    run: () => Promise<{ provider: ModelProviderConfig } | null>;
  }): Promise<{ provider: ModelProviderConfig } | null>;
  export function clearLiveCatalogCacheForTests(): void;
}
