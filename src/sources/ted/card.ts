import type { SourceCard } from "../../gateway/cards.js";

export const tedCard: SourceCard = {
  topics: ["procurement", "public-finance", "business"],
  geo_levels: ["national"],
  time: { start: "unknown", end: "present", series: true, note: "Published TED notices with Irish buyers." },
  cadence: "daily",
  dimensions: ["notice publication number", "buyer", "title", "CPV codes", "notice type", "estimated or awarded value", "deadline", "publication date"],
  join_keys: ["notice_id", "cpv_code", "company_name", "date"],
  freshness: "TED search API; notices appear on publication (TED publishes each working day).",
  auth: { required: false },
  examples: ["Tenders published by the HSE this month", "Construction tenders (CPV 45) from Irish councils in 2025"],
  unknowns: { time: "The earliest notice reachable through the keyless search endpoint has not been verified." }
};