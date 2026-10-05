# Ireland MCP

[![CI](https://github.com/c-mongan/ireland-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/c-mongan/ireland-mcp/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-34c08a.svg)](LICENSE)

**TL;DR:** one free, read-only [Model Context Protocol](https://modelcontextprotocol.io)
server that lets Claude, ChatGPT, GitHub Copilot and other AI assistants look up
Irish public data. Ask "What's the population of Galway?", "Any weather warnings
today?" or "What did houses sell for in Ennis last year?" and the assistant gets
real figures, with the source, licence and retrieval time attached.

- **14 sources, 41 tools.** CSO, Oireachtas, GeoHive, data.gov.ie, Smart Dublin,
  Met Éireann, NTA, the Irish Statute Book, the Property Price Register, Irish Rail,
  Luas, EirGrid, Marine Institute weather buoys and OPW river levels.
- **Two ways to run it.** A hosted Streamable HTTP endpoint (`/mcp`), or locally
  over stdio with `npx -y ireland-mcp`.
- **No accounts.** Nothing to sign up for. Nothing is written anywhere.

![Architecture](docs/architecture/ireland-mcp-arch-v4.png)

> **Hosted endpoint:** `https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp`
> (Streamable HTTP, no key needed). The npm package is not published yet; until it is,
> run the stdio server from source (see [Run from source](#run-from-source)).

## Tools

| Source | Tools | Data |
| --- | --- | --- |
| CSO PxStat | `cso_search_tables`, `cso_get_table_metadata`, `cso_get_data`, `cso_area_profile` | National statistics: census, prices, labour, housing |
| Oireachtas | `oireachtas_search_members`, `oireachtas_search_bills`, `oireachtas_get_debates`, `oireachtas_search_questions`, `oireachtas_get_votes` | TDs and Senators, bills, debates, PQs, divisions |
| GeoHive | `geohive_boundaries_at_point`, `geohive_list_layers`, `geohive_query_layer` | County, constituency, LEA, electoral division, small area |
| data.gov.ie | `datagov_search_datasets`, `datagov_get_dataset`, `datagov_query_datastore` | National open data catalogue |
| Smart Dublin | `smartdublin_search_datasets`, `smartdublin_get_dataset`, `smartdublin_query_datastore` | Dublin local authority datasets |
| Met Éireann | `met_get_forecast`, `met_get_observations`, `met_get_warnings` | Point forecasts, station observations, warnings |
| NTA | `nta_get_realtime_summary`, `nta_get_trip_updates` | Live GTFS-R delays and cancellations (operator key) |
| Irish Statute Book | `legislation_list_acts`, `legislation_get_act`, `legislation_get_section` | Acts by year, Act and section text via ELI |
| Property Price Register | `ppr_search_sales`, `ppr_price_stats` | Residential sales since 2010, area statistics |
| Irish Rail | `rail_find_station`, `rail_get_departures` | Live train departures for every station |
| Luas (TII) | `luas_get_forecast`, `luas_list_stops` | Live tram arrivals, stop list, service messages |
| EirGrid | `grid_get_status` | Live demand, wind generation and carbon intensity |
| Marine Institute | `marine_get_buoys` | Offshore wind, waves, air and sea temperature |
| OPW (waterlevel.ie) | `water_find_stations`, `water_get_level` | River and lake levels at ~460 gauges, last 36 hours |
| Cross-source | `search`, `fetch`, `list_sources`, `ireland_snapshot`, `nearby` | Search everything, fetch by id, place summaries |

`search` and `fetch` follow the ChatGPT deep research contract. `search` returns
`[{id, title, url}]` with ids such as `cso:FY003A`, `oireachtas:bill/2024/12` or
`legislation:2024/1`; `fetch(id)` returns `{id, title, text, url, metadata}`.

Every other tool returns an **evidence envelope**:

```json
{
  "data": { "...": "..." },
  "source": "Met Éireann",
  "url": "https://www.met.ie/Open_Data/json/warning_IRELAND.json",
  "licence": "CC BY 4.0",
  "attribution": "Copyright Met Éireann. Source: www.met.ie. ...",
  "retrieved_at": "2026-10-05T12:00:00.000Z",
  "cached": false,
  "truncated": false
}
```

`stale: true` means the source was down and you are seeing the last good copy.
Failures are typed: `BAD_ARGS`, `NOT_FOUND`, `UPSTREAM_DOWN`, `RATE_LIMITED`,
each with a hint the model can act on. Lists default to 50 items, max 500.

## Connect a client

The hosted URL is `https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp`.
If you deploy your own copy, use your own function app URL instead.

### Claude Desktop (local, stdio)

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ireland": { "command": "npx", "args": ["-y", "ireland-mcp"] }
  }
}
```

### Claude (remote connector)

Settings → Connectors → **Add custom connector**, then paste the hosted `/mcp`
URL. No authentication is needed.

### ChatGPT (developer mode)

Settings → Apps & Connectors → Advanced settings → turn on **Developer mode**.
Create a connector with the hosted `/mcp` URL and **No authentication**. Deep
research uses `search` and `fetch`; chat can use every tool. Developer mode
availability depends on your plan and region — check it is offered in Ireland
and the EEA for your account before relying on it.

### VS Code

`.vscode/mcp.json` (the top-level key is `servers`):

```json
{
  "servers": {
    "ireland": { "type": "http", "url": "https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp" }
  }
}
```

Local alternative: `{ "type": "stdio", "command": "npx", "args": ["-y", "ireland-mcp"] }`.

### GitHub Copilot CLI

`.mcp.json` in a repo, or `~/.copilot/mcp-config.json` (the top-level key is `mcpServers`):

```json
{
  "mcpServers": {
    "ireland": { "type": "http", "url": "https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp", "tools": ["*"] }
  }
}
```

### Environment variables (local stdio)

| Variable | Needed for | Default |
| --- | --- | --- |
| `NTA_API_KEY` | `nta_*` tools. Free key from [developer.nationaltransport.ie](https://developer.nationaltransport.ie) | unset: NTA tools return a clear error |
| `PPR_INDEX_PATH` | Faster PPR lookups from a prebuilt index (`npm run ppr:build`) | `.ppr-cache/index-v1.json.gz`; falls back to live county CSVs |
| `IRELAND_MCP_TELEMETRY` | Set to `off` to silence the one-line JSON tool logs on stderr | on |

The hosted app also reads `RATE_LIMIT_PER_MINUTE` (default 60 per IP),
`AzureWebJobsStorage__accountName`, `CACHE_TABLE_NAME` and `PPR_CONTAINER`.

## Run from source

Needs Node 22.12 or later.

```bash
git clone https://github.com/c-mongan/ireland-mcp && cd ireland-mcp
npm install && npm run build
node dist/src/cli.js          # stdio server — point a client's "command" here
npm run dev:http              # http://localhost:7071 landing page, MCP at /mcp
npx @modelcontextprotocol/inspector node dist/src/cli.js   # browse the tools
```

## Development

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests against recorded fixtures — no network |
| `npm run test:coverage` | Same, with a coverage report |
| `npm run typecheck && npm run lint` | TypeScript and ESLint |
| `npm run inspector:check` | MCP conformance through the Inspector CLI (also in CI) |
| `npm run live:sanity` | One real call per source; results in [docs/live-sanity.md](docs/live-sanity.md) |
| `npm run eval` | 40 Irish questions through promptfoo. Uses `OPENAI_API_KEY`, or Azure OpenAI with `AZURE_API_KEY`, `AZURE_API_HOST` and `AZURE_DEPLOYMENT`; skips without a key |
| `npm run ppr:build` | Build the Property Price Register index locally |

CI runs lint, typecheck, tests, Inspector conformance and CodeQL. A nightly
workflow runs the live smoke test and opens an issue if a source breaks.

To add a source, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Hosting

The hosted endpoint runs on Azure Functions Flex Consumption in North Europe,
with a capped instance count, a Table Storage cache, and App Insights. The
landing page in `web/` deploys to a free Azure Static Web App. See
[docs/deploy.md](docs/deploy.md).

## Licence and data

Code: [MIT](LICENSE). Data stays under each publisher's licence — mostly
CC BY 4.0. Keep the `attribution` text from each response when you reuse data.
Per-source details and credits are in [NOTICE](NOTICE). Not affiliated with any
Irish government body. Security reports: [SECURITY.md](SECURITY.md).
