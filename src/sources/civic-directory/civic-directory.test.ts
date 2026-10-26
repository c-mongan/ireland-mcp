import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createContext } from "../../gateway/context.js";
import { callTool } from "../../../test/helpers/callTool.js";
import { civicDirectoryModule, snapshotHealth } from "./index.js";
import { directorySnapshot, parseEntry } from "./parse.js";

const offline = async (): Promise<Response> => { throw new Error("The directory tool must not fetch citizendata.ie or GitHub"); };
const meta = { sourceUrl: "https://github.com/williamkennedy/eire_civic_tech_directory/blob/abc/src/content/projects/x.md", sha256: "0".repeat(64) };
const entry = (fields: string) => `\uFEFF---\n${fields}\n---\n\nBody text.\n`;
const valid = [
  "title: Example Tracker", "category: Housing", 'owner: ["Jane Doe", "Open Ireland"]',
  "description: Tracks housing completions by county.", "status: true", "link: https://example.ie/", "foundingYear: 2021"
].join("\n");

describe("civic directory entry parser", () => {
  it("strips one BOM, reads the frontmatter and derives the CitizenData.ie listing", () => {
    const p = parseEntry("example-tracker", entry(valid), meta);
    expect(p).toMatchObject({
      slug: "example-tracker", title: "Example Tracker", owners: ["Jane Doe", "Open Ireland"], status_as_listed: "active",
      founding_year: 2021, repo: null, citizendata_listing_url: "https://citizendata.ie/project/example-tracker"
    });
  });

  it("rejects unknown, duplicate, quoted, multi-line or malformed fields", () => {
    const bad = [
      `${valid}\nextra: yes`, `${valid}\ntitle: Again`, valid.replace("title: Example Tracker", 'title: "Quoted"'),
      valid.replace("status: true", "status: yes"), valid.replace('owner: ["Jane Doe", "Open Ireland"]', "owner: Jane"),
      valid.replace("link: https://example.ie/", "link: javascript:alert(1)"), valid.replace("foundingYear: 2021", "foundingYear: 21"),
      `${valid}\n  - continuation`, valid.replace("description: Tracks", "description: Note: tracks"), valid.replace("category: Housing\n", "")
    ];
    for (const fields of bad) expect(() => parseEntry("example-tracker", entry(fields), meta)).toThrow();
    expect(() => parseEntry("Bad_Slug", entry(valid), meta)).toThrow(/slug/);
    expect(() => parseEntry("x", "no frontmatter", meta)).toThrow(/frontmatter/);
  });
});

