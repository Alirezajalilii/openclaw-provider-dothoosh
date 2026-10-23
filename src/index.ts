import { defineSingleProviderPluginEntry } from "openclaw/plugin-sdk/provider-entry";
import { applyDotHooshConnectionConfig, DOTHOOSH_DEFAULT_MODEL_REF } from "./onboard.js";
import manifest from "./openclaw.plugin.json" with { type: "json" };
import { buildDotHooshProvider } from "./provider-catalog.js";

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
      buildProvider: buildDotHooshProvider,
      buildStaticProvider: buildDotHooshProvider,
      allowExplicitBaseUrl: true,
    },
  },
});
