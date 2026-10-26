# Development

## Run from source

Needs Node 22.12 or later.

```bash
git clone https://github.com/c-mongan/ireland-mcp
cd ireland-mcp
npm ci
npm run build
node dist/src/cli.js
npm run dev:http     # local HTTP dev server, MCP at /mcp
```

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests against recorded fixtures; no network. |
| `npm run typecheck && npm run lint` | TypeScript and ESLint. |
| `npm run build` | Compile production JS and copy runtime assets. |
| `npm run inspector:check` | MCP Inspector conformance. |
| `npm run check` | Lint, types, unit tests, package/deployment contracts and a real stdio MCP client check. |
| `npm run check:ui` | Storybook MCP, visual fixtures, accessibility and production website browser checks. Install Chromium first with `npx playwright install chromium`. |
| `npm run check:mcp -- --url https://mcp.irishopendata.ie/mcp` | Hosted MCP protocol and catalogue checks. It makes no upstream data requests. |
| `npm run measure:tools [-- all]` | Measure default or all-tool `tools/list`. |
| `npm run live:sanity` | Real source calls through `ireland_call`; includes the stored legal pilot when `LEGAL_ENABLED=true` or the root catalogue advertises it. Prints a Markdown receipt. See [docs/live-sanity.md](live-sanity.md). |
| `npm run live:all [-- --url https://mcp.irishopendata.ie/mcp]` | Real MCP client proof for every catalogue operation; writes [docs/live-all-ops.md](live-all-ops.md). |
| `npm run eval` | Promptfoo evaluation; default surface unless `EVAL_TOOLSETS=all`. |

The [quality loop](quality-loop.md) explains local, hosted, semantic and visual proof. The [playground access guide](playground-auth.md) distinguishes the public query playground from ChatGPT sign-in and subscription use.

### Eval results

69 routing questions, run through a multi-round agent loop that sends the server instructions as the system prompt (2026-10-05, Azure OpenAI):

| Model | Default surface (7 tools) | `all` surface (74 tools at the time) |
| --- | --- | --- |
| gpt-5.6-luna | **100%** | **100%** |
| gpt-5.4-mini | 91% | 97% |
| gpt-4.1-nano (worst-case floor) | 84% | 90% |

A 2026-10-07 rerun of the expanded 79-question set with 29 sources at the time scored gpt-4.1-nano at 85% on the default surface.

gpt-5.x models reject `temperature: 0`. For them, set `EVAL_TEMPERATURE=default`, for example: `AZURE_DEPLOYMENT=gpt-56-luna EVAL_TEMPERATURE=default npm run eval`.

## Registry and publishing

Ireland MCP is **listed on the [official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.c-mongan%2Fireland-mcp/versions/latest)** as `io.github.c-mongan/ireland-mcp`, with the hosted Streamable HTTP endpoint and the `ireland-mcp` npm package. Clients that browse the registry can install it by name. The future domain name is planned as `ie.irishopendata/ireland` after DNS verification. Publishing notes and directory checklists are in [docs/publishing.md](publishing.md). Do not publish from a fork without changing the name and endpoint.
