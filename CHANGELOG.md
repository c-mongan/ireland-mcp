# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- A "Website or docs feedback" issue template, so feedback about irishopendata.ie and the docs has a clear route.

### Fixed
- `fetch` now resolves the `eurostat:` and `wikidata:` ids that `search` returns; before, it answered NOT_FOUND. The NOT_FOUND hint lists only sources that can fetch, and an empty key (`cso:`) returns BAD_ARGS.
- EirGrid `grid_get_status`: an all-empty chart is now a transient failure. It is retried once, never cached (an earlier copy is served flagged stale when there is one), and the output `note` says when a value came from yesterday or is missing (#106).

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
