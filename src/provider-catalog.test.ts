import type { ProviderCatalogContext } from "openclaw/plugin-sdk/provider-catalog-shared";
import { expect, it } from "vitest";
import plugin from "./index.js";
import { DOTHOOSH_MODEL_CATALOG } from "./models.js";
import { buildDotHooshProvider } from "./provider-catalog.js";

type RegisteredProvider = {
  catalog?: { run: (ctx: ProviderCatalogContext) => Promise<unknown> };
  staticCatalog?: { run: (ctx: ProviderCatalogContext) => Promise<unknown> };
};

// Minimal plugin API stub: the entry only needs registerProvider to capture the provider.
async function registerProvider(): Promise<RegisteredProvider> {
  let captured: RegisteredProvider | undefined;
  const api = new Proxy(
    { registerProvider: (p: RegisteredProvider) => (captured = p) },
    { get: (t, k) => (k in t ? (t as never)[k] : () => undefined) },
  );
  await (plugin as unknown as { register: (a: unknown) => unknown }).register(api);
  if (!captured) throw new Error("provider not registered");
  return captured;
}

const provider = await registerProvider();

function context(baseUrl?: string): ProviderCatalogContext {
  const auth = { apiKey: "DOTHOOSH_API_KEY", discoveryApiKey: "fixture-key" };
  return {
    config: baseUrl ? { models: { providers: { dothoosh: { baseUrl, models: [] } } } } : {},
    env: {},
    resolveProviderApiKey: () => auth,
    resolveProviderAuth: () => ({ ...auth, mode: "api_key", source: "profile" }),
  };
}

function modelById(id: string) {
  const model = buildDotHooshProvider().models.find((entry) => entry.id === id);
  if (!model) {
    throw new Error(`missing model ${id}`);
  }
  return model;
}

it("defaults to the OpenAI-compatible Chat Completions route", () => {
  expect(buildDotHooshProvider()).toMatchObject({
    baseUrl: "https://gateway.dothoosh.com/v1",
    api: "openai-completions",
  });
  expect(modelById("deepseek-v4-pro").api).toBeUndefined();
});

it("serves Claude only through the Anthropic Messages endpoint", () => {
  for (const id of [
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
    "claude-fable-5-1",
  ]) {
    expect(modelById(id)).toMatchObject({
      api: "anthropic-messages",
      baseUrl: "https://gateway.dothoosh.com/anthropic",
    });
  }
});

it("routes GPT-6 models through Responses with store disabled", () => {
  for (const id of ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"]) {
    expect(modelById(id)).toMatchObject({
      api: "openai-responses",
      contextWindow: 1_050_000,
      compat: { supportsStore: false },
    });
  }
});

it("lists text-only models with unique ids and consistent limits", () => {
  const models = buildDotHooshProvider().models;
  expect(new Set(models.map((model) => model.id)).size).toBe(DOTHOOSH_MODEL_CATALOG.length);
  for (const model of models) {
    expect(model.input).toEqual(["text"]);
    expect(model.maxTokens).toBeLessThanOrEqual(model.contextWindow);
  }
  expect(modelById("claude-haiku-5-5")).toMatchObject({
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    cost: {
      input: 0.1283,
      output: 0.6417,
      cacheRead: 0.0128,
      cacheWrite: 0.1604,
      tieredPricing: [
        { range: [0, 100_001], input: 0.1283, output: 0.6417, cacheRead: 0.0128, cacheWrite: 0.1604 },
        { range: [100_001], input: 0.6417, output: 3.2083, cacheRead: 0.0642, cacheWrite: 0.8021 },
      ],
    },
  });
});

it("bills long GPT-6 prompts at the long-context tier", () => {
  expect(modelById("gpt-6.1-sol")).toMatchObject({
    cost: {
      cacheWrite: 3.2083,
      tieredPricing: [
        { range: [0, 272_001], input: 2.5667, output: 12.8333, cacheRead: 0.1283, cacheWrite: 3.2083 },
        { range: [272_001], input: 5.1333, output: 19.25, cacheRead: 0.2567, cacheWrite: 6.4167 },
      ],
    },
  });
});

it("builds the static catalog without network access", async () => {
  const staticResult = await provider.staticCatalog?.run(context());
  expect(staticResult).toEqual({ provider: buildDotHooshProvider() });
});

it("resolves the live catalog from the API-key env var", async () => {
  const result = await provider.catalog?.run(context());
  expect(result).toMatchObject({
    provider: { api: "openai-completions", apiKey: "DOTHOOSH_API_KEY" },
  });
  const anonymous = { ...context(), resolveProviderApiKey: () => ({ apiKey: undefined }) };
  await expect(provider.catalog?.run(anonymous)).resolves.toBeNull();
});
