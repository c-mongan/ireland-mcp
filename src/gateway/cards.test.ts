import { describe, expect, it } from "vitest";
import { appModules } from "../registry.js";
import { createLegalModules } from "../sources/irish-legal/index.js";
import {
  cardMatches,
  cardProblems,
  GEO_LEVELS,
  normaliseGeoLevel,
  normaliseJoinKey,
  normaliseTopic,
  operationCard,
  timeLabel,
  type SourceCard
} from "./cards.js";

const modules = [...appModules().modules, ...createLegalModules()];

describe("dataset cards", () => {
  it.each(modules.map((m) => [m.info.id, m] as const))("%s has a complete card", (_id, module) => {
    expect(module.card, `${module.info.id} has no card`).toBeDefined();
    expect(cardProblems(module.card!, module.tools.map((t) => t.name))).toEqual([]);
  });

  it("covers every registered source plus cross and the legal modules", () => {
    expect(modules.length).toBeGreaterThanOrEqual(41);
    expect(new Set(modules.map((m) => m.info.id)).size).toBe(modules.length);
  });

  it("marks the operator-key sources as needing auth", () => {
    const needsKey = modules.filter((m) => m.card?.auth.required).map((m) => m.info.id).sort();
    expect(needsKey).toEqual(["logainm", "nta"]);
  });

  it("uses the crosswalk's geography level names", () => {
    for (const level of ["county", "local_authority", "lea", "ed", "small_area", "constituency", "nuts3"]) {
      expect(GEO_LEVELS).toContain(level);
    }
  });

  it("flags incomplete or invalid cards", () => {
    const bad = {
      topics: ["nonsense"],
      geo_levels: [],
      time: { start: "unknown", end: "soon", series: true },
      cadence: "unknown",
      dimensions: [],
      join_keys: [],
      freshness: "x",
      auth: { required: true },
      examples: ["one"],
      operations: { missing_op: { examples: [] } }
    } as unknown as SourceCard;
    const problems = cardProblems(bad, ["real_op"]);
    expect(problems).toEqual(
      expect.arrayContaining([
        "source: bad topics",
        "source: bad geo_levels",
        "source: no join_keys and no reason",
        "source: no dimensions",
        "source: needs examples",
        "source: freshness too short",
        'source: bad time.end "soon"',
        "source: time unknown without reason",
        "source: cadence unknown without reason",
        "source: auth needs env and note",
        "operations.missing_op: no such operation",
        "operations.missing_op: needs examples"
      ])
    );
  });

  it("normalises filter values and aliases", () => {
    expect(normaliseGeoLevel("LEA")).toBe("lea");
    expect(normaliseGeoLevel("Local Electoral Areas")).toBe("lea");
    expect(normaliseGeoLevel("council")).toBe("local_authority");
    expect(normaliseGeoLevel("Small Area")).toBe("small_area");
    expect(normaliseGeoLevel("NUTS 3")).toBe("nuts3");
    expect(normaliseGeoLevel("planet")).toBeUndefined();
    expect(normaliseTopic("Housing")).toBe("housing");
    expect(normaliseTopic("public finance")).toBe("public-finance");
    expect(normaliseTopic("unemployment")).toBe("labour");
    expect(normaliseJoinKey("county")).toBe("county_name");
    expect(normaliseJoinKey("ED code")).toBe("ed_code");
    expect(normaliseJoinKey("ELI")).toBe("eli");
  });

  it("applies operation overrides and matches filters", () => {
    const cso = modules.find((m) => m.info.id === "cso")!.card!;
    const profile = operationCard(cso, "cso_area_profile");
    expect(profile.geo_levels).toEqual(["national", "county", "town"]);
    expect(cardMatches(operationCard(cso, "cso_get_data"), { geo_level: "lea", topic: "housing" })).toBe(true);
    expect(cardMatches(profile, { geo_level: "lea" })).toBe(false);
    expect(cardMatches(profile, { topic: "census", has_time_series: true, words: ["population"] })).toBe(true);
    expect(timeLabel({ start: "2010", end: "present", series: true })).toBe("2010–present");
    expect(timeLabel({ start: "live", end: "live", series: false })).toBe("live");
  });
});