describe("civic directory snapshot and search", () => {
  const raw = JSON.parse(readFileSync(new URL("../../../web/data/civic-directory.json", import.meta.url), "utf8"));

  it("is a valid MIT snapshot of the pinned commit with per-entry checksums", () => {
    const bytes = readFileSync(new URL("../../../web/data/civic-directory.json", import.meta.url));
    // Reviewed snapshot digest; update deliberately after reviewing a refresh diff.
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("05bdec39dafec6caf8ddbcc27ac3ece10405d0d2b1cc5987e043b9f215c1b497");
    expect(directorySnapshot.safeParse({ ...raw, schema: "https://irishopendata.ie/data/civic-directory.json#v2" }).success).toBe(false);
    const data = directorySnapshot.parse(raw);
    expect(data.commit).toBe("7f0aeaf1a8655b25e55f76dae94a497943970629");
    expect(data.projects).toHaveLength(119);
    expect(new Set(data.projects.map((p) => p.slug)).size).toBe(119);
    expect(data.licence_text).toMatch(/^MIT License[\s\S]*William Kennedy[\s\S]*Permission is hereby granted/);
    expect(data.projects.every((p) => p.source_url.includes(`/blob/${data.commit}/`))).toBe(true);
    expect(snapshotHealth()).toMatchObject({ ok: true });
  });

  it("filters by category, status and owner with stable, bounded pages", async () => {
    const housing = await callTool(civicDirectoryModule, "civic_directory_search", { category: "housing", limit: 50 }, offline);
    expect(housing.ok).toBe(true);
    expect(housing.body.data.total).toBe(22);
    expect(housing.body.data.projects.every((p: { category: string }) => p.category === "Housing")).toBe(true);
    const inactive = await callTool(civicDirectoryModule, "civic_directory_search", { status: "inactive" }, offline);
    expect(inactive.body.data.projects.map((p: { slug: string }) => p.slug).sort()).toEqual(["benefacts-legacy", "irish-political-maps", "overwatch-report"]);
    const first = await callTool(civicDirectoryModule, "civic_directory_search", { limit: 2 }, offline);
    const second = await callTool(civicDirectoryModule, "civic_directory_search", { limit: 2, offset: 2 }, offline);
    expect(first.body.data.total).toBe(119);
    expect(first.body.data.next_offset).toBe(2);
    expect(first.body.truncated).toBe(true);
    expect(second.body.data.projects[0].slug).not.toBe(first.body.data.projects[1].slug);
    const owner = await callTool(civicDirectoryModule, "civic_directory_search", { owner: "biodiversity" }, offline);
    expect(owner.body.data.projects.some((p: { slug: string }) => p.slug === "actions-for-pollinators")).toBe(true);
    const big = await callTool(civicDirectoryModule, "civic_directory_search", { limit: 50 }, offline);
    const shown = big.body.data.projects.length;
    expect(shown).toBeLessThan(50);
    expect(big.body.data.next_offset).toBe(shown);
    expect(big.body.data.projects.every((p: { citizendata_listing?: unknown; project_link?: unknown }) => p.citizendata_listing && p.project_link)).toBe(true);
    expect(big.body.attribution).toContain("William Kennedy");
    const rest = await callTool(civicDirectoryModule, "civic_directory_search", { limit: 8, offset: shown }, offline);
    const ordered = (await callTool(civicDirectoryModule, "civic_directory_search", { limit: 8, offset: shown - 1 }, offline)).body.data.projects;
    expect(rest.body.data.projects[0].slug).toBe(ordered[1].slug);
    const tooMany = await callTool(civicDirectoryModule, "civic_directory_search", { limit: 51 }, offline);
    expect(tooMany.ok).toBe(false);
    const defaultPage = await callTool(civicDirectoryModule, "civic_directory_search", {}, offline);
    expect(defaultPage.body.data.projects).toHaveLength(8);
    expect(defaultPage.body.truncated_at).toBeUndefined();
    expect(defaultPage.body.data.categories).toBeUndefined();
    const nothing = await callTool(civicDirectoryModule, "civic_directory_search", { category: "Astrology" }, offline);
    expect(nothing.body.data.total).toBe(0);
    expect(nothing.body.data.categories).toContain("Housing");
  });

  it("labels links as listed and unverified and points to CitizenData.ie", async () => {
    const result = await callTool(civicDirectoryModule, "civic_directory_search", { query: "pollinator", limit: 1 }, offline);
    const project = result.body.data.projects[0];
    expect(project.project_link).toEqual({ url: "https://pollinators.biodiversityireland.ie/", note: "as listed, unverified" });
    expect(project.citizendata_listing).toEqual({ url: "https://citizendata.ie/project/actions-for-pollinators", label: "see listing on CitizenData.ie" });
    expect(project.status_as_listed).toBe("active");
    expect(result.body.licence).toContain("MIT");
    expect(result.body.attribution).toContain("William Kennedy");
    expect(result.body.url).toContain("github.com/williamkennedy/eire_civic_tech_directory/tree/7f0aeaf");
    expect(result.body.data.snapshot.public_file).toBe("https://irishopendata.ie/data/civic-directory.json");
    expect(result.body.data.snapshot.listing_note).toMatch(/does not fetch or scrape citizendata\.ie/);
  });

  it("supports cross-source search and fetch from the same snapshot", async () => {
    const ctx = createContext({ fetch: offline });
    const hits = await civicDirectoryModule.search!("transport", 3, ctx);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.url).toMatch(/^https:\/\/citizendata\.ie\/project\//);
    const doc = await civicDirectoryModule.fetchById!(hits[0]!.id.replace(/^civic-directory:/, ""), ctx);
    expect(doc.text).toContain("as listed, unverified");
    await expect(civicDirectoryModule.fetchById!("no-such-project", ctx)).rejects.toThrow();
  });
});
