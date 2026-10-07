# v1.1.0 real-client transcripts

Hosted endpoint `https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp`, 7 October 2026, after deploying commit `6882a97` (v1.1.0). Both questions use sources added in v1.1.0 (EPA bathing water, NCSE).

## GitHub Copilot CLI

Prompt: "Using only the ireland-hosted MCP server, how many special needs assistant (SNA) or special education teaching allocations does NCSE publish for 2026-2027, and which dataset is it? Give the source URL."

Tool calls: `ncse_search_datasets` → `ncse_get_dataset` → `ncse_query_datastore` ×3.

> NCSE publishes **3,902 school-level allocation records** for 2026–2027 in the **"2026-2027 School Allocations"** dataset.
>
> | Allocation resource | Records |
> |---|---:|
> | SNA and SET hours — primary schools | 3,048 |
> | SNA and SET hours — post-primary schools | 721 |
> | Special-school allocations | 133 |
> | **Total** | **3,902** |
>
> This counts published school records, **not the total number of SNA or teaching posts**.
>
> **Source URL:** https://opendata.ncse.ie/dataset/2026-2027-school-allocations

Prompt: "Using only the ireland-hosted MCP server, list three Irish bathing-water locations with their EPA annual water quality classification. Cite the source URL."

Tool calls: `ireland_describe` (`epa_bathing_locations`) → `ireland_call`.

> | Bathing-water location | County | EPA annual classification (2025) |
> |---|---|---|
> | Loughrea Lake | Galway | Excellent |
> | Garrylucas, White Strand | Cork | Excellent |
> | Garryvoe | Cork | Good |
>
> Source: [EPA bathing-water locations API](https://data.epa.ie/bw/api/v1/locations?page=1&per_page=3)
>
> These classifications use bacteriological results from **2022–2025**; they are not current swimming-safety advice.

## VS Code Insiders, Copilot agent mode (GPT-5.6 Sol)

Prompt: "Using only the ireland MCP server tools: list three Irish bathing-water locations with their EPA annual water-quality classification, and tell me which NCSE dataset publishes 2026-2027 school allocations. Cite the source URLs the tools return."

Tool calls (9 steps, 1 min 23 s): `search` → `ireland_call epa_bathing_locations` (first with empty args, then `{page: 1, limit: 3}`) → `search` → `fetch ncse:2026-2027-school-allocations`.

> | Location | County | EPA classification |
> |---|---|---|
> | Loughrea Lake | Galway | **Excellent** |
> | Garrylucas, White Strand | Cork | **Excellent** |
> | Garryvoe | Cork | **Good** |
>
> **EPA source:** [Bathing Water Locations API](https://data.epa.ie/bw/api/v1/locations?page=1&per_page=3)
>
> The dataset is **[2026-2027 School Allocations](https://opendata.ncse.ie/dataset/2026-2027-school-allocations)**, published by **Resource Allocation**. It provides CSV resources covering primary-school SNA and SET hours, post-primary-school SNA and SET hours, and special-school allocations.

All three answers agreed with each other and with the MCP Inspector run, and each cited the URL the tool returned.
