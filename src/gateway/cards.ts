/**
 * Dataset cards: what each source and operation covers, so an agent can plan a multi-step query
 * (which datasets have X at county level for 2018–2024, and how do they join) before fetching data.
 * Cards are static, hand-written metadata. They describe the source; they do not prove liveness.
 */

/**
 * Geography levels, coarsest first. The place crosswalk (ireland_resolve_place) uses the same spellings
 * for county, local_authority, lea, ed, small_area, constituency and nuts3.
 */
export const GEO_LEVELS = [
  "national",
  "nuts2",
  "nuts3",
  "county",
  "local_authority",
  "constituency",
  "lea",
  "ed",
  "small_area",
  "town",
  "point"
] as const;
export type GeoLevel = (typeof GEO_LEVELS)[number];

export const TOPICS = [
  "population",
  "census",
  "housing",
  "property",
  "planning",
  "prices",
  "labour",
  "welfare",
  "income",
  "economy",
  "finance",
  "public-finance",
  "business",
  "procurement",
  "eu-funding",
  "education",
  "health",
  "deprivation",
  "migration",
  "politics",
  "law",
  "lobbying",
  "transport",
  "weather",
  "water",
  "environment",
  "energy",
  "geography",
  "places",
  "heritage",
  "tourism",
  "civic",
  "international"
] as const;
export type Topic = (typeof TOPICS)[number];

/** Identifiers a result exposes that can be matched against another source's results. */
export const JOIN_KEYS = [
  "county_name",
  "local_authority_name",
  "lea_name",
  "ed_code",
  "ed_name",
  "small_area_code",
  "constituency_name",
  "nuts_code",
  "town_name",
  "lat_lon",
  "eircode_routing_key",
  "cso_table_code",
  "member_code",
  "party_name",
  "bill_ref",
  "eli",
  "act_year_number",
  "si_year_number",
  "company_name",
  "company_number",
  "nace_code",
  "cpv_code",
  "atco_code",
  "gtfs_route_id",
  "gtfs_stop_id",
  "rail_station_code",
  "luas_stop_code",
  "met_station_name",
  "water_station_id",
  "waterbody_code",
  "wikidata_qid",
  "logainm_id",
  "iso3_country",
  "eurostat_geo",
  "school_roll_number",
  "planning_ref",
  "notice_id",
  "dataset_id",
  "year",
  "date"
] as const;
export type JoinKey = (typeof JOIN_KEYS)[number];

export const CADENCES = ["live", "hourly", "daily", "weekly", "monthly", "quarterly", "annual", "irregular", "snapshot", "unknown"] as const;
export type Cadence = (typeof CADENCES)[number];

/** "unknown" marks a value nobody has verified; the card's `unknowns` must then give the reason. */
export const UNKNOWN = "unknown";

export interface TimeCoverage {
  /** Earliest period available: "YYYY", "YYYY-MM", "YYYY-MM-DD", "live" or "unknown". */
  start: string;
  /** Latest period: a date, "present" (keeps growing), "live" (current readings only) or "unknown". */
  end: string;
  /** True when one source can return the same measure for several periods (a time series). */
  series: boolean;
  note?: string;
}

export type CardAuth =
  | { required: false }
  | { required: true; env: string; error: "NOT_CONFIGURED"; note: string };

export interface DatasetCard {
  topics: Topic[];
  geo_levels: GeoLevel[];
  time: TimeCoverage;
  cadence: Cadence;
  /** Key dimensions and measures, in plain words. */
  dimensions: string[];
  join_keys: JoinKey[];
  /** How current the data is, and what date the result carries (as_of, retrieved_at, snapshot date). */
  freshness: string;
  auth: CardAuth;
  /** Questions this source helps answer. At least two. */
  examples: string[];
  /** Field name → why it is unknown. Required for every field set to "unknown". */
  unknowns?: Partial<Record<CardField, string>>;
}

export type CardField = "topics" | "geo_levels" | "time" | "cadence" | "dimensions" | "join_keys" | "freshness" | "auth";

/** A module's card: the source-wide card plus per-operation overrides where an operation differs. */
export interface SourceCard extends DatasetCard {
  operations?: Record<string, Partial<DatasetCard>>;
}

/** Card for one operation: the source card with that operation's overrides applied. */
export function operationCard(card: SourceCard, operation: string): DatasetCard {
  const { operations, ...base } = card;
  const override = operations?.[operation];
  if (!override) return base;
  return { ...base, ...override, unknowns: { ...base.unknowns, ...override.unknowns } };
}

