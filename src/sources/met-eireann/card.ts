import type { SourceCard } from "../../gateway/cards.js";

export const metCard: SourceCard = {
  topics: ["weather"],
  geo_levels: ["point", "national"],
  time: { start: "live", end: "live", series: true, note: "Forecasts for the coming days and today's hourly station observations; no historical archive here." },
  cadence: "hourly",
  dimensions: ["temperature", "wind speed and direction", "rainfall", "cloud", "pressure", "humidity", "warning level, region and validity"],
  join_keys: ["lat_lon", "met_station_name", "date"],
  freshness: "Live: forecasts and observations are cached for 15 minutes and carry retrieved_at.",
  auth: { required: false },
  examples: ["Will it rain in Galway tomorrow afternoon?", "Are there any weather warnings in force?", "Observed temperature at Dublin Airport today"],
  operations: {
    met_get_observations: { geo_levels: ["point"], join_keys: ["met_station_name", "date"], examples: ["Hourly rainfall at Cork Airport today"] },
    met_get_warnings: { geo_levels: ["national", "county"], join_keys: ["county_name", "date"], examples: ["Is there an orange wind warning for Kerry?"] }
  }
};