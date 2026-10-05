import { describe, expect, it } from "vitest";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { fakeFetch } from "../../../test/helpers/fakeFetch.js";
import { ecbModule } from "./index.js";

type EcbBody = {
  data: {
    key?: string;
    currency?: string;
    base?: string;
    series?: Array<{ dimensions: Record<string, { id: string }>; observations: Array<{ time: string; value: number | null }> }>;
    observations?: Array<{ time: string; value: number | null }>;
  };
};

describe("ecb source", () => {
  it("decodes an ECB SDMX-JSON series key", async () => {
    const fetch = fakeFetch([{ match: /service\/data\/FM\/B\.U2\.EUR\.4F\.KR\.MRR_FR\.LEV/, file: fixturePath(import.meta.url, "fm-mrr.json") }]);
    const { body } = await callTool<EcbBody>(ecbModule, "ecb_get_series", { key: "FM.B.U2.EUR.4F.KR.MRR_FR.LEV", lastNObservations: 2 }, fetch);
    expect(body.data.key).toBe("FM.B.U2.EUR.4F.KR.MRR_FR.LEV");
    expect(body.data.series?.[0]?.dimensions.FREQ?.id).toBe("B");
    expect(body.data.series?.[0]?.observations.length).toBeGreaterThan(0);
  });

  it("accepts flow separately without treating the first series segment as a flow", async () => {
    const fetch = fakeFetch([{ match: /service\/data\/FM\/B\.U2\.EUR\.4F\.KR\.MRR_FR\.LEV/, file: fixturePath(import.meta.url, "fm-mrr.json") }]);
    const { body } = await callTool<EcbBody>(ecbModule, "ecb_get_series", { flow: "FM", key: "B.U2.EUR.4F.KR.MRR_FR.LEV", lastNObservations: 1 }, fetch);
    expect(body.data.key).toBe("FM.B.U2.EUR.4F.KR.MRR_FR.LEV");
    expect(fetch.calls[0]?.url).toContain("/service/data/FM/B.U2.EUR.4F.KR.MRR_FR.LEV?");
  });

  it("builds the ECB exchange-rate convenience key", async () => {
    const fetch = fakeFetch([{ match: /service\/data\/EXR\/D\.USD\.EUR\.SP00\.A/, file: fixturePath(import.meta.url, "exr-usd.json") }]);
    const { body } = await callTool<EcbBody>(ecbModule, "ecb_exchange_rate", { currency: "usd", lastNObservations: 3 }, fetch);
    expect(body.data).toMatchObject({ currency: "USD", base: "EUR", key: "EXR.D.USD.EUR.SP00.A" });
    expect(body.data.observations).toHaveLength(3);
  });
});
