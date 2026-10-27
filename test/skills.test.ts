import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AnyTool } from "../src/gateway/module.js";
import { appModules } from "../src/registry.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(root, "skills");

// Opt-in beta sources (LEGAL_ENABLED) are not on the hosted endpoint, so skills must not depend on them.
const BETA_SOURCES = new Set(["irish-legal", "citizens-info"]);
// ireland_call dispatches to these (source -> operation) pairs; "cross" holds nearby, ireland_snapshot, list_sources, ireland_resolve_place.
const ops = new Map<string, Set<string>>();
const toolsBySource = new Map<string, Map<string, AnyTool>>();
for (const mod of appModules().modules) {
  if (BETA_SOURCES.has(mod.info.id)) continue;
  ops.set(mod.info.id, new Set(mod.tools.map((tool) => tool.name)));
  toolsBySource.set(mod.info.id, new Map(mod.tools.map((tool) => [tool.name, tool])));
}
const allOps = new Set([...ops.values()].flatMap((set) => [...set]));
const META_TOOLS = ["ireland_catalogue", "ireland_describe", "ireland_call", "ireland_query", "ireland_about", "search", "fetch", "nearby", "ireland_resolve_place"];

function skillFolders(): string[] {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .filter((name) => !name.startsWith("_") && !name.startsWith("."))
    .filter((name) => statSync(join(skillsDir, name)).isDirectory())
    .sort();
}

interface InspirationRow { url: string; skills: string[] }

/** Rows of the mapping table in skills/_shared/inspirations.md, keyed by project name. */
function parseInspirations(): Map<string, InspirationRow> {
  const rows = new Map<string, InspirationRow>();
  const path = join(skillsDir, "_shared", "inspirations.md");
  if (!existsSync(path)) return rows;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\| \[([^\]]+)\]\(([^)]+)\) \|(.*)\|\s*$/.exec(line);
    if (!m) continue;
    const cells = (m[3] ?? "").split(" | ").map((cell) => cell.trim());
    const skills = (cells[3] ?? "").split(",").map((skill) => skill.trim()).filter(Boolean);
    rows.set(m[1] ?? "", { url: m[2] ?? "", skills });
  }
  return rows;
}
const inspirationRows = parseInspirations();

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!match) return undefined;
  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const kv = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line);
    if (kv?.[1]) meta[kv[1]] = (kv[2] ?? "").replace(/^["']|["']$/g, "").trim();
  }
  return { meta, body: match[2] ?? "" };
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return name.endsWith(".md") ? [path] : [];
  });
}

interface OpRef { source: string; op: string; file: string }

/** `source/operation` shorthand and ireland_call `"source": "x", "operation": "y"` arguments. */
function extractOpRefs(text: string, file: string): OpRef[] {
  const refs: OpRef[] = [];
  for (const m of text.matchAll(/`([a-z][a-z-]*)\/([a-z][a-z0-9_]*)`/g)) {
    refs.push({ source: m[1] ?? "", op: m[2] ?? "", file });
  }
  for (const m of text.matchAll(/"?source"?:\s*"([a-z][a-z-]*)"\s*,\s*"?operation"?:\s*"([a-z][a-z0-9_]*)"/g)) {
    refs.push({ source: m[1] ?? "", op: m[2] ?? "", file });
  }
  return refs;
}

/** Pre-lean-surface forms: dotted `source.op` refs and an `op` key (ireland_call takes `operation`). */
function legacyRefs(text: string): string[] {
  const dotted = [...text.matchAll(/`([a-z][a-z-]*)\.([a-z][a-z0-9_]*)`/g)]
    .filter((m) => ops.has(m[1] ?? "") || allOps.has(m[2] ?? ""))
    .map((m) => m[0]);
  const opKey = [...text.matchAll(/"?\bop"?:\s*"[a-z][a-z0-9_]*"/g)].map((m) => m[0]);
  return [...dotted, ...opKey];
}

interface StepExample { source: string; operation: string; raw: string; args: Record<string, unknown> }

