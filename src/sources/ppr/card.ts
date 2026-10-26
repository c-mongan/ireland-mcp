import type { SourceCard } from "../../gateway/cards.js";

export const pprCard: SourceCard = {
  topics: ["property", "housing", "prices"],
  geo_levels: ["county", "point"],
  time: { start: "2010", end: "present", series: true, note: "Every declared residential sale since 1 January 2010." },
  cadence: "daily",
  dimensions: ["sale date", "price (EUR)", "address", "county", "Eircode (when given)", "new or second-hand", "full market price flag", "median, mean and quartiles"],
  join_keys: ["county_name", "eircode_routing_key", "date", "year"],
  freshness: "Property Services Regulatory Authority register; sales appear after Revenue filing, so recent months are incomplete.",
  auth: { required: false },
  examples: ["Median sale price in County Dublin in 2024", "How many homes sold in Galway in 2024?", "Sales in Eircode area H91 over €500,000 this year"]
};