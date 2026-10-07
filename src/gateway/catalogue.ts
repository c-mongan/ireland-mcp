import { z } from "zod";
import { DOMAINS, type AnyTool, type SourceModule } from "./module.js";

export { DOMAINS };

export interface Operation {
  tool: AnyTool;
  source: string;
}

/** Every typed tool of every source becomes an ireland_call operation, keyed by its tool name. */
export function listOperations(modules: readonly SourceModule[]): Operation[] {
  return modules.flatMap((m) => m.tools.map((tool) => ({ tool, source: m.info.id })));
}

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  examples?: unknown[];
  description?: string;
  minimum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  minItems?: number;
  anyOf?: JsonSchema[];
  [key: string]: unknown;
};

const schemaCache = new WeakMap<AnyTool, JsonSchema>();

/** JSON Schema of an operation's arguments (draft 2020-12 without the `$schema` key). */
export function operationSchema(tool: AnyTool): JsonSchema {
  let schema = schemaCache.get(tool);
  if (!schema) {
    schema = z.toJSONSchema(z.object(tool.inputSchema), { io: "input", unrepresentable: "any" }) as JsonSchema;
    delete schema.$schema;
    schemaCache.set(tool, schema);
  }
  return schema;
}

/** Pulls the first sample out of a description like "e.g. 'Galway'" or "e.g. 53.35". */
function hintFromDescription(description: string | undefined, type: string | undefined): unknown {
  if (!description) return undefined;
  const m = /e\.g\.?\s*(?:'([^']+)'|"([^"]+)"|(-?\d+(?:\.\d+)?))/i.exec(description);
  if (!m) return undefined;
  if (m[3] !== undefined) return type === "string" ? m[3] : Number(m[3]);
  const str = m[1] ?? m[2]!;
  if (type === "number" || type === "integer") return Number.isFinite(Number(str)) ? Number(str) : undefined;
  return str;
}

function sampleFor(schema: JsonSchema): unknown {
  if (schema.examples?.length) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.anyOf?.length) return sampleFor({ ...schema.anyOf[0], description: schema.description });
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  const hinted = hintFromDescription(schema.description, type);
  if (hinted !== undefined) return type === "array" ? [hinted] : hinted;
  switch (type) {
    case "integer":
    case "number":
      return schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : 1);
    case "boolean":
      return false;
    case "array":
      return schema.items ? [sampleFor(schema.items)] : [];
    case "object":
      return requiredSample(schema);
    default:
      return "example".padEnd(schema.minLength ?? 0, "x");
  }
}

function requiredSample(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of schema.required ?? []) {
    const prop = schema.properties?.[key];
    if (prop) out[key] = sampleFor(prop);
  }
  return out;
}

/**
 * Example arguments for an operation: the tool's own `example`, otherwise the required fields
 * filled from schema examples, defaults, enums or "e.g." hints in the field descriptions.
 */
export function exampleArgs(tool: AnyTool): Record<string, unknown> {
  return tool.example ?? requiredSample(operationSchema(tool));
}

/** One-line description: the first sentence of the tool description, capped. */
export function shortDescription(text: string, max = 160): string {
  const first = /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

/** Bounded lexical discovery; schemas are fetched only for the selected operation. */
export function discoverOperations(modules: readonly SourceModule[], query: string, limit: number) {
  const tokens = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const terms = [...tokens(query)];
  const matches = modules.flatMap((module) => module.tools.map((tool) => {
    const name = tokens(tool.name.replaceAll("_", " "));
    const text = tokens(`${tool.title} ${tool.description}`);
    const context = tokens(`${module.info.id} ${module.info.name} ${module.summary}`);
    const score = terms.reduce((sum, term) => sum + (name.has(term) ? 4 : 0) + (text.has(term) ? 2 : 0) + (context.has(term) ? 1 : 0), 0);
    return { score, source: module.info.id, operation: tool.name, title: tool.title, description: shortDescription(tool.description) };
  })).filter((op) => op.score > 0).sort((a, b) => b.score - a.score || a.source.localeCompare(b.source) || a.operation.localeCompare(b.operation));
  return { operations: matches.slice(0, limit).map((op) => ({ source: op.source, operation: op.operation, title: op.title, description: op.description })), total: matches.length, truncated: matches.length > limit,
    next: "ireland_describe(source, operation) for arguments, then ireland_call." };
}
