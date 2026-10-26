import type { SourceCard } from "../../gateway/cards.js";

export const smartDublinCard: SourceCard = {
  topics: ["transport", "environment", "civic", "places"],
  geo_levels: ["local_authority", "point"],
  time: { start: "unknown", end: "present", series: true, note: "Per dataset; some are live feeds, others yearly files." },
  cadence: "irregular",
  dimensions: ["dataset", "publisher (Dublin City, Fingal, South Dublin, Dún Laoghaire-Rathdown)", "resource", "datastore columns"],
  join_keys: ["dataset_id", "local_authority_name", "lat_lon"],
  freshness: "CKAN metadata as published; each dataset has its own modified date.",
  auth: { required: false },
  examples: ["Cycle counter datasets for Dublin City", "Footfall counts on Grafton Street"],
  unknowns: { time: "Coverage varies by dataset and publisher." }
};