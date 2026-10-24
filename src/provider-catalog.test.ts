import type { ProviderCatalogContext } from "openclaw/plugin-sdk/provider-catalog-shared";
import { clearLiveCatalogCacheForTests } from "openclaw/plugin-sdk/provider-catalog-live-runtime";
import { beforeEach, expect, it, vi } from "vitest";
import plugin from "./index.js";
import { projectDotHooshRows } from "./models.js";
import { buildDotHooshLiveProvider, buildDotHooshProvider } from "./provider-catalog.js";

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

const OPENAI_ROWS = [
  {
    id: "deepseek-v4",
    name: "DeepSeek V4",
    context_length: 128000,
    max_output_tokens: 16000,
    top_provider: { context_length: 128000, max_completion_tokens: 16000 },
    architecture: {
      modality: "text->text",
      input_modalities: ["text"],
      output_modalities: ["text"],
    },
    pricing: {
      prompt: "0.0000017",
      completion: "0.0000051",
      input_cache_read: "0.00000006",
      request: "0",
    },
    protocols: [{ protocol: "openai-chat-completions" }],
    supported_parameters: ["include_reasoning", "max_tokens", "reasoning", "tool_choice", "tools"],
  },
  {
    id: "gpt-5",
    name: "GPT 5",
    context_length: 400000,
    max_output_tokens: 128000,
    architecture: { modality: "text+image->text", input_modalities: ["text", "image"] },
    pricing: {
      prompt: "0.0000025",
      completion: "0.00001",
      input_cache_read: "0.00000025",
      input_cache_write: "0.000003",
    },
    pricing_tiers: [{ above_input_tokens: 272000, prompt: "0.000005", completion: "0.000015" }],
    protocols: [{ protocol: "openai-responses" }],
    supported_parameters: ["max_tokens", "tool_choice", "tools"],
  },
  {
    id: "dual-model",
    architecture: { modality: "text->text" },
    protocols: ["openai-chat-completions", "openai-responses"],
    supported_parameters: ["max_tokens"],
  },
  { id: "image-only", architecture: { modality: "text->image" } },
  { name: "no id" },
  { id: "unavailable-model", status: "unavailable", supported_parameters: ["tools"] },
  { id: "limited-model", status: "limited", supported_parameters: ["tools"] },
  { id: "deprecated-model", status: "deprecated", supported_parameters: ["tools"] },
];

const ANTHROPIC_ROWS = [
  {
    id: "claude-opus-5",
    display_name: "Claude Opus 5",
    type: "model",
    context_length: 200000,
    top_provider: { context_length: 200000, max_completion_tokens: 25000 },
    architecture: { modality: "text+image->text", input_modalities: ["text", "image"] },
    pricing: { prompt: "0.000015", completion: "0.000075", input_cache_write: "0.00001875" },
    supported_parameters: ["include_reasoning", "tools"],
  },
  { id: "dual-model", type: "model" },
];

type GuardParams = { url: string; init?: RequestInit };

/** Fake SSRF-guarded fetch: serves the two fixture listings and records every request. */
function listings(openai: unknown[], anthropic: unknown[]) {
  return vi.fn(async (params: GuardParams) => {
    const data = params.url.includes("/anthropic/") ? anthropic : openai;
    return { response: Response.json({ data }), finalUrl: params.url, release: async () => {} };
  });
}

// Last-good rows are remembered per credential, so every test uses its own key.
let keySeq = 0;
const freshKey = () => `fixture-key-${++keySeq}`;

/** Fake guard: the Anthropic route answers like `anthropic`, the OpenAI route like `openai`. */
function routed(openai: () => Response, anthropic: () => Response) {
  return vi.fn(async (params: GuardParams) => ({
    response: params.url.includes("/anthropic/") ? anthropic() : openai(),
    finalUrl: params.url,
    release: async () => {},
  }));
}
const down = () => new Response("nope", { status: 503 });
const rowsOf = (data: unknown[]) => () => Response.json({ data });

function byId(models: ReturnType<typeof projectDotHooshRows>, id: string) {
  const model = models.find((entry) => entry.id === id);
  if (!model) {
    throw new Error(`missing model ${id}`);
  }
  return model;
}

beforeEach(() => clearLiveCatalogCacheForTests());

