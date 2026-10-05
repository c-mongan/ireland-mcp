import { describe, expect, it } from "vitest";
import { argumentNames, clientInfoFrom, DailySalt, hashedClientKey } from "./privacy.js";

const headers = (map: Record<string, string>) => new Headers(map);

describe("DailySalt", () => {
  it("keeps one salt per UTC day and rotates at midnight", () => {
    let now = Date.UTC(2026, 9, 5, 10);
    let n = 0;
    const salt = new DailySalt(() => now, () => Buffer.from([++n]));
    const first = salt.current();
    now = Date.UTC(2026, 9, 5, 23, 59);
    expect(salt.current()).toBe(first);
    now = Date.UTC(2026, 9, 6, 0, 0);
    expect(salt.current()).not.toEqual(first);
  });
});

describe("hashedClientKey", () => {
  it("never contains the address, is stable within a day and changes the next day", () => {
    let now = Date.UTC(2026, 9, 5, 12);
    const salt = new DailySalt(() => now);
    const h = headers({ "x-forwarded-for": "203.0.113.7" });
    const a = hashedClientKey(h, salt);
    expect(a).not.toContain("203.0.113.7");
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(hashedClientKey(h, salt)).toBe(a);
    expect(hashedClientKey(headers({ "x-forwarded-for": "203.0.113.8" }), salt)).not.toBe(a);
    now += 24 * 3600_000;
    expect(hashedClientKey(h, salt)).not.toBe(a);
  });
});

describe("argumentNames", () => {
  it("returns sorted names only, never values, and drops odd keys", () => {
    expect(argumentNames({ query: "secret text", limit: 5, area: "Galway" })).toEqual(["area", "limit", "query"]);
    expect(argumentNames({ "203.0.113.7": 1, "with space": 2, ok_name: 3 })).toEqual(["ok_name"]);
    expect(argumentNames("not an object")).toEqual([]);
    expect(argumentNames(undefined)).toEqual([]);
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${String(i).padStart(2, "0")}`, i]));
    expect(argumentNames(many)).toHaveLength(32);
  });
});

describe("clientInfoFrom", () => {
  it("extracts a bounded client name and version from initialize params", () => {
    expect(clientInfoFrom({ clientInfo: { name: "claude-ai", version: "0.1.0" } })).toEqual({ name: "claude-ai", version: "0.1.0" });
    expect(clientInfoFrom({ clientInfo: { name: "x".repeat(200) } })).toEqual({ name: "x".repeat(64) });
    expect(clientInfoFrom({ clientInfo: { name: 42 } })).toEqual({});
    expect(clientInfoFrom(undefined)).toEqual({});
  });
});
