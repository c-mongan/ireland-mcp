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

export const operationContracts = {
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
  geohive_boundaries_at_point: (data) => geographicPoint(data) && Object.hasOwn(data, "county"),
  geohive_locate: shape({ count: number, places: records }),
  geohive_list_layers: shape({ total: number, services: records }),
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