it("converts per-token prices to per-million rates and keeps cache prices", () => {
  const model = byId(projectDotHooshRows(OPENAI_ROWS, "openai"), "deepseek-v4");
  // Per-token strings times 1e6 would carry float noise; rates are rounded to 6 decimals.
  expect(model.cost).toEqual({ input: 1.7, output: 5.1, cacheRead: 0.06, cacheWrite: 0 });
  expect(model).toMatchObject({
    reasoning: true,
    input: ["text"],
    contextWindow: 128000,
    maxTokens: 16000,
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsTools: true },
  });
  expect(model.api).toBeUndefined();
});

it("turns pricing_tiers into whole-request tieredPricing above the threshold", () => {
  const model = byId(projectDotHooshRows(OPENAI_ROWS, "openai"), "gpt-5");
  expect(model).toMatchObject({ api: "openai-responses", input: ["text", "image"] });
  expect(model.cost).toEqual({
    input: 2.5,
    output: 10,
    cacheRead: 0.25,
    cacheWrite: 3,
    tieredPricing: [
      { range: [0, 272001], input: 2.5, output: 10, cacheRead: 0.25, cacheWrite: 3 },
      // The tier omits the cache-write price, so it bills at the tier's own input price.
      { range: [272001], input: 5, output: 15, cacheRead: 0.25, cacheWrite: 5 },
    ],
  });
});

