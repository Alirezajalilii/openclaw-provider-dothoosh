import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";
import { buildDotHooshModelCatalog, DOTHOOSH_BASE_URL, DOTHOOSH_PROVIDER_API } from "./models.js";

export function buildDotHooshProvider(): ModelProviderConfig {
  return {
    baseUrl: DOTHOOSH_BASE_URL,
    api: DOTHOOSH_PROVIDER_API,
    models: buildDotHooshModelCatalog(),
  };
}
