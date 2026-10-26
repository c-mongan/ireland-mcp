# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Dataset cards for every source (`src/sources/<id>/card.ts`): topics, geography levels, time coverage, update cadence, key dimensions, join keys, freshness, operator-key needs and example questions, with per-operation overrides and unverified fields marked `unknown` with a reason. `ireland_catalogue` takes optional `topic`, `geo_level`, `join_key`, `has_time_series` and `text` filters and then returns only matching operations with compact cards; with no filter its output is unchanged. `ireland_describe` with only `source` returns the full card, and with an operation it adds the operation's card. See [docs/dataset-cards.md](docs/dataset-cards.md).
- `cso_search_tables` ranks tables by geography level when the query names one ("completions LEA", "population council") or `geo_level` is passed, and lists each table's `geo_levels`. Cross-source `search` uses the same ranking. Without a level the CSO's order is kept.
- `node evals/multistep/discovery.mjs` (`npm run eval:discovery`) measures how well search and the filtered catalogue surface the tables and operations the dataset-card benchmark items need.
- Place crosswalk: `ireland_resolve_place` (default surface, and `cross/ireland_resolve_place` through `ireland_call`). It maps a place name, a CSO label, an ED, small-area or NUTS3 code, a Dublin postal district or a point to its county, province, council, LEA, Dáil constituency, NUTS3 region and electoral division. Areas that straddle a boundary come with population shares. `list` returns the EDs, LEAs, constituencies or councils inside an area. It reads a pinned, checksummed table built from CSO Census 2022 and Tailte Éireann boundaries (CC BY 4.0) by `scripts/build-crosswalk.mjs`, published at `/data/crosswalk/places-2022.json`. Garda, HSE and Eircode areas are not covered: no open boundary file was found. See `docs/crosswalk.md`.
- `nearby` and `ireland_snapshot` return a `codes` block (ED, LEA, constituency, council, county, NUTS3) from the crosswalk.
- A "Website or docs feedback" issue template, so feedback about irishopendata.ie and the docs has a clear route.
- The legal pilot now appears as a beta on the website and in the README, with a plain-English [assessment](docs/legal-beta-assessment.md) of coverage, licences and risks. `LEGAL_ENABLED` stays off by default.
- Skills pack 0.2.0: 16 cross-dataset skills (area comparison, where-to-live shortlist, local election brief, Oireachtas tracker, lobbying watch, council budgets, public money, EU funding, pay gap, planning and heritage, transport reliability, safety stats, energy, housing supply, dereliction and vacancy, rights check), with related Irish civic-tech projects credited in `skills/_shared/inspirations.md`.
- Irish law coverage in the `legislation` source: `legislation_get_constitution_article` (Bunreacht na hÉireann in English or Irish, by Article and section), `legislation_list_sis` and `legislation_get_si` (Statutory Instruments as made, with parent-Act powers, amended SIs and transposed EU acts), and `legislation_get_act_effects` (Legislation Directory commencement, amendments and SIs made under an Act). Responses carry "Not legal advice" and "enacted text is not amended text" warnings.
- `cachedText` accepts `validate`, so HTML soft-error pages are rejected before caching.
- The legal beta assessment records the 26 October 2026 finding that Citizens Information returns HTTP 403 to automated clients, including the pilot's own user-agent, and what wider coverage needs.
- Hard multi-step benchmark (`npm run eval:multistep`): 41 questions across three tiers that each combine at least two sources. Reference answers are pinned and recomputed through the real tools. Each failing question is tagged with the capability that would unlock it: dataset cards, place crosswalk, server-side query or knowledge index. A nightly references-only workflow needs no model key. See `docs/evals-multistep.md`.
- `oireachtas_get_bill`: one bill's stages, sponsors and versions, found by bill number or by the Act it became, with the enacted Act's Irish Statute Book ELI and Legislation Directory links.
- New `eu-law` source: `eu_law_lookup` returns EU act metadata (title, type, dates, in-force flag, ELI, CELEX) from the Publications Office Cellar SPARQL endpoint by CELEX or ELI, attributed under Commission Decision 2011/833/EU.

