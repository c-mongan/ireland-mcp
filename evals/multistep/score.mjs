// Deterministic scoring for multi-step answers. Agents end with a fenced ANSWER_JSON block whose keys
// the item declares; that block is scored strictly. A free-text fallback is reported separately as
// "lenient" so formatting misses are visible without inflating the headline score.
import { norm } from "./lib.mjs";

const ANSWER_BLOCK = /```(?:\s*ANSWER_JSON|json\s+ANSWER_JSON|answer_json)\s*\n([\s\S]*?)```/i;
const ANSWER_INLINE = /ANSWER_JSON\s*[:=]?\s*(\{[\s\S]*\})\s*$/i;

/** Extracts the final ANSWER_JSON object, or null. */
export function parseAnswerJson(text) {
  const s = String(text ?? "");
  const m = ANSWER_BLOCK.exec(s) ?? ANSWER_INLINE.exec(s);
  if (!m) return null;
  try {
    const v = JSON.parse(m[1].trim());
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const SCALE = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, bn: 1e9, b: 1e9, billion: 1e9 };

/** Parses "€1.2m", "2,345", "4.3%", "-21.58" and plain numbers. Returns NaN when nothing numeric. */
export function parseNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return NaN;
  const m = /(-|−)?\s*[€£$]?\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(k|thousand|mn|m|million|bn|b|billion)?\b/i.exec(value.replace(/\u00a0/g, " "));
  if (!m) return NaN;
  const n = Number(m[2].replace(/,/g, "")) * (m[3] ? SCALE[m[3].toLowerCase()] : 1);
  return m[1] ? -n : n;
}

/** All numbers in free text (for the lenient fallback). */
export function numbersIn(text) {
  const out = [];
  const re = /(-|−)?[€£$]?\s?(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|mn|million|bn|billion)?(?![\d])/gi;
  for (const m of String(text ?? "").matchAll(re)) {
    const n = Number(m[2].replace(/,/g, "")) * (m[3] ? SCALE[m[3].toLowerCase()] : 1);
    if (Number.isFinite(n)) out.push(m[1] ? -n : n);
  }
  return out;
}

function withinTolerance(spec, expected, got) {
  if (!Number.isFinite(got)) return false;
  const tol = Math.max(spec.tol_abs ?? 0, (spec.tol_rel ?? (spec.tol_abs === undefined ? 0.01 : 0)) * Math.abs(expected));
  return Math.abs(got - expected) <= tol + 1e-9;
}

const textMatch = (expected, got) => {
  const e = norm(expected);
  const g = norm(got);
  return e.length > 0 && g.length > 0 && (g === e || g.includes(e) || (g.length >= 4 && e.includes(g)));
};

function asList(got) {
  if (Array.isArray(got)) return got.map((x) => (typeof x === "object" && x ? Object.values(x).join(" ") : String(x)));
  if (typeof got === "string") return got.split(/[;,\n]|\band\b/).map((x) => x.trim()).filter(Boolean);
  return [];
}

/**
 * Checks one key. `expected` may be a single value, or `{ any: [v1, v2] }` for live items scored
 * against references recomputed just before and after the agent run.
 */
export function checkKey(spec, expected, got) {
  if (expected && typeof expected === "object" && !Array.isArray(expected) && Array.isArray(expected.any)) {
    return expected.any.some((e) => checkKey(spec, e, got));
  }
  if (got === undefined || got === null) return false;
  switch (spec.type) {
    case "number":
      return withinTolerance(spec, expected, parseNumber(got));
    case "bool": {
      const g = typeof got === "boolean" ? got : /^(true|yes|y)$/i.test(String(got).trim()) ? true : /^(false|no|n)$/i.test(String(got).trim()) ? false : null;
      return g === expected;
    }
    case "list":
    case "ordered_list": {
      const g = asList(got);
      const idx = expected.map((e) => g.findIndex((x) => textMatch(e, x)));
      if (idx.some((i) => i < 0)) return false;
      if (spec.exact && g.length !== expected.length) return false;
      if (spec.type === "ordered_list") {
        if (g.length !== expected.length && spec.exact !== false) return false;
        for (let i = 1; i < idx.length; i++) if (idx[i] <= idx[i - 1]) return false;
      }
      return true;
    }
    default:
      return textMatch(expected, typeof got === "object" ? JSON.stringify(got) : String(got));
  }
}

/** Lenient check of one key against the answer's free text. */
export function checkKeyInText(spec, expected, text) {
  if (expected && typeof expected === "object" && !Array.isArray(expected) && Array.isArray(expected.any)) {
    return expected.any.some((e) => checkKeyInText(spec, e, text));
  }
  const t = norm(text);
  switch (spec.type) {
    case "number":
      return numbersIn(text).some((n) => withinTolerance(spec, expected, n) || (spec.percent && withinTolerance(spec, expected, n * 100)));
    case "bool":
      return false;
    case "list":
    case "ordered_list":
      return expected.every((e) => t.includes(norm(e)));
    default:
      return t.includes(norm(expected));
  }
}

/** Scores an answer text against an item's answer spec and reference `expected` values. */
export function scoreAnswer(item, expected, text) {
  const json = parseAnswerJson(text);
  const keys = Object.keys(item.answer);
  const perKey = {};
  let strict = 0;
  let lenient = 0;
  for (const key of keys) {
    const spec = item.answer[key];
    const exp = expected[key];
    const s = json ? checkKey(spec, exp, json[key]) : false;
    const l = s || checkKeyInText(spec, exp, text);
    perKey[key] = { strict: s, lenient: l };
    if (s) strict++;
    if (l) lenient++;
  }
  return {
    has_answer_json: Boolean(json),
    strict_pass: strict === keys.length,
    lenient_pass: lenient === keys.length,
    key_fraction: keys.length ? strict / keys.length : 0,
    per_key: perKey
  };
}

const NOT_AVAILABLE = /\b(not (?:available|exposed|provided|possible)|no (?:tool|operation|dataset|data source)|cannot (?:find|answer|determine|compute|join)|unable to|does not (?:provide|expose|include)|isn'?t available|no way to)\b/i;

/**
 * Attributes a failure to a capability gap only from transcript symptoms, never from the item's
 * declared tags alone (otherwise gap tags would be self-fulfilling).
 */
export function failureSymptoms({ calls, answer, hitRoundCap }) {
  const tags = new Set();
  if (calls.some((c) => c.truncated)) tags.add("server-query:truncated-payload");
  const discovery = calls.filter((c) => /^(cso_search_tables|ireland_catalogue|search|eurostat_search_datasets|datagov_search_datasets|geohive_list_layers)$/.test(c.operation ?? c.name)).length;
  if (discovery >= 3) tags.add("dataset-card:discovery-churn");
  if (calls.filter((c) => c.isError && /BAD_ARGS/.test(c.text ?? "")).length >= 2) tags.add("dataset-card:argument-errors");
  if (NOT_AVAILABLE.test(answer ?? "")) tags.add("declared-unavailable");
  if (hitRoundCap) tags.add("harness:round-cap");
  return [...tags];
}
