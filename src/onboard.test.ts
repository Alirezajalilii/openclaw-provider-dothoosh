import { expect, it } from "vitest";
import { applyDotHooshConfig, DOTHOOSH_DEFAULT_MODEL_REF } from "./api.js";
import { applyDotHooshConnectionConfig } from "./onboard.js";

it("configures DotHoosh's OpenAI endpoint and the DeepSeek default", () => {
  const cfg = applyDotHooshConfig({});
  const provider = cfg.models?.providers?.dothoosh;
  expect(provider).toMatchObject({
    baseUrl: "https://gateway.dothoosh.com/v1",
    api: "openai-completions",
  });
  expect(provider?.models.map((model) => model.id)).toContain("deepseek-v4-pro");
  expect(cfg.agents?.defaults?.models?.[DOTHOOSH_DEFAULT_MODEL_REF]).toEqual({
    alias: "DeepSeek V4 Pro",
  });
  expect(cfg.agents?.defaults?.model).toEqual({ primary: "dothoosh/deepseek-v4-pro" });
});

it("does not persist placeholder limits or prices when connecting in the default mode", () => {
  // The wizard path; persisted rows would pin explicit values over the live listing.
  const cfg = applyDotHooshConnectionConfig({});
  expect(cfg.models?.providers?.dothoosh?.models ?? []).toEqual([]);
  expect(cfg.agents?.defaults?.model).toEqual({ primary: "dothoosh/deepseek-v4-pro" });
});
