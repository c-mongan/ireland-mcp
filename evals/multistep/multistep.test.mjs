// Offline checks for the multi-step benchmark: item structure and the deterministic scorer.
// Run: node --test evals/multistep/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { items } from "./questions.mjs";
import { checkKey, failureSymptoms, parseAnswerJson, parseNumber, scoreAnswer } from "./score.mjs";
import { GAP_PILLARS, pillarOf, pillarProbes } from "./lib.mjs";

test("items are well formed", () => {
  assert.ok(items.length >= 30 && items.length <= 50, `30–50 items, got ${items.length}`);
  const ids = new Set();
  for (const i of items) {
    assert.ok(!ids.has(i.id), `duplicate id ${i.id}`);
    ids.add(i.id);
    assert.match(i.id, /^t[123]-[a-z0-9-]+$/);
    assert.ok(["T1", "T2", "T3"].includes(i.tier), i.id);
    assert.equal(i.id.slice(0, 2), i.tier.toLowerCase(), `${i.id} id prefix matches tier`);
    assert.ok(["stable", "slow", "live"].includes(i.drift), i.id);
    assert.ok(i.required_sources.length >= 2, `${i.id} needs at least two sources`);
    if (i.tier === "T3") assert.ok(i.required_sources.length >= 3 || Object.keys(i.answer).length >= 4, `${i.id}: T3 needs 3+ sources or a multi-part analysis`);
    assert.ok(Object.keys(i.answer).length >= 2, `${i.id} answer keys`);
    for (const s of Object.values(i.answer)) assert.ok(["number", "text", "date", "list", "ordered_list", "bool"].includes(s.type), i.id);
    for (const g of [...i.gaps, ...Object.values(i.blocked_keys ?? {})]) assert.ok(pillarOf(g) in GAP_PILLARS, `${i.id}: unknown pillar in ${g}`);
    assert.equal(typeof i.reference, "function");
    assert.ok(i.tool_path.length >= 2, i.id);
    assert.ok(!/ANSWER_JSON/.test(i.question), "questions never embed the answer format");
  }
  for (const tier of ["T1", "T2", "T3"]) assert.ok(items.filter((i) => i.tier === tier).length >= 8, `${tier} coverage`);
  assert.ok(items.filter((i) => i.control).length >= 4, "control items");
});

test("pinned references cover every answerable item with the declared keys", () => {
  const pinned = JSON.parse(readFileSync(new URL("references.json", import.meta.url), "utf8"));
  assert.match(pinned.as_of, /^\d{4}-\d{2}-\d{2}$/);
  for (const i of items) {
    const p = pinned.items[i.id];
    assert.ok(p, `${i.id} pinned`);
    if (p.gap) {
      assert.ok(pillarOf(p.gap) in GAP_PILLARS);
      continue;
    }
    assert.deepEqual(Object.keys(p.expected).sort(), Object.keys(i.answer).sort(), `${i.id} keys`);
    assert.ok(p.calls.length >= 2 && p.calls.every((c) => c.source && c.operation), `${i.id} calls recorded`);
  }
});

test("parseNumber handles currency, separators and scale words", () => {
  assert.equal(parseNumber("€1.2m"), 1_200_000);
  assert.equal(parseNumber("2,345"), 2345);
  assert.equal(parseNumber("4.3%"), 4.3);
  assert.equal(parseNumber("-21.58"), -21.58);
  assert.equal(parseNumber("€902 million"), 902_000_000);
  assert.ok(Number.isNaN(parseNumber("n/a")));
});

test("checkKey applies tolerances, lists, ordering and live alternatives", () => {
  assert.ok(checkKey({ type: "number", tol_abs: 0.05 }, 4.3, "4.32"));
  assert.ok(!checkKey({ type: "number", tol_abs: 0.05 }, 4.3, 4.4));
  assert.ok(checkKey({ type: "number" }, 1000, 1009), "default 1% tolerance");
  assert.ok(checkKey({ type: "text" }, "Dublin South-West", "Dublin South West"));
  assert.ok(!checkKey({ type: "text" }, "Dublin South-West", "Dublin"), "a partial name is not a match");
  assert.ok(checkKey({ type: "text" }, "Waterford City & County", "Waterford City and County Council"));
  assert.ok(checkKey({ type: "date" }, "2024-10-17", "17 October 2024"));
  assert.ok(!checkKey({ type: "date" }, "2024-10-17", "2024-10-18"));
  assert.ok(checkKey({ type: "list" }, ["Farrell", "Naughton"], ["Mairéad Farrell", "Hildegarde Naughton", "Noel Grealish"]));
  assert.ok(!checkKey({ type: "list", exact: true }, ["Farrell"], ["Mairéad Farrell", "Noel Grealish"]));
  assert.ok(checkKey({ type: "ordered_list", exact: true }, ["Galway", "Mayo"], ["Galway", "Mayo"]));
  assert.ok(!checkKey({ type: "ordered_list", exact: true }, ["Galway", "Mayo"], ["Mayo", "Galway"]));
  assert.ok(checkKey({ type: "bool" }, false, "no"));
  assert.ok(checkKey({ type: "number", tol_abs: 1 }, { any: [40, 76] }, 75.5));
  assert.ok(!checkKey({ type: "number" }, 5, null));
});

test("scoreAnswer scores ANSWER_JSON strictly and free text leniently", () => {
  const item = { answer: { population_2022: { type: "number", tol_rel: 0.001 }, tds: { type: "list" } } };
  const expected = { population_2022: 277737, tds: ["Connolly", "Farrell"] };
  const good = "Galway had 277,737 people.\n```ANSWER_JSON\n{\"population_2022\": 277737, \"tds\": [\"John Connolly\", \"Mairéad Farrell\"]}\n```";
  assert.equal(scoreAnswer(item, expected, good).strict_pass, true);
  const prose = "Galway had 277,737 people; TDs include John Connolly and Mairéad Farrell.";
  const s = scoreAnswer(item, expected, prose);
  assert.equal(s.strict_pass, false);
  assert.equal(s.lenient_pass, true);
  assert.equal(scoreAnswer(item, expected, "").key_fraction, 0);
  assert.equal(parseAnswerJson("```ANSWER_JSON\nnot json\n```"), null);
});

test("failure symptoms map transcripts to pillars without trusting declared tags", () => {
  const tags = failureSymptoms({
    calls: [{ operation: "cso_search_tables" }, { operation: "cso_search_tables" }, { operation: "ireland_catalogue" }, { operation: "cso_get_data", truncated: true }],
    answer: "There is no tool to map LEAs to constituencies.",
    hitRoundCap: false
  });
  assert.deepEqual(tags.sort(), ["dataset-card:discovery-churn", "declared-unavailable", "server-query:truncated-payload"]);
  assert.deepEqual(failureSymptoms({ calls: [], answer: "Done.", hitRoundCap: true }), ["harness:round-cap"]);
});

test("pillar probes flip when a capability appears", () => {
  const base = { operations: new Set(["cso_get_data", "ireland_catalogue"]), toolArgs: { ireland_catalogue: ["domain"] } };
  assert.deepEqual(pillarProbes(base), { crosswalk: false, "dataset-card": false, "server-query": false, knowledge: false });
  const later = { operations: new Set(["ireland_resolve_place", "ireland_query", "cib_search"]), toolArgs: { ireland_catalogue: ["geo_level"] } };
  assert.deepEqual(pillarProbes(later), { crosswalk: true, "dataset-card": true, "server-query": true, knowledge: true });
});
