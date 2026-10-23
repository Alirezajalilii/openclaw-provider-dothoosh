import { expect, it } from "vitest";
import { applyDotHooshConfig, DOTHOOSH_DEFAULT_MODEL_REF } from "./api.js";

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
