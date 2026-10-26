# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- A "Website or docs feedback" issue template, so feedback about irishopendata.ie and the docs has a clear route.
- The legal pilot now appears as a beta on the website and in the README, with a plain-English [assessment](docs/legal-beta-assessment.md) of coverage, licences and risks. `LEGAL_ENABLED` stays off by default.
- Skills pack 0.2.0: 16 cross-dataset skills (area comparison, where-to-live shortlist, local election brief, Oireachtas tracker, lobbying watch, council budgets, public money, EU funding, pay gap, planning and heritage, transport reliability, safety stats, energy, housing supply, dereliction and vacancy, rights check), with related Irish civic-tech projects credited in `skills/_shared/inspirations.md`.
- Irish law coverage in the `legislation` source: `legislation_get_constitution_article` (Bunreacht na hÉireann in English or Irish, by Article and section), `legislation_list_sis` and `legislation_get_si` (Statutory Instruments as made, with parent-Act powers, amended SIs and transposed EU acts), and `legislation_get_act_effects` (Legislation Directory commencement, amendments and SIs made under an Act). Responses carry "Not legal advice" and "enacted text is not amended text" warnings.
- `cachedText` accepts `validate`, so HTML soft-error pages are rejected before caching.
- The legal beta assessment records the 26 October 2026 finding that Citizens Information returns HTTP 403 to automated clients, including the pilot's own user-agent, and what wider coverage needs.

### Changed
- README opens in plain English: what you can ask, a 30-second setup, how to check an answer and a **Beta features** section near the top. Developer detail sits lower.

### Fixed
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
