import { describe, expect, it } from "vitest";
import { createContext } from "../../gateway/context.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { fakeFetch } from "../../../test/helpers/fakeFetch.js";
import { worldBankModule } from "./index.js";

type IndicatorBody = { data: { observations: Array<{ indicator: string; country: string; year: string; value: number }> } };
type ProfileBody = { data: { indicators: unknown[] } };
const fx = (name: string) => fixturePath(import.meta.url, name);

describe("world-bank", () => {
  it("gets recent Ireland indicator observations", async () => {
    const fetch = fakeFetch([{ match: /country\/IRL\/indicator\/SP\.POP\.TOTL/, file: fx("population-irl.json") }]);
    const result = await callTool<IndicatorBody>(worldBankModule, "worldbank_get_indicator", { indicator: "SP.POP.TOTL", last: 5 }, fetch);
    expect(result.ok).toBe(true);
    expect(result.body.data.observations[0]).toMatchObject({ indicator: "SP.POP.TOTL", country: "IRL", year: "2025", value: 5484367 });
  });

  it("builds a compact Ireland profile from curated indicators", async () => {
    const fetch = fakeFetch([
      { match: /SP\.POP\.TOTL/, file: fx("population-irl.json") },
      { match: /NY\.GDP\.MKTP\.CD/, file: fx("gdp-irl.json") },
      { match: /NY\.GDP\.PCAP\.CD/, file: fx("gdp-irl.json") },
      { match: /SL\.UEM\.TOTL\.ZS/, file: fx("gdp-irl.json") },
      { match: /FP\.CPI\.TOTL\.ZG/, file: fx("gdp-irl.json") },
      { match: /EN\.ATM\.CO2E\.PC/, file: fx("gdp-irl.json") }
    ]);
    const ctx = createContext({ fetch });
    const result = await callTool<ProfileBody>(worldBankModule, "worldbank_ireland_profile", { last: 1 }, ctx);
    expect(result.ok).toBe(true);
    expect(result.body.data.indicators).toHaveLength(6);
  });
});
