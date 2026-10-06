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
    const fetch = fakeFetch([{ match: /data360\/data\?.*INDICATOR=WB_WDI_SP_POP_TOTL/, file: fx("population-irl.json") }]);
    const result = await callTool<IndicatorBody>(worldBankModule, "worldbank_get_indicator", { indicator: "SP.POP.TOTL", last: 5 }, fetch);
    expect(result.ok).toBe(true);
    expect(result.body.data.observations[0]).toMatchObject({ indicator: "SP.POP.TOTL", country: "IRL", year: "2025", value: 5484367 });
    expect(fetch.calls[0]?.url).toContain("DATABASE_ID=WB_WDI");
    expect(fetch.calls[0]?.url).toContain("top=200");
  });

  it("builds a compact Ireland profile from curated indicators", async () => {
    const fetch = fakeFetch([
      { match: /WB_WDI_SP_POP_TOTL/, file: fx("population-irl.json") },
      { match: /WB_WDI_NY_GDP_MKTP_CD/, file: fx("gdp-irl.json") },
      { match: /WB_WDI_NY_GDP_PCAP_CD/, file: fx("gdp-irl.json") },
      { match: /WB_WDI_SL_UEM_TOTL_ZS/, file: fx("gdp-irl.json") },
      { match: /WB_WDI_FP_CPI_TOTL_ZG/, file: fx("gdp-irl.json") },
      { match: /WB_WDI_EN_ATM_CO2E_PC/, file: fx("gdp-irl.json") }
    ]);
    const ctx = createContext({ fetch });
    const result = await callTool<ProfileBody>(worldBankModule, "worldbank_ireland_profile", { last: 1 }, ctx);
    expect(result.ok).toBe(true);
    expect(result.body.data.indicators).toHaveLength(6);
  });
});
