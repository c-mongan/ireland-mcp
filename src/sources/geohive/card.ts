import type { SourceCard } from "../../gateway/cards.js";

export const geohiveCard: SourceCard = {
  topics: ["geography", "places"],
  geo_levels: ["point", "county", "local_authority", "constituency", "lea", "ed", "small_area", "town"],
  time: { start: "unknown", end: "present", series: false, note: "Current statutory boundaries; boundary vintages vary by layer." },
  cadence: "irregular",
  dimensions: ["county (with province)", "local authority", "Dáil constituency", "local electoral area", "CSO electoral division (code)", "small area", "settlement", "gazetteer place coordinates"],
  join_keys: ["lat_lon", "county_name", "local_authority_name", "constituency_name", "lea_name", "ed_code", "ed_name", "small_area_code", "town_name"],
  freshness: "Tailte Éireann ArcGIS services; boundaries change after statutory reviews. Cached for a day.",
  auth: { required: false },
  examples: ["Which constituency and LEA is a point in Tallaght in?", "List the counties in Munster", "Coordinates of Dingle"],
  unknowns: { time: "Layer vintages (for example 2019 LEAs or Census 2022 small areas) differ by service and are not tracked here." },
  operations: {
    geohive_locate: { geo_levels: ["point", "town"], dimensions: ["place name (English, Irish)", "coordinates", "place type"], join_keys: ["lat_lon", "town_name"], examples: ["Where is Clonakilty?"] },
    geohive_list_layers: { dimensions: ["service name", "layer ids"], join_keys: ["dataset_id"], examples: ["Which GeoHive services have electoral boundaries?"] },
    geohive_query_layer: { examples: ["Which counties are in Connacht?"] }
  }
};