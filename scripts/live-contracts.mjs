// Minimum result contracts for every catalogue operation. These check data structure
// and selected internal consistency rules, not publisher accuracy or completeness.
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) => typeof v === "string" && v.trim().length > 0;
const number = (v) => typeof v === "number" && Number.isFinite(v);
const records = (v) => Array.isArray(v) && v.every(object);
const shape = (fields) => (data) => object(data) && Object.entries(fields).every(([key, check]) => check(data[key]));
const positive = (v) => number(v) && v > 0;
const collection = (field) => shape({ [field]: records });
const dataset = shape({ id: text, title: text, resources: records });
const datastore = shape({ total: number, fields: records, records });
const searchDatasets = shape({ total: number, datasets: records });
const geographicPoint = shape({ lat: number, lon: number });
const nullableNumber = (v) => v === null || number(v);
const observation = (row) => object(row) && text(row.time) && nullableNumber(row.temperature_c);
const stationObservations = (data) => {
  if (!shape({ station: text, observations: records })(data) || !data.observations.every(observation)) return false;
  if (data.observations.length === 0) return data.latest === null;
  const latest = data.observations.reduce((a, b) => a.time >= b.time ? a : b);
  return observation(data.latest) && data.latest.time === latest.time && data.latest.temperature_c === latest.temperature_c;
};
const legalEvidence = (doc) => shape({
  id: text, title: text, canonical_url: text, source_id: text, source_type: text,
  version: (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
  source_fetched_at: (value) => text(value) && Number.isFinite(Date.parse(value)),
  licence: text, attribution: text, currentness: text,
  current_law_verified: (value) => value === false,
  warnings: (value) => Array.isArray(value) && value.every(text),
  citation: shape({ id: text, version: text, url: text, licence: text, attribution: text })
})(doc) && doc.stale !== true && doc.citation.id === doc.id && doc.citation.version === doc.version && doc.citation.url === doc.canonical_url;
const legalDocument = (data) => legalEvidence(data) && text(data.text);
const legalCoverage = shape({ document_count: (value) => Number.isInteger(value) && value >= 0, sources: object, note: text });
const legalSearch = (data) => shape({ hits: records, coverage: legalCoverage })(data) && data.hits.every(legalEvidence);

export const operationContracts = {
  logainm_search_places: (data) => shape({ total: number, page: positive, places: records })(data)
    && data.places.every(shape({ id: positive, url: text, names: records, created_at: text })) && data.total >= data.places.length,
  failte_search: (data) => shape({ dataset: (value) => ["accommodation", "attractions"].includes(value), records, total: number, export_rows: positive, export_sha256: text, export_retrieved_at: text })(data)
    && data.records.every(shape({ name: text, latitude: nullableNumber, longitude: nullableNumber })) && data.total >= data.records.length,
  tfi_static_search_stops: (data) => shape({ stops: records, total: number, offset: number, fetched_at: text })(data)
    && data.stops.every(shape({ atco_code: text, name: text, lat: nullableNumber, lon: nullableNumber })) && data.total >= data.stops.length,
  groundwater_vulnerability_at: (data) => shape({ status: (value) => ["matched", "outside_coverage", "incomplete"].includes(value), areas: records, map_scale: (value) => value === "1:40000", limitation: text })(data)
    && data.areas.every(shape({ id: text, category: text, description: text })) && (data.status === "matched" ? data.areas.length > 0 : data.areas.length === 0),
  lobbying_search_returns: shape({ returns: records, page: number }),
  paygap_search_reports: shape({ reports: records, total_reports: number }),
  council_budgets_list_years: shape({ years: records }),
  council_budgets_get: shape({ budget_year: number, rows: records, amount_unit: text }),
  cso_search_tables: (data) => records(data) && data.every((row) => text(row.code) && text(row.title)),
  cso_get_table_metadata: shape({ code: text, title: text, dimensions: records }),
  cso_get_data: shape({ code: text, rows: records, total_rows: number }),
  cso_area_profile: (data) => shape({ area: text, census: records })(data) && data.census.length > 0,
  eurostat_search_datasets: searchDatasets,
  eurostat_get_data: shape({ dataset: text, rows: records, total_rows: number }),
  eurostat_compare_ie_eu: shape({ dataset: text, rows: records, geos: Array.isArray }),
  ecb_get_series: collection("series"),
  ecb_interest_rates: collection("rates"),
  ecb_exchange_rate: shape({ currency: text, observations: records }),
  pobal_deprivation_search: shape({ total: number, areas: records }),
  datagov_search_datasets: searchDatasets,
  datagov_get_dataset: dataset,
  datagov_query_datastore: datastore,
  smartdublin_search_datasets: searchDatasets,
  smartdublin_get_dataset: dataset,
  smartdublin_query_datastore: datastore,
  census_small_area_at: (data) => geographicPoint(data) && object(data.area),
  nta_get_realtime_summary: shape({ trips: number, cancelled: number, added: number, routes: records }),
  nta_get_trip_updates: shape({ total: number, trips: records }),
  rail_find_station: collection("stations"),
  rail_get_departures: shape({ station: shape({ code: text }), departures: records, count: number }),
  luas_get_forecast: shape({ stop: shape({ code: text }), inbound: records, outbound: records }),
  luas_list_stops: shape({ count: number, stops: records }),
  bikes_networks: collection("networks"),
  bikes_stations_near: shape({ stations: records, networks_considered: Array.isArray }),
  met_get_forecast: (data) => shape({ forecast: records })(data) && data.forecast.length > 0 && data.forecast.every((row) => text(row.time) && nullableNumber(row.temperature_c)),
  met_get_observations: stationObservations,
  met_get_warnings: (data) => shape({ count: number, warnings: records })(data) && data.count === data.warnings.length && data.warnings.every((row) => text(row.category) && text(row.level)),
  marine_get_buoys: shape({ count: number, buoys: records }),
  water_find_stations: shape({ count: number, stations: records }),
  water_get_level: shape({ station: object, history: object }),
  epa_wfd_search: shape({ total: number, results: records }),
  epa_wfd_waterbody: shape({ code: text, name: text, status_cycles: records }),
  protected_sites_at: shape({ count: number, sites: records }),
  protected_sites_near: shape({ count: number, sites: records }),
  grid_get_status: shape({ region: text, demand_mw: positive }),
  worldbank_get_indicator: shape({ observations: records, total: number }),
  worldbank_ireland_profile: collection("indicators"),
  cro_search_datasets: searchDatasets,
  cro_get_dataset: dataset,
  cro_query_datastore: datastore,
  ncse_search_datasets: searchDatasets,
  ncse_get_dataset: dataset,
  ncse_query_datastore: datastore,
  epa_bathing_locations: shape({ total: number, register_total: number, offset: number, locations: records }),
  epa_bathing_alerts: shape({ total: number, alerts: records }),
  epa_bathing_measurements: shape({ total: number, season: text, measurements: records }),
  kohesio_search_projects: shape({ total: number, projects: records }),
  kohesio_get_project: shape({ id: text, title: text }),
  cib_cis_annual_summary: (data) => shape({ record: object })(data) && data.record.callers > 0 && data.record.queries > 0,
  cib_cis_query_categories: (data) => shape({ record: object })(data) && Array.isArray(data.record.categories) && data.record.categories.length > 0,
  cib_cips_summary: (data) => shape({ record: object })(data) && data.record.contacts?.total > 0,
  civic_directory_search: (data) => shape({ total: number, projects: records })(data)
    && data.projects.every((p) => p.citizendata_listing?.url?.startsWith("https://citizendata.ie/project/") && p.project_link?.note === "as listed, unverified"),
  ted_search_tenders: shape({ total: number, tenders: records }),
  ted_get_notice: shape({ notice: object }),
  oireachtas_search_members: shape({ total: number, members: records }),
  oireachtas_search_bills: shape({ total: number, bills: records }),
  oireachtas_get_debates: shape({ total: number, days: records }),
  oireachtas_search_questions: shape({ total: number, questions: records }),
  oireachtas_get_votes: shape({ total: number, votes: records }),
  legislation_list_acts: shape({ year: number, acts: records }),
  legislation_get_act: shape({ title: text, sections: records, eli: text }),
  legislation_get_section: shape({ text, eli: text }),
  legislation_get_act_effects: (data) => shape({ act: object, counts: object, commencement: records, effects: records, made_under: records, warnings: Array.isArray })(data) && text(data.updated_to),
  legislation_list_sis: shape({ year: number, total: number, sis: records }),
  legislation_get_si: shape({ title: text, citation: text, text, eli: text }),
  legislation_get_constitution_article: (data) => shape({ article: text, heading: text, paragraphs: records })(data) && data.paragraphs.length > 0 && data.paragraphs.every((p) => text(p.ref) && text(p.text)),
  irish_legal_catalogue: (data) => shape({ sources: records, coverage: legalCoverage })(data) && data.sources.length > 0
    && data.sources.every(shape({ id: text, publisher: text, type: text, licence: text, attribution: text, terms: text, storage_allowed: (value) => typeof value === "boolean" })),
  irish_legal_search: legalSearch,
  irish_legal_fetch: legalDocument,
  irish_legal_get_provision: (data) => legalDocument(data) && text(data.section) && data.source_type === "legislation",
  irish_legal_get_changes: (data) => legalDocument(data) && data.source_type === "effects" && records(data.effects),
  irish_legal_research: (data) => shape({ documents: records, coverage: legalCoverage,
    warnings: (value) => Array.isArray(value) && value.every(text), current_law_verified: (value) => value === false })(data) && data.documents.every(legalDocument),
  citizens_info_search: (data) => legalSearch(data) && data.hits.every((hit) => hit.source_id === "citizens-info" && hit.source_type === "guidance"),
  citizens_info_get_article: (data) => legalDocument(data) && data.source_id === "citizens-info" && data.source_type === "guidance",
  geohive_boundaries_at_point: (data) => geographicPoint(data) && Object.hasOwn(data, "county"),
  geohive_locate: shape({ count: number, places: records }),
  geohive_list_layers: (data) => shape({ total: number })(data) && (records(data.services) || records(data.layers)),
  geohive_query_layer: shape({ count: number, features: records }),
  wikidata_place: shape({ total: number, matches: records }),
  wikidata_entity: shape({ qid: text, label: text }),
  ppr_search_sales: shape({ total: number, sales: records }),
  ppr_price_stats: (data) => shape({ count: number })(data) && (data.count === 0 ? data.median_eur === null : data.count > 0 && positive(data.median_eur)),
  planning_search: shape({ count: number, applications: records }),
  planning_get: shape({ count: number, applications: records }),
  heritage_monuments_near: shape({ count: number, monuments: records }),
  list_sources: collection("sources"),
  ireland_snapshot: shape({ place: text, population: object, boundaries: object, forecast: (v) => records(v) || object(v), national_warnings: (v) => records(v) || object(v) }),
  nearby: (data) => geographicPoint(data) && object(data.boundaries) && Object.hasOwn(data, "forecast") && Array.isArray(data.sources)
};