it("prefers Responses when a model lists both OpenAI protocols", () => {
  // GPT-6 chat completions admit function tools only in narrow cases; Responses always does.
  const model = byId(projectDotHooshRows(OPENAI_ROWS, "openai"), "dual-model");
  expect(model.api).toBe("openai-responses");
  expect(model.compat).toMatchObject({ supportsStore: false });
  expect(model.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  expect(model.compat).toMatchObject({ supportsTools: false });
});

it("keeps chat-only and chat plus Anthropic models on Chat Completions", () => {
  const rows = [
    { id: "chat-only", protocols: [{ protocol: "openai-chat-completions" }] },
    {
      id: "chat-and-anthropic",
      protocols: [{ protocol: "openai-chat-completions" }, { protocol: "anthropic-messages" }],
    },
  ];
  const models = projectDotHooshRows(rows, "openai");
  expect(byId(models, "chat-only").api).toBeUndefined();
  expect(byId(models, "chat-and-anthropic").api).toBeUndefined();
});

it("drops rows without an id or without text output", () => {
  expect(projectDotHooshRows(OPENAI_ROWS, "openai").map((model) => model.id)).toEqual([
    "deepseek-v4",
    "gpt-5",
    "dual-model",
    "limited-model",
    "deprecated-model",
  ]);
});

it("skips models whose lifecycle status is unavailable, on both routes", () => {
  const ids = (route: "openai" | "anthropic") =>
    projectDotHooshRows(
      [
        { id: "a", status: "active" },
        { id: "gone", status: "unavailable" },
        { id: "slow", status: "degraded" },
        { id: "unset" },
      ],
      route,
    ).map((model) => model.id);
  expect(ids("openai")).toEqual(["a", "slow", "unset"]);
  expect(ids("anthropic")).toEqual(["a", "slow", "unset"]);
});

it("routes Anthropic-listing rows to the Anthropic Messages endpoint", () => {
  const model = byId(projectDotHooshRows(ANTHROPIC_ROWS, "anthropic"), "claude-opus-5");
  expect(model).toMatchObject({
    name: "Claude Opus 5",
    api: "anthropic-messages",
    baseUrl: "https://gateway.dothoosh.com/anthropic",
    contextWindow: 200000,
    maxTokens: 25000,
    input: ["text", "image"],
    cost: { input: 15, output: 75, cacheRead: 0, cacheWrite: 18.75 },
  });
});

it("fetches both listings, keys each route correctly and merges by id", async () => {
  const fetchSpy = listings(OPENAI_ROWS, ANTHROPIC_ROWS);
  const apiKey = freshKey();
  const provider = await buildDotHooshLiveProvider({ apiKey, fetchGuard: fetchSpy });
  expect(provider.models.map((model) => model.id)).toEqual([
    "claude-opus-5",
    "deepseek-v4",
    "deprecated-model",
    "dual-model",
    "gpt-5",
    "limited-model",
  ]);
  // A model on both listings keeps its OpenAI-route entry.
  expect(byId(provider.models, "dual-model").api).toBe("openai-responses");
  const calls = fetchSpy.mock.calls.map(([params]) => params);
  expect(calls.map((call) => call.url).sort()).toEqual([
    "https://gateway.dothoosh.com/anthropic/v1/models",
    "https://gateway.dothoosh.com/v1/models",
  ]);
  const headersOf = (needle: string) =>
    new Headers(calls.find((call) => call.url.includes(needle))?.init?.headers);
  expect(headersOf("/v1/models").get("authorization")).toBe(`Bearer ${apiKey}`);
  expect(headersOf("/v1/models").get("x-api-key")).toBeNull();
  expect(headersOf("/anthropic/").get("x-api-key")).toBe(apiKey);
});

it("sends Bearer auth on the OpenAI listing", async () => {
  const fetchSpy = listings(OPENAI_ROWS, ANTHROPIC_ROWS);
  const apiKey = freshKey();
  await buildDotHooshLiveProvider({ apiKey, fetchGuard: fetchSpy });
  const openai = fetchSpy.mock.calls.find(([params]) => !params.url.includes("/anthropic/"));
  expect(new Headers(openai?.[0].init?.headers).get("authorization")).toBe(`Bearer ${apiKey}`);
});

it("rejects on a failed fetch", async () => {
  const failing = vi.fn(async (params: GuardParams) => ({
    response: new Response("nope", { status: 503 }),
    finalUrl: params.url,
    release: async () => {},
  }));
  await expect(buildDotHooshLiveProvider({ apiKey: freshKey(), fetchGuard: failing })).rejects.toThrow();
});

// A well-formed empty list on ONE route is legitimate: the gateway filters both listings by the
// key's model allow-list, so a key may have no Claude models (or no OpenAI-route models). A route
// that returns rows none of which are usable is an outage, and so is losing both routes.
it("accepts a well-formed empty OpenAI listing when the Anthropic one has models", async () => {
  const provider = await buildDotHooshLiveProvider({
    apiKey: freshKey(),
    fetchGuard: listings([], ANTHROPIC_ROWS),
  });
  expect(provider.models.map((model) => model.id)).toEqual(["claude-opus-5", "dual-model"]);
});

it("accepts a well-formed empty Anthropic listing when the OpenAI one has models", async () => {
  const provider = await buildDotHooshLiveProvider({
    apiKey: freshKey(),
    fetchGuard: listings(OPENAI_ROWS, []),
  });
  expect(provider.models.map((model) => model.id)).toContain("deepseek-v4");
  expect(provider.models.map((model) => model.id)).not.toContain("claude-opus-5");
});

it("rejects when both listings are empty", async () => {
  await expect(
    buildDotHooshLiveProvider({ apiKey: freshKey(), fetchGuard: listings([], []) }),
  ).rejects.toThrow(/dothoosh/i);
});

const UNUSABLE_LISTINGS: Array<[string, unknown[]]> = [
  ["rows without an id", [{ name: "no id" }, null]],
  ["rows without text output", [{ id: "image-only", architecture: { modality: "text->image" } }]],
  ["only unavailable models", [{ id: "gone", status: "unavailable" }]],
];

for (const [label, rows] of UNUSABLE_LISTINGS) {
  it(`rejects when the OpenAI listing has ${label}, even if the Anthropic one is healthy`, async () => {
    await expect(
      buildDotHooshLiveProvider({
        apiKey: freshKey(),
        fetchGuard: listings(rows, ANTHROPIC_ROWS),
      }),
    ).rejects.toThrow(/dothoosh/i);
  });

  it(`rejects when the Anthropic listing has ${label}, even if the OpenAI one is healthy`, async () => {
    await expect(
      buildDotHooshLiveProvider({
        apiKey: freshKey(),
        fetchGuard: listings(OPENAI_ROWS, rows),
      }),
    ).rejects.toThrow(/dothoosh/i);
  });
}

it("keeps a route's last good rows when only that route fails, never dropping the other route", async () => {
  const apiKey = freshKey();
  await buildDotHooshLiveProvider({ apiKey, fetchGuard: listings(OPENAI_ROWS, ANTHROPIC_ROWS) });
  clearLiveCatalogCacheForTests();
  // The Anthropic listing is now down; the OpenAI listing answers with a changed list.
  const guard = routed(
    rowsOf([{ id: "fresh-openai-model", supported_parameters: ["tools"] }]),
    down,
  );
  const provider = await buildDotHooshLiveProvider({ apiKey, fetchGuard: guard });
  const ids = provider.models.map((model) => model.id);
  expect(ids).toContain("claude-opus-5"); // Anthropic route: last good rows kept
  expect(ids).toContain("fresh-openai-model"); // OpenAI route: fresh rows used
  expect(ids).not.toContain("deepseek-v4"); // OpenAI route: replaced by the fresh listing
});

it("rejects when a route fails and it has no last good rows", async () => {
  await expect(
    buildDotHooshLiveProvider({
      apiKey: freshKey(),
      fetchGuard: routed(rowsOf(OPENAI_ROWS), down),
    }),
  ).rejects.toThrow();
});

it("rejects when both routes fail, even with last good rows", async () => {
  const apiKey = freshKey();
  await buildDotHooshLiveProvider({ apiKey, fetchGuard: listings(OPENAI_ROWS, ANTHROPIC_ROWS) });
  clearLiveCatalogCacheForTests();
  await expect(
    buildDotHooshLiveProvider({ apiKey, fetchGuard: routed(down, down) }),
  ).rejects.toThrow();
});

it("does not share last good rows between credentials", async () => {
  await buildDotHooshLiveProvider({
    apiKey: freshKey(),
    fetchGuard: listings(OPENAI_ROWS, ANTHROPIC_ROWS),
  });
  clearLiveCatalogCacheForTests();
  await expect(
    buildDotHooshLiveProvider({
      apiKey: freshKey(),
      fetchGuard: routed(rowsOf(OPENAI_ROWS), down),
    }),
  ).rejects.toThrow();
});

it("rejects an error-envelope body on either listing", async () => {
  for (const brokenRoute of ["anthropic", "openai"]) {
    clearLiveCatalogCacheForTests();
    const guard = vi.fn(async (params: GuardParams) => {
      const route = params.url.includes("/anthropic/") ? "anthropic" : "openai";
      const data = route === "anthropic" ? ANTHROPIC_ROWS : OPENAI_ROWS;
      return {
        response: Response.json(
          route === brokenRoute ? { error: { message: "upstream down" } } : { data },
        ),
        finalUrl: params.url,
        release: async () => {},
      };
    });
    await expect(buildDotHooshLiveProvider({ apiKey: freshKey(), fetchGuard: guard })).rejects.toThrow();
  }
});

it("does not cache an unusable listing as the catalog", async () => {
  const apiKey = freshKey();
  await expect(
    buildDotHooshLiveProvider({
      apiKey,
      fetchGuard: listings([{ name: "no id" }], ANTHROPIC_ROWS),
    }),
  ).rejects.toThrow();
  const provider = await buildDotHooshLiveProvider({
    apiKey,
    fetchGuard: listings(OPENAI_ROWS, ANTHROPIC_ROWS),
  });
  expect(provider.models.map((model) => model.id)).toContain("deepseek-v4");
});

it("keeps the live limits and prices over the offline seed", async () => {
  const provider = await buildDotHooshLiveProvider({
    apiKey: freshKey(),
    fetchGuard: listings(
      [
        {
          id: "deepseek-v4-pro",
          context_length: 1_000_000,
          max_output_tokens: 384_000,
          pricing: { prompt: "0.0000017", completion: "0.0000051" },
          supported_parameters: ["tools", "reasoning"],
        },
      ],
      ANTHROPIC_ROWS,
    ),
  });
  const model = byId(provider.models, "deepseek-v4-pro");
  expect(model).toMatchObject({ contextWindow: 1_000_000, maxTokens: 384_000, reasoning: true });
  expect(model.cost.input).toBe(1.7);
  expect(model.compat).toMatchObject({ supportsTools: true });
});

it("pins tier boundaries: the threshold itself stays on the lower tier", () => {
  const model = byId(
    projectDotHooshRows(
      [
        {
          id: "tiered",
          pricing: {
            prompt: "0.000001",
            completion: "0.000002",
            input_cache_read: "0.0000001",
            input_cache_write: "0.00000125",
          },
          pricing_tiers: [
            { above_input_tokens: 100000, prompt: "0.000002" },
            { above_input_tokens: 200000, completion: "0.000009" },
          ],
        },
      ],
      "openai",
    ),
    "tiered",
  );
  // [0, 100001) covers 100000 input tokens. Omitted tier fields come from the BASE price, never
  // from the tier below; an omitted cache write bills at that tier's own input price.
  expect(model.cost.tieredPricing).toEqual([
    { range: [0, 100001], input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
    { range: [100001, 200001], input: 2, output: 2, cacheRead: 0.1, cacheWrite: 2 },
    { range: [200001], input: 1, output: 9, cacheRead: 0.1, cacheWrite: 1 },
  ]);
});

it("rounds tier prices like base prices", () => {
  const model = byId(
    projectDotHooshRows(
      [
        {
          id: "gpt-6-luna",
          pricing: {
            prompt: "0.000000128336",
            completion: "0.00000064167",
            input_cache_read: "0.000000012837",
            input_cache_write: "0.00000016042",
          },
          pricing_tiers: [
            {
              above_input_tokens: 272000,
              prompt: "0.000000256669",
              completion: "0.000000962503",
              input_cache_read: "0.000000025669",
              input_cache_write: "0.000000320837",
            },
          ],
        },
      ],
      "openai",
    ),
    "gpt-6-luna",
  );
  expect(model.cost).toEqual({
    input: 0.128336,
    output: 0.64167,
    cacheRead: 0.012837,
    cacheWrite: 0.16042,
    tieredPricing: [
      {
        range: [0, 272001],
        input: 0.128336,
        output: 0.64167,
        cacheRead: 0.012837,
        cacheWrite: 0.16042,
      },
      {
        range: [272001],
        input: 0.256669,
        output: 0.962503,
        cacheRead: 0.025669,
        cacheWrite: 0.320837,
      },
    ],
  });
});

it("never invents an 8192 output cap: a row without one is bounded by its context window", () => {
  const kimi = byId(
    projectDotHooshRows([{ id: "kimi-k2.6", context_length: 262144 }], "openai"),
    "kimi-k2.6",
  );
  expect(kimi).toMatchObject({ contextWindow: 262144, maxTokens: 262144 });
  const bare = byId(projectDotHooshRows([{ id: "bare" }], "openai"), "bare");
  expect(bare.maxTokens).toBe(bare.contextWindow);
});

it("points Anthropic-route rows at the resolved base URL, not the production URL", () => {
  const rows = [{ id: "claude-x", type: "model" }];
  expect(byId(projectDotHooshRows(rows, "anthropic"), "claude-x").baseUrl).toBe(
    "https://gateway.dothoosh.com/anthropic",
  );
  expect(
    byId(projectDotHooshRows(rows, "anthropic", "https://proxy.example/v1"), "claude-x").baseUrl,
  ).toBe("https://proxy.example/anthropic");
});

it("builds Anthropic rows against a custom base URL end to end", async () => {
  const provider = await buildDotHooshLiveProvider({
    apiKey: freshKey(),
    baseUrl: "https://proxy.example/v1/",
    fetchGuard: listings(OPENAI_ROWS, ANTHROPIC_ROWS),
  });
  expect(byId(provider.models, "claude-opus-5").baseUrl).toBe("https://proxy.example/anthropic");
});

it("derives the Anthropic listing from an explicit base URL", async () => {
  const fetchSpy = listings(OPENAI_ROWS, ANTHROPIC_ROWS);
  await buildDotHooshLiveProvider({
    apiKey: freshKey(),
    baseUrl: "https://proxy.example/v1/",
    fetchGuard: fetchSpy,
  });
  expect(fetchSpy.mock.calls.map(([params]) => params.url).sort()).toEqual([
    "https://proxy.example/anthropic/v1/models",
    "https://proxy.example/v1/models",
  ]);
});


const registered = await registerProvider();

function context(): ProviderCatalogContext {
  const auth = { apiKey: "DOTHOOSH_API_KEY", discoveryApiKey: "fixture-key" };
  return {
    config: {},
    env: {},
    resolveProviderApiKey: () => auth,
    resolveProviderAuth: () => ({ ...auth, mode: "api_key", source: "profile" }),
  };
}

it("keeps a one-row offline seed with no hard-coded vendor models", async () => {
  const staticResult = await registered.staticCatalog?.run(context());
  expect(staticResult).toEqual({ provider: buildDotHooshProvider() });
  expect(buildDotHooshProvider()).toMatchObject({
    baseUrl: "https://gateway.dothoosh.com/v1",
    api: "openai-completions",
  });
  expect(buildDotHooshProvider().models.map((model) => model.id)).toEqual(["deepseek-v4-pro"]);
});

it("skips the live catalog without an API key", async () => {
  const anonymous = { ...context(), resolveProviderApiKey: () => ({ apiKey: undefined }) };
  await expect(registered.catalog?.run(anonymous)).resolves.toBeNull();
});
