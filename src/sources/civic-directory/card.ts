import type { SourceCard } from "../../gateway/cards.js";

export const civicDirectoryCard: SourceCard = {
  topics: ["civic"],
  geo_levels: ["national"],
  time: { start: "present", end: "present", series: false, note: "One pinned directory commit." },
  cadence: "snapshot",
  dimensions: ["project name", "category", "owner", "listed status", "project link", "CitizenData.ie listing"],
  join_keys: ["dataset_id"],
  freshness: "Pinned commit of the Éire Civic Tech Directory; as_of is returned with each result. Status and links are as listed, unverified.",
  auth: { required: false },
  examples: ["Civic-tech projects about housing", "Which listed projects track the Oireachtas?"]
};