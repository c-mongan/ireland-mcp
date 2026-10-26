import type { SourceCard } from "../../gateway/cards.js";

export const kohesioCard: SourceCard = {
  topics: ["eu-funding", "economy", "public-finance"],
  geo_levels: ["nuts2", "nuts3", "point"],
  time: { start: "2014", end: "2027", series: true, note: "Programming periods 2014–2020 and 2021–2027." },
  cadence: "snapshot",
  dimensions: ["project (Q id, title, summary)", "fund", "programme", "beneficiary", "NUTS region", "locality and coordinates", "EU and total budget", "start and end dates"],
  join_keys: ["nuts_code", "lat_lon", "company_name"],
  freshness: "Packaged official Kohesio CSV exports with snapshot dates returned in each result; not live.",
  auth: { required: false },
  examples: ["EU cohesion funding for projects in the West region (NUTS3 IE042)", "Largest EU-funded projects in Ireland since 2021"]
};