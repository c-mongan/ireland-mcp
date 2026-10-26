import type { SourceCard } from "../../gateway/cards.js";

export const epaCard: SourceCard = {
  topics: ["water", "environment"],
  geo_levels: ["point", "county"],
  time: { start: "unknown", end: "present", series: true, note: "WFD status by monitoring cycle; bathing-water samples and annual classifications by season." },
  cadence: "irregular",
  dimensions: ["waterbody code, name and type", "catchment", "WFD risk and ecological/chemical status by cycle", "bathing location and county", "annual classification", "sample date and results", "restrictions"],
  join_keys: ["waterbody_code", "county_name", "lat_lon", "date"],
  freshness: "EPA open APIs; sample and incident pages carry their own dates. Annual bathing classifications are not current swimming advice. Cached for a day.",
  auth: { required: false },
  examples: ["Bathing-water classification at Salthill", "Ecological status of the River Suir waterbodies", "Are there bathing restrictions in force?"],
  unknowns: { time: "Earliest WFD cycle and sample dates exposed by the API have not been verified." },
  operations: {
    epa_wfd_search: { geo_levels: ["national"], join_keys: ["waterbody_code"], examples: ["Waterbodies in the Blackwater catchment"] },
    epa_wfd_waterbody: { geo_levels: ["national"], join_keys: ["waterbody_code"], examples: ["Risk status of waterbody IE_SE_16B020080"] },
    epa_bathing_alerts: { geo_levels: ["point"], cadence: "daily", examples: ["Current bathing restrictions"] }
  }
};