import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createContext } from "../../gateway/context.js";
import { ToolError, toToolError } from "../../gateway/errors.js";
import { createWebHandler } from "../../../packages/irish-legal-mcp/src/server.mjs";
import { TOOLS } from "../../../packages/irish-legal-mcp/src/service.mjs";
import type { CoreService } from "../../../packages/irish-legal-mcp/src/types.mjs";
import { createLegalModules } from "./index.js";

describe("Irish legal gateway review regressions", () => {
  for (const source of ["irish-legal", "citizens-info"]) {
    for (const [message, code] of [
      ["NOT_FOUND: document is not indexed.", "NOT_FOUND"],
      ["BAD_ARGS: invalid document identity.", "BAD_ARGS"],
      ["HISTORICAL_UNAVAILABLE: requested publisher version is unavailable.", "NOT_FOUND"],
      ["Storage credentials rejected.", "UPSTREAM_DOWN"]
    ] as const) {
      it(`${source} cross-source fetch uses the direct tool error mapping for ${message.split(":")[0]}`, async () => {
        const service: CoreService = { tools: TOOLS, async call() { throw new Error(message); } };
        const module = createLegalModules(() => service).find(module => module.info.id === source)!;
        const ctx = createContext();
        const direct = module.tools.find(tool => tool.name === (source === "irish-legal" ? "irish_legal_fetch" : "citizens_info_get_article"))!;
        const errors = await Promise.all([
          direct.handler({ id: "missing" }, ctx).catch(error => error),
          module.fetchById!("missing", ctx).catch(error => error)
        ]);
        for (const error of errors) {
          expect(error).toBeInstanceOf(ToolError);
          expect(toToolError(error).code).toBe(code);
        }
        expect(errors[1].message).toBe(errors[0].message);
      });
    }
  }

  it("preserves property descriptions in required and optional public input schemas", () => {
    const tools = createLegalModules().flatMap(module => module.tools);
    for (const definition of TOOLS) {
      const tool = tools.find(tool => tool.name === definition.name)!;
      const schema = z.toJSONSchema(z.object(tool.inputSchema)) as { properties: Record<string, { description?: string }> };
      for (const [key, rule] of Object.entries(definition.inputSchema.properties)) {
        if (rule.description) expect(schema.properties[key]!.description).toBe(rule.description);
      }
    }
  });

  it("accepts the documented web handler body limit option", async () => {
    const service: CoreService = { tools: TOOLS, async call() { return {}; } };
    const response = await createWebHandler(service, { maxBodyBytes: 1 })(new Request("http://127.0.0.1/mcp", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}"
    }));
    expect(response.status).toBe(413);
  });
});
