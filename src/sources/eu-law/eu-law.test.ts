import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { cellarQuery, euLawModule as mod, summariseCellar } from "./index.js";

const f = (n: string) => fixturePath(import.meta.url, n);
const query = (url: string) => new URL(url).searchParams.get("query") ?? "";
const routes: Route[] = [
  { match: (url) => query(url).includes('"32016R0679"^^xsd:string'), file: f("celex-32016R0679.json") },
  { match: (url) => query(url).includes('"32008L0098"^^xsd:string'), file: f("celex-32008L0098.json") },
  { match: (url) => query(url).includes('"http://data.europa.eu/eli/reg/2014/536/oj"^^xsd:anyURI'), file: f("eli-reg-2014-536.json") },
  { match: (url) => query(url).includes('"32099R9999"'), file: f("celex-missing.json") },
  { match: (url) => query(url).includes('"32098R0001"'), body: '{"error":"Virtuoso 42000 Error"}' }
];

describe("Cellar SPARQL parsing", () => {
  it("merges multi-valued rows into one record and drops placeholder dates", () => {
    const [gdpr] = summariseCellar(JSON.parse(readFileSync(f("celex-32016R0679.json"), "utf8")));
    expect(gdpr).toEqual({
      cellar_uri: "http://publications.europa.eu/resource/cellar/3e485e15-11bd-11e6-ba9a-01aa75ed71a1",
      celex: ["32016R0679"],
      eli: "http://data.europa.eu/eli/reg/2016/679/oj",
      title: expect.stringMatching(/^Regulation \(EU\) 2016\/679 .*General Data Protection Regulation/),
      type: "REG",
      date_document: "2016-04-27",
      in_force: true,
      entry_into_force: ["2016-05-24", "2018-05-25"],
      end_of_validity: null,
      eur_lex: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679"
    });
  });

  it("reports conflicting in-force flags as unknown and ignores malformed rows", () => {
    const row = (force: string) => ({
      work: { type: "uri", value: "http://publications.europa.eu/resource/cellar/00000000-0000-0000-0000-000000000000" },
      force: { type: "literal", value: force },
      eif: { type: "literal", value: "1001-01-01" }
    });
    const bad = { work: { type: "uri", value: "https://evil.example/x" } };
    const docs = summariseCellar({ head: { vars: [] }, results: { bindings: [row("1"), row("false"), bad] } });
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ in_force: null, entry_into_force: [], eur_lex: null });
  });

  it("builds a bounded query with a typed literal", () => {
    const q = cellarQuery({ celex: "32016R0679" });
    expect(q).toContain('cdm:resource_legal_id_celex "32016R0679"^^xsd:string');
    expect(q).toMatch(/LIMIT 50$/);
  });
});

describe("eu_law_lookup", () => {
  it("looks up an act by CELEX with licence, attribution and warnings", async () => {
    const { body } = await callTool(mod, "eu_law_lookup", { celex: "32016R0679" }, fakeFetch(routes));
    expect(body.licence).toMatch(/^Commission Decision 2011\/833\/EU/);
    expect(body.attribution).toMatch(/© European Union/);
    expect(body.url).toMatch(/^https:\/\/publications\.europa\.eu\/webapi\/rdf\/sparql\?query=/);
    expect(body.data.documents[0]).toMatchObject({ type: "REG", in_force: true, eli: "http://data.europa.eu/eli/reg/2016/679/oj" });
    expect(body.data.warnings.join(" ")).toMatch(/Not legal advice.*Official Journal/);
    expect(body.data.licence_terms).toBe("https://data.europa.eu/data/datasets/sparql-cellar-of-the-publications-office");
  });

  it("looks up an act by an ELI from legislation_get_si transposes, accepting https", async () => {
    const { body } = await callTool(mod, "eu_law_lookup", { eli: "https://data.europa.eu/eli/reg/2014/536/oj" }, fakeFetch(routes));
    expect(body.data.query).toEqual({ eli: "http://data.europa.eu/eli/reg/2014/536/oj" });
    expect(body.data.documents[0]).toMatchObject({ celex: ["32014R0536"], date_document: "2014-04-16" });
  });

  it("keeps every entry-into-force date for directives", async () => {
    const { body } = await callTool(mod, "eu_law_lookup", { celex: "32008L0098" }, fakeFetch(routes));
    expect(body.data.documents[0]).toMatchObject({ type: "DIR", entry_into_force: ["2008-12-12", "2029-04-17"] });
  });

  it("maps bad, missing and malformed lookups to typed errors without caching them", async () => {
    const fetch = fakeFetch(routes);
    expect((await callTool(mod, "eu_law_lookup", {}, fetch)).body.error.code).toBe("BAD_ARGS");
    expect((await callTool(mod, "eu_law_lookup", { celex: '3" } . ?s ?p ?o . {' }, fetch)).body.error.code).toBe("BAD_ARGS");
    expect((await callTool(mod, "eu_law_lookup", { celex: "32016R0679", eli: "http://data.europa.eu/eli/reg/2016/679/oj" }, fetch)).body.error.code).toBe("BAD_ARGS");
    expect((await callTool(mod, "eu_law_lookup", { celex: "32099R9999" }, fetch)).body.error.code).toBe("NOT_FOUND");
    expect((await callTool(mod, "eu_law_lookup", { celex: "32098R0001" }, fetch)).body.error.code).toBe("UPSTREAM_DOWN");
    expect(fetch.calls.some((c) => !c.url.startsWith("https://publications.europa.eu/webapi/rdf/sparql?"))).toBe(false);
  });
});
