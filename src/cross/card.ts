import type { SourceCard } from "../gateway/cards.js";

export const crossCard: SourceCard = {
  topics: ["places", "geography", "population", "weather", "heritage", "environment"],
  geo_levels: ["point", "county", "local_authority", "constituency", "lea", "ed", "small_area", "town"],
  time: { start: "live", end: "live", series: false, note: "Combines current boundaries, Census population and live weather." },
  cadence: "live",
  dimensions: ["containing boundaries", "census population", "nearest weather station and forecast", "warnings", "monuments and protected sites nearby"],
  join_keys: ["lat_lon", "county_name", "local_authority_name", "constituency_name", "lea_name", "ed_code", "small_area_code", "town_name"],
  freshness: "Each section carries its own source, licence and retrieval time.",
  auth: { required: false },
  examples: ["What is at 53.39, -6.26: boundaries, forecast and protected sites?", "One-call snapshot of Athlone"],
  operations: {
    list_sources: {
      topics: ["civic"],
      geo_levels: ["national"],
      time: { start: "present", end: "present", series: false },
      cadence: "irregular",
      dimensions: ["source id", "licence", "attribution", "tool names"],
      join_keys: [],
      unknowns: { join_keys: "A source list has no data keys to join on." },
      examples: ["Which sources does this server have?"]
    }
  }
};
