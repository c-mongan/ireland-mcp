import { describe, expect, it } from "vitest";
import { sourceModules } from "../../registry.js";
import { callTool } from "../../../test/helpers/callTool.js";
import { fakeFetch } from "../../../test/helpers/fakeFetch.js";

describe("NCSE allocations", () => {
  it("discovers allocations and exposes the active datastore resource", async () => {
    const module = sourceModules.find((m) => m.info.id === "ncse");
    expect(module).toBeDefined();
    const fetch = fakeFetch([{ match: /opendata\.ncse\.ie\/api\/3\/action\/package_show\?id=2026-2027-school-allocations$/, body: JSON.stringify({ success: true, result: { id: "allocation", name: "2026-2027-school-allocations", title: "2026–2027 school allocations", license_title: "Creative Commons Attribution", metadata_modified: "2026-10-05", resources: [{ id: "f1f60760-d195-4be7-9a05-1a97159cbef6", format: "CSV", datastore_active: true }] } }) }]);
    const result = await callTool<{ data: { modified: string; resources: Array<{ datastore: boolean; id: string }> } }>(module!, "ncse_get_dataset", { id: "2026-2027-school-allocations" }, fetch);
    expect(result.body.data.modified).toBe("2026-10-05");
    expect(result.body.data.resources[0]).toMatchObject({ datastore: true, id: "f1f60760-d195-4be7-9a05-1a97159cbef6" });
  });
  it("queries a school roll number using exact filters and retains year-specific columns", async () => {
    const module = sourceModules.find((m) => m.info.id === "ncse");
    expect(module).toBeDefined();
    const fetch = fakeFetch([{ match: (url) => {
      const p = new URL(url).searchParams;
      return url.startsWith("https://opendata.ncse.ie/api/3/action/datastore_search?") && p.get("resource_id") === "f1f60760-d195-4be7-9a05-1a97159cbef6" && p.get("filters") === '{"Roll Number":"00651R"}' && p.get("limit") === "1";
    }, body: JSON.stringify({ success: true, result: { total: 1, fields: [{ id: "set_hours_26_27", type: "numeric" }], records: [{ "Roll Number": "00651R", "School Name": "Borris Mixed NS", set_hours_26_27: 70, total_sna_allocation_26_27: 3 }] } }) }]);
    const result = await callTool<{ data: { records: Array<Record<string, unknown>> } }>(module!, "ncse_query_datastore", { resource_id: "f1f60760-d195-4be7-9a05-1a97159cbef6", filters: { "Roll Number": "00651R" }, limit: 1 }, fetch);
    expect(result.ok).toBe(true);
    expect(result.body.data.records).toEqual([{ "Roll Number": "00651R", "School Name": "Borris Mixed NS", set_hours_26_27: 70, total_sna_allocation_26_27: 3 }]);
  });
});
