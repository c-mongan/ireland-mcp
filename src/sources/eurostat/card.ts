import type { SourceCard } from "../../gateway/cards.js";

export const eurostatCard: SourceCard = {
  topics: ["economy", "population", "labour", "prices", "international", "energy", "environment", "health", "education"],
  geo_levels: ["national", "nuts2", "nuts3"],
  time: { start: "unknown", end: "present", series: true, note: "Varies by dataset; read the time dimension of each dataset." },
  cadence: "irregular",
  dimensions: ["dataset code", "geo (IE, EU27_2020, NUTS codes)", "time period", "unit", "dataset-specific dimensions"],
  join_keys: ["eurostat_geo", "nuts_code", "year"],
  freshness: "Eurostat dissemination API; each dataset has its own update date. Results carry retrieved_at.",
  auth: { required: false },
  examples: ["Ireland's HICP inflation against the EU average since 2020", "Unemployment rate in Ireland and the EU27 by year"],
  unknowns: { time: "Start years vary by dataset, from the 1960s to recent years." }
};