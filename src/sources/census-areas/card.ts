import type { SourceCard } from "../../gateway/cards.js";

export const censusAreasCard: SourceCard = {
  topics: ["population", "census", "geography"],
  geo_levels: ["point", "small_area", "ed", "local_authority", "county", "nuts3"],
  time: { start: "2022", end: "2022", series: false, note: "Census 2022 small areas and population only." },
  cadence: "snapshot",
  dimensions: ["small area code", "electoral division (code, name)", "county", "local authority", "NUTS3", "total, male and female population"],
  join_keys: ["lat_lon", "small_area_code", "ed_code", "ed_name", "county_name", "local_authority_name", "nuts_code"],
  freshness: "CSO Census 2022 ArcGIS layers; fixed release.",
  auth: { required: false },
  examples: ["Population of the small area containing a point in Ballymun", "Which ED and county is this coordinate in?"]
};