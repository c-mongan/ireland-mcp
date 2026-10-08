# Real-client demo evidence

## v1.1.1 QA re-run (7 October 2026, commit `d64cc20`)

| Client | Question | Result | Citation checked |
| --- | --- | --- | --- |
| MCP Inspector (Playwright) | Nearby, CSO Ennis, Met Galway, PPR, EPA bathing locations | Pass, 5/5 | [`inspector/`](qa-r2/inspector/) screenshots |
| GitHub Copilot CLI | Current TDs for Galway West; Salthill bathing water; Kilkee on Wikidata | Pass, 3/3 | Oireachtas, EPA and Wikidata URLs in [`copilot-cli-v1.1.1.md`](qa-r2/copilot-cli-v1.1.1.md) |
| VS Code Insiders | `vscode-insiders:mcp/install?...` link from the README | Pass: opens the MCP server install page with the hosted URL | n/a |
| Raw MCP calls | QA findings H1–H4 and M6 | Pass | [`hosted-checks.md`](qa-r2/hosted-checks.md) |

## v1.1.0 re-run (7 October 2026, commit `6882a97`)

| Client | Question | Result | Citation checked |
| --- | --- | --- | --- |
| MCP Inspector (Playwright) | The four calls below plus `epa_bathing_locations` (new in v1.1.0) | Pass, 5/5 | As below, plus `data.epa.ie/bw/api/v1/locations` |
| GitHub Copilot CLI | NCSE 2026-2027 school allocations (new source) | Pass | `https://opendata.ncse.ie/dataset/2026-2027-school-allocations` |
| GitHub Copilot CLI | Three EPA bathing-water classifications (new source) | Pass | `https://data.epa.ie/bw/api/v1/locations?page=1&per_page=3` |
| VS Code Insiders, Copilot agent mode (GPT-5.6 Sol) | EPA bathing classifications and the NCSE allocations dataset | Pass | Both URLs above |

Answers are in [`transcripts-v1.1.0.md`](transcripts-v1.1.0.md); the Inspector result is [`inspector-epa-bathing-locations.png`](inspector-epa-bathing-locations.png). The current hosted result is in [live-all-ops](../live-all-ops.md).

## v1.0 run

All runs used the hosted endpoint `https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp` on 7 October 2026, after deploying commit `8b8d530`.

| Client                                             | Question                                                                                                 | Result                                                                                                                                                                     | Citation checked                                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| MCP Inspector (Playwright)                         | `nearby` Galway city; `cso_area_profile` Ennis; `met_get_forecast` Galway; `ppr_price_stats` Galway 2024 | Pass, 4/4                                                                                                                                                                  | CC BY 4.0 licence on `nearby`, `data.cso.ie/table/F1015`, Met Éireann forecast URL, `propertypriceregister.ie`              |
| VS Code Insiders, Copilot agent mode (GPT-5.6 Sol) | Census 2022 profile of Ennis and Met Éireann forecast for Galway                                         | Pass                                                                                                                                                                       | `https://data.cso.ie/table/F1015`; `http://openaccess.pf.api.met.ie/metno-wdb2ts/locationforecast?lat=53.2707;long=-9.0568` |
| GitHub Copilot CLI                                 | Met Éireann forecast for Galway                                                                          | Pass                                                                                                                                                                       | Met Éireann location-forecast URL                                                                                           |
| GitHub Copilot CLI                                 | Median residential sale price in Cork city, 2024                                                         | Pass                                                                                                                                                                       | Property Price Register 2024 Cork CSV URL                                                                                   |
| GitHub Copilot CLI                                 | CSO profile of Ennis                                                                                     | Pass after [#37](https://github.com/c-mongan/ireland-mcp/pull/37) added Census 2022 towns. Before that fix, the tool correctly refused to substitute County Clare figures. | `https://data.cso.ie/table/F1015`                                                                                           |

Files:

- [`inspector.gif`](inspector.gif): recorded with `node scripts/demo-inspector.mjs --out <dir>`. The script asserts that each result contains a source URL.
- [`inspector-cso-ennis.png`](inspector-cso-ennis.png), [`inspector-ppr-galway-2024.png`](inspector-ppr-galway-2024.png)
- [`vscode-copilot-chat.png`](vscode-copilot-chat.png): the end of the VS Code answer, showing the prompt, the CSO source and the Met Éireann section with its source.

The Ennis answer from VS Code and Copilot CLI agreed: 27,923 people (13,377 male, 14,546 female), average age 38.9.

Not tested: Claude Desktop (not installed on the test machine) and ChatGPT developer-mode connectors (these need the account owner to enable Developer mode in ChatGPT web settings). The setup steps for both are in the main [README](../../README.md#install).
