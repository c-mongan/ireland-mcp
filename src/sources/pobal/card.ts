import type { SourceCard } from "../../gateway/cards.js";

export const pobalCard: SourceCard = {
  topics: ["deprivation", "population", "census"],
  geo_levels: ["ed"],
  time: { start: "2022", end: "2022", series: false, note: "2022 index scores only." },
  cadence: "snapshot",
  dimensions: ["electoral division id and name", "2022 population", "relative and absolute deprivation score", "deprivation category and label"],
  join_keys: ["ed_code", "ed_name"],
  freshness: "Pobal HP Deprivation Index 2022 on the data.gov.ie datastore; a fixed release.",
  auth: { required: false },
  examples: ["How deprived is Ballymun's electoral division compared with Tallaght's?", "Deprivation score for ED 128020"]
};