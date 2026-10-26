# Skills and plugins

This repository is both a **plugin** and a **plugin marketplace**. Installing it gives your agent:

- the hosted, read-only **Ireland MCP server** (no API key), and
- a pack of **Agent Skills** in [`skills/`](../skills) that tell the agent how to answer common Irish
  public-data questions with citations.

## Server URL (one place to change)

```
IRELAND_MCP_URL = https://mcp.irishopendata.ie/mcp
```

`https://mcp.irishopendata.com/mcp` remains a working alias. If the URL changes, replace it
above in **two files only**: [`.mcp.json`](../.mcp.json) (Claude Code) and [`mcp.json`](../mcp.json)
(Agent Plugins: Copilot CLI, VS Code). `test/skills.test.ts` checks that both files agree.

## Skills

The pack has 25 skills. Single-source skills answer one kind of question; cross-dataset skills plan
several calls, join the results on shared keys (county, local authority, electoral division,
constituency, date) and cite every source.

### Places, property and housing

| Skill | What it does | Main sources |
|---|---|---|
| `irish-area-report` | One-page profile of a county, town or point | CSO census, GeoHive, PPR, Met Éireann |
| `compare-two-areas` | Two places side by side: population, deprivation, prices, rents | CSO, Pobal, PPR, RTB via CSO, GeoHive |
| `where-to-live-shortlist` | Matrix for 2–6 candidate towns: cost, transport, deprivation, schools | PPR, RTB via CSO, TFI stops, Irish Rail, Pobal, NCSE |
| `house-price-check` | Recorded sale prices, medians and recent sales | Property Price Register |
| `housing-supply-tracker` | Completions, vacancy, rents and prices for a council or LEA | CSO (NDQ, NDA, VAC, RIQ), PPR, planning |
| `derelict-and-vacancy` | Vacancy rates and each council's Derelict Sites Register | CSO VAC tables, data.gov.ie |
| `planning-and-heritage-near-me` | Planning applications, monuments and protected sites around a point | NPAD, NMS SMR, NPWS, GSI |

### Politics, law and accountability

| Skill | What it does | Main sources |
|---|---|---|
| `td-briefing` | Neutral briefing on a TD or Senator | Oireachtas |
| `local-election-brief` | Constituency brief: sitting TDs, their questions, local data | GeoHive, Oireachtas, CSO, PPR |
| `oireachtas-tracker` | Votes, bills, debates and questions over a period or topic | Oireachtas, Irish Statute Book |
| `lobbying-watch` | Register of Lobbying returns linked to members and bills | Lobbying.ie (SIPO), Oireachtas |
| `legislation-lookup` | Quote Irish Acts and sections | Irish Statute Book, Oireachtas |
| `rights-check` | The law behind a rights question, pending bills, where to get help (not legal advice) | Irish Statute Book, Oireachtas |

### Public money and economy

| Skill | What it does | Main sources |
|---|---|---|
| `council-budget-compare` | Adopted council budgets by division, per resident, across years | Council budget workbooks, CSO |
| `public-money-tracker` | Council budgets, EU tenders and EU-funded projects for one place or topic | Council budgets, TED, Kohesio, Lobbying.ie |
| `eu-funding-finder` | EU cohesion-funded projects by place, region or theme | Kohesio, TED, Eurostat |
| `pay-gap-compare` | Employer gender pay gap reports compared | PayGap.ie, CSO |

### Transport, energy, environment and safety

| Skill | What it does | Main sources |
|---|---|---|
| `commute-weather` | Live trains, Luas, bus delays and weather | Irish Rail, Luas, NTA, Met Éireann |
| `transport-reliability-check` | Live lateness and disruption snapshot for rail, Luas and bus | Irish Rail, Luas, NTA (if configured) |
| `grid-now` | Electricity demand, wind share and CO2 now | EirGrid |
| `energy-and-grid-explainer` | Live grid figures beside annual renewables share, Ireland vs EU | EirGrid, Eurostat, CSO |
| `flood-watch` | River levels, rain warnings and buoys | OPW, Met Éireann, Marine Institute |
| `safety-stats` | Road casualties and recorded crime by county or Garda division | RSA and CSO tables via CSO PxStat |

### Data discovery

| Skill | What it does | Main sources |
|---|---|---|
| `cso-chart` | Find, filter and chart a CSO table | CSO PxStat |
| `open-data-finder` | Find and preview open datasets | data.gov.ie, Smart Dublin |

### Related civic-tech projects

Many of these skills answer questions that independent Irish civic-tech projects also answer from the
same public data, such as Oireachtas Explorer, Lobbyieng, Local Authority Finances, PayGap.ie and
PlanningRegister.ie. [`skills/_shared/inspirations.md`](../skills/_shared/inspirations.md) credits
each project and owner, links its site, maps it to the operations a skill uses and says whether the
coverage is full or partial. The list was drawn from William Kennedy's MIT-licensed
[eire_civic_tech_directory](https://github.com/williamkennedy/eire_civic_tech_directory). No
affiliation or endorsement is implied either way. Each skill names its related projects in a
**Related projects** line.

All skills share the attribution rules in [`skills/_shared/citations.md`](../skills/_shared/citations.md).
Skills reference only sources on the default hosted server; the opt-in legal beta is never required.
The server's default surface lists only the meta tools (`ireland_catalogue`, `ireland_describe`,
`ireland_call`, `ireland_about`, `search`, `fetch`, `nearby`). Skills name each step as a source and
operation (e.g. `ppr/ppr_price_stats`) and run it with
`ireland_call { "source": "ppr", "operation": "ppr_price_stats", "args": { ... } }`, calling
`ireland_describe { "source", "operation" }` first when the argument shape is unclear.

To also list every typed tool (about 10.8k tokens of tool definitions instead of the lean default),
append `?toolsets=all` to the URL, or a comma list such as `?toolsets=ppr,cso`. The skills work
either way.

## Updating

After a release (the version is in [`plugin.json`](../plugin.json)), refresh the plugin to get new skills:

- Claude Code: `claude plugin marketplace update ireland-mcp`, then `claude plugin update ireland-mcp@ireland-mcp`.
- Copilot CLI: `copilot plugin update ireland-mcp`.
- VS Code: update it from the Extensions view (`@agentPlugins`).

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
   Each zip contains the skill folder plus the `_shared/` files (`citations.md`, `inspirations.md`).
2. In claude.ai, open **Settings → Capabilities → Skills**, choose **Upload skill** and pick a zip.
3. Add the MCP server as a custom connector using the URL above, so the skill can call it.

## Other MCP clients

Any client that supports remote Streamable HTTP servers can use the URL above directly. There is no
authentication. All data is read-only public data; each response carries its publisher and licence.
