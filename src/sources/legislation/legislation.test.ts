import { describe, expect, it } from "vitest";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { createContext } from "../../gateway/context.js";
import { legislationModule as mod } from "./index.js";

const f = (n: string) => fixturePath(import.meta.url, n);
const routes: Route[] = [
  { match: /eli\/2018\/act\/7\/enacted\/en\/xml$/, file: f("act-2018-7.xml") },
  { match: /eli\/2018\/act\/$/, file: f("year-2018.html") },
  { match: /eli\/\d{4}\/act\/$/, body: "<html><table></table></html>" },
  { match: /eli\/2018\/act\/99\/enacted\/en\/xml$/, status: 404, body: "" }
];

describe("legislation module", () => {
  it("lists and filters Acts for a year", async () => {
    const { body } = await callTool(mod, "legislation_list_acts", { year: 2018, query: "data protection" }, fakeFetch(routes));
    expect(body.data.acts).toEqual([{ number: 7, title: "Data Protection Act 2018", url: "https://www.irishstatutebook.ie/eli/2018/act/7/enacted/en/html" }]);
  });

  it("returns act metadata and the table of sections", async () => {
    const { body } = await callTool(mod, "legislation_get_act", { year: 2018, number: 7 }, fakeFetch(routes));
    expect(body.data).toMatchObject({ title: "Data Protection Act 2018", enacted: "2018-05-24" });
    expect(body.data.sections.slice(0, 2)).toEqual([
      { id: "1", number: "1", heading: "Short title, citation and commencement" },
      { id: "2", number: "2", heading: "Interpretation" }
    ]);
  });

  it("returns readable section text without footnotes", async () => {
    const { body } = await callTool(mod, "legislation_get_section", { year: 2018, number: 7, section: "2" }, fakeFetch(routes));
    expect(body.data.heading).toBe("Interpretation");
    expect(body.data.text).toContain("“Act of 1988” means the Data Protection Act 1988;");
    expect(body.data.text).not.toContain("OJ No. L 119");
    expect(body.data.text).not.toContain("Designation by appropriate authority");
    const missing = await callTool(mod, "legislation_get_section", { year: 2018, number: 7, section: "999" }, fakeFetch(routes));
    expect(missing.body.error.code).toBe("NOT_FOUND");
  });

  it("maps unknown Acts and impossible years to typed errors", async () => {
    expect((await callTool(mod, "legislation_get_act", { year: 2018, number: 99 }, fakeFetch(routes))).body.error.code).toBe("NOT_FOUND");
    expect((await callTool(mod, "legislation_get_act", { year: 2099, number: 1 }, fakeFetch(routes))).body.error.code).toBe("BAD_ARGS");
  });

  it("supports cross-source search and fetch", async () => {
    const ctx = createContext({ fetch: fakeFetch(routes) });
    const hits = await mod.search!("Data Protection Act 2018", 5, ctx);
    expect(hits).toEqual([{ id: "legislation:2018/7", title: "Data Protection Act 2018", url: expect.stringContaining("/eli/2018/act/7/") }]);
    const doc = await mod.fetchById!("2018/7/s2", ctx);
    expect(doc.title).toBe("Data Protection Act 2018, section 2");
    expect(doc.url).toContain("/section/2/");
  });
});
