// Hard multi-step benchmark items. Each item needs at least two sources plus analysis.
//
//   tier       T1 two-source lookup · T2 join + compute · T3 three or more sources with reasoning
//   answer     keys the agent must return in its final ANSWER_JSON block, with type and tolerance
//   reference  recomputes the expected values by calling the real tools through ireland_call
//   drift      stable (pinned) · slow (pinned; a recompute that differs flags a stale reference)
//              · live (always recomputed right before and after the agent run)
//   gaps       capability gaps that make the item hard today, tagged by pillar
//              (crosswalk, dataset-card, server-query, knowledge, source). A reference throws
//              GapError when a gap makes it unanswerable, and ctx.workaround() records a
//              client-side hack that a pillar would remove.
//   control    items of the same shape that need no pillar, so gap failures can be told apart
//              from general multi-step weakness.
//   tool_path  analysis-only sketch of one valid route; never shown to the agent.
import { GapError, UpstreamError, norm, round } from "./lib.mjs";

const AS_OF = "2026-10-26";

// ---------- helpers (thin wrappers over ireland_call; every call is recorded by ctx) ----------

async function csoRows(ctx, table_code, filters, limit = 500) {
  const data = await ctx.call("cso", "cso_get_data", { table_code, filters, limit });
  return data.rows;
}

/**
 * Finds a CSO table the way an agent would: a keyword search ranked by geography level (dataset cards),
 * then the first of the top five hits at that level whose metadata passes `accept`. Falls back to a
 * known table code, recorded as the dataset-card workaround, when search does not surface one (or the
 * server predates geo_level).
 */
async function discoverCsoTable(ctx, { query, geoLevel, accept, fallback }) {
  try {
    const hits = await ctx.call("cso", "cso_search_tables", { query, geo_level: geoLevel, limit: 10 }, { allowTruncated: true });
    for (const t of hits.filter((h) => (h.geo_levels ?? []).includes(geoLevel)).slice(0, 5)) {
      try {
        const meta = await ctx.call("cso", "cso_get_table_metadata", { table_code: t.code, max_categories: 500 }, { allowTruncated: true });
        if (accept(meta, t)) return { code: t.code, meta };
      } catch (error) {
        if (error instanceof UpstreamError) throw error;
      }
    }
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
  }
  ctx.workaround("dataset-card:hardcoded-table-code");
  return { code: fallback, meta: await ctx.call("cso", "cso_get_table_metadata", { table_code: fallback, max_categories: 500 }) };
}

/** True when every dimension other than statistic, time and `keep` starts with an all-categories total. */
const headlineTotals = (meta, keep) =>
  meta.dimensions.every((d) => d.code === "STATISTIC" || d.role === "time" || d === keep || /^(both sexes|all|total|state)/i.test(d.categories[0]?.label ?? ""));

async function countyPop2022(ctx, county) {
  const p = await ctx.call("cso", "cso_area_profile", { area: county });
  const c = p.census.find((x) => x.year === "2022");
  if (!c) throw new Error(`no 2022 census for ${county}`);
  return { pop2022: c.total, pop2016: p.census.find((x) => x.year === "2016")?.total, change_pct: p.change?.percent };
}

async function currentTds(ctx, constituency) {
  const d = await ctx.call("oireachtas", "oireachtas_search_members", { constituency, limit: 20 });
  const members = d.members.filter((m) => m.current !== false && norm(m.constituency) === norm(constituency));
  if (!members.length) throw new Error(`no current TDs for ${constituency}`);
  return members.map((m) => m.name.split(" ").slice(-1)[0]);
}

async function locate(ctx, name, county) {
  const d = await ctx.call("geohive", "geohive_locate", { name, limit: 10 });
  const hit = d.places.find((p) => !county || norm(p.county) === norm(county)) ?? d.places[0];
  if (!hit) throw new Error(`gazetteer has no ${name}`);
  return { lat: hit.lat, lon: hit.lon };
}

async function boundaries(ctx, pt) {
  return ctx.call("geohive", "geohive_boundaries_at_point", { lat: pt.lat, lon: pt.lon });
}

async function pprYear(ctx, args) {
  return ctx.call("ppr", "ppr_price_stats", args);
}

/** NDA05 completions for one year, every LEA ("<LEA>, <Council>"). */
async function completionsByLea(ctx, year) {
  const rows = await csoRows(ctx, "NDA05", { "TLIST(A1)": [String(year)] });
  return rows.filter((r) => r["Local Electoral Area"] !== "State").map((r) => {
    const label = r["Local Electoral Area"];
    const i = label.lastIndexOf(",");
    return { lea: label.slice(0, i).trim(), council: label.slice(i + 1).trim(), value: r.value ?? 0 };
  });
}

// ---------- place crosswalk (cross/ireland_resolve_place) ----------

async function resolvePlace(ctx, args) {
  return ctx.call("cross", "ireland_resolve_place", { limit: 500, ...args });
}

/** Names of the areas of `list` level inside a place, via the crosswalk (mostly-inside only). */
async function areasIn(ctx, place, level, list) {
  const d = await resolvePlace(ctx, { place, level, list });
  if (d.children.next_offset != null) throw new Error(`crosswalk list for ${place} is paged`);
  return d.children.items.filter((r) => r.share_inside >= 0.5);
}

/** NDA05 rows for the LEAs inside a county, matched through the crosswalk ("<LEA>, <council>"). */
async function leaRowsInCounty(ctx, leaRows, county) {
  const leas = await areasIn(ctx, county, "county", "lea");
  const rows = leaRows.filter((l) => leas.some((x) => norm(x.name) === norm(l.lea) && norm(x.local_authority).startsWith(norm(l.council))));
  // Independent cross-check against the hand-written council map the crosswalk replaced.
  const legacy = leaRows.filter((l) => councilToCounty(l.council) === county);
  if (rows.length !== legacy.length || rows.length !== leas.length) throw new Error(`crosswalk LEAs for ${county}: ${rows.length} matched, ${legacy.length} by council name, ${leas.length} listed`);
  return rows;
}

// Councils grouped into counties: the hand-written map the crosswalk replaced, kept only as a cross-check.
const COUNCIL_COUNTY = {
  "Dublin City": "Dublin", "South Dublin": "Dublin", Fingal: "Dublin", "Dun Laoghaire-Rathdown": "Dublin", "Dún Laoghaire-Rathdown": "Dublin",
  "Cork City": "Cork", "Cork County": "Cork", "Galway City": "Galway", "Galway County": "Galway"
};
const councilToCounty = (c) => COUNCIL_COUNTY[c] ?? c.replace(/ (County|City|City and County)$/, "");

async function divisionTotal(ctx, authority, year, division, measure = "Expenditure") {
  const d = await ctx.call("council-budgets", "council_budgets_get", { year, authority, division, limit: 500 });
  if (d.partial) throw new Error(`${authority} ${year} division ${division} is partial`);
  return d.rows.filter((r) => r.measure === measure).reduce((s, r) => s + (r.amount ?? 0), 0);
}

const LA_DIM = "Administrative Counties and Local Government Districts";

/**
 * Census 2022 local-authority rows from the all-island CPNI tables. The full tables exceed one
 * response, so the reference filters by statistic, year and the authorities it needs.
 */
async function cpni(ctx, table, { statistic, laMatch = () => true, year = "2022" } = {}) {
  const meta = await ctx.call("cso", "cso_get_table_metadata", { table_code: table, max_categories: 100 });
  const geo = meta.dimensions.find((d) => d.label === LA_DIM);
  const stat = meta.dimensions.find((d) => d.code === "STATISTIC");
  const time = meta.dimensions.find((d) => d.code.startsWith("TLIST"));
  const filters = { [geo.code]: geo.categories.filter((c) => laMatch(c.label)).map((c) => c.code) };
  if (statistic) filters.STATISTIC = stat.categories.filter((c) => c.label === statistic).map((c) => c.code);
  if (time.categories.some((c) => c.code === year)) filters[time.code] = [year];
  return csoRows(ctx, table, filters);
}

const pct = (a, b) => round(((b - a) / a) * 100, 1);

// ---------- items ----------

