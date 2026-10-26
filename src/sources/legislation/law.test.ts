import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { createContext } from "../../gateway/context.js";
import { parseConstitution, selectArticle } from "./constitution.js";
import { parseActEffects } from "./effects.js";
import { legislationModule as mod, mentionsSection } from "./index.js";
import { eliLink, parseSiListing, parseSiPage } from "./instruments.js";

const f = (n: string) => fixturePath(import.meta.url, n);
const read = (n: string) => readFileSync(f(n), "utf8");
const routes: Route[] = [
  { match: /eli\/cons\/en\/html$/, file: f("constitution-en.html") },
  { match: /eli\/cons\/ga\/html$/, file: f("constitution-ga.html") },
  { match: /eli\/2024\/si\/$/, file: f("si-list-2024.html") },
  { match: /eli\/2024\/si\/3\/made\/en\/html$/, file: f("si-2024-3.html") },
  { match: /eli\/2024\/si\/4999\/made\/en\/html$/, status: 404, body: "" },
  { match: /eli\/2024\/si\/5\/made\/en\/html$/, body: "<html><h1>Service unavailable</h1></html>" },
  { match: /eli\/isbc\/2018_7\.html$/, file: f("isbc-2018-7.html") },
  { match: /eli\/isbc\/2026_1\.html$/, file: f("isbc-2026-1.html") },
  { match: /eli\/isbc\/2018_99\.html$/, status: 404, body: "" }
];
const now = new Date("2026-10-26T12:00:00Z");

describe("Constitution parser", () => {
  const en = parseConstitution(read("constitution-en.html"));
  const ga = parseConstitution(read("constitution-ga.html"));

  it("reads the edition note in both languages", () => {
    expect(en.edition).toBe("January 2020");
    expect(ga.edition).toBe("Eanáir 2020");
  });

  it("maps paragraphs to the printed numbering, not the upstream anchors", () => {
    const refs = selectArticle(en, "12")!.segments.map((s) => `${s.ref}@${s.anchor}`);
    // eISB's English anchor article12_3 holds the paragraph printed as 12.2.3°.
    expect(refs.slice(0, 5)).toEqual(["12.1@article12_1", "12.2.1@article12_2_1", "12.2.2@article12_2_2", "12.2.3@article12_3", "12.3.1@article12_3_1"]);
    // One English anchor (article12_11_2) and one Irish anchor (article12_11) each hold several numbered paragraphs.
    expect(refs.slice(-3)).toEqual(["12.11.1@article12_11_1", "12.11.2@article12_11_2", "12.11.3@article12_11_2"]);
    expect(selectArticle(ga, "12")!.segments.slice(-3).map((s) => `${s.ref}@${s.anchor}`)).toEqual([
      "12.11.1@article12_11",
      "12.11.2@article12_11",
      "12.11.3@article12_11"
    ]);
  });

  it("reads headings, parts, lettered articles and the malformed article 19 anchor", () => {
    const twelve = selectArticle(en, "12")!;
    expect(twelve).toMatchObject({ heading: "ARTICLE 12", part: "THE PRESIDENT" });
    expect(twelve.segments[1]!.text).toBe("The President shall be elected by direct vote of the people.");
    expect(selectArticle(ga, "12")!).toMatchObject({ heading: "AIRTEAGAL 12", part: "AN tUACHTARÁN" });
    expect(selectArticle(en, "28a")!.segments.map((s) => s.ref)).toEqual(["28A.1", "28A.2", "28A.3", "28A.4", "28A.5"]);
    expect(selectArticle(en, "19")!.segments[0]!.text).toMatch(/^Provision may be made by law for the direct election/);
    expect(selectArticle(en, "1")!.segments).toHaveLength(1);
  });

  it("stops before the closing words and the index, and narrows by section", () => {
    const fifty = selectArticle(en, "50")!;
    expect(fifty.segments.at(-1)!.text).toMatch(/in accordance with the terms thereof\.$/);
    expect(JSON.stringify(fifty)).not.toMatch(/Dochum|INDEX/);
    expect(selectArticle(en, "12", "2")!.segments.map((s) => s.ref)).toEqual(["12.2.1", "12.2.2", "12.2.3"]);
    expect(selectArticle(en, "12", "2.3")!.segments.map((s) => s.ref)).toEqual(["12.2.3"]);
    expect(selectArticle(en, "12", "1")!.segments.map((s) => s.ref)).toEqual(["12.1"]);
    expect(selectArticle(en, "99")).toBeUndefined();
  });

  it("returns no articles for a page without Constitution anchors", () => {
    expect(parseConstitution("<html>maintenance</html>").articles.size).toBe(0);
  });
});

