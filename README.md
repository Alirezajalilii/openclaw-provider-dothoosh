# OpenClaw DotHoosh provider

[OpenClaw](https://docs.openclaw.ai) provider plugin for [DotHoosh](https://gateway.dothoosh.com),
an AI API gateway that serves Claude, GPT, Gemini, DeepSeek and Kimi models through one API key.
DotHoosh exposes OpenAI-compatible (`/v1`) and Anthropic-compatible (`/anthropic`) endpoints
and bills a prepaid wallet in Toman.

## Install

```bash
openclaw plugins install @dothoosh/openclaw-provider
```

## Configure

1. Create an API key at https://gateway.dothoosh.com/api-keys.
2. Export it, or enter it during onboarding (`openclaw onboard`, choose "DotHoosh API key"):

   ```bash
   export DOTHOOSH_API_KEY=...
   ```

3. Select a model as `dothoosh/<model-id>`, for example `dothoosh/deepseek-v4-pro` (the default).

Models are not listed in the plugin. It reads DotHoosh's live catalog, `GET /v1/models` (OpenAI
routes) and `GET /anthropic/v1/models` (Claude), with your key, so a new model or a price change
reaches OpenClaw without a plugin release. Each row supplies the context window, output limit,
text/image input, tool and reasoning support, per-token prices (including cache prices) and
long-context price tiers. Results are cached for 60 seconds.

Routing follows the listing: models the gateway serves on the OpenAI Responses API use it (GPT-6 chat
completions admit function tools only in narrow cases), models served only on the Anthropic route use
Anthropic Messages (`https://gateway.dothoosh.com/anthropic`), and the rest use OpenAI Chat Completions
(`https://gateway.dothoosh.com/v1`). Models whose status is `unavailable` are not listed, and a row
without an output cap is limited by its context window. A custom base URL moves both listings and the
Claude models with it (`https://proxy.example/v1` gives `https://proxy.example/anthropic`).

Only the provider id, base URLs, the `DOTHOOSH_API_KEY` variable name and the default model id
(`deepseek-v4-pro`, used by onboarding) are static. Before the first successful fetch the plugin
shows just that one default model, with placeholder limits and no price.

Both listings are filtered by your key's model allow-list, so a well-formed empty list on one route is
normal. A refresh counts as an outage, and the previous catalog stays, when both routes fail, both are
empty, or a route returns rows that are all unusable. When only one route fails (HTTP error, network
error, error body or non-JSON), that route keeps its last good rows for your key while the other route
refreshes. Run `openclaw models list --provider dothoosh` to see the live list.

## Development

```bash
npm install
npm run typecheck && npm test && npm run build
npm pack
openclaw plugins install npm-pack:./dothoosh-openclaw-provider-<version>.tgz
```

Requires Node 24.22.1 or newer (an OpenClaw requirement).

## License

MIT, see [LICENSE](LICENSE).
