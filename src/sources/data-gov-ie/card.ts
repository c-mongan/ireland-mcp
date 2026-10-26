import type { SourceCard } from "../../gateway/cards.js";

export const dataGovIeCard: SourceCard = {
  topics: ["civic", "environment", "transport", "housing", "economy", "health", "education", "public-finance"],
  geo_levels: ["national", "county", "local_authority", "point"],
  time: { start: "unknown", end: "present", series: true, note: "Per dataset; read each dataset's resources and dates." },
  cadence: "irregular",
  dimensions: ["dataset", "publisher organisation", "resource (format, datastore flag)", "datastore columns"],
  join_keys: ["dataset_id", "county_name", "local_authority_name"],
  freshness: "CKAN metadata as published; each dataset has its own modified date.",
  auth: { required: false },
  examples: ["Which public bodies publish bathing water or air quality data?", "Read the rows of a datastore resource"],
  unknowns: { time: "Coverage varies by dataset and publisher." }
};