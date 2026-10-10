import { describe, expect, it } from "vitest";
// @ts-expect-error The website module has no generated TypeScript declaration.
import { safeProperties } from "../web/analytics.js";

const operations = new Map([["cso", new Set(["cso_search_tables"])]]);
const labels = { source: "cso", operation: "cso_search_tables" };
const privateFields = { args: { query: "private-query" }, result: "private-result", url: "https://private.example", error: "private-error", token: "private-token", distinct_id: "private-person", release_commit: "private-release", surface: "private-surface", schema_version: 999 };

describe("first-use analytics property projection", () => {
  it("records only finite labels for a query attempt", () => {
    expect(safeProperties("ireland_query_started", { ...labels, ...privateFields, outcome: "ok", duration_ms: 50 }, operations)).toEqual(labels);
  });

  it.each(["inspect_raw", "open_source", "connect"])("permits only the %s result action and finite labels", (action) => {
    expect(safeProperties("ireland_result_action", { ...labels, action, ...privateFields }, operations)).toEqual({ ...labels, action });
  });

  it.each(["copy", "installed", "https://private.example", undefined, { action: "connect" }])("rejects an invalid result action %s", (action) => {
    expect(safeProperties("ireland_result_action", { ...labels, action }, operations)).toBeUndefined();
  });

  it.each(["ireland_query_started", "ireland_result_action"])("redacts unknown source and operation for %s", (event) => {
    const properties = safeProperties(event, { source: "private-person", operation: "private-query", action: "open_source" }, operations);
    expect(properties).toMatchObject({ source: "_OTHER", operation: "_OTHER" });
    expect(JSON.stringify(properties)).not.toContain("private");
    expect(safeProperties(event, { source: "cso", operation: "private-query", action: "connect" }, operations)).toMatchObject({ source: "cso", operation: "_OTHER" });
  });

  it("preserves the completed-query schema and rejects arbitrary event names", () => {
    expect(safeProperties("ireland_query_completed", { ...labels, ...privateFields, outcome: "ok", duration_ms: 12.6 }, operations)).toEqual({ ...labels, outcome: "ok", duration_ms: 13 });
    expect(safeProperties("private-event", privateFields, operations)).toBeUndefined();
  });
});