export const items = [
  // ================= T1: two-source lookups =================
  {
    id: "t1-galway-pop-tds",
    tier: "T1",
    control: true,
    drift: "slow",
    question: "What was the population of County Galway in Census 2022, and who are the current TDs for the Galway West constituency?",
    required_sources: ["cso", "oireachtas"],
    tool_path: ["cso_area_profile(Galway)", "oireachtas_search_members(constituency=Galway West)"],
    answer: {
      population_2022: { type: "number", tol_rel: 0.001, desc: "persons" },
      tds: { type: "list", desc: "TD names" }
    },
    gaps: [],
    async reference(ctx) {
      const { pop2022 } = await countyPop2022(ctx, "Galway");
      return { population_2022: pop2022, tds: await currentTds(ctx, "Galway West") };
    }
  },
  {
    id: "t1-planning-act-bill",
    tier: "T1",
    control: true,
    drift: "stable",
    question: "The Planning and Development Act 2024: what is its Act number, on what date was it enacted, and what was the Oireachtas bill number (year/number) of the bill that became it?",
    required_sources: ["legislation", "oireachtas"],
    tool_path: ["legislation_list_acts(2024, planning)", "legislation_get_act", "oireachtas_search_bills(Planning and Development, 2023)"],
    answer: {
      act_number: { type: "number", tol_abs: 0, desc: "Act number in 2024" },
      enacted: { type: "date", desc: "YYYY-MM-DD" },
      bill: { type: "text", desc: "bill number as YYYY/N" }
    },
    gaps: [],
    async reference(ctx) {
      const list = await ctx.call("legislation", "legislation_list_acts", { year: 2024, query: "Planning and Development" });
      const act = list.acts.find((a) => /^Planning and Development Act 2024$/.test(a.title));
      const detail = await ctx.call("legislation", "legislation_get_act", { year: 2024, number: act.number, limit: 1 }, { allowTruncated: true });
      const bills = await ctx.call("oireachtas", "oireachtas_search_bills", { query: "Planning and Development", year: "2023", limit: 10 });
      const bill = bills.bills.find((b) => b.act?.act === `2024/${act.number}`);
      if (!bill) throw new Error("bill not linked to the Act");
      return { act_number: act.number, enacted: detail.enacted, bill: bill.bill };
    }
  },
  {
    id: "t1-unemployment-ie-eu-wb",
    tier: "T1",
    drift: "slow",
    question: "For 2024, what was Ireland's unemployment rate (age 15–74) according to Eurostat, the EU27 rate, and the World Bank's figure for Ireland? How many percentage points below the EU27 was Ireland on Eurostat's figures?",
    required_sources: ["eurostat", "world-bank"],
    tool_path: ["eurostat_compare_ie_eu(une_rt_a, Y15-74, T, PC_ACT, 2024)", "worldbank_get_indicator(SL.UEM.TOTL.ZS)"],
    answer: {
      ie_eurostat_pct: { type: "number", tol_abs: 0.05 },
      eu27_pct: { type: "number", tol_abs: 0.05 },
      ie_worldbank_pct: { type: "number", tol_abs: 0.1 },
      gap_pp: { type: "number", tol_abs: 0.1, desc: "EU27 minus Ireland, percentage points" }
    },
    gaps: [],
    async reference(ctx) {
      const e = await ctx.call("eurostat", "eurostat_compare_ie_eu", { dataset: "une_rt_a", filters: { age: ["Y15-74"], sex: ["T"], unit: ["PC_ACT"] }, since: "2024", until: "2024" });
      const ie = e.rows.find((r) => r["Geopolitical entity (reporting)"] === "Ireland").value;
      const eu = e.rows.find((r) => /European Union/.test(r["Geopolitical entity (reporting)"])).value;
      const wb = await ctx.call("world-bank", "worldbank_get_indicator", { indicator: "SL.UEM.TOTL.ZS", country: "IRL", last: 5 });
      const w = wb.observations.find((o) => o.year === "2024").value;
      return { ie_eurostat_pct: ie, eu27_pct: eu, ie_worldbank_pct: round(w, 2), gap_pp: round(eu - ie, 1) };
    }
  },
  {
    id: "t1-tallaght-constituency-tds",
    tier: "T1",
    drift: "slow",
    question: "Take the Tailte Éireann gazetteer point for Tallaght. Which Dáil constituency and local electoral area is it in, and who are that constituency's current TDs?",
    required_sources: ["geohive", "oireachtas"],
    tool_path: ["geohive_locate(Tallaght)", "geohive_boundaries_at_point", "oireachtas_search_members(constituency)"],
    answer: {
      constituency: { type: "text" },
      local_electoral_area: { type: "text" },
      tds: { type: "list" }
    },
    gaps: ["crosswalk:point-to-constituency"],
    async reference(ctx) {
      const b = await boundaries(ctx, await locate(ctx, "Tallaght", "Dublin"));
      return { constituency: b.dail_constituency.name, local_electoral_area: b.local_electoral_area.name, tds: await currentTds(ctx, b.dail_constituency.name) };
    }
  },
  {
    id: "t1-heuston-rail-luas",
    tier: "T1",
    control: true,
    drift: "stable",
    question: "Heuston in Dublin is served by both Irish Rail and the Luas. Give the Irish Rail station code and the Luas line and Luas stop code for Heuston.",
    required_sources: ["irish-rail", "luas"],
    tool_path: ["rail_find_station(Heuston)", "luas_list_stops"],
    answer: {
      rail_code: { type: "text" },
      luas_line: { type: "text" },
      luas_stop_code: { type: "text" }
    },
    gaps: [],
    async reference(ctx) {
      const r = await ctx.call("irish-rail", "rail_find_station", { query: "Heuston" });
      const l = await ctx.call("luas", "luas_list_stops", {});
      const stop = l.stops.find((s) => /heuston/i.test(s.name));
      return { rail_code: r.stations[0].code, luas_line: stop.line, luas_stop_code: stop.code };
    }
  },
  {
    id: "t1-salthill-bathing-protected",
    tier: "T1",
    drift: "slow",
    question: "What is the EPA's latest annual water-quality classification for Salthill Beach in Galway, and which NPWS protected sites (SAC/SPA/NHA/pNHA) lie within 1 km of the Tailte Éireann gazetteer point for Salthill?",
    required_sources: ["epa", "environment-sites", "geohive"],
    tool_path: ["epa_bathing_locations(Salthill)", "geohive_locate(Salthill)", "protected_sites_near(radius 1000)"],
    answer: {
      classification: { type: "text", desc: "e.g. Excellent, Good, Sufficient, Poor" },
      protected_sites: { type: "list", desc: "site names" }
    },
    gaps: ["crosswalk:itm-to-wgs84"],
    async reference(ctx) {
      const b = await ctx.call("epa", "epa_bathing_locations", { name: "Salthill" });
      const loc = b.locations.find((l) => /Salthill Beach/i.test(l.beach_name)) ?? b.locations[0];
      const cls = /achieving (\w+) Water Quality/i.exec(loc.annual_water_quality_assessment)?.[1];
      if (!cls) throw new Error("classification text not parsed");
      const pt = await locate(ctx, "Salthill", "Galway");
      const s = await ctx.call("environment-sites", "protected_sites_near", { lat: pt.lat, lon: pt.lon, radius_m: 1000, limit: 50 });
      return { classification: cls, protected_sites: [...new Set(s.sites.map((x) => x.name))] };
    }
  },
  {
    id: "t1-athlone-river-now",
    tier: "T1",
    drift: "live",
    question: "Right now, what is the latest water level (metres above gauge zero) at the OPW Athlone gauge, and what air temperature does Met Éireann forecast for the next hour at that gauge's coordinates?",
    required_sources: ["opw-water", "met-eireann"],
    tool_path: ["water_get_level(Athlone)", "met_get_forecast(gauge lat/lon, 1h)"],
    answer: {
      athlone_level_m: { type: "number", tol_abs: 0.05 },
      forecast_temp_c: { type: "number", tol_abs: 1.5 }
    },
    gaps: [],
    async reference(ctx) {
      const w = await ctx.call("opw-water", "water_get_level", { station: "Athlone", hours: 3 });
      const f = await ctx.call("met-eireann", "met_get_forecast", { lat: w.station.lat, lon: w.station.lon, hours: 2 }, { allowTruncated: true });
      return { athlone_level_m: w.station.level_m, forecast_temp_c: f.forecast[0].temperature_c };
    }
  },
  {
    id: "t1-grid-wind-now",
    tier: "T1",
    drift: "live",
    question: "Right now, what share of all-island electricity demand is wind generation according to EirGrid, and what is the latest observed wind speed (km/h) at Met Éireann's Dublin Airport station?",
    required_sources: ["eirgrid", "met-eireann"],
    tool_path: ["grid_get_status(ALL)", "met_get_observations(Dublin Airport)"],
    answer: {
      wind_share_pct: { type: "number", tol_abs: 8 },
      dublin_airport_wind_kmh: { type: "number", tol_abs: 8 }
    },
    gaps: [],
    async reference(ctx) {
      const g = await ctx.call("eirgrid", "grid_get_status", { region: "ALL" });
      const m = await ctx.call("met-eireann", "met_get_observations", { station: "Dublin Airport" });
      return { wind_share_pct: g.wind_share_pct, dublin_airport_wind_kmh: m.latest.wind_speed_kmh };
    }
  },
  {
    id: "t1-killarney-pop-constituency",
    tier: "T1",
    control: true,
    drift: "stable",
    question: "What was the Census 2022 population of the town of Killarney, and which Dáil constituency is the Killarney gazetteer point in?",
    required_sources: ["cso", "geohive"],
    tool_path: ["cso_area_profile(Killarney)", "geohive_locate(Killarney)", "geohive_boundaries_at_point"],
    answer: {
      population_2022: { type: "number", tol_rel: 0.001 },
      constituency: { type: "text" }
    },
    gaps: [],
    async reference(ctx) {
      const p = await ctx.call("cso", "cso_area_profile", { area: "Killarney" });
      const c = (p.census ?? []).find((x) => String(x.year) === "2022") ?? p;
      const b = await boundaries(ctx, await locate(ctx, "Killarney", "Kerry"));
      return { population_2022: c.total ?? c.population, constituency: b.dail_constituency.name };
    }
  },
  {
    id: "t1-galway-city-wikidata-vs-cso",
    tier: "T1",
    drift: "slow",
    question: "Wikidata and the CSO both give a population for Galway city. What does each say (CSO: Census 2022 for Galway City), and what is the difference (Wikidata minus CSO)?",
    required_sources: ["wikidata", "cso"],
    tool_path: ["wikidata_place(Galway)", "cso_area_profile(Galway City)"],
    answer: {
      wikidata_population: { type: "number", tol_rel: 0.001 },
      cso_population_2022: { type: "number", tol_rel: 0.001 },
      difference: { type: "number", tol_abs: 50 }
    },
    gaps: ["crosswalk:entity-ids"],
    async reference(ctx) {
      const w = await ctx.call("wikidata", "wikidata_place", { name: "Galway", limit: 5 }, { allowTruncated: true });
      const city = w.matches.find((m) => /city in Ireland/i.test(m.description ?? "") && m.population);
      const p = await ctx.call("cso", "cso_area_profile", { area: "Galway City" });
      const c = (p.census ?? []).find((x) => String(x.year) === "2022");
      if (!city || !c) throw new Error("population missing");
      return { wikidata_population: city.population, cso_population_2022: c.total, difference: city.population - c.total };
    }
  },
  {
    id: "t1-galway-ppr-in-gbp",
    tier: "T1",
    drift: "slow",
    question: "What was the median declared sale price of residential property in County Galway in calendar year 2024 (Property Price Register), and what is that in pounds sterling at the latest ECB EUR/GBP reference rate?",
    required_sources: ["ppr", "ecb"],
    tool_path: ["ppr_price_stats(Galway, 2024)", "ecb_exchange_rate(GBP)"],
    answer: {
      median_eur: { type: "number", tol_rel: 0.005 },
      median_gbp: { type: "number", tol_rel: 0.03 }
    },
    gaps: [],
    async reference(ctx) {
      const p = await pprYear(ctx, { county: "Galway", from: "2024-01-01", to: "2024-12-31" });
      const fx = await ctx.call("ecb", "ecb_exchange_rate", { currency: "GBP", lastNObservations: 1 });
      const rate = fx.observations.at(-1).value;
      return { median_eur: p.median_eur, median_gbp: Math.round(p.median_eur * rate) };
    }
  },
  {
    id: "t1-kilkenny-monuments-protected",
    tier: "T1",
    control: true,
    drift: "stable",
    question: "Around the Tailte Éireann gazetteer point for Kilkenny city: how many Sites and Monuments Record entries are within 500 m, and how many NPWS protected sites intersect a 2 km radius?",
    required_sources: ["heritage", "environment-sites", "geohive"],
    tool_path: ["geohive_locate(Kilkenny)", "heritage_monuments_near(500 m)", "protected_sites_near(2000 m)"],
    answer: {
      monuments_500m: { type: "number", tol_rel: 0.05 },
      protected_sites_2km: { type: "number", tol_abs: 0 }
    },
    gaps: [],
    async reference(ctx) {
      const pt = await locate(ctx, "Kilkenny", "Kilkenny");
      const h = await ctx.call("heritage", "heritage_monuments_near", { lat: pt.lat, lon: pt.lon, radius_m: 500, limit: 500 });
      if (h.count >= 500) throw new Error("monument count hit the limit");
      const s = await ctx.call("environment-sites", "protected_sites_near", { lat: pt.lat, lon: pt.lon, radius_m: 2000, limit: 50 });
      return { monuments_500m: h.count, protected_sites_2km: s.count ?? s.sites.length };
    }
  },

  // ================= T2: join + compute =================
  {
    id: "t2-galway-sales-per-1000",
    tier: "T2",
    control: true,
    drift: "stable",
    question: "How many residential sales did the Property Price Register record in County Galway in 2024, and how many is that per 1,000 residents using the Census 2022 population?",
    required_sources: ["ppr", "cso"],
    tool_path: ["ppr_price_stats(Galway, 2024)", "cso_area_profile(Galway)"],
    answer: {
      sales_2024: { type: "number", tol_rel: 0.01 },
      sales_per_1000: { type: "number", tol_abs: 0.1 }
    },
    gaps: [],
    async reference(ctx) {
      const p = await pprYear(ctx, { county: "Galway", from: "2024-01-01", to: "2024-12-31" });
      const { pop2022 } = await countyPop2022(ctx, "Galway");
      return { sales_2024: p.count, sales_per_1000: round((p.count / pop2022) * 1000, 2) };
    }
  },
  {
    id: "t2-dublin-ppr-vs-rppi",
    tier: "T2",
    drift: "stable",
    question: "Compare two measures of Dublin house-price change from 2019 to 2024: the change in the median declared sale price for County Dublin on the Property Price Register (calendar 2019 vs calendar 2024), and the change in the CSO Residential Property Price Index for Dublin (all residential properties, December 2019 vs December 2024). Give both percentage changes and the difference in percentage points (PPR minus RPPI).",
    required_sources: ["ppr", "cso"],
    tool_path: ["ppr_price_stats(Dublin, 2019)", "ppr_price_stats(Dublin, 2024)", "cso_get_table_metadata(HPM09)", "cso_get_data(HPM09, Dublin, 201912/202412)"],
    answer: {
      ppr_median_change_pct: { type: "number", tol_abs: 0.5 },
      rppi_change_pct: { type: "number", tol_abs: 0.5 },
      difference_pp: { type: "number", tol_abs: 1 }
    },
    gaps: ["dataset-card:time-alignment"],
    async reference(ctx) {
      const a = await pprYear(ctx, { county: "Dublin", from: "2019-01-01", to: "2019-12-31" });
      const b = await pprYear(ctx, { county: "Dublin", from: "2024-01-01", to: "2024-12-31" });
      const rows = await csoRows(ctx, "HPM09", { STATISTIC: ["HPM09C01"], "TLIST(M1)": ["201912", "202412"], C02803V03373: ["05"] });
      const r0 = rows.find((r) => /2019/.test(r.Month))?.value;
      const r1 = rows.find((r) => /2024/.test(r.Month))?.value;
      if (!r0 || !r1) throw new Error("RPPI rows missing");
      const ppr = pct(a.median_eur, b.median_eur);
      const rppi = pct(r0, r1);
      return { ppr_median_change_pct: ppr, rppi_change_pct: rppi, difference_pp: round(ppr - rppi, 1) };
    }
  },
  {
    id: "t2-munster-unemployment-popchange",
    tier: "T2",
    drift: "stable",
    question: "Among the local authorities in the province of Munster, which had the highest ILO unemployment rate in Census 2022, what was that rate, and by what percentage did that local authority's population change between 2016 and 2022?",
    required_sources: ["cso", "geohive"],
    tool_path: ["geohive_query_layer(Counties, PROVINCE='Munster')", "cso_get_data(CPNI37)", "cso_get_data(CPNI05, Percentage change since 2016)"],
    answer: {
      local_authority: { type: "text" },
      unemployment_rate_pct: { type: "number", tol_abs: 0.05 },
      population_change_pct: { type: "number", tol_abs: 0.1 }
    },
    gaps: ["crosswalk:la-to-province", "dataset-card:geo-level-discovery"],
    async reference(ctx) {
      const c = await ctx.call("geohive", "geohive_query_layer", { service: "Counties___OSi_National_Statutory_Boundaries", where: "PROVINCE='Munster'", out_fields: "ENGLISH,PROVINCE", limit: 20 });
      const counties = new Set(c.features.map((f) => norm(f.ENGLISH)));
      if (!counties.size) throw new Error("no Munster counties from GeoHive");
      const names = (await areasIn(ctx, "Munster", "province", "local_authority")).map((r) => r.name);
      const las = new Set(names.map(norm));
      const isMunsterLa = (label) => las.has(norm(label));
      // Cross-check: the crosswalk's councils are exactly those named after a GeoHive Munster county.
      const legacy = (label) => /Council$/.test(label) && [...counties].some((cn) => norm(label).startsWith(cn.split(" ")[0]));
      if (names.some((la) => !legacy(la))) throw new Error(`crosswalk Munster councils disagree with GeoHive counties: ${names.join(", ")}`);
      const unemp = await cpni(ctx, "CPNI37", { laMatch: isMunsterLa });
      const top = unemp.sort((x, y) => y.value - x.value)[0];
      const la = top[LA_DIM];
      const change = await cpni(ctx, "CPNI05", { statistic: "Percentage change since 2016", laMatch: (l) => l === la });
      const row = change.find((r) => r[LA_DIM] === la);
      if (!row) throw new Error(`no CPNI05 row for ${la}`);
      return { local_authority: la.replace(/ Council$/, ""), unemployment_rate_pct: top.value, population_change_pct: row.value };
    }
  },
  {
    id: "t2-cork-housing-spend-per-capita",
    tier: "T2",
    drift: "stable",
    question: "Using the 2025 adopted council budgets, what is the total Division A (Housing and Building) expenditure for Cork City Council and for Cork County Council, and how much is that per resident of each local authority using Census 2022 populations? Which spends more per resident?",
    required_sources: ["council-budgets", "cso"],
    tool_path: ["council_budgets_get(2025, Cork City Council, A)", "council_budgets_get(2025, Cork County Council, A)", "cso_search_tables -> FY003A (population by administrative county)", "cso_get_data(FY003A)"],
    answer: {
      city_expenditure_eur: { type: "number", tol_rel: 0.01 },
      county_expenditure_eur: { type: "number", tol_rel: 0.01 },
      city_per_resident_eur: { type: "number", tol_rel: 0.02 },
      county_per_resident_eur: { type: "number", tol_rel: 0.02 },
      higher: { type: "text", desc: "Cork City Council or Cork County Council" }
    },
    gaps: ["dataset-card:geo-level-discovery", "server-query:aggregate"],
    async reference(ctx) {
      const city = await divisionTotal(ctx, "Cork City Council", 2025, "A");
      const county = await divisionTotal(ctx, "Cork County Council", 2025, "A");
      // CPNI05 merges Cork City and County; the split needs a local-authority population table such as FY003A.
      const corkGeo = (meta) => meta.dimensions.find((d) => ["Cork City Council", "Cork County Council"].every((n) => d.categories.some((c) => c.label === n)));
      const { code, meta } = await discoverCsoTable(ctx, {
        query: "population",
        geoLevel: "local_authority",
        fallback: "FY003A",
        accept: (m) =>
          Boolean(corkGeo(m)) &&
          /^population$/i.test(m.dimensions.find((d) => d.code === "STATISTIC")?.categories[0]?.label ?? "") &&
          m.dimensions.some((d) => d.role === "time" && d.categories.some((c) => c.code === "2022")) &&
          headlineTotals(m, corkGeo(m))
      });
      const geo = corkGeo(meta);
      const time = meta.dimensions.find((d) => d.role === "time");
      const filters = { [geo.code]: geo.categories.filter((c) => /^Cork (City|County) Council$/.test(c.label)).map((c) => c.code), [time.code]: ["2022"] };
      for (const d of meta.dimensions) if (d !== geo && d !== time) filters[d.code] = [d.categories[0].code];
      const pop = await csoRows(ctx, code, filters);
      const p = (name) => pop.find((r) => r[geo.label] === name)?.value;
      const pc = p("Cork City Council");
      const pk = p("Cork County Council");
      if (!pc || !pk) throw new Error("LA population missing");
      const a = city / pc;
      const b = county / pk;
      return { city_expenditure_eur: Math.round(city), county_expenditure_eur: Math.round(county), city_per_resident_eur: round(a, 0), county_per_resident_eur: round(b, 0), higher: a > b ? "Cork City Council" : "Cork County Council" };
    }
  },
  {
    id: "t2-connacht-completions-per-1000",
    tier: "T2",
    drift: "slow",
    question: "Rank the counties of the province of Connacht by new dwelling completions in 2024 per 1,000 residents (Census 2022 population). Give the full ranking (highest first) and the top county's rate.",
    required_sources: ["cso", "cross"],
    tool_path: ["ireland_resolve_place(Connacht, list county)", "cso_search_tables(completions)", "cso_get_data(NDA05, 2024)", "ireland_resolve_place(<county>, list lea) to aggregate LEAs", "cso_area_profile per county"],
    answer: {
      ranking: { type: "ordered_list", exact: true },
      top_rate_per_1000: { type: "number", tol_abs: 0.05 }
    },
    gaps: ["crosswalk:lea-to-county", "server-query:aggregate"],
    async reference(ctx) {
      const leas = await completionsByLea(ctx, 2024);
      const counties = (await areasIn(ctx, "Connacht", "province", "county")).map((r) => r.name);
      if (counties.length !== 5) throw new Error(`expected 5 Connacht counties, got ${counties.length}`);
      const rates = [];
      for (const c of counties) {
        const total = (await leaRowsInCounty(ctx, leas, c)).reduce((s, l) => s + l.value, 0);
        const { pop2022 } = await countyPop2022(ctx, c);
        rates.push({ c, rate: (total / pop2022) * 1000 });
      }
      rates.sort((x, y) => y.rate - x.rate);
      return { ranking: rates.map((r) => r.c), top_rate_per_1000: round(rates[0].rate, 2) };
    }
  },
  {
    id: "t2-dsp-jobseekers-per-1000",
    tier: "T2",
    drift: "slow",
    question: "Using the Department of Social Protection's quarterly county counts for 2026Q2, which three counties had the most Jobseeker's Allowance recipients per 1,000 residents (Census 2022 population)? Give them in order with the top county's rate, and the 2024 median Property Price Register sale price in the top county.",
    required_sources: ["cso", "ppr"],
    tool_path: ["cso_search_tables(jobseekers county)", "cso_get_table_metadata(DSP24)", "cso_get_data(DSP24, 2026Q2, Jobseekers Allowance)", "cso_area_profile x26"],
    answer: {
      top3: { type: "ordered_list", exact: true },
      top_rate_per_1000: { type: "number", tol_abs: 0.2 },
      top_county_median_eur: { type: "number", tol_rel: 0.01 }
    },
    gaps: ["server-query:join", "crosswalk:county-label-variants"],
    async reference(ctx) {
      const meta = await ctx.call("cso", "cso_get_table_metadata", { table_code: "DSP24", max_categories: 60 });
      const schemeDim = meta.dimensions.find((d) => /Scheme/i.test(d.label));
      const ja = schemeDim.categories.find((c) => /^Jobseekers Allowance$/i.test(c.label));
      const rows = await csoRows(ctx, "DSP24", { "TLIST(Q1)": ["2026Q2"], [schemeDim.code]: [ja.code] });
      const rates = [];
      for (const r of rows) {
        const m = /^Co\.?\s*(.+)$/.exec(r.County ?? "");
        if (!m || r.value == null) continue;
        // The crosswalk reads DSP's "Co.Donegal" labels; the regex above is the cross-check.
        const county = (await resolvePlace(ctx, { place: r.County, level: "county" })).place.name;
        if (norm(county) !== norm(m[1])) throw new Error(`crosswalk read ${r.County} as ${county}`);
        const { pop2022 } = await countyPop2022(ctx, county);
        rates.push({ c: county, rate: (r.value / pop2022) * 1000 });
      }
      if (rates.length < 20) throw new Error(`only ${rates.length} counties parsed`);
      rates.sort((x, y) => y.rate - x.rate);
      const ppr = await pprYear(ctx, { county: rates[0].c, from: "2024-01-01", to: "2024-12-31" });
      return { top3: rates.slice(0, 3).map((r) => r.c), top_rate_per_1000: round(rates[0].rate, 1), top_county_median_eur: ppr.median_eur };
    }
  },
  {
    id: "t2-real-deposit-rate-2025",
    tier: "T2",
    control: true,
    drift: "stable",
    question: "What was the ECB deposit facility rate in force on 31 December 2025, what was Ireland's 2025 annual average HICP inflation rate (Eurostat), and what is the implied real deposit rate (deposit rate minus inflation)?",
    required_sources: ["ecb", "eurostat"],
    tool_path: ["ecb_get_series(FM.B.U2.EUR.4F.KR.DFR.LEV)", "eurostat_get_data(prc_hicp_aind, CP00, RCH_A_AVG, 2025)"],
    answer: {
      deposit_rate_pct: { type: "number", tol_abs: 0.01 },
      hicp_2025_pct: { type: "number", tol_abs: 0.05 },
      real_rate_pct: { type: "number", tol_abs: 0.06 }
    },
    gaps: [],
    async reference(ctx) {
      const s = await ctx.call("ecb", "ecb_get_series", { key: "FM.B.U2.EUR.4F.KR.DFR.LEV", lastNObservations: 12 });
      const obs = s.series[0].observations.filter((o) => o.time <= "2025-12-31");
      const dfr = obs.at(-1).value;
      const h = await ctx.call("eurostat", "eurostat_get_data", { dataset: "prc_hicp_aind", filters: { coicop: ["CP00"], unit: ["RCH_A_AVG"] }, since: "2025", until: "2025" });
      const infl = h.rows[0].value;
      return { deposit_rate_pct: dfr, hicp_2025_pct: infl, real_rate_pct: round(dfr - infl, 2) };
    }
  },
  {
    id: "t2-gender-pay-gap-finance",
    tier: "T2",
    drift: "slow",
    question: "In the 2025 PayGap.ie reports, what mean hourly gender pay gap did AIB report, what is the median mean-hourly gap across all 2025 reports in the Financial and Insurance Activities sector, and what is Eurostat's latest unadjusted gender pay gap for Ireland (whole economy excluding public administration)?",
    required_sources: ["paygap", "eurostat"],
    tool_path: ["paygap_search_reports(AIB, 2025)", "ireland_query(paygap_search_reports(industry=Financial, 2025): median mean_hourly_gap)", "eurostat_get_data(earn_gr_gpgr2)"],
    answer: {
      aib_mean_gap_pct: { type: "number", tol_abs: 0.05 },
      sector_median_pct: { type: "number", tol_abs: 0.3 },
      eurostat_ie_pct: { type: "number", tol_abs: 0.05 },
      eurostat_year: { type: "text" }
    },
    gaps: ["server-query:aggregate"],
    async reference(ctx) {
      const aib = await ctx.call("paygap", "paygap_search_reports", { company: "AIB", year: 2025, limit: 5 });
      const a = aib.reports.find((r) => r.company_name === "AIB");
      const sector = { industry: "Financial and Insurance", year: 2025 };
      let median;
      if (ctx.hasOperation("ireland_query")) {
        const q = await ctx.query({ tables: [{ alias: "r", source: "paygap", operation: "paygap_search_reports", args: sector }], steps: [{ aggregate: { reports: "count", median: "median:metrics.mean_hourly_gap" } }] });
        median = q.rows[0].median;
      } else {
        const gaps = [];
        // Follow next_offset: the server trims each page to its token budget.
        let seen = 0;
        let total = null;
        for (let offset = 0, guard = 0; offset != null && guard < 100; guard++) {
          const page = await ctx.call("paygap", "paygap_search_reports", { ...sector, limit: 20, offset }, { allowTruncated: true });
          total = page.total_reports;
          seen += page.reports.length;
          for (const r of page.reports) if (typeof r.metrics?.mean_hourly_gap === "number") gaps.push(r.metrics.mean_hourly_gap);
          offset = page.next_offset;
        }
        ctx.workaround("server-query:pagination");
        if (seen !== total) throw new Error(`paged ${seen} of ${total} sector reports`);
        gaps.sort((x, y) => x - y);
        const mid = gaps.length / 2;
        median = gaps.length % 2 ? gaps[Math.floor(mid)] : (gaps[mid - 1] + gaps[mid]) / 2;
      }
      const e = await ctx.call("eurostat", "eurostat_get_data", { dataset: "earn_gr_gpgr2", filters: { nace_r2: ["B-S_X_O"], unit: ["PC"] }, since: "2018" });
      const last = e.rows.filter((r) => r.value != null).at(-1);
      return { aib_mean_gap_pct: a.metrics.mean_hourly_gap, sector_median_pct: round(median, 2), eurostat_ie_pct: last.value, eurostat_year: last.Time };
    }
  },
  {
    id: "t2-dublin-top-lea-completions",
    tier: "T2",
    drift: "slow",
    question: "Across the four Dublin local authorities, which three local electoral areas had the most new dwelling completions in 2024 (in order), what share of all Dublin completions did those three account for, and which Dáil constituency is the top LEA mainly in?",
    required_sources: ["cso", "cross"],
    tool_path: ["cso_get_data(NDA05, 2024)", "ireland_resolve_place(Dublin, list lea)", "ireland_resolve_place(<top LEA>) -> constituency with largest share"],
    answer: {
      top3_leas: { type: "ordered_list", exact: true },
      top3_share_pct: { type: "number", tol_abs: 0.3 },
      top_lea_constituency: { type: "text" }
    },
    gaps: ["crosswalk:lea-to-constituency", "crosswalk:lea-to-county"],
    async reference(ctx) {
      const leas = await leaRowsInCounty(ctx, await completionsByLea(ctx, 2024), "Dublin");
      const total = leas.reduce((s, l) => s + l.value, 0);
      leas.sort((a, b) => b.value - a.value);
      const top = leas.slice(0, 3);
      // "Mainly in": the constituency holding the largest share of the LEA's Census 2022 residents.
      const r = await resolvePlace(ctx, { place: `${top[0].lea}, ${top[0].council}`, level: "lea" });
      return { top3_leas: top.map((l) => l.lea), top3_share_pct: round((top.reduce((s, l) => s + l.value, 0) / total) * 100, 1), top_lea_constituency: r.codes.constituency[0].name };
    }
  },
  {
    id: "t2-kohesio-west-per-capita",
    tier: "T2",
    drift: "stable",
    question: "In the packaged Kohesio snapshot, what is the total EU budget of EU-funded projects in the West region (NUTS3 IE042: Galway, Mayo, Roscommon), and how much is that per resident of those three counties (Census 2022)?",
    required_sources: ["kohesio", "cso"],
    tool_path: ["ireland_query(kohesio_search_projects(region=IE042): count, sum eu_budget)", "cso_area_profile x3"],
    answer: {
      project_count: { type: "number", tol_abs: 0 },
      total_eu_budget_eur: { type: "number", tol_rel: 0.01 },
      per_resident_eur: { type: "number", tol_rel: 0.02 }
    },
    gaps: ["server-query:aggregate", "crosswalk:nuts3-to-county"],
    async reference(ctx) {
      let total = 0;
      let count = 0;
      if (ctx.hasOperation("ireland_query")) {
        const q = await ctx.query({ tables: [{ alias: "k", source: "kohesio", operation: "kohesio_search_projects", args: { region: "IE042" } }], steps: [{ aggregate: { projects: "count", eu_budget: "sum:eu_budget" } }] });
        count = q.rows[0].projects;
        total = q.rows[0].eu_budget ?? 0;
      } else {
        let offset = 0;
        for (let page = 0; page < 40; page++) {
          const d = await ctx.call("kohesio", "kohesio_search_projects", { region: "IE042", limit: 50, offset }, { allowTruncated: true });
          for (const p of d.projects) total += p.eu_budget ?? 0;
          count += d.projects.length;
          if (d.next_offset == null || d.next_offset >= d.total) break;
          offset = d.next_offset;
        }
        ctx.workaround("server-query:pagination");
      }
      const counties = (await areasIn(ctx, "IE042", "nuts3", "county")).map((r) => r.name).sort();
      if (counties.join() !== "Galway,Mayo,Roscommon") throw new Error(`crosswalk IE042 counties: ${counties.join(", ")}`);
      let pop = 0;
      for (const c of counties) pop += (await countyPop2022(ctx, c)).pop2022;
      return { project_count: count, total_eu_budget_eur: Math.round(total), per_resident_eur: round(total / pop, 1) };
    }
  },
  {
    id: "t2-rent-law-rpz",
    tier: "T2",
    drift: "stable",
    question: "Which Acts with 'Residential Tenancies' in their title were enacted in 2021, and by what percentage did the RTB average monthly rent for Dublin (all bedrooms, all property types) change from 2021 to 2024?",
    required_sources: ["legislation", "cso"],
    tool_path: ["legislation_list_acts(2021, Residential Tenancies)", "cso_get_table_metadata(RIA02)", "cso_get_data(RIA02, Dublin, 2021/2024)"],
    answer: {
      acts: { type: "list", exact: true, desc: "full Act titles" },
      rent_change_pct: { type: "number", tol_abs: 0.3 }
    },
    gaps: ["dataset-card:geo-level-discovery"],
    async reference(ctx) {
      const l = await ctx.call("legislation", "legislation_list_acts", { year: 2021, query: "Residential Tenancies", limit: 20 });
      const acts = l.acts.map((a) => a.title);
      const meta = await ctx.call("cso", "cso_get_table_metadata", { table_code: "RIA02", max_categories: 500 });
      const loc = meta.dimensions.find((d) => d.label === "Location");
      const dublin = loc.categories.find((c) => c.label === "Dublin");
      if (!dublin) throw new Error("no Dublin category in RIA02");
      const rows = await csoRows(ctx, "RIA02", { "TLIST(A1)": ["2021", "2024"], C02970V03592: ["-"], C02969V03591: ["-"], [loc.code]: [dublin.code] });
      const v = (y) => rows.find((r) => String(r.Year) === y)?.value;
      return { acts, rent_change_pct: pct(v("2021"), v("2024")) };
    }
  },
  {
    id: "t2-lobbying-planning-bill",
    tier: "T2",
    drift: "slow",
    question: "How many returns on the Register of Lobbying with return dates in calendar 2024 match the exact phrase \"Planning and Development Bill\", and what is the current Oireachtas status of the Planning and Development Bill 2023?",
    required_sources: ["lobbying", "oireachtas"],
    tool_path: ["lobbying_search_returns(query, 2024 dates)", "oireachtas_search_bills(Planning and Development Bill 2023)"],
    answer: {
      returns_2024: { type: "number", tol_rel: 0.1, tol_abs: 2 },
      bill_status: { type: "text" }
    },
    gaps: [],
    async reference(ctx) {
      const l = await ctx.call("lobbying", "lobbying_search_returns", { query: '"Planning and Development Bill"', date_from: "2024-01-01", date_to: "2024-12-31", limit: 1 }, { allowTruncated: true });
      if (l.possibly_more && l.total == null) throw new Error("lobbying total not exact");
      const b = await ctx.call("oireachtas", "oireachtas_search_bills", { query: "Planning and Development", year: "2023", limit: 10 });
      const bill = b.bills.find((x) => x.title === "Planning and Development Bill 2023");
      return { returns_2024: l.total, bill_status: bill.status };
    }
  },
  {
    id: "t2-dataset-discovery-lea",
    tier: "T2",
    drift: "slow",
    question: "Find the CSO tables that give (a) new dwelling completions and (b) arrivals from Ukraine at local electoral area level. For each, which LEA had the highest value in the latest year available? Give the two table codes, the two LEAs, and the 2024 median Property Price Register sale price for the county containing the top completions LEA.",
    required_sources: ["cso", "ppr"],
    tool_path: ["cso_search_tables(completions LEA)", "cso_search_tables(Ukraine LEA)", "cso_get_table_metadata x2", "cso_get_data x2 latest year"],
    answer: {
      completions_table: { type: "text" },
      completions_top_lea: { type: "text" },
      ukraine_table: { type: "text" },
      ukraine_top_lea: { type: "text" },
      completions_county_median_eur: { type: "number", tol_rel: 0.01 }
    },
    gaps: ["dataset-card:geo-level-discovery"],
    async reference(ctx) {
      const out = {};
      const probes = [
        ["completions", "NDA05", "new dwelling completions", (m, t) => /completion/i.test(t.title) && m.dimensions.some((d) => d.code === "TLIST(A1)")],
        ["ukraine", "UA05", "arrivals from Ukraine", (_m, t) => /ukraine/i.test(t.title)]
      ];
      for (const [key, fallback, query, accept] of probes) {
        const { code, meta } = await discoverCsoTable(ctx, { query, geoLevel: "lea", accept, fallback });
        const time = meta.dimensions.find((d) => d.role === "time");
        const geo = meta.dimensions.find((d) => d.role === "geo" || /Electoral/i.test(d.label));
        const stat = meta.dimensions.find((d) => d.code === "STATISTIC");
        const latest = time.categories.at(-1).code;
        const filters = { [time.code]: [latest], STATISTIC: [stat.categories[0].code] };
        for (const d of meta.dimensions) if (![time.code, geo.code, "STATISTIC"].includes(d.code)) filters[d.code] = [d.categories[0].code];
        const rows = (await csoRows(ctx, code, filters, 500)).filter((r) => r.value != null && !/^(State|Ireland|Total|All )/i.test(r[geo.label]));
        rows.sort((a, b) => b.value - a.value);
        out[`${key}_table`] = code;
        out[`${key}_top_lea`] = rows[0][geo.label].split(",")[0].trim();
        if (key === "completions") {
          const r = await resolvePlace(ctx, { place: rows[0][geo.label], level: "lea" });
          out._county = r.codes.county[0].name;
          if (out._county !== councilToCounty(rows[0][geo.label].split(",").at(-1).trim())) throw new Error(`crosswalk county ${out._county} for ${rows[0][geo.label]}`);
        }
      }
      out.completions_county_median_eur = (await pprYear(ctx, { county: out._county, from: "2024-01-01", to: "2024-12-31" })).median_eur;
      delete out._county;
      return out;
    }
  },
  {
    id: "t2-cib-social-welfare-vs-ja",
    tier: "T2",
    control: true,
    drift: "stable",
    question: "Between 2023 and 2025, by what percentage did the number of Social Welfare queries handled by Citizens Information Services change, and what share of all their 2025 queries were about Social Welfare? Over the same period, by what percentage did the national number of Jobseeker's Allowance recipients change (DSP quarterly counts, 2023Q2 to 2025Q2)? Did the two move in the same direction?",
    required_sources: ["cib", "cso"],
    tool_path: ["cib_cis_query_categories(2023, Social Welfare)", "cib_cis_query_categories(2025, Social Welfare)", "cso_get_table_metadata(DSP24)", "cso_get_data(DSP24, Ireland, Jobseekers Allowance, 2023Q2/2025Q2)"],
    answer: {
      cib_social_welfare_change_pct: { type: "number", tol_abs: 0.2 },
      social_welfare_share_2025_pct: { type: "number", tol_abs: 0.2 },
      ja_change_pct: { type: "number", tol_abs: 0.2 },
      same_direction: { type: "bool" }
    },
    gaps: [],
    async reference(ctx) {
      const q = async (year) => (await ctx.call("cib", "cib_cis_query_categories", { year, category: "Social Welfare" }, { allowTruncated: true })).record;
      const a = await q(2023);
      const b = await q(2025);
      const sw = (r) => r.categories.find((c) => c.category === "Social Welfare").queries;
      const meta = await ctx.call("cso", "cso_get_table_metadata", { table_code: "DSP24", max_categories: 60 });
      const scheme = meta.dimensions.find((d) => /Scheme/i.test(d.label));
      const county = meta.dimensions.find((d) => d.label === "County");
      const ja = scheme.categories.find((c) => /^Jobseekers Allowance$/i.test(c.label));
      const ie = county.categories.find((c) => c.label === "Ireland");
      const rows = await csoRows(ctx, "DSP24", { "TLIST(Q1)": ["2023Q2", "2025Q2"], [scheme.code]: [ja.code], [county.code]: [ie.code] });
      const j0 = rows.find((r) => r.Quarter === "2023Q2").value;
      const j1 = rows.find((r) => r.Quarter === "2025Q2").value;
      const cibChange = pct(sw(a), sw(b));
      const jaChange = pct(j0, j1);
      return { cib_social_welfare_change_pct: cibChange, social_welfare_share_2025_pct: round((sw(b) / b.total_queries) * 100, 1), ja_change_pct: jaChange, same_direction: Math.sign(cibChange) === Math.sign(jaChange) };
    }
  },
  {
    id: "t2-ed-deprivation-population",
    tier: "T2",
    drift: "stable",
    question: "For the point at the Spire on O'Connell Street, Dublin (53.3498, -6.2603): which CSO electoral division is it in, what is that ED's 2022 Pobal HP relative deprivation score and category, and what is the Census 2022 population of the small area containing the point?",
    required_sources: ["census-areas", "pobal"],
    tool_path: ["census_small_area_at (or geohive_boundaries_at_point)", "pobal_deprivation_search(ED code)"],
    answer: {
      electoral_division: { type: "text" },
      relative_score: { type: "number", tol_abs: 0.01 },
      deprivation_label: { type: "text" },
      small_area_population: { type: "number", tol_abs: 0 }
    },
    gaps: ["crosswalk:ed-codes"],
    async reference(ctx) {
      const pt = { lat: 53.3498, lon: -6.2603 };
      const sa = await ctx.call("census-areas", "census_small_area_at", pt);
      const edName = sa.area.electoral_division.name;
      const edCode = sa.area.electoral_division.code;
      const p = await ctx.call("pobal", "pobal_deprivation_search", { query: edCode, limit: 5 }, { allowTruncated: true });
      const ed = p.areas.find((a) => a.ed_id === edCode) ?? p.areas.find((a) => norm(a.electoral_division) === norm(edName));
      if (!ed) throw new Error(`Pobal has no ED ${edCode}`);
      return { electoral_division: edName, relative_score: ed.relative_score_2022, deprivation_label: ed.deprivation_label, small_area_population: sa.area.small_area.population };
    }
  },
  {
    id: "t2-planning-near-luas-broombridge",
    tier: "T2",
    drift: "slow",
    question: "How many planning applications received in calendar 2024 lie within 500 m of the Broombridge Luas stop, and how many residential units do they propose in total?",
    required_sources: ["luas", "planning"],
    tool_path: ["luas_list_stops(Green)", "planning_stats(lat, lon, 500, 2024)"],
    answer: {
      applications: { type: "number", tol_abs: 1 },
      residential_units: { type: "number", tol_rel: 0.05, tol_abs: 2 }
    },
    gaps: ["server-query:count"],
    async reference(ctx) {
      const l = await ctx.call("luas", "luas_list_stops", { line: "Green" });
      const s = l.stops.find((x) => /Broombridge/i.test(x.name));
      const args = { lat: s.lat, lon: s.lon, radius_m: 500, from: "2024-01-01", to: "2024-12-31" };
      if (!ctx.hasOperation("ireland_query")) {
        const p = await ctx.call("planning", "planning_search", { ...args, limit: 100 }, { allowTruncated: true });
        if (p.count >= 100) throw new GapError("server-query:count", "planning_search caps at 100 rows with no total; count unknowable");
        return { applications: p.count, residential_units: p.applications.reduce((t, a) => t + (a.residential_units ?? 0), 0) };
      }
      const st = await ctx.call("planning", "planning_stats", args);
      return { applications: st.applications, residential_units: st.residential_units };
    }
  },
  {
    id: "t2-galway-city-planning-volume",
    tier: "T2",
    drift: "slow",
    question: "How many planning applications did Galway City Council receive in calendar 2024, and what was the council's 2025 adopted Division D (Development Management) expenditure per application?",
    required_sources: ["planning", "council-budgets"],
    tool_path: ["planning_stats(council=Galway City Council, 2024) -> applications", "council_budgets_get(2025, Galway City Council, D)"],
    answer: {
      applications_2024: { type: "number", tol_rel: 0.02 },
      division_d_per_application_eur: { type: "number", tol_rel: 0.03 }
    },
    gaps: ["server-query:count"],
    async reference(ctx) {
      const args = { council: "Galway City Council", from: "2024-01-01", to: "2024-12-31" };
      if (!ctx.hasOperation("ireland_query")) {
        const p = await ctx.call("planning", "planning_search", { ...args, limit: 100 }, { allowTruncated: true });
        if (p.count >= 100 && p.total == null) throw new GapError("server-query:count", "planning_search returns at most 100 rows and no total; a council-year count needs server-side aggregation");
      }
      // The ArcGIS service counts; planning_search's exact total must agree.
      const s = await ctx.call("planning", "planning_stats", args);
      const p = await ctx.call("planning", "planning_search", { ...args, limit: 1 }, { allowTruncated: true });
      if (p.total !== s.applications) throw new Error(`planning_stats ${s.applications} vs planning_search total ${p.total}`);
      const d = await divisionTotal(ctx, "Galway City Council", 2025, "D");
      return { applications_2024: s.applications, division_d_per_application_eur: Math.round(d / s.applications) };
    }
  },

  // ================= T3: three or more sources with reasoning =================
  {
    id: "t3-rent-growth-completions-tds",
    tier: "T3",
    drift: "slow",
    question: "Among the three Galway City local electoral areas (Galway City Central, East and West), which had the fastest RTB average rent growth from 2019 to 2024 (all bedrooms, all property types)? For that LEA give the growth, its 2024 new dwelling completions, and the current TDs of the Dáil constituency that contains it.",
    required_sources: ["cso", "cross", "oireachtas"],
    tool_path: ["cso_get_table_metadata(RIA02) find LEA locations", "cso_get_data(RIA02, 2019/2024)", "cso_get_data(NDA05, 2024)", "ireland_resolve_place(LEA) -> constituency", "oireachtas_search_members"],
    answer: {
      lea: { type: "text" },
      rent_growth_pct: { type: "number", tol_abs: 0.5 },
      completions_2024: { type: "number", tol_abs: 0 },
      tds: { type: "list" }
    },
    // RTB publishes rents by LEA only in its own Rent Index reports (rtb.ie). CSO's RIA02 has towns and
    // neighbourhoods; mapping them to LEAs cannot give an LEA average without tenancy counts, so this is a
    // missing source, not a crosswalk gap. The crosswalk does answer the LEA -> constituency step.
    gaps: ["source:rtb-lea-rents", "server-query:large-table"],
    async reference(ctx) {
      const meta = await ctx.call("cso", "cso_get_table_metadata", { table_code: "RIA02", max_categories: 500 });
      const loc = meta.dimensions.find((d) => d.label === "Location");
      const names = ["Galway City Central", "Galway City East", "Galway City West"];
      const cats = names.map((n) => loc.categories.find((c) => norm(c.label).startsWith(norm(n))));
      if (cats.some((c) => !c)) throw new GapError("source:rtb-lea-rents", `RIA02 has ${loc.categories.length} locations (counties, towns, neighbourhoods) and none is an LEA; Galway entries: ${loc.categories.filter((c) => /galway/i.test(c.label)).map((c) => c.label).join("; ")}`);
      const rows = await csoRows(ctx, "RIA02", { "TLIST(A1)": ["2019", "2024"], C02970V03592: ["-"], C02969V03591: ["-"], [loc.code]: cats.map((c) => c.code) });
      const growth = names.map((n, i) => {
        const r = rows.filter((x) => x.Location === cats[i].label);
        return { n, g: pct(r.find((x) => String(x.Year) === "2019").value, r.find((x) => String(x.Year) === "2024").value) };
      }).sort((a, b) => b.g - a.g);
      const top = growth[0];
      const comp = (await completionsByLea(ctx, 2024)).find((l) => norm(l.lea) === norm(top.n));
      const r = await resolvePlace(ctx, { place: `${top.n}, Galway City`, level: "lea" });
      return { lea: top.n, rent_growth_pct: top.g, completions_2024: comp.value, tds: await currentTds(ctx, r.codes.constituency[0].name) };
    }
  },
  {
    id: "t3-ballymun-vs-tallaght",
    tier: "T3",
    drift: "slow",
    question: "Compare Ballymun and Tallaght (Dublin): the population-weighted average 2022 Pobal HP relative deprivation score across the electoral divisions whose names start with each place name, the number of public-transport stops (NaPTAN) within 1 km of each gazetteer point, and the OPW flood risk for each. Which area is more deprived?",
    required_sources: ["pobal", "geohive", "tfi-static"],
    tool_path: ["pobal_deprivation_search(Ballymun)", "pobal_deprivation_search(Tallaght)", "geohive_locate x2", "tfi_static_search_stops(lat, lon, 1000) x2", "flood risk: no source"],
    answer: {
      ballymun_weighted_score: { type: "number", tol_abs: 0.1 },
      tallaght_weighted_score: { type: "number", tol_abs: 0.1 },
      ballymun_stops_1km: { type: "number", tol_rel: 0.05 },
      tallaght_stops_1km: { type: "number", tol_rel: 0.05 },
      more_deprived: { type: "text" }
    },
    blocked_keys: { flood_risk: "source:opw-flood-maps" },
    gaps: ["source:opw-flood-maps", "crosswalk:place-to-eds"],
    async reference(ctx) {
      const out = {};
      for (const place of ["Ballymun", "Tallaght"]) {
        const p = await ctx.call("pobal", "pobal_deprivation_search", { query: place, limit: 50 });
        const eds = p.areas.filter((a) => norm(a.electoral_division).startsWith(norm(place)));
        ctx.workaround("crosswalk:place-to-eds");
        const pop = eds.reduce((s, a) => s + a.population_2022, 0);
        out[`${place.toLowerCase()}_weighted_score`] = round(eds.reduce((s, a) => s + a.relative_score_2022 * a.population_2022, 0) / pop, 2);
        const pt = await locate(ctx, place, "Dublin");
        const s = await ctx.call("tfi-static", "tfi_static_search_stops", { lat: pt.lat, lon: pt.lon, radius: 1000, limit: 1 }, { allowTruncated: true });
        out[`${place.toLowerCase()}_stops_1km`] = s.total;
      }
      out.more_deprived = out.ballymun_weighted_score < out.tallaght_weighted_score ? "Ballymun" : "Tallaght";
      return out;
    }
  },
  {
    id: "t3-welfare-unemployment-law",
    tier: "T3",
    drift: "slow",
    question: "Did Jobseeker's Allowance recipients in County Donegal rise or fall between 2024Q2 and 2026Q2 (DSP county counts), how does Donegal's Census 2022 ILO unemployment rate compare with the State's, how many Citizens Information queries about social welfare came from Donegal (CIB publishes national totals only), and which Act consolidates the law on Jobseeker's Allowance (title, year, number)?",
    required_sources: ["cso", "legislation"],
    tool_path: ["cso_get_data(DSP24, Co.Donegal, JA, 2024Q2/2026Q2)", "cso_get_data(CPNI37)", "Citizens Information query statistics: no source", "legislation_list_acts(2005, Social Welfare Consolidation)"],
    answer: {
      ja_change_pct: { type: "number", tol_abs: 0.5 },
      direction: { type: "text", desc: "rose or fell" },
      donegal_unemployment_pct: { type: "number", tol_abs: 0.05 },
      state_unemployment_pct: { type: "number", tol_abs: 0.05 },
      act: { type: "text", desc: "Act title" },
      act_number: { type: "number", tol_abs: 0 }
    },
    blocked_keys: { cib_social_welfare_queries_donegal: "source:cib-county-breakdown" },
    gaps: ["source:cib-county-breakdown", "knowledge:law-search", "crosswalk:la-vs-county"],
    async reference(ctx) {
      const meta = await ctx.call("cso", "cso_get_table_metadata", { table_code: "DSP24", max_categories: 60 });
      const scheme = meta.dimensions.find((d) => /Scheme/i.test(d.label));
      const county = meta.dimensions.find((d) => d.label === "County");
      const ja = scheme.categories.find((c) => /^Jobseekers Allowance$/i.test(c.label));
      const dl = county.categories.find((c) => /Donegal/.test(c.label));
      const rows = await csoRows(ctx, "DSP24", { "TLIST(Q1)": ["2024Q2", "2026Q2"], [scheme.code]: [ja.code], [county.code]: [dl.code] });
      const a = rows.find((r) => r.Quarter === "2024Q2").value;
      const b = rows.find((r) => r.Quarter === "2026Q2").value;
      const unemp = await cpni(ctx, "CPNI37", { laMatch: (l) => l === "Donegal County Council" || /^(State|Ireland)$/.test(l) });
      const dg = unemp.find((r) => r[LA_DIM] === "Donegal County Council").value;
      const state = unemp.find((r) => /^(State|Ireland)$/.test(r[LA_DIM]))?.value;
      if (state == null) throw new Error("no State row in CPNI37");
      // Finding which Act governs a payment needs law full-text search; the reference knows the title.
      ctx.workaround("knowledge:law-search");
      const l = await ctx.call("legislation", "legislation_list_acts", { year: 2005, query: "Social Welfare Consolidation" });
      const act = l.acts.find((x) => /Social Welfare Consolidation Act 2005/.test(x.title));
      return { ja_change_pct: pct(a, b), direction: b > a ? "rose" : "fell", donegal_unemployment_pct: dg, state_unemployment_pct: state, act: act.title, act_number: act.number };
    }
  },
  {
    id: "t3-gdp-per-capita-three-ways",
    tier: "T3",
    drift: "stable",
    question: "Ireland's 2024 GDP per capita: what does the World Bank give (current US$), what does Eurostat give (current euro), and, converting the World Bank figure to euro at the ECB's 2024 annual average USD/EUR rate, how far apart are the two (Eurostat minus converted World Bank, as a % of Eurostat)?",
    required_sources: ["world-bank", "eurostat", "ecb"],
    tool_path: ["worldbank_get_indicator(NY.GDP.PCAP.CD)", "eurostat_get_data(nama_10_pc, CP_EUR_HAB, B1GQ, 2024)", "ecb_get_series(EXR.A.USD.EUR.SP00.A)"],
    answer: {
      worldbank_usd: { type: "number", tol_rel: 0.005 },
      eurostat_eur: { type: "number", tol_rel: 0.005 },
      usd_per_eur_2024: { type: "number", tol_abs: 0.001 },
      difference_pct: { type: "number", tol_abs: 0.5 }
    },
    gaps: [],
    control: true,
    async reference(ctx) {
      const wb = await ctx.call("world-bank", "worldbank_get_indicator", { indicator: "NY.GDP.PCAP.CD", country: "IRL", last: 5 });
      const usd = wb.observations.find((o) => o.year === "2024").value;
      const es = await ctx.call("eurostat", "eurostat_get_data", { dataset: "nama_10_pc", filters: { unit: ["CP_EUR_HAB"], na_item: ["B1GQ"] }, since: "2024", until: "2024" });
      const eur = es.rows[0].value;
      const fx = await ctx.call("ecb", "ecb_get_series", { key: "EXR.A.USD.EUR.SP00.A", lastNObservations: 5 });
      const rate = fx.series[0].observations.find((o) => o.time === "2024").value;
      const conv = usd / rate;
      return { worldbank_usd: Math.round(usd), eurostat_eur: eur, usd_per_eur_2024: round(rate, 4), difference_pct: round(((eur - conv) / eur) * 100, 1) };
    }
  },
  {
    id: "t3-athlone-vs-mullingar",
    tier: "T3",
    drift: "stable",
    question: "Compare the towns of Athlone and Mullingar: Census 2022 population of each town, the median declared sale price in 2024 for Property Price Register addresses containing each town name (County Westmeath only), and the number of NPWS protected sites within 2 km of each gazetteer point. Which town has the higher median price?",
    required_sources: ["cso", "ppr", "geohive", "environment-sites"],
    tool_path: ["cso_area_profile(Athlone)", "cso_area_profile(Mullingar)", "ppr_price_stats(Westmeath, address, 2024) x2", "geohive_locate x2", "protected_sites_near x2"],
    answer: {
      athlone_population: { type: "number", tol_rel: 0.001 },
      mullingar_population: { type: "number", tol_rel: 0.001 },
      athlone_median_eur: { type: "number", tol_rel: 0.01 },
      mullingar_median_eur: { type: "number", tol_rel: 0.01 },
      athlone_protected_sites: { type: "number", tol_abs: 0 },
      mullingar_protected_sites: { type: "number", tol_abs: 0 },
      higher_median: { type: "text" }
    },
    gaps: ["crosswalk:town-spans-counties"],
    async reference(ctx) {
      const out = {};
      for (const t of ["Athlone", "Mullingar"]) {
        const k = t.toLowerCase();
        const p = await ctx.call("cso", "cso_area_profile", { area: t });
        out[`${k}_population`] = (p.census ?? []).find((x) => String(x.year) === "2022").total;
        out[`${k}_median_eur`] = (await pprYear(ctx, { county: "Westmeath", address: t, from: "2024-01-01", to: "2024-12-31" })).median_eur;
        const pt = await locate(ctx, t, "Westmeath");
        const s = await ctx.call("environment-sites", "protected_sites_near", { lat: pt.lat, lon: pt.lon, radius_m: 2000, limit: 50 });
        out[`${k}_protected_sites`] = s.count ?? s.sites.length;
      }
      out.higher_median = out.athlone_median_eur > out.mullingar_median_eur ? "Athlone" : "Mullingar";
      return out;
    }
  },
  {
    id: "t3-munster-housing-pressure",
    tier: "T3",
    drift: "slow",
    question: "For Cork, Kerry and Limerick counties: give the 2024 median Property Price Register sale price, the 2024 new dwelling completions per 1,000 residents (Census 2022), and the 2016–2022 population growth. Rank the three counties by completions per 1,000 residents (highest first).",
    required_sources: ["ppr", "cso"],
    tool_path: ["ppr_price_stats x3", "cso_get_data(NDA05, 2024) aggregated to county", "cso_area_profile x3"],
    answer: {
      ranking: { type: "ordered_list", exact: true },
      cork_median_eur: { type: "number", tol_rel: 0.01 },
      kerry_median_eur: { type: "number", tol_rel: 0.01 },
      limerick_median_eur: { type: "number", tol_rel: 0.01 },
      cork_completions_per_1000: { type: "number", tol_abs: 0.05 },
      kerry_completions_per_1000: { type: "number", tol_abs: 0.05 },
      limerick_completions_per_1000: { type: "number", tol_abs: 0.05 },
      cork_pop_growth_pct: { type: "number", tol_abs: 0.1 },
      kerry_pop_growth_pct: { type: "number", tol_abs: 0.1 },
      limerick_pop_growth_pct: { type: "number", tol_abs: 0.1 }
    },
    gaps: ["crosswalk:lea-to-county", "server-query:aggregate"],
    async reference(ctx) {
      const leas = await completionsByLea(ctx, 2024);
      const out = {};
      const rates = [];
      for (const c of ["Cork", "Kerry", "Limerick"]) {
        const k = c.toLowerCase();
        out[`${k}_median_eur`] = (await pprYear(ctx, { county: c, from: "2024-01-01", to: "2024-12-31" })).median_eur;
        const { pop2022, change_pct } = await countyPop2022(ctx, c);
        const total = (await leaRowsInCounty(ctx, leas, c)).reduce((s, l) => s + l.value, 0);
        out[`${k}_completions_per_1000`] = round((total / pop2022) * 1000, 2);
        out[`${k}_pop_growth_pct`] = change_pct;
        rates.push([c, total / pop2022]);
      }
      out.ranking = rates.sort((a, b) => b[1] - a[1]).map((r) => r[0]);
      return out;
    }
  },
  {
    id: "t3-lowest-deprivation-galway-city-td",
    tier: "T3",
    drift: "slow",
    question: "Which electoral division in the Galway City Council area has the lowest (most deprived) 2022 Pobal HP relative deprivation score, what is the score, and who are the current TDs for the Dáil constituency it is in?",
    required_sources: ["pobal", "cross", "oireachtas"],
    tool_path: ["ireland_resolve_place(Galway City Council, list ed)", "pobal_deprivation_search(ED id) x22", "ED -> constituency (from the list)", "oireachtas_search_members"],
    answer: {
      electoral_division: { type: "text" },
      relative_score: { type: "number", tol_abs: 0.01 },
      tds: { type: "list" }
    },
    gaps: ["crosswalk:la-to-eds", "crosswalk:ed-to-constituency"],
    async reference(ctx) {
      if (!ctx.hasOperation("ireland_resolve_place") && !ctx.hasOperation("ireland_crosswalk")) {
        throw new GapError("crosswalk:la-to-eds", "no tool lists the electoral divisions of a local authority; pobal_deprivation_search needs a name or id and has no council filter");
      }
      const eds = await areasIn(ctx, "Galway City Council", "local_authority", "ed");
      if (eds.length < 20) throw new Error(`only ${eds.length} Galway City EDs from the crosswalk`);
      const scored = [];
      for (const ed of eds) {
        const p = await ctx.call("pobal", "pobal_deprivation_search", { query: ed.code, limit: 5 }, { allowTruncated: true });
        const hit = p.areas.find((a) => a.ed_id === ed.code);
        if (!hit || typeof hit.relative_score_2022 !== "number") throw new Error(`Pobal has no score for ED ${ed.code} ${ed.name}`);
        scored.push({ ed, score: hit.relative_score_2022 });
      }
      scored.sort((a, b) => a.score - b.score);
      const low = scored[0];
      if (low.ed.constituency.includes(";")) throw new Error(`ED ${low.ed.name} straddles constituencies: ${low.ed.constituency}`);
      return { electoral_division: low.ed.name, relative_score: low.score, tds: await currentTds(ctx, low.ed.constituency) };
    }
  },
  {
    id: "t3-energy-weather-now",
    tier: "T3",
    drift: "live",
    question: "Right now: what is EirGrid's all-island wind share of demand, which reporting Irish weather buoy has the highest significant wave height (and what is it in metres), and how many Met Éireann weather warnings are currently active? Is wind generation above 50% of demand?",
    required_sources: ["eirgrid", "marine", "met-eireann"],
    tool_path: ["grid_get_status(ALL)", "marine_get_buoys()", "met_get_warnings"],
    answer: {
      wind_share_pct: { type: "number", tol_abs: 8 },
      highest_wave_buoy: { type: "text", desc: "buoy id, e.g. M3" },
      highest_wave_m: { type: "number", tol_abs: 0.5 },
      active_warnings: { type: "number", tol_abs: 1 },
      above_half: { type: "bool" }
    },
    gaps: [],
    async reference(ctx) {
      const g = await ctx.call("eirgrid", "grid_get_status", { region: "ALL" });
      const b = await ctx.call("marine", "marine_get_buoys", {});
      const top = b.buoys.filter((x) => typeof x.wave_height_m === "number").sort((x, y) => y.wave_height_m - x.wave_height_m)[0];
      const w = await ctx.call("met-eireann", "met_get_warnings", {});
      return { wind_share_pct: g.wind_share_pct, highest_wave_buoy: top.id, highest_wave_m: top.wave_height_m, active_warnings: w.count ?? w.warnings.length, above_half: g.wind_share_pct > 50 };
    }
  },
  {
    id: "t3-galway-planning-act-budget",
    tier: "T3",
    drift: "slow",
    question: "For Galway City Council: how many planning applications proposing residential units were received in 2024, what is the total number of units proposed, what is the council's 2025 adopted Division A (Housing and Building) expenditure, and under which 2024 Act will new planning applications be decided once commenced (title and number)?",
    required_sources: ["planning", "council-budgets", "legislation"],
    tool_path: ["ireland_query(planning_search(council, 2024): filter residential_units > 0, count + sum)", "council_budgets_get(2025, A)", "legislation_list_acts(2024, planning)"],
    answer: {
      residential_applications: { type: "number", tol_rel: 0.03 },
      residential_units: { type: "number", tol_rel: 0.03 },
      division_a_expenditure_eur: { type: "number", tol_rel: 0.01 },
      act: { type: "text" },
      act_number: { type: "number", tol_abs: 0 }
    },
    gaps: ["server-query:count", "knowledge:law-search"],
    async reference(ctx) {
      const args = { council: "Galway City Council", from: "2024-01-01", to: "2024-12-31" };
      if (!ctx.hasOperation("ireland_query")) {
        const p = await ctx.call("planning", "planning_search", { ...args, limit: 100 }, { allowTruncated: true });
        if (p.count >= 100 && p.total == null) throw new GapError("server-query:count", "planning_search caps at 100 rows and has no total; a council-year filter + sum needs server-side aggregation");
      }
      const q = await ctx.query({
        tables: [{ alias: "p", source: "planning", operation: "planning_search", args }],
        steps: [{ filter: ["residential_units", ">", 0] }, { aggregate: { applications: "count", units: "sum:residential_units" } }]
      });
      const res = q.rows[0];
      // Cross-check against the ArcGIS service's own statistics.
      const s = await ctx.call("planning", "planning_stats", { ...args, min_units: 1 });
      if (s.applications !== res.applications || s.residential_units !== res.units) throw new Error(`ireland_query ${res.applications}/${res.units} vs planning_stats ${s.applications}/${s.residential_units}`);
      const l = await ctx.call("legislation", "legislation_list_acts", { year: 2024, query: "Planning and Development" });
      const act = l.acts.find((a) => a.title === "Planning and Development Act 2024");
      return { residential_applications: res.applications, residential_units: res.units, division_a_expenditure_eur: Math.round(await divisionTotal(ctx, "Galway City Council", 2025, "A")), act: act.title, act_number: act.number };
    }
  },
  {
    id: "t3-cso-geography-mismatch",
    tier: "T3",
    drift: "stable",
    question: "For the point 53.2859, -6.3733 in Tallaght: which small area do GeoHive's boundaries and the CSO Census 2022 small-area service each report, what is the CSO small area's population, and what is the Pobal 2022 deprivation label for the electoral division?",
    required_sources: ["geohive", "census-areas", "pobal"],
    tool_path: ["geohive_boundaries_at_point", "census_small_area_at", "pobal_deprivation_search(ED code)"],
    answer: {
      geohive_small_area: { type: "text" },
      cso_small_area: { type: "text" },
      cso_small_area_population: { type: "number", tol_abs: 0 },
      deprivation_label: { type: "text" }
    },
    gaps: ["crosswalk:small-area-versions", "crosswalk:ed-codes"],
    async reference(ctx) {
      const pt = { lat: 53.2859, lon: -6.3733 };
      const g = await boundaries(ctx, pt);
      const c = await ctx.call("census-areas", "census_small_area_at", pt);
      const edCode = c.area.electoral_division.code;
      const p = await ctx.call("pobal", "pobal_deprivation_search", { query: edCode, limit: 5 }, { allowTruncated: true });
      const ed = p.areas.find((a) => a.ed_id === edCode);
      if (!ed) throw new Error(`Pobal has no ED ${edCode}`);
      return { geohive_small_area: g.small_area.code, cso_small_area: c.area.small_area.code, cso_small_area_population: c.area.small_area.population, deprivation_label: ed.deprivation_label };
    }
  },
  {
    id: "t3-cib-guidance-with-stats",
    tier: "T3",
    drift: "slow",
    question: "According to Citizens Information, what is the maximum personal weekly rate of Jobseeker's Allowance for a person aged 25 or over, how many people were receiving Jobseeker's Allowance nationally in 2026Q2 (DSP), roughly what annual cost does that imply at the maximum personal rate, and which Act (title) provides for the payment?",
    required_sources: ["citizens-information", "cso", "legislation"],
    tool_path: ["Citizens Information search (knowledge index)", "cso_get_data(DSP24, Ireland, JA, 2026Q2)", "law search -> legislation_list_acts(2005, Social Welfare Consolidation)"],
    answer: {
      max_weekly_rate_eur: { type: "number", tol_abs: 0.5 },
      recipients_2026q2: { type: "number", tol_rel: 0.001 },
      implied_annual_cost_eur: { type: "number", tol_rel: 0.02 },
      act: { type: "text" }
    },
    gaps: ["knowledge:citizens-info", "knowledge:law-search"],
    async reference(ctx) {
      throw new GapError("knowledge:citizens-info", ctx.hasOperation("citizens_info_search") ? "citizens_info_search present: write this reference" : "no Citizens Information guidance search/get operation in the catalogue (cib_* tools are query statistics only)");
    }
  },
  {
    id: "t3-section-text-and-stats",
    tier: "T3",
    drift: "stable",
    question: "Section 2 of the Data Sharing and Governance Act 2019 defines terms used in the Act. Using the Irish Statute Book, give that Act's number and enactment date, say whether section 2 defines 'public body', give how many Acts in total were enacted in 2019, and how many datasets on data.gov.ie match the search 'data sharing'.",
    required_sources: ["legislation", "data-gov-ie"],
    tool_path: ["legislation_list_acts(2019, Data Sharing)", "legislation_get_act", "legislation_get_section(2)", "legislation_list_acts(2019) total", "datagov_search_datasets(data sharing)"],
    answer: {
      act_number: { type: "number", tol_abs: 0 },
      enacted: { type: "date", desc: "YYYY-MM-DD" },
      defines_public_body: { type: "bool" },
      acts_2019_total: { type: "number", tol_abs: 0 },
      datagov_matches: { type: "number", tol_rel: 0.1, tol_abs: 2 }
    },
    gaps: ["knowledge:law-search"],
    async reference(ctx) {
      const l = await ctx.call("legislation", "legislation_list_acts", { year: 2019, query: "Data Sharing and Governance" });
      const act = l.acts[0];
      const d = await ctx.call("legislation", "legislation_get_act", { year: 2019, number: act.number, limit: 1 }, { allowTruncated: true });
      const s = await ctx.call("legislation", "legislation_get_section", { year: 2019, number: act.number, section: "2" });
      const all = await ctx.call("legislation", "legislation_list_acts", { year: 2019, limit: 1 }, { allowTruncated: true });
      const dg = await ctx.call("data-gov-ie", "datagov_search_datasets", { query: "data sharing", limit: 1 }, { allowTruncated: true });
      return { act_number: act.number, enacted: d.enacted, defines_public_body: /[“"‘']public body[”"’']/i.test(s.text ?? JSON.stringify(s)), acts_2019_total: all.total, datagov_matches: dg.count ?? dg.total };
    }
  }
];

export const AS_OF_DATE = AS_OF;
