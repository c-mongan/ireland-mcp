import { describe, expect, it, vi } from "vitest";
const azure = vi.hoisted(() => vi.fn());
vi.mock("@azure/monitor-opentelemetry", () => ({ useAzureMonitor: azure }));
vi.mock("./datadog.js", () => ({ createDatadogRuntime: async () => { throw new Error("private exporter configuration"); } }));
import { initTelemetry } from "./otel.js";

describe("optional exporter failure", () => {
  it("preserves Azure export and does not log private configuration", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(initTelemetry({ APPLICATIONINSIGHTS_CONNECTION_STRING: "test-connection" })).resolves.toBe(true);
      expect(azure).toHaveBeenCalledOnce();
      expect(JSON.stringify(warning.mock.calls)).not.toContain("private exporter configuration");
    } finally {
      warning.mockRestore();
    }
  });
});
