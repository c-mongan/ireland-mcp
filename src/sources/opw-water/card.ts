import type { SourceCard } from "../../gateway/cards.js";

export const opwWaterCard: SourceCard = {
  topics: ["water", "environment"],
  geo_levels: ["point"],
  time: { start: "live", end: "live", series: true, note: "Latest reading plus up to the last day of 15-minute readings." },
  cadence: "live",
  dimensions: ["station (id, name, river, coordinates)", "water level (m, local datum and OD)", "water temperature", "min, max and change over recent hours"],
  join_keys: ["water_station_id", "lat_lon"],
  freshness: "waterlevel.ie provisional data; each reading has a timestamp.",
  auth: { required: false },
  examples: ["River Shannon level at Athlone now", "Has the River Suir at Clonmel risen in the last 12 hours?"]
};