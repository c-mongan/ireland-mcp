import type { SourceCard } from "../../gateway/cards.js";

export const euLawCard: SourceCard = {
  topics: ["law", "international"],
  geo_levels: ["national"],
  time: { start: "unknown", end: "present", series: false, note: "One EU act at a time, by CELEX number or ELI." },
  cadence: "daily",
  dimensions: ["CELEX number", "title", "resource type", "document date", "entry into force and end of validity", "in-force flag", "ELI"],
  join_keys: ["eli", "date"],
  freshness: "Publications Office Cellar metadata, cached for seven days; check the in-force flag and dates in each result.",
  auth: { required: false },
  examples: ["Is the GDPR (CELEX 32016R0679) in force and since when?", "Title and ELI of the EU act an Irish SI transposes"],
  unknowns: { time: "The earliest act indexed in Cellar has not been verified." }
};
