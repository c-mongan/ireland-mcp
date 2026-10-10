import { describe, expect, it } from "vitest";
// @ts-expect-error The browser preview module uses plain JavaScript.
import { buildResultView, decodeToolPayload, safeSourceUrl } from "../web/result-view.js";

const metadata = { source: "CSO", url: "https://data.cso.ie/table/RIQ02", licence: "CC BY 4.0", retrieved_at: "2025-12-01T12:30:00Z" };
const view = (source: string, operation: string, data: unknown, extra = {}) => buildResultView({ ...metadata, data, ...extra }, { source, operation });

describe("deterministic result previews", () => {
  it("decodes structured and text MCP envelopes without interpreting plain text", () => {
    expect(decodeToolPayload({ structuredContent: { data: [] } })).toEqual({ data: [] });
    expect(decodeToolPayload({ content: [{ type: "text", text: '{"data":[]}' }] })).toEqual({ data: [] });
    expect(decodeToolPayload({ content: [{ type: "image", text: "ignored" }, { type: "text", text: "Provider unavailable" }] })).toBe("Provider unavailable");
  });
  it.each(["javascript:alert(1)", "data:text/html,test", "file:///tmp/test", "/relative", "https://user:secret@example.org"])("rejects unsafe source link %s", (url) => {
    expect(safeSourceUrl(url)).toBeUndefined();
  });
  it("retains safe absolute links and reports missing metadata", () => {
    expect(safeSourceUrl("https://data.cso.ie/table/RIQ02")).toBe("https://data.cso.ie/table/RIQ02");
    const result = buildResultView({ data: null, retrieved_at: "not a date" }, {});
    expect(result.provenance).toMatchObject({ publisher: "Not reported", licence: "Not reported", retrieved: "Not reported" });
    expect(result.tables).toEqual([]);
  });
  it("bounds CSO previews, keeps input unchanged, and treats malicious text as text", () => {
    const data = Array.from({ length: 20 }, (_, index) => ({ code: `T${index}`, title: '<img src=x onerror="alert(1)">', released: null }));
    const result = view("cso", "cso_search_tables", data);
    expect(result.tables[0].rows).toHaveLength(5);
    expect(result.tables[0].rows[0][0]).toBe('<img src=x onerror="alert(1)">');
    expect(result.notices.join(" ")).toContain("More entries are in the raw response");
    expect(data).toHaveLength(20);
  });
  it("does not turn malformed or mismatched responses into an empty result", () => {
    for (const data of [null, {}, [null], [{ unrelated: "value" }]]) expect(view("cso", "cso_search_tables", data).tables).toEqual([]);
    const mismatch = view("cso", "cso_search_tables", [{ title: "Table" }], { operation: "luas_get_forecast" });
    expect(mismatch.tables).toEqual([]);
    expect(mismatch.notices.join(" ")).toContain("different operation");
  });
  it("preserves cache, stale, truncation and partial warnings", () => {
    const result = view("unknown", "unknown", {}, { cached: true, stale: true, truncated: true, partial: true });
    expect(result.notices).toHaveLength(4);
    expect(result.tables).toEqual([]);
  });
  it("shows due-now trams and missing times without replacing missing values with zero", () => {
    const result = view("luas", "luas_get_forecast", { stop: { name: "Heuston" }, inbound: [{ destination: "City", due_in_min: 0 }], outbound: [{ destination: "West", due_in_min: null }] });
    expect(result.tables[0].rows[0]).toEqual(["City", "0 min"]);
    expect(result.tables[1].rows[0][1]).toBe("Not reported");
  });
  it("does not describe an incomplete warning preview as clear weather", () => {
    const result = view("met-eireann", "met_get_warnings", { count: 2, warnings: [] }, { truncated: true });
    expect(result.title).toBe("No warning entries in this preview");
    expect(result.notices.join(" ")).toContain("incomplete");
    expect(view("met-eireann", "met_get_warnings", { count: 0 }).tables).toEqual([]);
  });
  it("shows rail source fields with their original status", () => {
    const result = view("irish-rail", "rail_get_departures", { station: { name: "Connolly" }, departures: [{ destination: "Howth", due_in_min: 4, expected_departure: "12:34", status: "En Route" }] });
    expect(result.tables[0].rows[0]).toEqual(["Howth", "4 min", "12:34", "En Route"]);
  });
  it("shows grid measurement times and distinguishes zero wind from absent demand", () => {
    const result = view("eirgrid", "grid_get_status", { region: "ALL", demand_mw: null, wind_mw: 0, wind_time: "2025-12-01T12:00:00", wind_share_pct: null, co2_g_per_kwh: 42 });
    expect(result.tables[0].rows[0][1]).toBe("Not reported");
    expect(result.tables[0].rows[1]).toEqual(["Wind generation", "0 MW", "2025-12-01T12:00:00"]);
    expect(result.notices.join(" ")).toContain("Missing readings are not zero");
  });
  it("does not produce a zero property median when no sale prices are reported", () => {
    const result = view("ppr", "ppr_price_stats", { count: 0, median_eur: null, mean_eur: null });
    expect(result.description).toContain("0 sales reported");
    expect(result.tables[0].rows[0][1]).toBe("Not reported");
    expect(view("ppr", "ppr_price_stats", { count: null }).tables).toEqual([]);
  });
  it("shows supplied historical rent figures and treats RIQ02 zero as insufficient data", () => {
    const data = { code: "RIQ02", title: "RTB Average Monthly Rent Report", rows: [{ Location: "Galway City", Quarter: "2025Q4", "Number of Bedrooms": "Two bed", "Property Type": "Apartment", value: 1672.57, unit: "Euro" }] };
    const result = view("cso", "cso_get_data", data);
    expect(result.tables[0].rows[0]).toEqual(["Galway City", "2025Q4", "1,672.57 Euro", "Two bed · Apartment"]);
    expect(result.description).toContain("Historical registered-tenancy");
    expect(view("cso", "cso_get_data", { ...data, rows: [{ ...data.rows[0], value: 0 }] }).tables[0].rows[0][2]).toBe("Insufficient published data");
    expect(view("cso", "cso_get_data", { ...data, rows: [{ ...data.rows[0], value: null }] }).tables[0].rows[0][2]).toBe("Not reported");
    expect(view("cso", "cso_get_data", { ...data, code: "OTHER" }).tables).toEqual([]);
  });
  it("never shows a data preview for a tool error even when it contains data", () => {
    const result = buildResultView({ ...metadata, data: [{ title: "Table" }] }, { source: "cso", operation: "cso_search_tables", isError: true });
    expect(result.tables).toEqual([]);
    expect(result.title).toContain("error");
  });
});
