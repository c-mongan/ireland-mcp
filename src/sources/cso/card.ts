import type { SourceCard } from "../../gateway/cards.js";

export const csoCard: SourceCard = {
  topics: ["population", "census", "housing", "prices", "labour", "welfare", "income", "economy", "migration", "education", "health", "transport", "deprivation"],
  geo_levels: ["national", "nuts2", "nuts3", "county", "local_authority", "constituency", "lea", "ed", "small_area", "town"],
  time: { start: "1841", end: "present", series: true, note: "Varies by table: census tables from 1841 (F1001), most releases from the 1990s or later. Read each table's time dimension." },
  cadence: "irregular",
  dimensions: ["statistic", "time period (year, quarter, month or census year)", "geography (varies by table)", "sex", "age group", "table-specific categories"],
  join_keys: ["cso_table_code", "county_name", "local_authority_name", "lea_name", "ed_code", "small_area_code", "constituency_name", "nuts_code", "town_name", "year"],
  freshness: "Each table has its own release date (`released` in search, `updated` in metadata). Results carry retrieved_at; cached for a day.",
  auth: { required: false },
  examples: [
    "Which CSO table gives new dwelling completions by local electoral area?",
    "Population of each local authority in Census 2022 (table FY003A)",
    "Residential Property Price Index for Dublin, December 2019 vs December 2024 (HPM09)",
    "ILO unemployment rate by administrative county in Census 2022 (CPNI37)"
  ],
  operations: {
    cso_search_tables: {
      dimensions: ["table code", "title", "subject", "release date", "dimension names", "geo_levels inferred from dimension names"],
      examples: ["cso_search_tables(query='completions', geo_level='lea')", "cso_search_tables(query='population council')"]
    },
    cso_get_table_metadata: { dimensions: ["dimension codes and labels", "category codes and labels", "last update", "cell count"], examples: ["Which category code is Cork City Council in FY003A?"] },
    cso_area_profile: {
      topics: ["population", "census"],
      geo_levels: ["national", "county", "town"],
      time: { start: "1841", end: "2022", series: true, note: "Counties: census years in F1001 (defaults to the latest two). Towns: Census 2022 only (F1015)." },
      cadence: "irregular",
      dimensions: ["census year", "population total, male, female", "change between censuses", "town age profile"],
      join_keys: ["county_name", "town_name", "cso_table_code", "year"],
      examples: ["Population of Galway in 2016 and 2022 and the change", "Census 2022 population and average age of Ennis"]
    }
  }
};