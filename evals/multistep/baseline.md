# Multi-step benchmark report

- Run: 2026-10-26T15:44:10.417Z · server stdio dist/src/cli.js · git 0c03c2f · question set as of 2026-10-26
- Mode: references
- Items: 41 (T1 12, T2 17, T3 12)

## References

| Status | Items | Meaning |
| --- | ---: | --- |
| ok | 37 | Reference recomputed through the real tools |
| gap | 4 | Unanswerable with today's catalogue (capability gap) |

## Capability gaps by pillar

Blocked = no reference is possible today. Workaround = the reference only works through a client-side hack the pillar would remove.

| Pillar | Blocked | Workaround | Declared (hard today) | Present now? |
| --- | --- | --- | --- | --- |
| Pillar 1: dataset cards in ireland_catalogue / ireland_describe | 0 | 0 | 5 | yes |
| Pillar 2: place crosswalk (ireland_resolve_place / ireland_crosswalk) | 0 | 1 | 15 | yes |
| Pillar 3: table handles + ireland_query (server-side join/aggregate) | 2 | 2 | 10 | no |
| Pillar 4: knowledge indexes (Citizens Information, law full text) | 1 | 1 | 4 | no |
| New source: data not in the catalogue at all | 1 | 0 | 3 | n/a |

## Roadmap signal: which pillar unlocks which items

- Pillar 1: dataset cards in ireland_catalogue / ireland_describe: t2-dublin-ppr-vs-rppi (time-alignment); t2-munster-unemployment-popchange (geo-level-discovery); t2-cork-housing-spend-per-capita (geo-level-discovery); t2-rent-law-rpz (geo-level-discovery); t2-dataset-discovery-lea (geo-level-discovery)
- Pillar 2: place crosswalk (ireland_resolve_place / ireland_crosswalk): t1-tallaght-constituency-tds (point-to-constituency); t1-salthill-bathing-protected (itm-to-wgs84); t1-galway-city-wikidata-vs-cso (entity-ids); t2-munster-unemployment-popchange (la-to-province); t2-connacht-completions-per-1000 (lea-to-county); t2-dsp-jobseekers-per-1000 (county-label-variants); t2-dublin-top-lea-completions (lea-to-constituency, lea-to-county); t2-kohesio-west-per-capita (nuts3-to-county); t2-ed-deprivation-population (ed-codes); t3-ballymun-vs-tallaght (place-to-eds); t3-welfare-unemployment-law (la-vs-county); t3-athlone-vs-mullingar (town-spans-counties); t3-munster-housing-pressure (lea-to-county); t3-lowest-deprivation-galway-city-td (la-to-eds, ed-to-constituency); t3-cso-geography-mismatch (small-area-versions, ed-codes)
- Pillar 3: table handles + ireland_query (server-side join/aggregate): t2-cork-housing-spend-per-capita (aggregate); t2-connacht-completions-per-1000 (aggregate); t2-dsp-jobseekers-per-1000 (join); t2-gender-pay-gap-finance (aggregate, pagination); t2-kohesio-west-per-capita (aggregate, pagination); t2-planning-near-luas-broombridge (count); **blocked** t2-galway-city-planning-volume (count); t3-rent-growth-completions-tds (large-table); t3-munster-housing-pressure (aggregate); **blocked** t3-galway-planning-act-budget (count)
- Pillar 4: knowledge indexes (Citizens Information, law full text): t3-welfare-unemployment-law (law-search); t3-galway-planning-act-budget (law-search); **blocked** t3-cib-guidance-with-stats (citizens-info, law-search); t3-section-text-and-stats (law-search)
- New source: data not in the catalogue at all: **blocked** t3-rent-growth-completions-tds (rtb-lea-rents); t3-ballymun-vs-tallaght (opw-flood-maps); t3-welfare-unemployment-law (cib-county-breakdown)

## Items

| Item | Tier | Drift | Reference | Calls | Workarounds / gap |
| --- | --- | --- | --- | ---: | --- |
| t1-galway-pop-tds | T1 | slow | ok | 2 |  |
| t1-planning-act-bill | T1 | stable | ok | 3 |  |
| t1-unemployment-ie-eu-wb | T1 | slow | ok | 2 |  |
| t1-tallaght-constituency-tds | T1 | slow | ok | 3 |  |
| t1-heuston-rail-luas | T1 | stable | ok | 2 |  |
| t1-salthill-bathing-protected | T1 | slow | ok | 3 |  |
| t1-athlone-river-now | T1 | live | ok | 2 |  |
| t1-grid-wind-now | T1 | live | ok | 2 |  |
| t1-killarney-pop-constituency | T1 | stable | ok | 3 |  |
| t1-galway-city-wikidata-vs-cso | T1 | slow | ok | 2 |  |
| t1-galway-ppr-in-gbp | T1 | slow | ok | 2 |  |
| t1-kilkenny-monuments-protected | T1 | stable | ok | 3 |  |
| t2-galway-sales-per-1000 | T2 | stable | ok | 2 |  |
| t2-dublin-ppr-vs-rppi | T2 | stable | ok | 3 |  |
| t2-munster-unemployment-popchange | T2 | stable | ok | 6 |  |
| t2-cork-housing-spend-per-capita | T2 | stable | ok | 6 |  |
| t2-connacht-completions-per-1000 | T2 | slow | ok | 12 |  |
| t2-dsp-jobseekers-per-1000 | T2 | slow | ok | 55 |  |
| t2-real-deposit-rate-2025 | T2 | stable | ok | 2 |  |
| t2-gender-pay-gap-finance | T2 | slow | ok | 11 | server-query:pagination |
| t2-dublin-top-lea-completions | T2 | slow | ok | 3 |  |
| t2-kohesio-west-per-capita | T2 | stable | ok | 11 | server-query:pagination |
| t2-rent-law-rpz | T2 | stable | ok | 3 |  |
| t2-lobbying-planning-bill | T2 | slow | ok | 2 |  |
| t2-dataset-discovery-lea | T2 | slow | ok | 8 |  |
| t2-cib-social-welfare-vs-ja | T2 | stable | ok | 4 |  |
| t2-ed-deprivation-population | T2 | stable | ok | 2 |  |
| t2-planning-near-luas-broombridge | T2 | slow | ok | 2 |  |
| t2-galway-city-planning-volume | T2 | slow | gap | 1 | **server-query:count** |
| t3-rent-growth-completions-tds | T3 | slow | gap | 1 | **source:rtb-lea-rents** |
| t3-ballymun-vs-tallaght | T3 | slow | ok | 6 | crosswalk:place-to-eds |
| t3-welfare-unemployment-law | T3 | slow | ok | 5 | knowledge:law-search |
| t3-gdp-per-capita-three-ways | T3 | stable | ok | 3 |  |
| t3-athlone-vs-mullingar | T3 | stable | ok | 8 |  |
| t3-munster-housing-pressure | T3 | slow | ok | 10 |  |
| t3-lowest-deprivation-galway-city-td | T3 | slow | ok | 24 |  |
| t3-energy-weather-now | T3 | live | ok | 3 |  |
| t3-galway-planning-act-budget | T3 | slow | gap | 1 | **server-query:count** |
| t3-cso-geography-mismatch | T3 | stable | ok | 3 |  |
| t3-cib-guidance-with-stats | T3 | slow | gap | 0 | **knowledge:citizens-info** |
| t3-section-text-and-stats | T3 | stable | ok | 5 |  |
