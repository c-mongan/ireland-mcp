# Related Irish civic-tech projects

Several skills in this pack answer questions that Irish civic-tech projects also answer, using the
same public sources. This file credits those projects and shows which Ireland MCP operations reach
the same underlying data.

- **No affiliation and no endorsement.** These projects are independent. Listing one here does not
  mean that it endorses this pack, or that this pack endorses it, its methods or its views.
- **No copied content.** The summaries below are our own wording. Each project keeps its own licence;
  visit its site for its actual data, method and terms.
- **Discovery source.** The list was drawn from the community catalogue
  [eire_civic_tech_directory](https://github.com/williamkennedy/eire_civic_tech_directory) by
  William Kennedy (MIT licence, commit `7f0aeaf`), which powers citizendata.ie.
- **Coverage.** "Full" means the skill reaches the same public data the project is built on.
  "Partial" means it covers only part of it; the reason is given.

## Mapping

| Related project | Owner | Our wording of what it does | Ireland MCP operations | Skill | Coverage |
|---|---|---|---|---|---|
| [Oireachtas Explorer](https://oireachtas-explorer.ie) | David Ward | Browses members, debates, bills, questions and votes | `oireachtas/oireachtas_search_members`, `oireachtas/oireachtas_get_votes`, `oireachtas/oireachtas_search_bills` | oireachtas-tracker, td-briefing | Full for the Open Data API (no transcript text) |
| [Dáil Tracker](https://dailtracker.streamlit.app/member-overview) | peweet | Tracks members, legislation, votes, payments and lobbying | `oireachtas/oireachtas_search_questions`, `lobbying/lobbying_search_returns` | oireachtas-tracker, lobbying-watch, td-briefing | Partial: no attendance or payments data |
| [Kildare Street](https://www.kildarestreet.com/) | John Handelaar | Searches Oireachtas debate transcripts | `oireachtas/oireachtas_get_debates` | oireachtas-tracker | Partial: debate headings only, not full transcripts |
| [Vote TD](https://votetd.ie/) | Frank Conway | Shows how TDs and Senators vote | `oireachtas/oireachtas_get_votes` | oireachtas-tracker | Partial: division tallies, not per-member lists |
| [Oireachtas Vote](https://robmcelhinney.com/OireachtasVote/) | Robert McElhinney | Shows Dáil voting records | `oireachtas/oireachtas_get_votes` | oireachtas-tracker | Partial: division tallies, not per-member lists |
| [Rule.ie](https://rule.ie/) | Unknown | Summarises Oireachtas bills | `oireachtas/oireachtas_search_bills`, `legislation/legislation_get_act` | oireachtas-tracker, rights-check, legislation-lookup | Full for bill metadata; we quote, not summarise with AI |
| [Contact Your Local TD](https://www.contactyourtd.ie/) | Unknown | Finds a local TD and their record | `geohive/geohive_boundaries_at_point`, `oireachtas/oireachtas_search_members` | local-election-brief, td-briefing | Partial: no contact details beyond the official record |
| [Constituent](https://constituent.ie/) | Owen Connor | Finds representatives and the issues they work on | `geohive/geohive_boundaries_at_point`, `oireachtas/oireachtas_search_questions` | local-election-brief | Partial: no EU or council representatives |
| [Oireachtas Connect](https://oireachtasconnect.ie/) | Oireachtas Connect | Finds a TD and shows lobbying and local metrics | `oireachtas/oireachtas_search_members`, `lobbying/lobbying_search_returns`, `cso/cso_area_profile` | local-election-brief, lobbying-watch | Full for these sources |
| [Lobbyieng](https://lobbyieng.com/) | Robert McElhinney | Visualises the Register of Lobbying | `lobbying/lobbying_search_returns` | lobbying-watch | Full for search; no charts |
| [Local Authority Finances](https://localauthorityfinances.com) | Gerard Turley, Stephen McNena | Compares council budgets | `council-budgets/council_budgets_get`, `cso/cso_area_profile` | council-budget-compare, public-money-tracker | Full for adopted budgets; no audited outturns |
| [PublicPurse.ie](https://publicpurse.ie) | William Kennedy | Indexes government spending line items | `council-budgets/council_budgets_get`, `ted/ted_search_tenders`, `kohesio/kohesio_search_projects` | public-money-tracker | Partial: no central Government line items |
| [StateSpend.ie](https://statespend.ie) | Albert Dolan TD, Matthew Fenlon (TPSA) | Searches public-body purchase orders and payments | `ted/ted_search_tenders` | public-money-tracker | Partial: EU-threshold tenders only, not payments |
| [Where Your Money Goes](https://whereyourmoneygoes.gov.ie) | Government | Explains central Government spending | `council-budgets/council_budgets_get`, `kohesio/kohesio_search_projects` | public-money-tracker | Partial: council and EU-funded spending only |
| [PayGap.ie](https://paygap.ie/) | Jennifer Keane | Collects employer gender pay gap reports | `paygap/paygap_search_reports` | pay-gap-compare | Full (same dataset) |
| [Property Price Register API](https://priceregister.civictech.ie/) | CivicTech.ie | API over the Property Price Register | `ppr/ppr_search_sales`, `ppr/ppr_price_stats` | where-to-live-shortlist, house-price-check | Full |
| [HousePrice.ie](https://houseprice.ie/) | u/hungry475 on Reddit | Searchable Property Price Register | `ppr/ppr_search_sales` | where-to-live-shortlist, house-price-check | Full |
| [PropertyLab](https://propertylab.ie/) | u/dylgarr on Reddit | Searchable Property Price Register | `ppr/ppr_search_sales` | where-to-live-shortlist, house-price-check | Full |
| [Ireland Property Price Atlas](https://propertypriceireland.com) | Ireland Property Price Atlas | Sale prices by county and locality over time | `ppr/ppr_price_stats` | compare-two-areas, house-price-check | Full for medians; no maps |
| [HomeTrue](https://hometrue.ie/) | Unknown | Address report on commute, energy, schools and safety | `geohive/geohive_locate`, `tfi-static/tfi_static_search_stops`, `pobal/pobal_deprivation_search`, `opw-water/water_find_stations` | where-to-live-shortlist | Partial: no BER, school or commute-time data |
| [PlanningRegister.ie](https://planningregister.ie/) | John McEnroe | Planning applications near an address | `planning/planning_search`, `planning/planning_get` | planning-and-heritage-near-me | Full for the national planning database |
| [Monumental Ireland](https://monumentalireland.ie/) | Monumental Ireland | Guide to prehistoric monuments from the SMR | `heritage/heritage_monuments_near` | planning-and-heritage-near-me | Full for SMR points; no visitor information |
| [Discover Alone](https://discoveralone.com/) | Rickie Doherty | Map of historic places with nearby search | `heritage/heritage_monuments_near`, `wikidata/wikidata_place` | planning-and-heritage-near-me | Partial: no local stories |
| [One Million Homes](https://onemillionhomes.ie/) | Rob Cass, Edward Dixon | Housing delivery dashboard by local electoral area | `cso/cso_get_data` (NDQ, NDA, VAC tables) | housing-supply-tracker | Partial: no wait-time or first-time-buyer data |
| [House Price Ireland](https://housepriceireland.ie/) | Unknown | County house values and affordability | `ppr/ppr_price_stats`, `cso/cso_get_data` (RTB rents) | housing-supply-tracker | Full for prices and rents |
| [EireEstate](https://www.eireestate.ie/) | Evegny Koltsov | Tracks new-build developments | `planning/planning_search`, `ppr/ppr_price_stats` | housing-supply-tracker | Partial: planning and new-home sales only |
| [IrelandInsights](https://irelandinsights.ie/) | IrelandInsights | Census and housing data by electoral division | `census-areas/census_small_area_at`, `pobal/pobal_deprivation_search` | compare-two-areas | Partial: no election data |
| [Civgraph](https://civgraph.net/) | Scott Moore (@scottmoore0) | Boundaries and census data for the island | `geohive/geohive_boundaries_at_point`, `cso/cso_area_profile` | compare-two-areas, irish-area-report | Partial: Republic of Ireland only, no election results |
| [Derelict Ireland](https://acoci86.github.io/derelict-ireland/) | Alessio Coci | Maps council derelict-site registers | `data-gov-ie/datagov_search_datasets` | derelict-and-vacancy | Partial: only registers published on data.gov.ie |
| [Derelict Sites](https://www.derelictsites.com/) | Rob Cross | Maps derelict and long-term vacant property | `data-gov-ie/datagov_search_datasets`, `cso/cso_get_data` (VAC tables) | derelict-and-vacancy | Partial: area counts, not addresses |
| [Smart Grid Dashboard](https://www.smartgriddashboard.com/all/) | EirGrid Group plc | Live demand and generation on the island grid | `eirgrid/grid_get_status` | energy-and-grid-explainer, grid-now | Partial: latest snapshot only, no history |
| [Green Collective](https://www.greencollective.io/) | Johnston & Wang Green Collective KlG | Grid generation and decarbonisation analysis | `eirgrid/grid_get_status`, `eurostat/eurostat_compare_ie_eu` | energy-and-grid-explainer | Partial: annual renewables share, not per-plant data |
| [Ghost Buster](https://realtime.prototype.website/) | Oliver Moran | Cork bus tracker built on NTA real-time data | `nta/nta_get_realtime_summary` | transport-reliability-check | Partial: NTA real-time needs an operator key; no history |
| [Bus Cancellations Dublin](https://buscancellationsdublin.eu/) | Unknown | Dublin bus cancellations over time | `nta/nta_get_realtime_summary` | transport-reliability-check | Partial: live snapshot only, no history |
| [No-Show Bus Tracker](https://noshowbus.ie/) | Dublin Inquirer | Crowd reports of buses that never came | `nta/nta_get_trip_updates` | transport-reliability-check | Partial: official feed only, no crowd reports |
| [Live Dublin Trains](https://www.jake.ie/trains) | Jake McDermott | Live map of Dublin-area trains | `irish-rail/rail_get_departures` | transport-reliability-check, commute-weather | Partial: departures list, no map |
| [EZ Commute IE](https://ezcommute.ie/) | Rituraj Sambherao | Real-time Luas, rail and DART information | `luas/luas_get_forecast`, `irish-rail/rail_get_departures` | transport-reliability-check, commute-weather | Full for live departures |
| [Ireland Road Deaths](https://www.rsa.ie/road-safety/statistics/collisions) | RSA | Fatal and injury collisions on a map | `cso/cso_get_data` (ROA tables) | safety-stats | Partial: county and year totals, no map points |
| [Crime Stats IE](https://www.crimestats.ie/) | Brian Fox | Basic crime statistics | `cso/cso_get_data` (CJQ, CJA tables) | safety-stats | Full for CSO recorded crime |

## Not covered

These catalogue themes have no matching Ireland MCP source today, so no skill claims to cover them:
genealogy and historic censuses, sport results, election results and opinion polls, council roll-call
votes, crowd-sourced collision or litter reports, FSAI enforcement orders, Coimisiún na Meán funding
awards, non-profit finances, salary and mortgage calculators, renovation-grant eligibility,
biodiversity and pollinator records, and petitions.
