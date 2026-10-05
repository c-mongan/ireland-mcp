import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { appModules } from "../src/registry.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(root, "skills");

// ireland_call dispatches to these (source -> operation) pairs; "cross" holds nearby, ireland_snapshot, list_sources.
const ops = new Map<string, Set<string>>();
for (const mod of appModules().modules) ops.set(mod.info.id, new Set(mod.tools.map((tool) => tool.name)));
const allOps = new Set([...ops.values()].flatMap((set) => [...set]));
const META_TOOLS = ["ireland_catalogue", "ireland_describe", "ireland_call", "ireland_about", "search", "fetch", "nearby"];

function skillFolders(): string[] {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .filter((name) => !name.startsWith("_") && !name.startsWith("."))
    .filter((name) => statSync(join(skillsDir, name)).isDirectory())
    .sort();
}

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

function checkRef(ref: OpRef): void {
  expect(ops.has(ref.source), `${ref.file}: unknown source "${ref.source}" (op ${ref.op})`).toBe(true);
  expect(ops.get(ref.source)?.has(ref.op), `${ref.file}: source "${ref.source}" has no operation "${ref.op}"`).toBe(true);
}

describe("skills pack", () => {
  const folders = skillFolders();

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

  it.each(folders.map((name) => [name]))("%s only uses top-level tools that the default surface lists", (name) => {
    const text = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
    const typed = [...allOps].filter((op) => !META_TOOLS.includes(op));
    for (const m of text.matchAll(/`([a-z][a-z0-9_]*)\s*[({]/g)) {
      expect(typed, `${name}: call typed tool ${m[1]} via ireland_call`).not.toContain(m[1]);
    }
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

  it("install docs exist", () => {
    expect(existsSync(join(root, "docs", "plugins.md"))).toBe(true);
  });
});
