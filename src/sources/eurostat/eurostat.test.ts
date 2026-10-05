import { describe, expect, it } from "vitest";
import { createContext } from "../../gateway/context.js";
import { createAppServer } from "../../registry.js";
import { connectClient } from "../../../test/helpers/mcpClient.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { fakeFetch, parseToolText } from "../../../test/helpers/fakeFetch.js";
import { eurostatModule } from "./index.js";

type EurostatBody = {
  operation?: string;
  data: {
    datasets?: Array<{ code: string; title: string }>;
    title?: string;
    rows?: Array<{ value: number | null }>;
  };
};

describe("eurostat source", () => {
  it("searches the cached Eurostat catalogue", async () => {
    const fetch = fakeFetch([{ match: /catalogue\/toc/, file: fixturePath(import.meta.url, "toc.txt") }]);
    const { ok, body } = await callTool<EurostatBody>(eurostatModule, "eurostat_search_datasets", { query: "population", limit: 2 }, fetch);
    expect(ok).toBe(true);
    expect(body.data.datasets?.[0]).toMatchObject({ code: "demo_pjan", title: "Population on 1 January by age and sex" });
    expect(fetch.calls[0]?.url).toContain("catalogue/toc/txt");
  });

  it("fetches and decodes compact JSON-stat data for Ireland", async () => {
    const fetch = fakeFetch([{ match: /statistics\/1\.0\/data\/demo_pjan/, file: fixturePath(import.meta.url, "demo_pjan-ie-2024.json") }]);
    const { body } = await callTool<EurostatBody>(
      eurostatModule,
      "eurostat_get_data",
      { dataset: "demo_pjan", filters: { sex: ["T"], age: ["TOTAL"], unit: ["NR"], time: ["2024"] }, limit: 5 },
      fetch
    );
    expect(body.data.title).toContain("Population on 1 January");
    expect(body.data.rows?.[0]?.value).toBe(5351681);
    expect(fetch.calls[0]?.url).toContain("geo=IE");
  });

  it("is reachable through ireland_call", async () => {
    const fetch = fakeFetch([{ match: /statistics\/1\.0\/data\/demo_pjan/, file: fixturePath(import.meta.url, "demo_pjan-ie-2024.json") }]);
    const server = createAppServer(createContext({ fetch }));
    const client = await connectClient(server);
    const result = await client.callTool({
      name: "ireland_call",
      arguments: { source: "eurostat", operation: "eurostat_get_data", args: { dataset: "demo_pjan", filters: { sex: ["T"], age: ["TOTAL"], unit: ["NR"], time: ["2024"] } } }
    });
    const body = parseToolText<EurostatBody>(result as { content: Array<{ type: string; text?: string }> });
    expect(body.operation).toBe("eurostat_get_data");
    expect(body.data.rows?.[0]?.value).toBe(5351681);
    await client.close();
  });
});
