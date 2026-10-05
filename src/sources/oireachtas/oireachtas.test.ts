import { describe, expect, it } from "vitest";
import { createContext } from "../../gateway/context.js";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { oireachtasModule as mod } from "./index.js";

const f = (name: string) => fixturePath(import.meta.url, name);
const routes: Route[] = [
  { match: /\/members\?chamber=dail&house_no=34/, file: f("members-dail34.json") },
  { match: /\/legislation\?bill_year=2099/, body: '{"head":{"counts":{"billCount":0,"resultCount":0}},"results":[]}' },
  { match: /\/legislation/, file: f("legislation.json") },
  { match: /\/debates/, file: f("debates.json") },
  { match: /\/questions/, file: f("questions.json") },
  { match: /\/divisions/, file: f("votes.json") }
];

describe("Oireachtas module", () => {
  it("finds members by accent-insensitive name, party and constituency", async () => {
    const fetch = fakeFetch(routes);
    const byName = await callTool(mod, "oireachtas_search_members", { name: "micheal" }, fetch);
    expect(byName.body.data.members).toHaveLength(1);
    expect(byName.body.data.members[0]).toMatchObject({ name: "Micheál Martin", party: "Fianna Fáil" });
    const byParty = await callTool(mod, "oireachtas_search_members", { party: "labour" }, fetch);
    expect(byParty.body.data.members.map((m: { name: string }) => m.name)).toEqual(["Ciarán Ahern", "Ivana Bacik"]);
    const harris = await callTool(mod, "oireachtas_search_members", { constituency: "Wicklow" }, fetch);
    expect(harris.body.data.members[0].member_code).toBe("Simon-Harris.D.2011-03-09");
    expect(harris.body.licence).toContain("Oireachtas");
  });

  it("searches bills by title words with summarised stages", async () => {
    const { body } = await callTool(mod, "oireachtas_search_bills", { query: "tobacco" }, fakeFetch(routes));
    expect(body.data.bills).toHaveLength(1);
    expect(body.data.bills[0]).toMatchObject({ title: expect.stringContaining("Smokefree Generation"), url: expect.stringContaining("oireachtas.ie/en/bills/bill/") });
    expect(body.data.bills[0].long_title).not.toContain("<p>");
  });

  it("never asks the API for more than 250 bills, which would exceed the response bound", async () => {
    const fetch = fakeFetch(routes);
    await callTool(mod, "oireachtas_search_bills", { query: "tobacco" }, fetch);
    await callTool(mod, "oireachtas_search_bills", { limit: 500 }, fetch);
    const limits = fetch.calls.map((c) => Number(new URL(c.url).searchParams.get("limit")));
    expect(limits.length).toBeGreaterThan(0);
    expect(Math.max(...limits)).toBeLessThanOrEqual(250);
  });

  it("lists bills without a query and reports truncation against the total", async () => {
    const { body } = await callTool(mod, "oireachtas_search_bills", { limit: 2 }, fakeFetch(routes));
    expect(body.data.bills).toHaveLength(2);
    expect(body.truncated).toBe(true);
    const empty = await callTool(mod, "oireachtas_search_bills", { year: "2099" }, fakeFetch(routes));
    expect(empty.body.data.bills).toEqual([]);
  });

  it("summarises debates, questions and votes", async () => {
    const fetch = fakeFetch(routes);
    const debates = await callTool(mod, "oireachtas_get_debates", { limit: 2, max_sections: 2 }, fetch);
    expect(debates.body.data.days[0]).toMatchObject({ date: "2026-10-01", total_topics: 4 });
    expect(debates.body.data.days[0].topics).toHaveLength(2);
    const questions = await callTool(mod, "oireachtas_search_questions", { member_code: "Simon-Harris.D.2011-03-09", limit: 2 }, fetch);
    expect(questions.body.data.questions[0]).toMatchObject({ type: "oral", asked_by: "Donnchadh Ó Laoghaire" });
    expect(fetch.calls.at(-1)?.url).toContain("member_id=https%3A%2F%2Fdata.oireachtas.ie");
    const votes = await callTool(mod, "oireachtas_get_votes", { date_from: "2026-09-01", limit: 2 }, fetch);
    expect(votes.body.data.votes[0]).toMatchObject({ outcome: "Lost", ta: 65 });
    expect(fetch.calls.at(-1)?.url).toContain("date_start=2026-09-01");
  });

  it("rejects malformed dates", async () => {
    const { ok, body } = await callTool(mod, "oireachtas_get_votes", { date_from: "last week" }, fakeFetch(routes));
    expect(ok).toBe(false);
    expect(body.error.code).toBe("BAD_ARGS");
  });

  it("supports cross-source search and fetch for bills and members", async () => {
    const ctx = createContext({ fetch: fakeFetch(routes) });
    const hits = await mod.search!("smokefree tobacco", 5, ctx);
    expect(hits[0]?.id).toMatch(/^oireachtas:bill\/2026\/\d+$/);
    const people = await mod.search!("Bacik", 5, ctx);
    expect(people[0]?.id).toBe("oireachtas:member/Ivana-Bacik.S.2007-07-23");
    const doc = await mod.fetchById!("member/Simon-Harris.D.2011-03-09", ctx);
    expect(doc.text).toContain("Fine Gael");
    const bill = await mod.fetchById!(hits[0]!.id.replace("oireachtas:", ""), ctx);
    expect(bill.text).toContain("Status:");
    await expect(mod.fetchById!("nonsense", ctx)).rejects.toThrow("Unknown Oireachtas id");
  });
});
