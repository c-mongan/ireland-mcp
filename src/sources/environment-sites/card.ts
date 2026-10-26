import type { SourceCard } from "../../gateway/cards.js";

export const environmentSitesCard: SourceCard = {
  topics: ["environment", "heritage"],
  geo_levels: ["point", "county"],
  time: { start: "present", end: "present", series: false, note: "Current designations." },
  cadence: "irregular",
  dimensions: ["site code and name", "designation (SPA, SAC, NHA, pNHA)", "county", "area"],
  join_keys: ["lat_lon", "county_name"],
  freshness: "NPWS ArcGIS FeatureServer; designations change rarely.",
  auth: { required: false },
  examples: ["Is Salthill beach inside a Special Area of Conservation?", "Protected sites within 2 km of a wind-farm site"]
};