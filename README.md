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

Routing follows the listing: models served on the Anthropic route use Anthropic Messages
(`https://gateway.dothoosh.com/anthropic`), models whose only OpenAI route is Responses use the
OpenAI Responses API, and the rest use OpenAI Chat Completions (`https://gateway.dothoosh.com/v1`).

Only the provider id, base URLs, the `DOTHOOSH_API_KEY` variable name and the default model id
(`deepseek-v4-pro`, used by onboarding) are static. Before the first successful fetch the plugin
shows just that one default model, with placeholder limits and no price. If a fetch fails, the provider reports
itself unavailable rather than showing a stale price list. Run `openclaw models list --provider dothoosh` to see the live list.

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
