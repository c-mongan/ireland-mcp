import { describe, expect, it } from "vitest";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { fakeFetch } from "../../../test/helpers/fakeFetch.js";
import { createContext, DAY } from "../../gateway/context.js";
import { wikidataModule } from "./index.js";

type WikidataBody = {
  data: {
    qid?: string;
    label?: string | null;
    matches?: Array<{ qid: string | null; label: string | null; population: number | null }>;
  };
};

describe("wikidata source", () => {
  it("uses a safe Irish-place template and descriptive user agent", async () => {
    const fetch = fakeFetch([{ match: /query\.wikidata\.org\/sparql/, file: fixturePath(import.meta.url, "galway-simple.json") }]);
    const { body } = await callTool<WikidataBody>(wikidataModule, "wikidata_place", { name: "Galway", limit: 3 }, fetch);
    expect(body.data.matches?.[0]).toMatchObject({ qid: "Q129610", label: "Galway", population: 83456, url: "https://www.wikidata.org/wiki/Q129610" });
    const call = fetch.calls[0]!;
    expect(decodeURIComponent(call.url).replace(/\+/g, " ")).toContain("wdt:P17 wd:Q27");
    expect(String((call.init?.headers as Record<string, string>)["user-agent"])).toContain("templated Irish public-data lookup");
  });

  it("summarises an entity without depending on the unavailable Query Service", async () => {
    const claim = (value: unknown, rank = "normal") => ({ rank, mainsnak: { snaktype: "value", datavalue: { value } } });
    const entity = { id: "Q27", labels: { en: { value: "Ireland" }, ga: { value: "Éire" } }, descriptions: { en: { value: "country" } }, claims: {
      P31: [claim({ id: "Q6256" })], P17: [claim({ id: "Q27" })],
      P1082: [claim({ amount: "+1" }, "deprecated"), claim({ amount: "+4000000" }), claim({ amount: "+5149139" }, "preferred")],
      P625: [claim({ latitude: 53, longitude: -8, globe: "http://www.wikidata.org/entity/Q2" })], P856: [claim("http://www.gov.ie/")]
    } };
    const fetch = fakeFetch([
      { match: url => new URL(url).searchParams.get("props") === "labels|descriptions|claims", body: JSON.stringify({ entities: { Q27: entity } }) },
      { match: url => new URL(url).searchParams.get("props") === "labels", body: JSON.stringify({ entities: { Q6256: { id: "Q6256", labels: { en: { value: "country" } } }, Q27: entity } }) }
    ]);
    const result = await callTool(wikidataModule, "wikidata_entity", { qid: "Q27" }, fetch);
    expect(result.ok).toBe(true);
    expect(result.body.data).toMatchObject({ qid: "Q27", label: "Ireland", irish_name: "Éire", instance_of: "country", country: "Ireland", population: 5149139, coordinates: { lat: 53, lon: -8 }, website: "http://www.gov.ie/" });
    expect(fetch.calls).toHaveLength(2);
    expect(fetch.calls.every(c => new URL(c.url).hostname === "www.wikidata.org")).toBe(true);
    expect(result.body.cached).toBe(false);
  });

  it("fetches the ids its search returns", async () => {
    const entity = { id: "Q129610", labels: { en: { value: "Galway" } }, descriptions: { en: { value: "city in Ireland" } }, claims: {} };
    const ctx = createContext({ fetch: fakeFetch([
      { match: /query\.wikidata\.org\/sparql/, file: fixturePath(import.meta.url, "galway-simple.json") },
      { match: /www\.wikidata\.org\/w\/api\.php/, body: JSON.stringify({ entities: { Q129610: entity } }) }
    ]) });
    const [hit] = await wikidataModule.search!("Galway", 1, ctx);
    expect(hit?.id).toBe("wikidata:Q129610");
    const doc = await wikidataModule.fetchById!(hit!.id.slice("wikidata:".length), ctx);
    expect(doc).toMatchObject({ id: "wikidata:Q129610", title: "Galway (Wikidata Q129610)", url: "https://www.wikidata.org/wiki/Q129610" });
    expect(doc.text).toContain("city in Ireland");
    expect(doc.metadata).toMatchObject({ licence: wikidataModule.info.licence, attribution: wikidataModule.info.attribution });
    await expect(wikidataModule.fetchById!("abc", ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it.each([
    [{ entities: { Q27: { id: "Q27", missing: "" } } }, "NOT_FOUND"],
    [{ error: { code: "maxlag" } }, "UPSTREAM_DOWN"],
    [{ entities: {} }, "UPSTREAM_DOWN"],
    [{ entities: { Q27: { id: "Q42" } } }, "UPSTREAM_DOWN"],
    [{ entities: { Q27: { id: "Q27", claims: { P31: "invalid" } } } }, "UPSTREAM_DOWN"]
  ])("rejects missing or invalid entity responses: %j", async (body, code) => {
    const fetch = fakeFetch([{ match: /www\.wikidata\.org\/w\/api.php/, body: JSON.stringify(body) }]);
    const result = await callTool(wikidataModule, "wikidata_entity", { qid: "Q27" }, fetch);
    expect(result.ok).toBe(false);
    expect(result.body.error.code).toBe(code);
  });

  it("keeps absent claims null and does not resurrect normal claims behind a preferred unknown", async () => {
    const fetch = fakeFetch([{ match: /www\.wikidata\.org\/w\/api.php/, body: JSON.stringify({ entities: { Q27: { id: "Q27", labels: { en: { value: "Ireland" } }, claims: {
      P1082: [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { value: { amount: "+123" } } } }, { rank: "preferred", mainsnak: { snaktype: "somevalue" } }]
    } } } }) }]);
    const result = await callTool(wikidataModule, "wikidata_entity", { qid: "Q27" }, fetch);
    expect(result.ok).toBe(true);
    expect(result.body.data).toMatchObject({ population: null, coordinates: null, instance_of: null, country: null, website: null });
    expect(fetch.calls).toHaveLength(1);
  });

  it("marks the complete summary stale when related labels cannot refresh", async () => {
    let now = 0;
    let failLabels = false;
    const fetch = fakeFetch([
      { match: url => new URL(url).searchParams.get("props") === "labels|descriptions|claims", body: JSON.stringify({ entities: { Q27: { id: "Q27", labels: { en: { value: "Ireland" } }, claims: { P31: [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { value: { id: "Q6256" } } } }] } } } }) },
      { match: /api.php/, body: JSON.stringify({ entities: { Q6256: { id: "Q6256", labels: { en: { value: "country" } } } } }) }
    ]);
    const ctx = createContext({ now: () => new Date(now), fetch: async (url, init) => {
      if (failLabels && new URL(url).searchParams.get("props") === "labels") throw new Error("upstream unavailable");
      return fetch(url, init);
    } });
    const first = await callTool(wikidataModule, "wikidata_entity", { qid: "Q27" }, ctx);
    expect(first.ok).toBe(true);
    expect(first.body.cached).toBe(false);
    const second = await callTool(wikidataModule, "wikidata_entity", { qid: "Q27" }, ctx);
    expect(second.body.cached).toBe(true);
    now = 8 * DAY;
    failLabels = true;
    const third = await callTool(wikidataModule, "wikidata_entity", { qid: "Q27" }, ctx);
    expect(third.ok).toBe(true);
    expect(third.body.stale).toBe(true);
    expect(third.body.cached).toBe(false);
  });

  it("uses the fast entity-search index and ranks exact names first (uncached towns like Kilkee)", async () => {
    const row = (qid: string, label: string, extra: Record<string, unknown> = {}) => ({
      place: { type: "uri", value: `http://www.wikidata.org/entity/${qid}` },
      placeLabel: { type: "literal", value: label },
      ...extra
    });
    const body = {
      head: { vars: [] },
      results: {
        bindings: [
          row("Q100", "Kilkee (parish)"),
          row("Q1013617", "Kilkee", { population: { type: "literal", value: "1325" }, countyLabel: { type: "literal", value: "County Clare" } }),
          row("Q1013617", "Kilkee", { countyLabel: { type: "literal", value: "Munster" } })
        ]
      }
    };
    const fetch = fakeFetch([{ match: /query\.wikidata\.org\/sparql/, body: JSON.stringify(body) }]);
    const result = await callTool<WikidataBody>(wikidataModule, "wikidata_place", { name: "kilkee", limit: 5 }, fetch);
    expect(result.body.data.matches?.map((m) => m.qid)).toEqual(["Q1013617", "Q100"]);
    expect(result.body.data.matches?.[0]).toMatchObject({ label: "Kilkee", population: 1325 });
    const sparql = new URL(fetch.calls[0]!.url).searchParams.get("query")!;
    expect(sparql).toContain('wikibase:api "EntitySearch"');
    expect(sparql).toContain('mwapi:search "kilkee"');
    expect(sparql).not.toContain("LCASE");
  });
});
