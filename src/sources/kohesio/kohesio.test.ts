import { describe, expect, it } from "vitest";
import { createContext } from "../../gateway/context.js";
import { callTool } from "../../../test/helpers/callTool.js";
import { kohesioModule } from "./index.js";

const offline = async (): Promise<Response> => { throw new Error("No upstream access in hosted requests"); };

describe("Kohesio dated Ireland exports", () => {
  it("searches a bundled, attributed snapshot without frontend API calls", async () => {
    const result = await callTool(kohesioModule, "kohesio_search_projects", { limit: 3 }, offline);
    expect(result.ok).toBe(true);
    expect(result.body.data.total).toBe(979);
    expect(result.body.data.projects).toHaveLength(3);
    expect(result.body.data.snapshot.kind).toBe("static_export");
    expect(result.body.data.snapshot.exports.map((e: { snapshot_date: string }) => e.snapshot_date)).toEqual(["2026-09-24", "2026-09-24"]);
    expect(result.body.attribution).toContain("European Commission");
    expect(result.body.url).not.toContain("/api/projects");
    expect(result.body.truncated).toBe(true);
  });

  it("preserves Q ids, URL lookup and compact project fields for both periods", async () => {
    for (const id of ["Q232198", "https://linkedopendata.eu/entity/Q7361323"]) {
      const result = await callTool(kohesioModule, "kohesio_get_project", { id }, offline);
      expect(result.ok).toBe(true);
      expect(result.body.data.country).toBe("Ireland");
      expect(result.body.data.title).toBeTruthy();
      if (id === "Q232198") expect(result.body.data.eu_budget).toBeNull();
      else expect(result.body.data.eu_budget).toBe(149999.99);
      expect(result.body.data.snapshot.exports).toHaveLength(2);
      expect(result.body.data.url).toContain("linkedopendata.eu/entity/Q");
    }
  });

  it("applies keyword, region, budget and stable pagination locally", async () => {
    const all = await callTool(kohesioModule, "kohesio_search_projects", { query: "  longford  ", region: "IE063", min_eu_budget: 100_000, limit: 500, max_tokens: 8000 }, offline);
    expect(all.ok).toBe(true);
    expect(all.body.data.total).toBeGreaterThan(1);
    expect(all.body.data.projects.every((p: { eu_budget: number }) => p.eu_budget >= 100_000)).toBe(true);
    const page = await callTool(kohesioModule, "kohesio_search_projects", { query: "Longford", region: "ie063", min_eu_budget: 100_000, limit: 1, offset: 1 }, offline);
    expect(page.body.data.total).toBe(all.body.data.total);
    expect(page.body.data.projects[0].id).toBe(all.body.data.projects[1].id);
    const empty = await callTool(kohesioModule, "kohesio_search_projects", { offset: 100_000 }, offline);
    expect(empty.body.data.projects).toEqual([]);
    expect(empty.body.truncated).toBe(false);
  });

  it("rejects invalid ids and missing Irish projects without a fabricated result", async () => {
    const invalid = await callTool(kohesioModule, "kohesio_get_project", { id: "https://example.com/Q232198" }, offline);
    expect(invalid.body.error.code).toBe("BAD_ARGS");
    const missing = await callTool(kohesioModule, "kohesio_get_project", { id: "Q999999999" }, offline);
    expect(missing.body.error.code).toBe("NOT_FOUND");
  });

  it("uses the same snapshot in cross-source search and fetch", async () => {
    const ctx = createContext({ fetch: offline });
    const hits = await kohesioModule.search!("hydrogen", 2, ctx);
    expect(hits).toHaveLength(2);
    const doc = await kohesioModule.fetchById!(hits[0]!.id.replace(/^kohesio:/, ""), ctx);
    expect(doc.id).toBe(hits[0]!.id);
    expect(doc.metadata?.snapshot).toBeDefined();
    expect(doc.text).toContain("static_export");
  });
});
