import { describe, expect, it } from "vitest";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { fakeFetch } from "../../../test/helpers/fakeFetch.js";
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
    expect(body.data.matches?.[0]).toMatchObject({ qid: "Q129610", label: "Galway", population: 83456 });
    const call = fetch.calls[0]!;
    expect(decodeURIComponent(call.url).replace(/\+/g, " ")).toContain("wdt:P17 wd:Q27");
    expect(String((call.init?.headers as Record<string, string>)["user-agent"])).toContain("templated Irish public-data lookup");
  });

  it("summarises one entity by QID without accepting SPARQL", async () => {
    const fetch = fakeFetch([{ match: /query\.wikidata\.org\/sparql/, file: fixturePath(import.meta.url, "q27.json") }]);
    const { body } = await callTool<WikidataBody>(wikidataModule, "wikidata_entity", { qid: "Q27" }, fetch);
    expect(body.data).toMatchObject({ qid: "Q27", label: "Ireland" });
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
