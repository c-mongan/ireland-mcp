import { describe, expect, it } from "vitest";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { fakeFetch } from "../../../test/helpers/fakeFetch.js";
import { kohesioModule } from "./index.js";

type SearchBody = { data: { total: number; projects: Array<{ id: string }> } };
type ProjectBody = { data: { title: string; country: string } };
const fx = (name: string) => fixturePath(import.meta.url, name);

describe("kohesio", () => {
  it("searches Irish EU-funded projects", async () => {
    const fetch = fakeFetch([{ match: (url) => url.includes("/api/projects?") && url.includes("country=https"), file: fx("projects-ie.json") }]);
    const result = await callTool<SearchBody>(kohesioModule, "kohesio_search_projects", { limit: 3 }, fetch);
    expect(result.ok).toBe(true);
    expect(result.body.data.total).toBeGreaterThan(1000);
    expect(result.body.data.projects[0]?.id).toBe("Q232198");
  });

  it("gets one Kohesio project by Q id", async () => {
    const fetch = fakeFetch([{ match: /\/api\/projects\/https%3A%2F%2Flinkedopendata\.eu%2Fentity%2FQ232198/, file: fx("project-q232198.json") }]);
    const result = await callTool<ProjectBody>(kohesioModule, "kohesio_get_project", { id: "Q232198" }, fetch);
    expect(result.ok).toBe(true);
    expect(result.body.data.title).toContain("anonymous social media app");
    expect(result.body.data.country).toBe("Ireland");
  });

  it("explains cloud-hosted Kohesio 403 blocks", async () => {
    const fetch = fakeFetch([{ match: /\/api\/projects\?/, status: 403, body: "Forbidden" }]);
    const result = await callTool(kohesioModule, "kohesio_search_projects", { query: "Galway", limit: 3 }, fetch);
    expect(result.ok).toBe(false);
    expect(result.body.error.code).toBe("UPSTREAM_DOWN");
    expect(result.body.error.hint).toContain("Kohesio blocks some cloud-hosted IPs");
  });
});