### Changed
- Website rewritten in plain English: "Ask AI about Ireland. See the source.", sample questions, three-step setup, a "Built to be checked" trust section, an FAQ and a clearly labelled **Beta: Irish law and your rights** section (off on the hosted server, not legal advice).
- `geohive_boundaries_at_point` reads LEAs from the 2024 statutory boundaries (166 LEAs, as used in the 2019 and 2024 local elections) instead of the 2014 layer (137 LEAs). Each LEA now has its Irish name and boundary id. The electoral division adds `ed_id`, the 6-digit id that Census 2022, Pobal and the crosswalk use; `cso_code` is CSO's older code.
- Pobal `pobal_deprivation_search` returns 6-digit `ed_id`s ("068001", not "68001"), matching CSO and GeoHive. It accepts either form.
- Multi-step benchmark: crosswalk-tagged references now use `ireland_resolve_place`. Each keeps the old hand-written mapping as a cross-check. `t3-lowest-deprivation-galway-city-td` now has a reference. `t3-rent-growth-completions-tds` is re-tagged `source:rtb-lea-rents`, because CSO has no LEA-level RTB rents.
- README opens in plain English: what you can ask, a 30-second setup, how to check an answer and a **Beta features** section near the top. Developer detail sits lower.

### Fixed
- `cso_get_table_metadata` and `cso_get_data` accept CSO table codes longer than 12 characters, such as the Census small-area tables `SAP2022T1T1CTY`, which `cso_search_tables` returns.
- CKAN portals (data.gov.ie, Smart Dublin, CRO, NCSE) no longer cache a `success:false` response for the cache TTL; the next call retries upstream.
- `fetch` now resolves the `eurostat:` and `wikidata:` ids that `search` returns; before, it answered NOT_FOUND. The NOT_FOUND hint lists only sources that can fetch, and an empty key (`cso:`) returns BAD_ARGS.
- EirGrid `grid_get_status`: an all-empty chart is now a transient failure. It is retried once, never cached (an earlier copy is served flagged stale when there is one), and the output `note` says when a value came from yesterday or is missing (#106).
- Fáilte Ireland `failte_search`: when the publisher's open-data API runs out of its shared bandwidth quota (HTTP 403 "Out of bandwidth quota"), the tool now returns `RATE_LIMITED` with the reset time, or an earlier export flagged stale, instead of a generic access error. The export is cached for a day instead of an hour to use less of that quota. The nightly live smoke reports this exact error as WARN (#110).
- Irish Statute Book licence: the eISB is re-used under the Oireachtas (Open Data) PSI Licence, which incorporates CC BY 4.0, not the PSI General Licence. Updated the source envelope, legal pilot policy, NOTICE, README, site, skills and source-policy note, and replaced the dead `eli/copyright.html` link with `eli/open-data.html`.

## [1.1.4] - 2026-10-08

### Changed
- irishopendata.ie is now the canonical site and `https://mcp.irishopendata.ie/mcp` the primary endpoint. irishopendata.com and mcp.irishopendata.com remain working aliases. Infrastructure as code covers both apexes and the mcp.ie managed certificate (#67).

## [1.1.3] - 2026-10-08

### Changed
- Site moved to irishopendata.com with MCP at `https://mcp.irishopendata.com/mcp`; the azurewebsites.net origin still works.
- Footer disclaimer, configurable canonical site, updated install links and Registry metadata.

## [1.1.2] - 2026-10-08

### Fixed
- Kohesio now answers from packaged, dated official Irish CSV exports (snapshot 2026-09-24; 979 projects, 2014-2020 and 2021-2027) instead of the rate-limited frontend API that returned HTTP 403 to Azure. Every answer carries `snapshot_date` and `live: false`. `scripts/refresh-kohesio.mjs` refreshes and validates the snapshot (#58).

## [1.1.1] - 2026-10-07

Fixes from independent QA round 2.

### Added
- `ireland_call` accepts `arguments` as an alias for `args` (#55).
- VS Code install links, a site 404 page and NCSE on the status page (#53).

### Changed
- Current Oireachtas members are returned by default, with `include_former` for the rest (#52).
- One source of truth for counts, with a CI check; discovery files point at the live URLs (#53).
- Wikidata citations use https (#56).

### Fixed
- EPA bathing-water paging no longer drops rows; caller errors never trip the circuit breaker; Wikidata place lookups are bounded and cached; clearer upstream 4xx and timeout messages (#52).
- EirGrid falls back to the previous day just after midnight (#54).

[Unreleased]: https://github.com/c-mongan/ireland-mcp/compare/v1.1.4...HEAD
[1.1.4]: https://github.com/c-mongan/ireland-mcp/releases/tag/v1.1.4
[1.1.3]: https://github.com/c-mongan/ireland-mcp/releases/tag/v1.1.3
[1.1.2]: https://github.com/c-mongan/ireland-mcp/releases/tag/v1.1.2
[1.1.1]: https://github.com/c-mongan/ireland-mcp/releases/tag/v1.1.1
