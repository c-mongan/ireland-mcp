import type { SourceCard } from "../../gateway/cards.js";

export const ecbCard: SourceCard = {
  topics: ["finance", "prices", "economy"],
  geo_levels: ["national"],
  time: { start: "1999", end: "present", series: true, note: "Euro series from 1999; some series start later. Use lastNObservations." },
  cadence: "daily",
  dimensions: ["series key", "period", "value", "unit"],
  join_keys: ["date"],
  freshness: "ECB Data Portal; policy rates change on decision dates and FX reference rates are published each working day.",
  auth: { required: false },
  examples: ["Current ECB deposit facility rate", "Euro to sterling reference rate today", "Irish household deposit interest rate (MIR series)"]
};