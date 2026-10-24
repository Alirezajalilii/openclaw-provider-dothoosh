import { expect, it } from "vitest";
import { DOTHOOSH_BASE_URL, resolveDotHooshAnthropicBaseUrl } from "./models.js";

it.each([
  ["the default root", DOTHOOSH_BASE_URL, "https://gateway.dothoosh.com/anthropic"],
  ["a custom /v1 root", "https://proxy.example/v1", "https://proxy.example/anthropic"],
  ["a root with trailing slashes", "https://proxy.example/v1///", "https://proxy.example/anthropic"],
  ["a root without /v1", "https://proxy.example", "https://proxy.example/anthropic"],
])("derives the Anthropic root from %s", (_name, baseUrl, expected) => {
  expect(resolveDotHooshAnthropicBaseUrl(baseUrl)).toBe(expected);
});

it("trims slashes in linear time on a long run of slashes inside the URL", () => {
  // A /\/+$/ regex backtracks quadratically here (CodeQL js/polynomial-redos).
  const baseUrl = `https://proxy.example/v1${"/".repeat(50_000)}x`;

  const startedAt = performance.now();
  resolveDotHooshAnthropicBaseUrl(baseUrl);

  expect(performance.now() - startedAt).toBeLessThan(500);
});
