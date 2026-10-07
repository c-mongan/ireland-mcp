import { describe, expect, it } from "vitest";
import { callTool } from "../../../test/helpers/callTool.js";
import { fakeFetch } from "../../../test/helpers/fakeFetch.js";
import { epaModule } from "./index.js";

describe("EPA bathing water", () => {
  it("returns compact locations with pagination and dated classification", async () => {
    const fetch = fakeFetch([{ match: /\/bw\/api\/v1\/locations\?page=2&per_page=1$/, body: JSON.stringify({ count: 243, page: 2, list: [{ beach_id: "IEWEBWL29_194_0100", beach_name: "Loughrea Lake", county_name: "Galway", annual_water_quality_assessment: "Excellent in 2025", has_all_season_bathing_restriction_in_place: "Yes", reason_for_all_season_bathing_restriction: "Water quality", beach_description: "x".repeat(10000) }] }) }]);
    const r = await callTool<{ data: { locations: Array<Record<string, unknown>>; total: number }; truncated: boolean }>(epaModule, "epa_bathing_locations", { page: 2, limit: 1 }, fetch);
    expect(r.ok).toBe(true);
    expect(r.body.data.total).toBe(243);
    expect(r.body.data.locations[0]).toMatchObject({ beach_id: "IEWEBWL29_194_0100", annual_water_quality_assessment: "Excellent in 2025", has_all_season_bathing_restriction_in_place: "Yes", reason_for_all_season_bathing_restriction: "Water quality" });
    expect(JSON.stringify(r.body)).not.toContain("x".repeat(100));
    expect(r.body.truncated).toBe(true);
  });
  it("preserves restriction and update dates without inferring swimming safety", async () => {
    const fetch = fakeFetch([{ match: /\/alerts\?page=1&per_page=5$/, body: JSON.stringify({ count: 1, page: 1, list: [{ beach_id: "IESHBWL27_72_0100", has_bathing_restriction_in_place: "Yes", incident_end_date: null, last_updated: "2026-09-23T11:10:43" }] }) }]);
    const r = await callTool<{ data: { alerts: Array<Record<string, unknown>>; caveat: string } }>(epaModule, "epa_bathing_alerts", { limit: 5 }, fetch);
    expect(r.ok).toBe(true);
    expect(r.body.data.alerts[0]).toMatchObject({ has_bathing_restriction_in_place: "Yes", incident_end_date: null, last_updated: "2026-09-23T11:10:43" });
    expect(r.body.data.caveat).toContain("absence");
  });
  it("queries out-of-season samples and preserves the sample date", async () => {
    const fetch = fakeFetch([{ match: /\/measurements\/out-season\?page=1&per_page=2$/, body: JSON.stringify({ count: 1007, page: 1, list: [{ beach_id: "BPNBF070000020002", result_date: "2016-01-04", e_coli_result: "6488", sample_water_quality_status: "Poor" }] }) }]);
    const r = await callTool<{ data: { measurements: Array<Record<string, unknown>>; caveat: string } }>(epaModule, "epa_bathing_measurements", { season: "out-season", limit: 2 }, fetch);
    expect(r.ok).toBe(true);
    expect(r.body.data.measurements[0]).toMatchObject({ result_date: "2016-01-04", e_coli_result: "6488" });
    expect(r.body.data.caveat).toContain("latest");
  });
  it("rejects malformed success bodies rather than reporting no alerts", async () => {
    const r = await callTool(epaModule, "epa_bathing_alerts", {}, fakeFetch([{ match: /\/alerts\?/, body: '{"error":"unavailable"}' }]));
    expect(r.ok).toBe(false);
  });
});
