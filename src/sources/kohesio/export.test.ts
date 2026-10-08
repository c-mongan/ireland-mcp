import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSnapshot, csvRows, exportLocation, MAX_EXPORT_BYTES, MAX_EXPORT_ROWS, parseExport, type Snapshot } from "./export.js";
import { refreshSnapshot } from "./refresh.js";
import { HttpClient } from "../../gateway/http.js";

const snapshot = JSON.parse(readFileSync(new URL("./snapshot.json", import.meta.url), "utf8")) as Snapshot;
// A small synthetic CSV uses the verified export header, without claiming synthetic records are official.
const header = snapshot.metadata.exports[0]!.columns!;
function csv(overrides: Record<string, string | undefined> = {}) {
  const record: Record<string, string | undefined> = { Operation_Unique_Identifier: "https://linkedopendata.eu/entity/Q1", Operation_Name_English: 'Research, "test"\nproject', Country: "Ireland", Programming_Period: "2014-2020", Operation_Start_Date: "29/02/2024", Project_EU_Budget: "123.45", ...overrides };
  const cell = (v: string) => `"${v.replaceAll('"', '""')}"`;
  return `\uFEFF${header.join(",")}\r\n${header.map((key) => cell(record[key as keyof typeof record] ?? "")).join(",")}\r\n`;
}

describe("verified Kohesio export schema", () => {
  it("handles quoted commas, escaped quotes, multiline values, BOM and CRLF", () => {
    const project = parseExport(csv(), "2014-2020")[0]!;
    expect(project.title).toBe('Research, "test" project');
    expect(project.start).toBe("2024-02-29");
    expect(project.eu_budget).toBe(123.45);
    expect(project.total_budget).toBeNull();
    expect(project.id).toBe("Q1");
  });
  it.each([
    { Country: "France" }, { Programming_Period: "2021-2027" },
    { Operation_Unique_Identifier: "https://example.com/Q1" },
    { Operation_Start_Date: "31/02/2024" }, { Project_EU_Budget: "EUR 123" }
  ])("rejects incompatible rows: %j", (override) => {
    expect(() => parseExport(csv(override), "2014-2020")).toThrow("Invalid Kohesio export");
  });
  it("rejects missing columns, duplicate ids, malformed quoting and mismatched widths", () => {
    expect(() => parseExport("Country\nIreland", "2014-2020")).toThrow("columns");
    const input = csv();
    const row = input.slice(input.indexOf("\r\n") + 2);
    expect(() => parseExport(input + row, "2014-2020")).toThrow("duplicate project");
    expect(() => csvRows('A\n"unterminated')).toThrow("unterminated");
    expect(() => csvRows('A\n"value"tail')).toThrow("quoting");
    expect(() => parseExport(input + "x,y\n", "2014-2020")).toThrow("width");
  });
  it("enforces download and row bounds", () => {
    expect(() => csvRows("a".repeat(MAX_EXPORT_BYTES + 1))).toThrow("byte bound");
    expect(() => csvRows("a\n".repeat(MAX_EXPORT_ROWS + 2))).toThrow("row bound");
  });
  it("records actual schema and row counts from both verified exports", () => {
    expect(snapshot.metadata.exports.map((e) => [e.rows, e.columns?.length])).toEqual([[793, 40], [186, 44]]);
    expect(new Set(snapshot.projects.map((p) => p.id)).size).toBe(979);
    expect(snapshot.metadata.exports.every((e) => /^[a-f0-9]{64}$/.test(e.sha256))).toBe(true);
    expect(snapshot.metadata.exports.every((e) => e.publication_date === null)).toBe(true);
  });
  it("requires both programming periods before publishing a snapshot", () => {
    expect(() => buildSnapshot([{ period: "2014-2020", snapshot_date: "2026-09-24", csv: csv() }], new Date().toISOString())).toThrow("both Irish");
  });
  it("validates snapshot dates before constructing download URLs", () => {
    expect(exportLocation("2021-2027", "2026-09-24").url).toContain("IE-pp21-27-20260924.csv");
    expect(() => exportLocation("2014-2020", "2026-02-31")).toThrow("valid export date");
    expect(() => exportLocation("2014-2020", "latest")).toThrow("valid export date");
  });
});

describe("maintenance refresh", () => {
  it("accepts only listed, validated files and retains download provenance", async () => {
    const http = new HttpClient(async (url) => {
      const period = url.includes("2021-2027") ? "2021-2027" : "2014-2020";
      if (!url.includes("object?id=")) return new Response(JSON.stringify({ files: [exportLocation(period, "2026-09-24").path] }));
      return new Response(csv({ Programming_Period: period, Operation_Unique_Identifier: `https://linkedopendata.eu/entity/${period === "2014-2020" ? "Q1" : "Q2"}` }));
    });
    const next = await refreshSnapshot("2026-09-24", http, new Date("2026-10-07T23:00:00Z"));
    expect(next.projects.map((p) => p.id)).toEqual(["Q1", "Q2"]);
    expect(next.metadata.exports.every((e) => e.retrieved_at === "2026-10-07T23:00:00.000Z")).toBe(true);
    expect(next.metadata.live).toBe(false);
    expect(next.metadata.exports[0]!.url).toBe(exportLocation("2014-2020", "2026-09-24").url);
  });
  it("rejects a missing Ireland file without accepting fabricated file URLs", async () => {
    const http = new HttpClient(async () => new Response(JSON.stringify({ files: ["data/other-country.csv"] })));
    await expect(refreshSnapshot("2026-09-24", http)).rejects.toThrow("does not contain the Ireland");
  });
  it("fails before publishing if an official export is malformed", async () => {
    const http = new HttpClient(async (url) => url.includes("object?id=")
      ? new Response("<html>Not a CSV export</html>")
      : new Response(JSON.stringify({ files: [exportLocation("2014-2020", "2026-09-24").path, exportLocation("2021-2027", "2026-09-24").path] })));
    await expect(refreshSnapshot("2026-09-24", http)).rejects.toThrow("Invalid Kohesio export");
  });
});