/** "Call `source/operation` with `{...}`" step examples. Prose placeholders such as { "source", "operation" } are skipped. */
function stepExamples(markdown: string): StepExample[] {
  const text = markdown.replace(/\s*\r?\n\s*/g, " ");
  return [...text.matchAll(/`([a-z][a-z-]*)\/([a-z][a-z0-9_]*)` with `(\{[^`]*\})`/g)].flatMap(([, source = "", operation = "", raw = ""]) => {
    try {
      const args = JSON.parse(raw) as unknown;
      return args && typeof args === "object" && !Array.isArray(args) ? [{ source, operation, raw, args: args as Record<string, unknown> }] : [];
    } catch {
      return [];
    }
  });
}

function checkRef(ref: OpRef): void {
  expect(ops.has(ref.source), `${ref.file}: unknown source "${ref.source}" (op ${ref.op})`).toBe(true);
  expect(ops.get(ref.source)?.has(ref.op), `${ref.file}: source "${ref.source}" has no operation "${ref.op}"`).toBe(true);
}

describe("skills pack", () => {
  const folders = skillFolders();

  it("ships the civic-data skills", () => {
    for (const name of [
      "compare-two-areas", "where-to-live-shortlist", "local-election-brief", "oireachtas-tracker", "lobbying-watch",
      "council-budget-compare", "public-money-tracker", "eu-funding-finder", "pay-gap-compare", "planning-and-heritage-near-me",
      "transport-reliability-check", "safety-stats", "energy-and-grid-explainer", "housing-supply-tracker", "derelict-and-vacancy",
      "rights-check"
    ]) {
      expect(folders).toContain(name);
    }
  });

  it("ships the core skills", () => {
    for (const name of ["irish-area-report", "house-price-check", "td-briefing", "commute-weather", "grid-now", "flood-watch", "cso-chart"]) {
      expect(folders).toContain(name);
    }
    expect(existsSync(join(skillsDir, "_shared", "citations.md"))).toBe(true);
  });

  it.each(folders.map((name) => [name]))("%s has valid frontmatter", (name) => {
    const path = join(skillsDir, name, "SKILL.md");
    expect(existsSync(path), `${path} missing`).toBe(true);
    const parsed = parseFrontmatter(readFileSync(path, "utf8"));
    expect(parsed, "frontmatter missing").toBeDefined();
    const meta = parsed?.meta ?? {};
    expect(meta.name).toBe(name);
    expect(meta.name).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(meta.description?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(meta.description?.length ?? 0).toBeLessThanOrEqual(1024);
    expect(meta.license).toBe("MIT");
  });

  it.each(folders.map((name) => [name]))("%s only references real sources and ops", (name) => {
    const dir = join(skillsDir, name);
    const refs = markdownFiles(dir).flatMap((file) => extractOpRefs(readFileSync(file, "utf8"), file));
    expect(refs.length, "skill should reference at least one source/operation").toBeGreaterThan(0);
    refs.forEach(checkRef);
  });

  it.each(folders.map((name) => [name]))("%s calls ops through ireland_call on the lean surface", (name) => {
    const text = markdownFiles(join(skillsDir, name)).map((file) => readFileSync(file, "utf8")).join("\n");
    expect(text).toContain("ireland_call");
    expect(text).toContain("ireland_describe");
    expect(/"source":\s*"[a-z-]+",\s*"operation":/.test(text), "needs a full ireland_call argument example").toBe(true);
    expect(legacyRefs(text), "legacy source.op / op: references").toEqual([]);
  });

  it.each(folders.map((name) => [name]))("%s ireland_call example is accepted by the operation's input schema", (name) => {
    const text = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
    const examples = [...text.matchAll(/```json[ \t]*\r?\n([\s\S]*?)```/g)]
      .map((m) => m[1]?.trim() ?? "")
      .filter((block) => /"operation"\s*:/.test(block))
      .map((block) => JSON.parse(block) as { source: string; operation: string; args?: Record<string, unknown> });
    expect(examples, `${name}: expected exactly one ireland_call JSON example`).toHaveLength(1);
    const { source, operation, args = {} } = examples[0]!;
    const tool = toolsBySource.get(source)?.get(operation);
    expect(tool, `${name}: ${source}/${operation} does not exist`).toBeDefined();
    // strict(): a renamed or removed argument fails here instead of being silently dropped at call time.
    const parsed = z.object(tool!.inputSchema).strict().safeParse(args);
    expect(parsed.success, `${name}: ${source}/${operation} rejects ${JSON.stringify(args)}: ${parsed.error?.message ?? ""}`).toBe(true);
  });

  it.each(folders.map((name) => [name]))("%s step examples only use argument names the operation accepts", (name) => {
    for (const { source, operation, raw, args } of stepExamples(readFileSync(join(skillsDir, name, "SKILL.md"), "utf8"))) {
      const tool = toolsBySource.get(source)?.get(operation);
      expect(tool, `${name}: ${source}/${operation} does not exist`).toBeDefined();
      // Steps may leave out values from an earlier step or write "<placeholder>": check names, and types of concrete values.
      const entries = Object.entries(args);
      for (const [key] of entries) expect(Object.keys(tool!.inputSchema), `${name}: ${source}/${operation} has no argument "${key}"`).toContain(key);
      const concrete = Object.fromEntries(entries.filter(([, value]) => !(typeof value === "string" && /^<[^>]*>$/.test(value))));
      const parsed = z.object(tool!.inputSchema).partial().strict().safeParse(concrete);
      expect(parsed.success, `${name}: ${source}/${operation} rejects ${raw}: ${parsed.error?.message ?? ""}`).toBe(true);
    }
  });

  it("finds step examples to check", () => {
    const total = folders.reduce((n, name) => n + stepExamples(readFileSync(join(skillsDir, name, "SKILL.md"), "utf8")).length, 0);
    expect(total).toBeGreaterThanOrEqual(20);
  });

  it("the example check rejects stale argument names", () => {
    const tool = toolsBySource.get("ppr")?.get("ppr_price_stats");
    expect(z.object(tool!.inputSchema).strict().safeParse({ county: "Galway", town: "oranmore" }).success).toBe(false);
  });

  it.each(folders.map((name) => [name]))("%s only uses top-level tools that the default surface lists", (name) => {
    const text = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
    const typed = [...allOps].filter((op) => !META_TOOLS.includes(op));
    for (const m of text.matchAll(/`([a-z][a-z0-9_]*)\s*[({]/g)) {
      expect(typed, `${name}: call typed tool ${m[1]} via ireland_call`).not.toContain(m[1]);
    }
  });

  it.each(folders.map((name) => [name]))("%s only names ireland_* tools that exist", (name) => {
    const text = markdownFiles(join(skillsDir, name)).map((file) => readFileSync(file, "utf8")).join("\n");
    for (const m of text.matchAll(/`(ireland_[a-z0-9_]+)\b/g)) {
      expect([...META_TOOLS, ...allOps], `${name}: unknown tool ${m[1]}`).toContain(m[1]);
    }
  });

  it.each(folders.map((name) => [name]))("%s does not depend on opt-in beta sources", (name) => {
    const text = markdownFiles(join(skillsDir, name)).map((file) => readFileSync(file, "utf8")).join("\n");
    for (const id of BETA_SOURCES) {
      expect(text, `${name} names beta source ${id}`).not.toMatch(new RegExp(`\`${id}/|"source":\\s*"${id}"`));
    }
    expect(text).not.toMatch(/\b(citizens_info|irish_legal)_[a-z_]+/);
  });

  it.each(folders.map((name) => [name]))("%s credits related projects consistently with inspirations.md", (name) => {
    const text = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
    const match = /^\*\*Related projects:\*\* ([\s\S]*?)(?:\r?\n\r?\n|(?![\s\S]))/m.exec(text);
    expect(match, `${name}: missing "**Related projects:**" line`).not.toBeNull();
    const line = (match?.[1] ?? "").replace(/\s+/g, " ");
    const links = [...line.matchAll(/\[([^\]]+)\]\((https:\/\/[^)]+)\)/g)].filter((m) => !(m[2] ?? "").includes("inspirations.md"));
    if (links.length === 0) {
      expect(line, `${name}: no project links, so the line must start with "None"`).toMatch(/^None/);
      return;
    }
    expect(line).toContain("Not affiliated");
    for (const [, project, url] of links) {
      const row = inspirationRows.get(project ?? "");
      expect(row, `${name}: "${project}" is not a row in _shared/inspirations.md`).toBeDefined();
      expect(row?.url).toBe(url);
      expect(row?.skills, `${name}: inspirations.md row "${project}" does not list this skill`).toContain(name);
    }
  });

  it("inspirations.md rows link https sites and name real skills that credit them back", () => {
    expect(inspirationRows.size).toBeGreaterThanOrEqual(10);
    for (const [project, row] of inspirationRows) {
      expect(row.url, project).toMatch(/^https:\/\//);
      for (const skill of row.skills) {
        expect(folders, `${project}: unknown skill ${skill}`).toContain(skill);
        expect(readFileSync(join(skillsDir, skill, "SKILL.md"), "utf8"), `${skill} should credit ${project}`).toContain(`[${project}](${row.url})`);
      }
    }
  });

  it("docs/plugins.md lists exactly the shipped skills", () => {
    const docs = readFileSync(join(root, "docs", "plugins.md"), "utf8");
    const listed = [...docs.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]).sort();
    expect(listed).toEqual(folders);
  });

  it("shared references only name real ops", () => {
    for (const file of markdownFiles(join(skillsDir, "_shared"))) {
      extractOpRefs(readFileSync(file, "utf8"), file).forEach(checkRef);
    }
  });

  it("op extractor catches bad references", () => {
    const refs = extractOpRefs('Use `ppr/ppr_nope` and ireland_call { "source": "nope", "operation": "cso_get_data" }', "x");
    expect(refs).toEqual([
      { source: "ppr", op: "ppr_nope", file: "x" },
      { source: "nope", op: "cso_get_data", file: "x" }
    ]);
    expect(ops.get("ppr")?.has("ppr_nope")).toBe(false);
    expect(ops.has("nope")).toBe(false);
    expect(legacyRefs('`ppr.ppr_price_stats` and { source: "cso", op: "cso_get_data" }')).toHaveLength(2);
    expect(ops.get("cross")?.has("ireland_snapshot")).toBe(true);
  });
});

