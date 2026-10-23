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

Routing is handled by the plugin: Claude models use the Anthropic Messages endpoint
(`https://gateway.dothoosh.com/anthropic`), GPT-6 models use the OpenAI Responses API, and the
rest use OpenAI Chat Completions (`https://gateway.dothoosh.com/v1`). All models are text input.

## Models

| Model ref | Name | API route |
| --- | --- | --- |
| `dothoosh/deepseek-v4-pro` | DeepSeek V4 Pro | openai-completions |
| `dothoosh/deepseek-flash` | DeepSeek V4.1 Flash | openai-completions |
| `dothoosh/kimi-k3` | Kimi K3 | openai-completions |
| `dothoosh/kimi-k2.7-code` | Kimi K2.7 Code | openai-completions |
| `dothoosh/kimi-k2.6` | Kimi K2.6 | openai-completions |
| `dothoosh/gemini-4-argon` | Gemini 4 Argon | openai-completions |
| `dothoosh/gemini-3.8-flash` | Gemini 3.8 Flash | openai-completions |
| `dothoosh/gemini-3.5-flash-lite` | Gemini 3.5 Flash Lite | openai-completions |
| `dothoosh/gpt-6.1-sol` | GPT-6.1 Sol | openai-responses |
| `dothoosh/gpt-6-astra` | GPT-6 Astra | openai-responses |
| `dothoosh/gpt-6-luna` | GPT-6 Luna | openai-responses |
| `dothoosh/claude-opus-5-5` | Claude Opus 5.5 | anthropic-messages |
| `dothoosh/claude-sonnet-5-5` | Claude Sonnet 5.5 | anthropic-messages |
| `dothoosh/claude-haiku-5-5` | Claude Haiku 5.5 | anthropic-messages |
| `dothoosh/claude-fable-5-1` | Claude Fable 5.1 | anthropic-messages |

Context windows, limits and prices are defined in `src/models.ts`.

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
