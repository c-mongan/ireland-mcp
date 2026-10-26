import type { SourceCard } from "../../gateway/cards.js";

export const logainmCard: SourceCard = {
  topics: ["places", "geography", "heritage"],
  geo_levels: ["point", "county", "town"],
  time: { start: "present", end: "present", series: false },
  cadence: "irregular",
  dimensions: ["place id", "Irish and English names", "place type", "containing county, barony, parish", "coordinates and accuracy"],
  join_keys: ["logainm_id", "lat_lon", "county_name"],
  freshness: "Gaois Logainm API, live.",
  auth: { required: true, env: "LOGAINM_API_KEY", error: "NOT_CONFIGURED", note: "The operator must register at the Gaois Developer Hub; without the key every call returns NOT_CONFIGURED." },
  examples: ["Irish name and parish of a townland", "Official English and Irish forms of Dún Laoghaire"]
};