describe("plugin manifests", () => {
  const readJson = (rel: string): Record<string, unknown> => JSON.parse(readFileSync(join(root, rel), "utf8")) as Record<string, unknown>;
  const liveUrl = /^https:\/\/[a-z0-9.-]+\/mcp$/;

  it("Claude Code plugin manifest is valid", () => {
    const plugin = readJson(".claude-plugin/plugin.json");
    expect(plugin.name).toMatch(/^[a-z0-9-]+$/);
    expect(typeof plugin.version).toBe("string");
    for (const key of ["skills", "mcpServers"] as const) {
      const value = plugin[key];
      if (typeof value === "string") expect(existsSync(join(root, value)), `${key}: ${value}`).toBe(true);
    }
  });

  it("marketplace lists the plugin with an existing relative source", () => {
    const market = readJson(".claude-plugin/marketplace.json");
    const plugin = readJson(".claude-plugin/plugin.json");
    expect(market.name).toMatch(/^[a-zA-Z0-9._-]+$/);
    expect((market.owner as { name?: string }).name).toBeTruthy();
    const plugins = market.plugins as { name: string; source: string }[];
    expect(plugins.map((p) => p.name)).toContain(plugin.name);
    for (const entry of plugins) {
      expect(entry.source.startsWith("./")).toBe(true);
      expect(entry.source.includes("..")).toBe(false);
      expect(existsSync(join(root, entry.source, ".claude-plugin", "plugin.json"))).toBe(true);
    }
  });

  it("Agent Plugins root manifest uses only spec fields", () => {
    const plugin = readJson("plugin.json");
    const allowed = ["$schema", "name", "version", "description", "author", "homepage", "repository", "license", "keywords", "extensions"];
    for (const key of Object.keys(plugin)) expect(allowed).toContain(key);
    expect(plugin.name).toMatch(/^[a-z0-9.-]{1,64}$/);
    expect(plugin.name).toBe(readJson(".claude-plugin/plugin.json").name);
  });

  it("MCP configs point at the live server", () => {
    const claude = readJson(".mcp.json") as { mcpServers: Record<string, { type: string; url: string }> };
    expect(claude.mcpServers.ireland?.type).toBe("http");
    expect(claude.mcpServers.ireland?.url).toMatch(liveUrl);
    const spec = readJson("mcp.json") as { mcpServers: Record<string, { type: string; url: string }> };
    expect(spec.mcpServers.ireland?.type).toBe("streamable-http");
    expect(spec.mcpServers.ireland?.url).toBe(claude.mcpServers.ireland?.url);
  });

  it("plugin versions agree across manifests", () => {
    const { name, version } = readJson("plugin.json");
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(readJson(".claude-plugin/plugin.json").version).toBe(version);
    const market = readJson(".claude-plugin/marketplace.json") as { plugins: { name: string; version?: string }[] };
    expect(market.plugins.find((p) => p.name === name)?.version).toBe(version);
  });

  it("install docs exist", () => {
    expect(existsSync(join(root, "docs", "plugins.md"))).toBe(true);
  });
});