describe("SI and Legislation Directory parsers", () => {
  it("uses the link number for SI listings, keeping Irish-only and unnumbered rows", () => {
    const y2024 = parseSiListing(read("si-list-2024.html"));
    expect(y2024[0]).toEqual({ number: 1, title: "Income Tax (Employments) Regulations 2024", language: "en" });
    expect(y2024.filter((r) => r.number === 253)).toEqual([
      { number: 253, title: "Tourism, Culture, Arts, Gaeltacht, Sport and Media (Delegation of Ministerial Functions) Order 2024", language: "en" }
    ]);
    expect(y2024.some((r) => r.title === "Missing Title")).toBe(false);
    const y1930 = parseSiListing(read("si-list-1930.html"));
    expect(y1930.slice(2)).toEqual([
      { number: 895, listed_number: "95", title: "Portal Inspection Order of 1924. Amendment Order of 1930.", language: "en" },
      { number: 901, listed_number: null, title: "Northern Ireland Potatoes Importation Order, 1930.", language: "en" }
    ]);
  });

  it("parses SI metadata with uppercase attributes and multi-valued links", () => {
    const doc = parseSiPage(read("si-2024-3.html"))!;
    expect(doc).toMatchObject({
      title: "European Union (Clinical Trials on Medicinal Products for Human Use) (Amendment) Regulations 2024",
      made: "2024-01-08",
      changes: ["https://www.irishstatutebook.ie/eli/2022/si/99/made", "https://www.irishstatutebook.ie/eli/2022/si/727/made"],
      based_on: ["https://www.irishstatutebook.ie/eli/1972/act/27/section/3/enacted"],
      transposes: ["http://data.europa.eu/eli/reg/2014/536/oj"]
    });
    expect(doc.explanatory_note).toMatch(/^\(This note is not part of the Instrument/);
    expect(doc.text).toMatch(/^Notice of the making of this Statutory Instrument/);
    expect(doc.text).not.toMatch(/[<>]/);
    expect(parseSiPage("<html><h1>Error</h1></html>")).toBeUndefined();
  });

  it("keeps only eISB and EU ELI links", () => {
    expect(eliLink("http://www.irishstatutebook.ie/eli/2018/si/345/made")).toBe("https://www.irishstatutebook.ie/eli/2018/si/345/made");
    expect(eliLink("https://evil.example/eli/2018/si/345/made")).toBeNull();
    expect(eliLink("http://www.irishstatutebook.ie/eli/2018/si/345/made?x=1")).toBeNull();
    expect(eliLink("javascript:alert(1)")).toBeNull();
  });

  it("parses Legislation Directory tables and carries blank first cells forward", () => {
    const effects = parseActEffects(read("isbc-2018-7.html"))!;
    expect(effects).toMatchObject({
      title: "Data Protection Act 2018",
      updated_to: "13 October 2026 (Act No. 36 of 2026 and S.I. No. 522 of 2026)",
      revised_note: "All effects below are reflected in the most recent Revised Act."
    });
    expect(effects.commencement[1]).toEqual({ provision: "Ss. 2-6", commencement: "25 May 2018", information: expect.stringContaining("S.I. No. 174 of 2018") });
    expect(effects.effects[3]!.affected).toBe(effects.effects[2]!.affected);
    expect(effects.effects[3]!.affecting_provision).toMatch(/S\.I\. No\. 656 of 2020/);
    expect(effects.made_under[0]).toEqual({ provision: "S. 9", instrument: "Data Protection Act 2018 (Establishment Day) Order 2018 (S.I. No. 175 of 2018)" });
    const fresh = parseActEffects(read("isbc-2026-1.html"))!;
    expect(fresh).toMatchObject({ revised_note: null, effects: [] });
    expect(parseActEffects("<html>Access denied</html>")).toBeUndefined();
  });

  it("matches sections in provision text, including ranges", () => {
    expect(mentionsSection("S. 60(3A) inserted", "60")).toBe(true);
    expect(mentionsSection("S. 600 amended", "60")).toBe(false);
    expect(mentionsSection("Ss. 57-70", "60")).toBe(true);
    expect(mentionsSection("Part 5 ch. 2 (ss. 62-64A) application restricted", "63")).toBe(true);
    expect(mentionsSection("S. 19A inserted", "19A")).toBe(true);
    expect(mentionsSection("S. 19A inserted", "19")).toBe(false);
    expect(mentionsSection("Whole Act", "5")).toBe(true);
    expect(mentionsSection("Ss. 71, 72", "72")).toBe(true);
    expect(mentionsSection("Ss. 189, 190", "190")).toBe(true);
    expect(mentionsSection("Ss. 135A, 135B inserted", "135B")).toBe(true);
    expect(mentionsSection("Ss. 135A, 135B inserted", "135")).toBe(false);
    expect(mentionsSection("S. 7 and 9 amended", "9")).toBe(true);
    expect(mentionsSection("Ss. 62-64A", "64A")).toBe(true);
    expect(mentionsSection("Schs. 1, 2, 3", "2")).toBe(false);
    expect(mentionsSection("S. 72(1)(a), (b) amended", "1")).toBe(false);
  });
});

describe("legislation law tools", () => {
  const call = (name: string, args: Record<string, unknown>) => callTool(mod, name, args, createContext({ fetch: fakeFetch(routes), now: () => now }));

  it("returns a Constitution article with references, links, licence and warnings", async () => {
    const { body } = await call("legislation_get_constitution_article", { article: "12", subsection: "2" });
    expect(body.licence).toBe("Oireachtas (Open Data) PSI Licence (incorporates CC BY 4.0)");
    expect(body.attribution).toMatch(/Oireachtas \(Open Data\) PSI Licence/);
    expect(body.url).toBe("https://www.irishstatutebook.ie/eli/cons/en/html#article12_2_1");
    expect(body.data).toMatchObject({ article: "12", heading: "ARTICLE 12", edition: "January 2020", total_paragraphs: 3, text_truncated: false });
    expect(body.data.paragraphs[2]).toMatchObject({ ref: "12.2.3", url: "https://www.irishstatutebook.ie/eli/cons/en/html#article12_3" });
    expect(body.data.warnings.join(" ")).toMatch(/Not legal advice.*January 2020.*Irish text prevails/);
  });

  it("serves the Irish text and bounds long articles", async () => {
    const ga = await call("legislation_get_constitution_article", { article: "12", lang: "ga", max_chars: 500 });
    expect(ga.body.data.heading).toBe("AIRTEAGAL 12");
    expect(ga.body.data.text_truncated).toBe(true);
    expect(ga.body.truncated).toBe(true);
    expect(ga.body.data.paragraphs.map((p: { text: string }) => p.text).join("").length).toBeLessThanOrEqual(510);
  });

  it("maps unknown articles and sections to NOT_FOUND", async () => {
    expect((await call("legislation_get_constitution_article", { article: "99" })).body.error.code).toBe("NOT_FOUND");
    expect((await call("legislation_get_constitution_article", { article: "12", subsection: "40" })).body.error.code).toBe("NOT_FOUND");
  });

  it("lists and filters SIs for a year with ELI links", async () => {
    const { body } = await call("legislation_list_sis", { year: 2024, query: "sick leave" });
    expect(body.data.sis).toEqual([
      { number: 10, title: "Sick Leave Act 2022 (Increase of Statutory Sick Leave Days) Order 2024", language: "en", url: "https://www.irishstatutebook.ie/eli/2024/si/10/made/en/html" }
    ]);
    expect((await call("legislation_list_sis", { year: 2099 })).body.error.code).toBe("BAD_ARGS");
  });

  it("returns an SI with bounded text and enacted-text warnings", async () => {
    const { body } = await call("legislation_get_si", { year: 2024, number: 3, max_chars: 500 });
    expect(body.data).toMatchObject({ citation: "S.I. No. 3 of 2024", made: "2024-01-08", text_truncated: true, transposes: ["http://data.europa.eu/eli/reg/2014/536/oj"] });
    expect(body.data.text.length).toBeLessThanOrEqual(501);
    expect(body.data.warnings.join(" ")).toMatch(/Not legal advice.*not amended text/);
    const missing = await call("legislation_get_si", { year: 2024, number: 4999 });
    expect(missing.body.error).toMatchObject({ code: "NOT_FOUND", message: "No S.I. No. 4999 of 2024 in the Irish Statute Book." });
  });

  it("does not cache a soft-error page as an SI", async () => {
    const fetch = fakeFetch(routes);
    const ctx = createContext({ fetch, now: () => now });
    for (let i = 0; i < 2; i += 1) {
      expect((await callTool(mod, "legislation_get_si", { year: 2024, number: 5 }, ctx)).body.error.code).toBe("UPSTREAM_DOWN");
    }
    expect(fetch.calls.filter((c) => c.url.includes("/si/5/"))).toHaveLength(2);
  });

  it("returns Act effects filtered by section with counts and warnings", async () => {
    const { body } = await call("legislation_get_act_effects", { year: 2018, number: 7, limit: 2 });
    expect(body.url).toBe("https://www.irishstatutebook.ie/eli/isbc/2018_7.html");
    expect(body.data.act).toEqual({ title: "Data Protection Act 2018", year: 2018, number: 7, eli: "https://www.irishstatutebook.ie/eli/2018/act/7/enacted/en/html" });
    expect(body.data.counts).toEqual({ commencement: 4, effects: 8, made_under: 4 });
    expect(body.data.effects).toHaveLength(2);
    expect(body.truncated).toBe(true);
    expect(body.data.warnings.join(" ")).toMatch(/not amended text/);
    const s3 = await call("legislation_get_act_effects", { year: 2018, number: 7, section: "3" });
    expect(s3.body.data.commencement.map((r: { provision: string }) => r.provision)).toEqual(["Ss. 2-6"]);
    expect((await call("legislation_get_act_effects", { year: 2018, number: 99 })).body.error.code).toBe("NOT_FOUND");
  });
});
