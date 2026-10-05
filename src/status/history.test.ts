import { describe, expect, it } from "vitest";
import { appendSample, parseHistory, toSample, type StatusSample } from "./history.js";

const at = (iso: string): StatusSample => ({ checked_at: iso, status: "ok", sources: [] });

describe("status history", () => {
  it("compacts a deep-health report to status and per-source latency", () => {
    const sample = toSample(
      {
        status: "degraded",
        checked_at: "2026-10-05T10:00:00.000Z",
        cached: false,
        sources: [
          { source: "cso", status: "up", latencyMs: 120, httpStatus: 200 },
          { source: "nta", status: "skipped", latencyMs: 0, error: "NTA_API_KEY not set" },
          { bogus: true }
        ]
      },
      new Date("2026-10-05T10:00:05Z")
    );
    expect(sample).toEqual({
      checked_at: "2026-10-05T10:00:00.000Z",
      status: "degraded",
      sources: [
        { source: "cso", status: "up", latencyMs: 120 },
        { source: "nta", status: "skipped", latencyMs: 0 }
      ]
    });
  });

  it("records an unreachable sample when the endpoint did not answer", () => {
    expect(toSample({ status: "unreachable" }, new Date("2026-10-05T10:00:00Z"))).toEqual({
      checked_at: "2026-10-05T10:00:00.000Z",
      status: "unreachable",
      sources: []
    });
    expect(toSample(null, new Date("2026-10-05T10:00:00Z")).status).toBe("unreachable");
  });

  it("keeps only the last 7 days, sorted, without duplicate cached reports", () => {
    const now = new Date("2026-10-08T00:00:00Z");
    const history = [at("2026-10-07T12:00:00.000Z"), at("2026-09-30T23:59:59.000Z"), at("2026-10-01T00:30:00.000Z")];
    const result = appendSample(history, at("2026-10-07T12:00:00.000Z"), now);
    expect(result.map((s) => s.checked_at)).toEqual(["2026-10-01T00:30:00.000Z", "2026-10-07T12:00:00.000Z"]);
    expect(appendSample(result, at("2026-10-07T23:30:00.000Z"), now)).toHaveLength(3);
  });

  it("bounds history to one sample per 30 minutes for a week", () => {
    const now = new Date("2026-10-08T00:00:00Z");
    let samples: StatusSample[] = [];
    for (let i = 0; i < 14 * 48; i += 1) {
      samples = appendSample(samples, at(new Date(now.getTime() - i * 30 * 60_000).toISOString()), now);
    }
    expect(samples.length).toBe(7 * 48 + 1);
  });

  it("tolerates a missing or corrupt history file", () => {
    expect(parseHistory(undefined)).toEqual([]);
    expect(parseHistory("not json")).toEqual([]);
    expect(parseHistory('{"samples":[{"checked_at":"x"},{}]}')).toEqual([{ checked_at: "x" }]);
  });
});
