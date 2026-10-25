import { z } from "zod";
import { DAY } from "../../gateway/context.js";
import { envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import type { ToolContext } from "../../gateway/module.js";

const text = z.object({ value: z.string() });
const statement = z.object({
  rank: z.enum(["preferred", "normal", "deprecated"]),
  mainsnak: z.object({ snaktype: z.enum(["value", "somevalue", "novalue"]), datavalue: z.object({ value: z.unknown() }).optional() })
});
const entitySchema = z.object({
  id: z.string(), missing: z.string().optional(),
  labels: z.record(z.string(), text).optional(),
  descriptions: z.record(z.string(), text).optional(),
  claims: z.record(z.string(), z.array(statement)).optional()
});
const responseSchema = z.object({ entities: z.record(z.string(), entitySchema) });
type Entity = z.infer<typeof entitySchema>;

// Match truthy wdt: semantics: preferred rank wins, deprecated statements never do.
function claim(entity: Entity, property: string): unknown {
  const statements = entity.claims?.[property] ?? [];
  const rank = statements.some(s => s.rank === "preferred") ? "preferred" : "normal";
  return statements.find(s => s.rank === rank && s.mainsnak.snaktype === "value")?.mainsnak.datavalue?.value;
}

async function entities(ctx: ToolContext, ids: string[], props: string) {
  const url = `https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: "wbgetentities", ids: ids.join("|"), props, languages: "en|ga", format: "json" })}`;
  const validate = (value: unknown) => {
    const parsed = responseSchema.safeParse(value);
    if (!parsed.success || ids.some(id => parsed.data.entities[id]?.id !== id)) {
      throw new ToolError("UPSTREAM_DOWN", "Wikidata returned an unexpected entity response.");
    }
    return parsed.data;
  };
  const result = await ctx.cachedJson<unknown>(url, 7 * DAY, {
    label: "Wikidata entity API", timeoutMs: 6_000, retries: 0, maxBytes: 1_500_000,
    headers: { accept: "application/json", "user-agent": "ireland-mcp/1.0 (templated Irish public-data lookup; https://github.com/c-mongan/ireland-mcp)" }, validate
  });
  return { ...result, value: validate(result.value), url };
}

const qidValue = z.object({ id: z.string().regex(/^Q\d+$/) });
const amountValue = z.object({ amount: z.string().regex(/^\+?\d+(?:\.\d+)?$/) });
const pointValue = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), globe: z.literal("http://www.wikidata.org/entity/Q2") });

/** QID lookup does not need the separate SPARQL service, which can be unavailable while the entity API is healthy. */
export async function entitySummary(ctx: ToolContext, qid: string, info: SourceInfo) {
  const result = await entities(ctx, [qid], "labels|descriptions|claims");
  const entity = result.value.entities[qid]!;
  if (entity.missing !== undefined) throw new ToolError("NOT_FOUND", `No Wikidata entity ${qid} was returned.`);
  const instance = qidValue.safeParse(claim(entity, "P31")).data?.id;
  const country = qidValue.safeParse(claim(entity, "P17")).data?.id;
  const ids = [...new Set([instance, country].filter((id): id is string => !!id))];
  const labels = ids.length ? await entities(ctx, ids, "labels") : undefined;
  const label = (id: string | undefined) => id ? labels?.value.entities[id]?.labels?.en?.value ?? id : null;
  const amount = amountValue.safeParse(claim(entity, "P1082")).data?.amount;
  const population = amount === undefined ? null : Number(amount);
  const point = pointValue.safeParse(claim(entity, "P625")).data;
  const website = claim(entity, "P856");
  return envelope({ ...info, name: "Wikidata" }, {
    data: {
      qid, label: entity.labels?.en?.value ?? qid, description: entity.descriptions?.en?.value ?? null,
      irish_name: entity.labels?.ga?.value ?? null, instance_of: label(instance), country: label(country),
      population: population !== null && Number.isFinite(population) ? population : null,
      coordinates: point ? { lat: point.latitude, lon: point.longitude } : null,
      website: typeof website === "string" ? website : null, url: `https://www.wikidata.org/wiki/${qid}`
    },
    url: result.url, cached: result.cached && (labels?.cached ?? true),
    stale: result.stale || (labels?.stale ?? false), truncated: false
  });
}
