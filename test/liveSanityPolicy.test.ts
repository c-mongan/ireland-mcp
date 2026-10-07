import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script without type declarations
import { classify, exitCode, KNOWN_FLAKY } from "../scripts/live-sanity-policy.mjs";

type Result = { source: string; tool: string; status: string; ms: number; note: string };
const row = (source: string, status: string, note = ""): Result => ({ source, tool: "t", status, ms: 1, note });

describe("live smoke policy", () => {
  it("lists Kohesio as known flaky", () => {
    expect(KNOWN_FLAKY.kohesio).toContain("403");
  });

  it("downgrades the known Kohesio HTTP 403 to WARN and keeps the original note", () => {
    const warned = classify(row("kohesio", "FAIL", "UPSTREAM_DOWN: Kohesio returned HTTP 403.")) as Result;
    expect(warned.status).toBe("WARN");
    expect(warned.note).toContain("Kohesio returned HTTP 403.");
    expect(warned.note).toContain("Known flaky");
  });

  it("keeps real failures as FAIL", () => {
    expect(classify(row("kohesio", "FAIL", "")).status).toBe("FAIL");
    expect(classify(row("kohesio", "FAIL", "BAD_ARGS: rejected")).status).toBe("FAIL");
    expect(classify(row("cso", "FAIL", "UPSTREAM_DOWN: CSO returned HTTP 500.")).status).toBe("FAIL");
    expect(classify(row("cso", "PASS")).status).toBe("PASS");
  });

  it.each([
    "UPSTREAM_DOWN: Kohesio returned HTTP 500.",
    "UPSTREAM_DOWN: Kohesio timed out.",
    "UPSTREAM_DOWN: unexpected handler failure",
    "UPSTREAM_DOWN: unexpected schema mentioning HTTP 403",
    "UPSTREAM_DOWN: Kohesio returned HTTP 4030.",
    "BAD_ARGS: Kohesio returned HTTP 403."
  ])("fails unexpected Kohesio failures: %s", (note) => {
    const failure = row("kohesio", "FAIL", note);
    expect(classify(failure)).toBe(failure);
    expect(exitCode([classify(failure)])).toBe(1);
  });

  it("passes with one isolated warning but fails on any FAIL or multiple warnings", () => {
    expect(exitCode([row("cso", "PASS"), row("nta", "SKIP")])).toBe(0);
    expect(exitCode([row("cso", "PASS"), row("kohesio", "WARN")])).toBe(0);
    expect(exitCode([row("cso", "FAIL"), row("kohesio", "WARN")])).toBe(1);
    expect(exitCode([row("kohesio", "WARN"), row("kohesio", "WARN")])).toBe(1);
  });
});
