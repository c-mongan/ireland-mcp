import type { GeoLevel } from "../../gateway/cards.js";
import type { CsoSearchResult } from "./client.js";

/**
 * Geography-aware ranking for CSO table search. PxStat search matches words in titles and dimension names
 * and caps results at 100, so "population council" ranked the local-authority population tables F1004A and FY003A
 * 49th and 53rd, and "Ukraine LEA" missed UA05 entirely (evidence in docs/dataset-cards.md). When the query or
 * the caller names a geography level, we search the topic words and the topic words plus the CSO name for
 * that level, then put tables broken down by that level first.
 */

/** CSO dimension names → geography level. The first matching rule wins, so specific names come first. */
const DIMENSION_RULES: Array<[RegExp, GeoLevel]> = [
  [/small areas?/i, "small_area"],
  [/local electoral areas?/i, "lea"],
  [/electoral divisions?|\bDEDs?\b|\bEDs?\b/i, "ed"],
  [/constituenc/i, "constituency"],
  [/nuts ?3|nuts iii/i, "nuts3"],
  [/nuts ?2|nuts ii/i, "nuts2"],
  [/administrative count|local authorit|local government district|\bcouncils?\b/i, "local_authority"],
  [/\bcount(y|ies)\b/i, "county"],
  [/\btowns?\b|settlements?|built.?up area|urban area/i, "town"]
];

/** Dimension names can list several levels ("County, Rural/Urban District, District Electoral Division and Town"). */
export function dimensionLevels(name: string): GeoLevel[] {
  const out: GeoLevel[] = [];
  let rest = name;
  for (const [pattern, level] of DIMENSION_RULES) {
    if (pattern.test(rest)) {
      out.push(level);
      rest = rest.replace(new RegExp(pattern.source, "gi"), " ");
    }
  }
  return out;
}

export function tableLevels(table: Pick<CsoSearchResult, "classification">): GeoLevel[] {
  const levels = new Set<GeoLevel>();
  for (const c of table.classification ?? []) for (const level of dimensionLevels(c.ClsValue)) levels.add(level);
  return [...levels];
}

/** Query words → geography level, checked in order. Matching is on whole words. */
const INTENT_RULES: Array<[RegExp, GeoLevel]> = [
  [/\blocal electoral areas?\b|\bleas?\b/gi, "lea"],
  [/\bsmall areas?\b/gi, "small_area"],
  [/\b(district )?electoral divisions?\b|\bdeds?\b|\beds?\b/gi, "ed"],
  [/\b(dail )?constituenc(y|ies)\b/gi, "constituency"],
  [/\bnuts ?3\b/gi, "nuts3"],
  [/\bnuts ?2\b/gi, "nuts2"],
  [/\blocal authorit(y|ies)\b|\bcouncils?\b|\badministrative count(y|ies)\b/gi, "local_authority"],
  [/\bcount(y|ies)\b/gi, "county"],
  [/\btowns?\b|\bsettlements?\b/gi, "town"]
];

/** The CSO dimension wording for each level, added to the topic words for a second, targeted search. */
export const LEVEL_VOCABULARY: Record<GeoLevel, string | undefined> = {
  national: undefined,
  nuts2: "NUTS 2 Region",
  nuts3: "NUTS 3 Region",
  county: "County",
  local_authority: "Administrative Counties",
  constituency: "Constituencies",
  lea: "Local Electoral Area",
  ed: "Electoral Divisions",
  small_area: "Small Areas",
  town: "Towns",
  point: undefined
};

/** Levels that are a reasonable second choice: local authorities aggregate to counties and vice versa. */
const RELATED: Partial<Record<GeoLevel, GeoLevel[]>> = { county: ["local_authority"], local_authority: ["county"] };

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const FILLER = /\b(by|per|at|in|for|of|the|level|breakdown|each|every|all)\b/gi;

export interface GeoIntent {
  level: GeoLevel | undefined;
  /** The query with geography words removed; the original query when nothing useful is left. */
  core: string;
}

/** Finds the geography level a query asks for. An explicit level wins over words in the query. */
export function geoIntent(query: string, explicit?: GeoLevel): GeoIntent {
  let text = fold(query);
  let level = explicit;
  for (const [pattern, candidate] of INTENT_RULES) {
    if (pattern.test(text)) {
      level ??= candidate;
      text = text.replace(pattern, " ");
    }
    pattern.lastIndex = 0;
  }
  if (!level) return { level: undefined, core: query };
  const core = text.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  return { level, core: core.replace(/[^a-z0-9]/g, "").length >= 2 ? core : query };
}

const STOP = new Set(["by", "per", "at", "in", "for", "of", "the", "and", "a", "an", "to", "from", "on", "with"]);
const tokens = (text: string) =>
  fold(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));

/**
 * Ranks the merged search results for a level: tables broken down by that level first, then related levels,
 * then the rest. Within a group: titles that contain more of the topic words, then titles with fewer extra
 * words, then tables with fewer dimensions (headline tables), then the upstream order.
 */
export function rankByLevel(results: readonly CsoSearchResult[], level: GeoLevel, core: string): CsoSearchResult[] {
  const wanted = new Set(tokens(core));
  const related = RELATED[level] ?? [];
  const scored = results.map((table, position) => {
    const levels = tableLevels(table);
    const exact = level === "national" ? levels.length === 0 : levels.includes(level);
    const group = exact ? 2 : levels.some((l) => related.includes(l)) ? 1 : 0;
    const title = new Set(tokens(table.MtrTitle));
    const hits = [...wanted].filter((t) => title.has(t)).length;
    return {
      table,
      group,
      recall: wanted.size ? hits / wanted.size : 0,
      precision: title.size ? hits / title.size : 0,
      dims: table.classification?.length ?? 0,
      position
    };
  });
  scored.sort(
    (a, b) => b.group - a.group || b.recall - a.recall || b.precision - a.precision || a.dims - b.dims || a.position - b.position
  );
  return scored.map((s) => s.table);
}

/** Interleaves result lists, keeping each table's first appearance. */
export function mergeResults(lists: ReadonlyArray<readonly CsoSearchResult[]>): CsoSearchResult[] {
  const seen = new Set<string>();
  const out: CsoSearchResult[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      const table = list[i];
      if (table && !seen.has(table.MtrCode)) {
        seen.add(table.MtrCode);
        out.push(table);
      }
    }
  }
  return out;
}
