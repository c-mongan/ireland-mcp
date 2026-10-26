import { z } from "zod";
import { envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule, type FetchedDocument } from "../../gateway/module.js";
import { createService, TOOLS } from "../../../packages/irish-legal-mcp/src/service.mjs";
import type { CoreService, CoreDocument, SchemaRule } from "../../../packages/irish-legal-mcp/src/types.mjs";
import { legalRepositoryFromEnv } from "./backend.js";
import { citizensInfoCard, irishLegalCard } from "./card.js";

const legalInfo: SourceInfo = { id: "irish-legal", name: "Irish legal evidence corpus", homepage: "https://www.irishstatutebook.ie",
  licence: "Per-document source licence; see citation metadata", attribution: "Irish Statute Book, Citizens Information Board and permitted source publishers; attribution accompanies each document." };
const citizenInfo: SourceInfo = { id: "citizens-info", name: "Citizens Information", homepage: "https://www.citizensinformation.ie",
  licence: "CC BY 4.0; third-party material excluded", attribution: "Citizens Information Board." };

function shape(rule: SchemaRule): z.ZodType {
  if (rule.type === "integer") return z.number().int().min(rule.minimum ?? 0).max(rule.maximum ?? Number.MAX_SAFE_INTEGER);
  if (rule.enum) return z.enum(rule.enum as [string, ...string[]]);
  let value = z.string();
  if (rule.minLength) value = value.min(rule.minLength);
  if (rule.maxLength) value = value.max(rule.maxLength);
  if (rule.pattern) value = value.regex(new RegExp(rule.pattern));
  return value;
}
const defaultService = () => createService(legalRepositoryFromEnv());

function legalToolError(error: unknown): ToolError {
  const message = error instanceof Error ? error.message : "Evidence lookup failed.";
  if (/^BAD_ARGS:/.test(message)) return new ToolError("BAD_ARGS", message);
  if (/^NOT_FOUND:|^HISTORICAL_UNAVAILABLE:/.test(message)) return new ToolError("NOT_FOUND", message);
  return new ToolError("UPSTREAM_DOWN", "Stored legal evidence is temporarily unavailable.");
}

export function createLegalModules(getService: () => CoreService = defaultService): SourceModule[] {
  return [legalInfo, citizenInfo].map(info => {
    const citizen = info.id === "citizens-info";
    const tools = TOOLS.filter(tool => tool.name.startsWith(citizen ? "citizens_info_" : "irish_legal_")).map(tool => defineTool({
      name: tool.name, title: tool.name.replace(/_/g, " "), description: tool.description,
      inputSchema: Object.fromEntries(Object.entries(tool.inputSchema.properties).map(([key, rule]) => {
        const field = tool.inputSchema.required.includes(key) ? shape(rule) : shape(rule).optional();
        return [key, rule.description ? field.describe(rule.description) : field];
      })),
      handler: async (args, ctx) => {
        try {
          const result = await getService().call(tool.name, args);
          return envelope(info, { data: result, url: info.homepage, retrievedAt: ctx.now() });
        } catch (error) {
          throw legalToolError(error);
        }
      }
    }));
    return {
      info, tools, domain: "law/politics", card: citizen ? citizensInfoCard : irishLegalCard,
      summary: citizen ? "Indexed Citizens Information guidance, with source dates and attribution." : "Versioned legal provisions, source snapshots, amendment evidence and cited research.",
      coverage: "Coverage is limited to ingested pages. Run legal source sync; enacted text and consolidation cutoffs do not certify current law.",
      async search(query, limit) {
        const result = await getService().call(citizen ? "citizens_info_search" : "irish_legal_search", { query, limit, ...(!citizen ? { source_type: "legislation" } : {}) });
        return (result.hits as CoreDocument[]).map(doc => ({ id: citizen ? doc.id : `irish-legal:${doc.id}`, title: doc.title, url: doc.canonical_url }));
      },
      async fetchById(key): Promise<FetchedDocument> {
        try {
          const doc = await getService().call(citizen ? "citizens_info_get_article" : "irish_legal_fetch", { id: citizen ? `citizens-info:${key}` : key }) as CoreDocument;
          const { id, title, text, canonical_url, ...metadata } = doc;
          return { id: citizen ? id : `irish-legal:${id}`, title, text, url: canonical_url, metadata };
        } catch (error) {
          throw legalToolError(error);
        }
      }
    };
  });
}
