import assert from "node:assert/strict";
import test from "node:test";
import * as smoke from "../scripts/live-sanity-policy.mjs";
import { operationContracts } from "../scripts/live-contracts.mjs";
import { createService, TOOLS } from "../packages/irish-legal-mcp/src/service.mjs";
import { makeService } from "../packages/irish-legal-mcp/test/helpers.mjs";

const catalogue = (...ids) => [{ domain: "law/politics", sources: ids.map((id) => ({ id })) }];
const selected = (domains, enabled) => smoke.optionalLegalCases?.(domains, enabled);

test("disabled legal sources do not add smoke calls to the default catalogue", () => {
  assert.deepEqual(selected(catalogue("legislation"), "false"), []);
  assert.deepEqual(selected(catalogue("legislation"), "TRUE"), []);
});

test("enabled legal integration checks both sources even if registration is missing", () => {
  assert.deepEqual(selected([], "true")?.map(([source]) => source), ["irish-legal", "citizens-info"]);
});

test("an advertised optional source is checked without requiring a local environment flag", () => {
  assert.deepEqual(selected(catalogue("citizens-info"), "false")?.map(([source]) => source), ["citizens-info"]);
  assert.deepEqual(selected(catalogue("irish-legal", "citizens-info"), undefined)?.map(([source]) => source), ["irish-legal", "citizens-info"]);
});

const wrap = (operation, data, typed) => ({ content: [{ type: "text", text: JSON.stringify({
  ...(!typed ? { operation } : {}), data, source: "Optional legal pilot", url: "https://www.irishstatutebook.ie/",
  licence: "Per-document licence", attribution: "Cited source publisher", retrieved_at: "2026-10-11T10:00:00Z", cached: false, truncated: false
}) }] });

for (const typed of [false, true]) {
  test(`legal smoke checks accept stored legislation and guidance with source evidence (typed=${typed})`, async (t) => {
    const { service } = await makeService(t);
    const cases = selected(catalogue("irish-legal", "citizens-info"), "false");
    assert.equal(cases?.length, 2, "Both optional legal sources need smoke calls");
    for (const [source, operation, args, check] of cases) {
      const data = await service.call(operation, args);
      const assessed = smoke.assessSmokeResult(wrap(operation, data, typed), { source, tool: operation, check, typed });
      assert.equal(assessed.status, "PASS", assessed.note);
      const doc = source === "citizens-info" ? data.hits[0] : data;
      assert.equal(doc.current_law_verified, false);
      assert.ok(doc.warnings.length > 0);

      for (const broken of [{ ...doc, citation: undefined }, { ...doc, current_law_verified: true }, { ...doc, stale: true }]) {
        const invalid = source === "citizens-info" ? { ...data, hits: [broken] } : broken;
        assert.equal(smoke.assessSmokeResult(wrap(operation, invalid, typed), { source, tool: operation, check, typed }).status, "FAIL");
      }
    }
  });
}

test("empty guidance coverage fails the enabled pilot smoke check", () => {
  const cases = selected(catalogue("citizens-info"), "false");
  assert.equal(cases?.length, 1, "Citizens Information needs a smoke call");
  const [source, operation, , check] = cases[0];
  const assessed = smoke.assessSmokeResult(wrap(operation, { hits: [], coverage: { document_count: 0, sources: {}, note: "Only indexed pages" } }, false), { source, tool: operation, check });
  assert.equal(assessed.status, "FAIL");
});

test("all optional legal operations validate their stored-corpus results", async (t) => {
  const { repo, service } = await makeService(t);
  const guidance = await service.call("citizens_info_search", { query: "annual leave", limit: 2 });
  const legislation = await service.call("irish_legal_get_provision", { year: 1997, number: 20, section: "19", version_type: "enacted" });
  const effects = { ...legislation, id: "legislation-effects:1997/act/20", source_id: "legislation-effects", source_type: "effects",
    canonical_url: "https://www.irishstatutebook.ie/eli/isbc/1997_20.html", source_url: "https://www.irishstatutebook.ie/eli/isbc/1997_20.html",
    section: null, version_type: "effects", text: "Stored amendment directory evidence for the Organisation of Working Time Act 1997.",
    warnings: ["Stored effects do not establish comprehensive amendment coverage."] };
  await repo.commit([effects], "effects source snapshot");
  const calls = {
    irish_legal_catalogue: {},
    irish_legal_search: { query: "annual leave", limit: 2 },
    irish_legal_fetch: { id: legislation.id },
    irish_legal_get_provision: { year: 1997, number: 20, section: "19", version_type: "enacted" },
    irish_legal_get_changes: { year: 1997, number: 20 },
    irish_legal_research: { query: "annual leave", limit: 2 },
    citizens_info_search: { query: "annual leave", limit: 2 },
    citizens_info_get_article: { id: guidance.hits[0].id }
  };
  for (const { name } of TOOLS) {
    const check = operationContracts[name];
    assert.equal(typeof check, "function", `${name} needs a response contract`);
    const result = await createService(repo).call(name, calls[name]);
    assert.equal(check(result), true, `${name} should accept its real service result`);
    assert.equal(check({ garbage: true }), false, `${name} must reject arbitrary successful data`);
  }
});
