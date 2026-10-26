import type { SourceCard } from "../../gateway/cards.js";

export const eirgridCard: SourceCard = {
  topics: ["energy", "environment"],
  geo_levels: ["national"],
  time: { start: "live", end: "live", series: true, note: "Latest 15-minute values plus today and recent days." },
  cadence: "live",
  dimensions: ["system demand (MW)", "wind generation (MW)", "wind share of demand (%)", "carbon intensity (gCO2/kWh)", "region (all-island, ROI, NI)"],
  join_keys: ["date"],
  freshness: "EirGrid Smart Grid Dashboard, 15-minute resolution; values are provisional.",
  auth: { required: false },
  examples: ["What share of Ireland's electricity is coming from wind right now?", "Current carbon intensity of the Irish grid"]
};