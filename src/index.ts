import type { ProviderCatalogContext } from "openclaw/plugin-sdk/provider-catalog-shared";
import { runLiveProviderCatalog } from "openclaw/plugin-sdk/provider-catalog-live-runtime";
import { defineSingleProviderPluginEntry } from "openclaw/plugin-sdk/provider-entry";
import { applyDotHooshConnectionConfig, DOTHOOSH_DEFAULT_MODEL_REF } from "./onboard.js";
import manifest from "./openclaw.plugin.json" with { type: "json" };
import { buildDotHooshLiveProvider, buildDotHooshProvider } from "./provider-catalog.js";

const PROVIDER_ID = "dothoosh";

export default defineSingleProviderPluginEntry({
  id: PROVIDER_ID,
  name: "DotHoosh Provider",
  description: "DotHoosh provider plugin",
  manifest,
  provider: {
    label: "DotHoosh",
    docsPath: "/providers/dothoosh",
    manifestAuth: {
      defaultModel: DOTHOOSH_DEFAULT_MODEL_REF,
      applyConfig: applyDotHooshConnectionConfig,
      noteTitle: "DotHoosh",
      noteMessage: [
        "DotHoosh is an AI API gateway billed in Toman from a prepaid wallet.",
        "Create an API key at: https://gateway.dothoosh.com/api-keys",
      ].join("\n"),
    },
    catalog: {
      order: "simple",
      run: async (ctx: ProviderCatalogContext) => {
        const auth = ctx.resolveProviderApiKey(PROVIDER_ID);
        const apiKey = auth.apiKey;
        if (!apiKey) {
          return null;
        }
        const providerConfig = ctx.config.models?.providers?.dothoosh;
        return await runLiveProviderCatalog({
          providerId: PROVIDER_ID,
          profileId: auth.profileId,
          run: async () => ({
            provider: await buildDotHooshLiveProvider({
              apiKey,
              discoveryApiKey: auth.discoveryApiKey,
              baseUrl: providerConfig?.baseUrl,
            }),
          }),
        });
      },
      staticRun: async () => ({ provider: buildDotHooshProvider() }),
    },
  },
});