export function timeLabel(time: TimeCoverage): string {
  if (time.start === "live" || time.end === "live") return time.start === "live" ? "live" : `${time.start}–now (live)`;
  if (time.start === time.end) return time.start;
  return `${time.start}–${time.end}`;
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const GEO_ALIASES: Record<string, GeoLevel> = {
  state: "national",
  ireland: "national",
  country: "national",
  "nuts 2": "nuts2",
  region: "nuts3",
  regions: "nuts3",
  "nuts 3": "nuts3",
  "nuts iii": "nuts3",
  counties: "county",
  la: "local_authority",
  "local authority": "local_authority",
  "local authorities": "local_authority",
  council: "local_authority",
  councils: "local_authority",
  "administrative county": "local_authority",
  "administrative counties": "local_authority",
  "dail constituency": "constituency",
  constituencies: "constituency",
  leas: "lea",
  "local electoral area": "lea",
  "local electoral areas": "lea",
  "electoral division": "ed",
  "electoral divisions": "ed",
  eds: "ed",
  ded: "ed",
  "district electoral division": "ed",
  sa: "small_area",
  "small area": "small_area",
  "small areas": "small_area",
  towns: "town",
  settlement: "town",
  settlements: "town",
  coordinates: "point",
  "lat lon": "point",
  latlon: "point"
};

const JOIN_ALIASES: Record<string, JoinKey> = {
  county: "county_name",
  "local authority": "local_authority_name",
  council: "local_authority_name",
  la: "local_authority_name",
  lea: "lea_name",
  ed: "ed_code",
  "electoral division": "ed_code",
  "small area": "small_area_code",
  sa: "small_area_code",
  constituency: "constituency_name",
  nuts: "nuts_code",
  nuts3: "nuts_code",
  town: "town_name",
  point: "lat_lon",
  coordinates: "lat_lon",
  latlon: "lat_lon",
  "lat lon": "lat_lon",
  eircode: "eircode_routing_key",
  "routing key": "eircode_routing_key",
  table: "cso_table_code",
  "cso table": "cso_table_code",
  member: "member_code",
  td: "member_code",
  party: "party_name",
  bill: "bill_ref",
  act: "act_year_number",
  si: "si_year_number",
  "statutory instrument": "si_year_number",
  company: "company_name",
  nace: "nace_code",
  cpv: "cpv_code",
  atco: "atco_code",
  stop: "gtfs_stop_id",
  route: "gtfs_route_id",
  station: "rail_station_code",
  qid: "wikidata_qid",
  wikidata: "wikidata_qid",
  country: "iso3_country",
  iso3: "iso3_country",
  "roll number": "school_roll_number",
  "planning reference": "planning_ref"
};

/** Related topics a topic filter also accepts, so "housing" finds property and planning sources. */
const TOPIC_FAMILY: Partial<Record<Topic, Topic[]>> = {
  housing: ["property", "planning"],
  property: ["housing"],
  census: ["population"],
  population: ["census"],
  labour: ["welfare", "income"],
  welfare: ["labour"],
  law: ["politics", "lobbying"],
  politics: ["law", "lobbying"],
  water: ["environment"],
  places: ["geography"],
  geography: ["places"],
  finance: ["economy"],
  economy: ["finance", "prices"]
};

const TOPIC_ALIASES: Record<string, Topic> = {
  people: "population",
  demographics: "population",
  rent: "housing",
  rents: "housing",
  homes: "housing",
  "house prices": "property",
  employment: "labour",
  unemployment: "labour",
  jobs: "labour",
  "social welfare": "welfare",
  budget: "public-finance",
  budgets: "public-finance",
  tenders: "procurement",
  companies: "business",
  schools: "education",
  legislation: "law",
  parliament: "politics",
  oireachtas: "politics",
  climate: "weather",
  rivers: "water",
  grid: "energy",
  electricity: "energy",
  boundaries: "geography",
  placenames: "places",
  monuments: "heritage",
  "eu funds": "eu-funding",
  inflation: "prices"
};

function resolve<T extends string>(value: string, valid: readonly T[], aliases: Record<string, T>): T | undefined {
  const folded = fold(value);
  const underscored = folded.replace(/ /g, "_");
  const hyphenated = folded.replace(/ /g, "-");
  return (
    valid.find((v) => v === underscored || v === hyphenated || v === folded.replace(/ /g, "")) ??
    aliases[folded] ??
    (folded.endsWith("s") ? aliases[folded.slice(0, -1)] ?? valid.find((v) => v === underscored.slice(0, -1)) : undefined)
  );
}

export const normaliseGeoLevel = (value: string) => resolve(value, GEO_LEVELS, GEO_ALIASES);
export const normaliseTopic = (value: string) => resolve(value, TOPICS, TOPIC_ALIASES);
export const normaliseJoinKey = (value: string) => resolve(value, JOIN_KEYS, JOIN_ALIASES);

export function topicFamily(topic: Topic): Topic[] {
  return [topic, ...(TOPIC_FAMILY[topic] ?? [])];
}

export interface CardFilter {
  topic?: Topic;
  geo_level?: GeoLevel;
  has_time_series?: boolean;
  join_key?: JoinKey;
  /** Folded words that must all start a word in the card's text. */
  words?: string[];
}

export function hasFilter(filter: CardFilter): boolean {
  return Boolean(filter.topic || filter.geo_level || filter.join_key || filter.has_time_series !== undefined || filter.words?.length);
}

/** Words in a card worth matching free text against. */
export function cardText(card: DatasetCard): string {
  return fold([card.topics.join(" "), card.geo_levels.join(" "), card.dimensions.join(" "), card.join_keys.join(" "), card.examples.join(" ")].join(" "));
}

export function textWords(text: string): string[] {
  return fold(text)
    .split(" ")
    .filter((w) => w.length > 1);
}

/** True when the card matches every set filter. `extraText` is other text to search (names, summary, tool titles). */
export function cardMatches(card: DatasetCard, filter: CardFilter, extraText = ""): boolean {
  if (filter.topic) {
    const family = topicFamily(filter.topic);
    if (!card.topics.some((t) => family.includes(t))) return false;
  }
  if (filter.geo_level && !card.geo_levels.includes(filter.geo_level)) return false;
  if (filter.join_key && !card.join_keys.includes(filter.join_key)) return false;
  if (filter.has_time_series !== undefined && card.time.series !== filter.has_time_series) return false;
  if (filter.words?.length) {
    const haystack = ` ${cardText(card)} ${fold(extraText)} `;
    // Word-prefix match: "rent" finds "rents" and "rental" but not "current".
    if (!filter.words.every((w) => haystack.includes(` ${w}`))) return false;
  }
  return true;
}

/** The compact card shown in ireland_catalogue results. */
export function compactCard(card: DatasetCard) {
  return {
    topics: card.topics,
    geo_levels: card.geo_levels,
    time: timeLabel(card.time),
    series: card.time.series,
    cadence: card.cadence,
    join_keys: card.join_keys,
    ...(card.auth.required ? { needs_key: card.auth.env } : {})
  };
}

/** Problems with a card (empty when complete). Used by the card test and by nothing at runtime. */
export function cardProblems(card: SourceCard, operations: readonly string[]): string[] {
  const problems: string[] = [];
  const check = (c: Partial<DatasetCard>, where: string, full: boolean) => {
    const need = <K extends keyof DatasetCard>(key: K) => full && c[key] === undefined && problems.push(`${where}: missing ${key}`);
    (["topics", "geo_levels", "time", "cadence", "dimensions", "join_keys", "freshness", "auth", "examples"] as const).forEach(need);
    if (c.topics && (c.topics.length === 0 || c.topics.some((t) => !TOPICS.includes(t)))) problems.push(`${where}: bad topics`);
    if (c.geo_levels && (c.geo_levels.length === 0 || c.geo_levels.some((g) => !GEO_LEVELS.includes(g)))) problems.push(`${where}: bad geo_levels`);
    if (c.join_keys && c.join_keys.some((k) => !JOIN_KEYS.includes(k))) problems.push(`${where}: bad join_keys`);
    if (c.join_keys && c.join_keys.length === 0 && !c.unknowns?.join_keys) problems.push(`${where}: no join_keys and no reason`);
    if (c.cadence && !CADENCES.includes(c.cadence)) problems.push(`${where}: bad cadence`);
    if (c.dimensions && c.dimensions.length === 0) problems.push(`${where}: no dimensions`);
    if (c.examples && c.examples.length < (full ? 2 : 1)) problems.push(`${where}: needs examples`);
    if (c.freshness !== undefined && c.freshness.trim().length < 10) problems.push(`${where}: freshness too short`);
    if (c.time) {
      for (const field of ["start", "end"] as const) {
        const v = c.time[field];
        if (!/^(\d{4}(-\d{2}(-\d{2})?)?|live|present|unknown)$/.test(v)) problems.push(`${where}: bad time.${field} "${v}"`);
      }
      if ((c.time.start === UNKNOWN || c.time.end === UNKNOWN) && !c.unknowns?.time && !card.unknowns?.time) problems.push(`${where}: time unknown without reason`);
    }
    if (c.cadence === UNKNOWN && !c.unknowns?.cadence && !card.unknowns?.cadence) problems.push(`${where}: cadence unknown without reason`);
    if (c.auth?.required && (!c.auth.env || !c.auth.note)) problems.push(`${where}: auth needs env and note`);
  };
  check(card, "source", true);
  for (const [name, override] of Object.entries(card.operations ?? {})) {
    if (!operations.includes(name)) problems.push(`operations.${name}: no such operation`);
    check(override, `operations.${name}`, false);
  }
  return problems;
}
