import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createContext } from "../src/gateway/context.js";
import { createAppServer } from "../src/registry.js";
import { connectClient } from "./helpers/mcpClient.js";
import { fakeFetch } from "./helpers/fakeFetch.js";

const fixture = (path: string) => fileURLToPath(new URL(`../src/sources/${path}`, import.meta.url));
const unpack = (result: unknown) => JSON.parse((result as { content: Array<{ text: string }> }).content[0]!.text);

describe("civic sources through the MCP gateway", () => {
  it("discovers and calls lobbying and PayGap through the default lean surface", async () => {
    const client = await connectClient(createAppServer(createContext({ fetch: fakeFetch([
      { match: (url) => new URL(url).hostname === "api.lobbying.ie", file: fixture("lobbying/fixtures/search-page-1.json") },
      { match: (url) => new URL(url).hostname === "paygap.ie", file: fixture("paygap/fixtures/annotated-reports.csv") }
    ]) })));
    try {
      const catalogue = unpack(await client.callTool({ name: "ireland_catalogue", arguments: {} }));
      const sources = catalogue.domains.flatMap((domain: { sources: Array<{ id: string }> }) => domain.sources);
      expect(sources.map((source: { id: string }) => source.id)).toEqual(expect.arrayContaining(["lobbying", "paygap"]));
      const lobbying = unpack(await client.callTool({ name: "ireland_call", arguments: { source: "lobbying", operation: "lobbying_search_returns", args: { limit: 1 }, max_tokens: 3000 } }));
      expect(lobbying.error).toBeUndefined();
      expect(lobbying.data.returns).toHaveLength(1);
      expect(lobbying.attribution).toContain("Standards in Public Office");
      const paygap = unpack(await client.callTool({ name: "ireland_call", arguments: { source: "paygap", operation: "paygap_search_reports", args: { company: "Acme", limit: 1 }, max_tokens: 3000 } }));
      expect(paygap.error).toBeUndefined();
      expect(paygap.data.reports[0].metrics.mean_hourly_gap).toBe(-12.5);
      expect(paygap.licence).toBe("CC0 1.0");
    } finally { await client.close(); }
  });
  it("reads a council workbook through the registered source with units and provenance", async () => {
    const client = await connectClient(createAppServer(createContext({ fetch: fakeFetch([
      { match: (url) => new URL(url).hostname === "opendata.housing.gov.ie", file: fixture("council-budgets/fixtures/budget-2026.xlsx") }
    ]) })));
    try {
      const result = unpack(await client.callTool({ name: "ireland_call", arguments: { source: "council-budgets", operation: "council_budgets_get", args: { year: 2026, authority: "Carlow County Council", division: "A", limit: 1 }, max_tokens: 3000 } }));
      expect(result.error).toBeUndefined();
      expect(result.data.rows[0]).toMatchObject({ amount: 4309186.99, unit: "EUR", measure: "Expenditure" });
      expect(result.data.budget_type).toBe("adopted budget estimate");
      expect(result.licence).toContain("CC BY-SA 4.0");
      expect(result.url).toContain("opendata.housing.gov.ie");
    } finally { await client.close(); }
  });

});
