import { describe, expect, it } from "vitest";
import { fakeFetch, parseToolText } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { connectClient } from "../../../test/helpers/mcpClient.js";
import { createContext } from "../../gateway/context.js";
import { createAppServer } from "../../registry.js";
import { tedModule as mod } from "./index.js";

const f = (name: string) => fixturePath(import.meta.url, name);

describe("TED module", () => {
  it("searches Irish TED tenders and normalises notices with paging links", async () => {
    const fetch = fakeFetch([{ match: /api\.ted\.europa\.eu\/v3\/notices\/search/, file: f("search-bicycle.json") }]);
    const { ok, body } = await callTool<any>(mod, "ted_search_tenders", { text: "bicycle", limit: 2 }, fetch); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(ok).toBe(true);
    expect(body.data.tenders[0]).toMatchObject({
      id: "646747-2026",
      title: expect.stringContaining("Bike Share Scheme"),
      buyer: "Dublin City Council",
      value: { amount: null, currency: "EUR" },
      links: { html: "https://ted.europa.eu/en/notice/-/detail/646747-2026" }
    });
    expect(body.data.total).toBeGreaterThan(2);
    expect(body.data.next_cursor).toBe("2");
    const request = JSON.parse(String(fetch.calls[0]?.init?.body));
    expect(request.query).toContain("buyer-country=IRL");
    expect(request.query).toContain('FT~"bicycle"');
  });

  it("escapes free text so TED expert-query operators cannot be injected", async () => {
    const fetch = fakeFetch([{ match: /api\.ted\.europa\.eu\/v3\/notices\/search/, body: '{"notices":[],"totalNoticeCount":0}' }]);
    await callTool(mod, "ted_search_tenders", { text: 'roads" OR buyer-country=DEU', buyer: "Dublin City Council" }, fetch);
    const request = JSON.parse(String(fetch.calls[0]?.init?.body));
    expect(request.query).toContain("buyer-country=IRL");
    expect(request.query).toContain('FT~"roads OR buyer-country=DEU"');
    expect(request.query).toContain('buyer-name~"Dublin City Council"');
  });

  it("gets a notice by id through the keyless search endpoint", async () => {
    const fetch = fakeFetch([{ match: /api\.ted\.europa\.eu\/v3\/notices\/search/, file: f("search-bicycle.json") }]);
    const { ok, body } = await callTool<any>(mod, "ted_get_notice", { id: "646747-2026" }, fetch); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(ok).toBe(true);
    expect(body.data.notice.id).toBe("646747-2026");
    const request = JSON.parse(String(fetch.calls[0]?.init?.body));
    expect(request.query).toBe("buyer-country=IRL AND publication-number=646747-2026");
  });

  it("is callable through ireland_call at the server surface", async () => {
    const ctx = createContext({ fetch: fakeFetch([{ match: /api\.ted\.europa\.eu\/v3\/notices\/search/, file: f("search-bicycle.json") }]) });
    const client = await connectClient(createAppServer(ctx));
    const result = await client.callTool({ name: "ireland_call", arguments: { source: "ted", operation: "ted_search_tenders", args: { text: "bicycle", limit: 1 } } });
    expect(result.isError).toBeFalsy();
    const body = parseToolText<any>(result as { content: Array<{ type: string; text?: string }> }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.operation).toBe("ted_search_tenders");
    expect(body.data.tenders[0].id).toBe("646747-2026");
    await client.close();
  });
});
