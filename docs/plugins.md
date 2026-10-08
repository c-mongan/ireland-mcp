# Skills and plugins

This repository is both a **plugin** and a **plugin marketplace**. Installing it gives your agent:

- the hosted, read-only **Ireland MCP server** (no API key), and
- a pack of **Agent Skills** in [`skills/`](../skills) that tell the agent how to answer common Irish
  public-data questions with citations.

## Server URL (one place to change)

```
IRELAND_MCP_URL = https://mcp.irishopendata.com/mcp
```

The `.ie` endpoint `https://mcp.irishopendata.ie/mcp` is planned. If the URL changes, replace it
above in **two files only**: [`.mcp.json`](../.mcp.json) (Claude Code) and [`mcp.json`](../mcp.json)
(Agent Plugins: Copilot CLI, VS Code). `test/skills.test.ts` checks that both files agree.

## Skills

| Skill | What it does | Main sources |
|---|---|---|
| `irish-area-report` | One-page profile of a county, town or point | CSO census, GeoHive, PPR, Met Éireann |
| `house-price-check` | Recorded sale prices, medians and recent sales | Property Price Register |
| `td-briefing` | Neutral briefing on a TD or Senator | Oireachtas |
| `commute-weather` | Live trains, Luas, bus delays and weather | Irish Rail, Luas, NTA, Met Éireann |
| `grid-now` | Electricity demand, wind share and CO2 now | EirGrid |
| `flood-watch` | River levels, rain warnings and buoys | OPW, Met Éireann, Marine Institute |
| `cso-chart` | Find, filter and chart a CSO table | CSO PxStat |
| `legislation-lookup` | Quote Irish Acts and sections | Irish Statute Book, Oireachtas |
| `open-data-finder` | Find and preview open datasets | data.gov.ie, Smart Dublin |

All skills share the attribution rules in [`skills/_shared/citations.md`](../skills/_shared/citations.md).
The server's default surface lists only the meta tools (`ireland_catalogue`, `ireland_describe`,
`ireland_call`, `ireland_about`, `search`, `fetch`, `nearby`). Skills name each step as a source and
operation (e.g. `ppr/ppr_price_stats`) and run it with
`ireland_call { "source": "ppr", "operation": "ppr_price_stats", "args": { ... } }`, calling
`ireland_describe { "source", "operation" }` first when the argument shape is unclear.

To also list every typed tool (about 10.8k tokens of tool definitions instead of the lean default),
append `?toolsets=all` to the URL, or a comma list such as `?toolsets=ppr,cso`. The skills work
either way.

## Claude Code

```
/plugin marketplace add c-mongan/ireland-mcp
/plugin install ireland-mcp@ireland-mcp
```

Claude Code reads [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json) and
[`.claude-plugin/plugin.json`](../.claude-plugin/plugin.json), loads skills from `skills/` and the MCP
server from `.mcp.json`. Run `/mcp` to confirm the `ireland` server is connected.

MCP server only, without skills: `claude mcp add --transport http ireland <IRELAND_MCP_URL>`.

## GitHub Copilot CLI

```
copilot plugin marketplace add c-mongan/ireland-mcp
copilot plugin install ireland-mcp@ireland-mcp
```

Or install straight from the repository: `copilot plugin install c-mongan/ireland-mcp`.
Copilot CLI uses the root [`plugin.json`](../plugin.json) (Agent Plugins 1.0), skills from
`skills/<name>/SKILL.md` and the server from root [`mcp.json`](../mcp.json).
To try a local checkout without installing: `copilot --plugin-dir /path/to/ireland-mcp`.

## VS Code (Agent Plugins)

1. Make sure `chat.plugins.enabled` is `true`.
2. Either run **Chat: Install Plugin From Source** and enter `https://github.com/c-mongan/ireland-mcp`,
3. or add the marketplace to your **user** settings and install from the Extensions view (`@agentPlugins`):

```json
"chat.plugins.marketplaces": ["c-mongan/ireland-mcp"]
```

Plugins you installed with Copilot CLI also appear in VS Code automatically.

## claude.ai (upload a skill)

1. Build the zips: `npm run skills:package`. This writes one zip per skill to `dist/skills/<name>.zip`.
   Each zip contains the skill folder plus `_shared/citations.md`.
2. In claude.ai, open **Settings → Capabilities → Skills**, choose **Upload skill** and pick a zip.
3. Add the MCP server as a custom connector using the URL above, so the skill can call it.

## Other MCP clients

Any client that supports remote Streamable HTTP servers can use the URL above directly. There is no
authentication. All data is read-only public data; each response carries its publisher and licence.
