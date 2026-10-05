import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { createContext } from "../../gateway/context.js";
import { buildPprIndex } from "./build.js";
import { createPprModule } from "./index.js";
import { decodeIndex, encodeIndex, MemoryIndexStore } from "./indexStore.js";
import { parsePprCsv, splitCsvLine } from "./parse.js";

const csv = fixturePath(import.meta.url, "ppr-sample-1252.csv");
const now = () => new Date("2026-10-05T12:00:00Z");
const routes: Route[] = [{ match: /PPR-20\d\d(-[A-Za-z]+)?\.csv\/\$FILE/, file: csv }];

describe("PPR parsing", () => {
  it("decodes Windows-1252, normalises dates and euro prices", async () => {
    const rows = parsePprCsv(await readFile(csv));
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual(["2026-01-05", "1 FICTIONAL TERRACE, ORANMORE, GALWAY", "Galway", "H91X001", 200000, 0, "Second-Hand Dwelling house /Apartment", ""]);
    expect(rows[2]![5]).toBe(2);
    expect(rows[3]![5]).toBe(1);
    expect(rows[5]![1]).toContain("BÓTHAR NA TRÁ");
    expect(rows[4]![4]).toBe(725500);
  });

  it("splits quoted CSV fields with commas and doubled quotes", () => {
    expect(splitCsvLine('"a, b","c ""d""",e')).toEqual(["a, b", 'c "d"', "e"]);
  });
});

describe("PPR module", () => {
  it("searches a county live when no index exists", async () => {
    const mod = createPprModule({ store: new MemoryIndexStore() });
    const fetch = fakeFetch(routes);
    const { body } = await callTool(mod, "ppr_search_sales", { county: "Galway", address: "oranmore", from: "2026-01-01" }, createContext({ fetch, now }));
    expect(body.data.total).toBe(1);
    expect(body.data.sales[0]).toMatchObject({ date: "2026-01-05", price_eur: 200000, eircode: "H91X001", not_full_market_price: false });
    expect(fetch.calls[0]!.url).toContain("PPR-2026-Galway.csv");
  });

  it("requires a county without an index and rejects long live ranges", async () => {
    const mod = createPprModule({ store: new MemoryIndexStore() });
    const ctx = createContext({ fetch: fakeFetch(routes), now });
    expect((await callTool(mod, "ppr_price_stats", {}, ctx)).body.error.code).toBe("BAD_ARGS");
    expect((await callTool(mod, "ppr_price_stats", { county: "Cork", from: "2015-01-01" }, ctx)).body.error.code).toBe("BAD_ARGS");
  });

  it("builds a national index and answers stats from it", async () => {
    const store = new MemoryIndexStore();
    const fetch = fakeFetch(routes);
    const ctx = createContext({ fetch, now });
    const index = await buildPprIndex(ctx, store, [2025, 2026]);
    expect(index.rows[0]![0]).toBe("2026-04-02");
    expect(decodeIndex(encodeIndex(index)).rows).toHaveLength(6);

    const mod = createPprModule({ store });
    const calls = fetch.calls.length;
    const { body } = await callTool(mod, "ppr_price_stats", { eircode: "d03", from: "2025-01-01" }, ctx);
    expect(fetch.calls.length).toBe(calls);
    expect(body.data).toMatchObject({ count: 2, median_eur: 667750, min_eur: 610000, max_eur: 725500, second_hand_count: 2 });
    expect(body.data.source).toContain("index built");
  });

  it("sorts and filters by price and property type", async () => {
    const store = new MemoryIndexStore();
    const ctx = createContext({ fetch: fakeFetch(routes), now });
    await buildPprIndex(ctx, store, [2026]);
    const mod = createPprModule({ store });
    const { body } = await callTool(mod, "ppr_search_sales", { include_non_market: true, sort: "price_asc", limit: 2 }, ctx);
    expect(body.data.sales.map((s: { price_eur: number }) => s.price_eur)).toEqual([95000, 200000]);
    expect(body.truncated).toBe(true);
    const fresh = await callTool(mod, "ppr_search_sales", { property: "new" }, ctx);
    expect(fresh.body.data.sales[0]).toMatchObject({ vat_exclusive: true, size: "less than 38 sq metres" });
  });
});
