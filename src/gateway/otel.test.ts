import { describe, expect, it } from "vitest";
import { azureMonitorOptions, defaultErrorType, initTelemetry, telemetryEnabled } from "./otel.js";

describe("telemetry bootstrap", () => {
  it("stays a no-op without a connection string or when switched off", async () => {
    expect(telemetryEnabled({})).toBe(false);
    expect(telemetryEnabled({ APPLICATIONINSIGHTS_CONNECTION_STRING: "InstrumentationKey=x", IRELAND_MCP_OTEL: "off" })).toBe(false);
    expect(telemetryEnabled({ APPLICATIONINSIGHTS_CONNECTION_STRING: "InstrumentationKey=x" })).toBe(true);
    await expect(initTelemetry({})).resolves.toBe(false);
  });

  it("disables every auto-instrumentation and clamps sampling", () => {
    const options = azureMonitorOptions({ APPLICATIONINSIGHTS_CONNECTION_STRING: "cs", IRELAND_MCP_OTEL_SAMPLING_RATIO: "0.25" }, { token: 1 });
    expect(options.samplingRatio).toBe(0.25);
    expect(options.azureMonitorExporterOptions).toEqual({ connectionString: "cs", credential: { token: 1 } });
    expect(Object.values(options.instrumentationOptions).every((o) => !o.enabled)).toBe(true);
    expect(options.enableLiveMetrics).toBe(false);
    expect(azureMonitorOptions({ IRELAND_MCP_OTEL_SAMPLING_RATIO: "5" }).samplingRatio).toBe(1);
    expect(azureMonitorOptions({}).azureMonitorExporterOptions).not.toHaveProperty("credential");
  });

  it("derives error.type from typed codes or error names", () => {
    expect(defaultErrorType({ code: "UPSTREAM_DOWN" })).toBe("UPSTREAM_DOWN");
    expect(defaultErrorType(new TypeError("x"))).toBe("TypeError");
    expect(defaultErrorType("boom")).toBe("_OTHER");
  });
});
