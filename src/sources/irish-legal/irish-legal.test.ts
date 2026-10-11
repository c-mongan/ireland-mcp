import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext } from "../../gateway/context.js";
import { FileBackend, createRepository } from "../../../packages/irish-legal-mcp/src/store.mjs";
import { parseSource } from "../../../packages/irish-legal-mcp/src/sources.mjs";
import { createService } from "../../../packages/irish-legal-mcp/src/service.mjs";
import { createLegalModules } from "./index.js";

describe("Irish legal gateway integration", () => {
  it("exposes corpus tools and cross-source search/fetch with exact provenance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "irish-legal-gateway-"));
    try {
      const repository = createRepository(new FileBackend(directory));
      await repository.commit(parseSource({ source: "citizens-info", url: "https://www.citizensinformation.ie/en/employment/annual-leave/",
        body: "<main><h1>Annual leave</h1><p>Employees have an entitlement to paid annual leave.</p></main>", fetchedAt: "2026-10-11T10:00:00.000Z" }), "raw");
      const modules = createLegalModules(() => createService(repository));
      const citizens = modules.find(module => module.info.id === "citizens-info")!;
      const ctx = createContext();
      const hits = await citizens.search!("annual leave", 10, ctx);
      expect(hits[0]!.id).toBe("citizens-info:/en/employment/annual-leave/");
      const fetched = await citizens.fetchById!("/en/employment/annual-leave/", ctx);
      expect(fetched.text).toContain("paid annual leave");
      expect(fetched.metadata.source_fetched_at).toBe("2026-10-11T10:00:00.000Z");
      const tool = citizens.tools.find(tool => tool.name === "citizens_info_search")!;
      const result = await tool.handler({ query: "annual leave" }, ctx) as { data: { hits: unknown[] } };
      expect(result.data.hits).toHaveLength(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
