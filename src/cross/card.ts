import type { SourceCard } from "../gateway/cards.js";

export const crossCard: SourceCard = {
  topics: ["places", "geography", "population", "weather", "heritage", "environment"],
  geo_levels: ["point", "county", "local_authority", "constituency", "lea", "ed", "small_area", "town"],
  time: { start: "live", end: "live", series: false, note: "Combines current boundaries, Census population and live weather." },
  cadence: "live",
  dimensions: ["containing boundaries", "census population", "nearest weather station and forecast", "warnings", "monuments and protected sites nearby"],
  join_keys: ["lat_lon", "county_name", "local_authority_name", "constituency_name", "lea_name", "ed_code", "small_area_code", "town_name", "nuts_code"],
  freshness: "Each section carries its own source, licence and retrieval time.",
  auth: { required: false },
  examples: ["What is at 53.39, -6.26: boundaries, forecast and protected sites?", "One-call snapshot of Athlone"],
  operations: {
    ireland_resolve_place: {
      topics: ["places", "geography", "population", "politics"],
      geo_levels: ["nuts2", "nuts3", "county", "local_authority", "constituency", "lea", "ed", "small_area", "town", "point"],
      time: { start: "2022", end: "2022", series: false, note: "Census 2022 EDs and small areas; LEAs of the 2019 and 2024 local elections; Dáil constituencies of the 2023 Act." },
      cadence: "snapshot",
      dimensions: ["county", "province", "local authority", "LEA (seats)", "Dáil constituency (seats)", "NUTS3 and NUTS2", "electoral division", "small area", "Census 2022 population share"],
      join_keys: ["county_name", "local_authority_name", "lea_name", "constituency_name", "nuts_code", "ed_code", "ed_name", "small_area_code", "town_name", "lat_lon"],
      examples: ["List the electoral divisions of Galway City Council with their constituency", "Which counties are in NUTS3 region IE042?", "Which constituency is the Donaghmede LEA mainly in?"]
    },
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
