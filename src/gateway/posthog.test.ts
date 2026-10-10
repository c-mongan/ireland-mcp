import { afterEach, describe, expect, it, vi } from "vitest";
import { createPostHogCapture, safeToolProperties, validatedRelease } from "./posthog.js";

const operations = new Map([["cso", new Set(["cso_search_tables"])]]);
const event = { source: "cso", tool: "cso_search_tables", durationMs: 12.6, outcome: "ok" as const };
const configured = () => ({ IRELAND_MCP_POSTHOG_ENABLED: "true", IRELAND_MCP_POSTHOG_KEY: "test-ingestion-token", IRELAND_MCP_POSTHOG_HOST: "https://eu.i.posthog.com" });

afterEach(() => vi.useRealTimers());

describe("safe PostHog capture", () => {
  it("projects only known registry labels, scalar fields and error codes", () => {
    expect(safeToolProperties({ ...event, cached: true, stale: false, errorCode: "BAD_ARGS", args: "private" } as typeof event, operations)).toEqual({
      source: "cso", operation: "cso_search_tables", duration_ms: 13, outcome: "ok", cached: true, stale: false, error_code: "BAD_ARGS"
    });
    expect(safeToolProperties({ source: "private@email.test", tool: "https://private.example/secret", outcome: "error", durationMs: Infinity, errorCode: "private message" }, operations)).toEqual({
      source: "_OTHER", operation: "_OTHER", duration_ms: 0, outcome: "error", error_code: "_OTHER"
    });
    expect(safeToolProperties({ ...event, durationMs: 999999, tool: "private" }, operations)).toMatchObject({ operation: "_OTHER", duration_ms: 120000 });
    expect(safeToolProperties({ ...event, durationMs: -5 }, operations).duration_ms).toBe(0);
  });

  it.each([{}, { ...configured(), IRELAND_MCP_POSTHOG_ENABLED: "false" }, { ...configured(), IRELAND_MCP_TELEMETRY: "off" }, { ...configured(), IRELAND_MCP_POSTHOG_HOST: "https://private.example" }, { ...configured(), IRELAND_MCP_POSTHOG_KEY: "" }])("sends nothing without complete opt-in configuration", async (env) => {
    const send = vi.fn();
    const capture = createPostHogCapture({ operations, env, fetch: send, onDelivery: vi.fn() });
    capture.capture(event);
    await capture.flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("batches no more than 50 safe events, with one fixed aggregate identity", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null));
    const capture = createPostHogCapture({ operations, env: configured(), fetch: send, onDelivery: vi.fn() });
    for (let count = 0; count < 100; count++) capture.capture({ ...event, args: "private-query", result: "private-result", headers: "private-header" } as typeof event);
    expect(send).not.toHaveBeenCalled();
    await capture.flush();
    expect(send).toHaveBeenCalledOnce();
    const [url, init] = send.mock.calls[0]!;
    expect(url).toBe("https://eu.i.posthog.com/batch/");
    expect(init).toMatchObject({ credentials: "omit", redirect: "error" });
    const body = JSON.parse(String(init!.body));
    expect(body.batch).toHaveLength(50);
    expect(body.batch[0]).toEqual({
      event: "ireland_mcp_tool_completed", distinct_id: "ireland-mcp-service-aggregate",
      properties: { source: "cso", operation: "cso_search_tables", outcome: "ok", duration_ms: 13, schema_version: 1, surface: "mcp", $process_person_profile: false, $geoip_disable: true, $ip: "0.0.0.0" }
    });
    expect(JSON.stringify(body)).not.toContain("private");
    await capture.flush();
    expect(send).toHaveBeenCalledOnce();
  });

  it("does not throw or retry network errors or failed HTTP responses", async () => {
    for (const failure of [Promise.reject(new Error("private network error")), Promise.resolve(new Response(null, { status: 500 }))]) {
      const send = vi.fn<typeof fetch>().mockReturnValue(failure);
      const capture = createPostHogCapture({ operations, env: configured(), fetch: send, onDelivery: vi.fn() });
      capture.capture(event);
      await expect(capture.flush()).resolves.toBeUndefined();
      await capture.flush();
      expect(send).toHaveBeenCalledOnce();
    }
  });

  it("bounds flush if a transport ignores cancellation and shares an active flush", async () => {
    vi.useFakeTimers();
    const send = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => undefined));
    const capture = createPostHogCapture({ operations, env: configured(), fetch: send, onDelivery: vi.fn() });
    capture.capture(event);
    const flush = capture.flush();
    expect(capture.flush()).toBe(flush);
    await vi.advanceTimersByTimeAsync(251);
    await expect(flush).resolves.toBeUndefined();
    expect(send.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(send).toHaveBeenCalledOnce();
  });

  it.each(["a1b2c3d", "a".repeat(40), "private-secret", "https://private.example", "a".repeat(41)])("accepts only a safe commit label: %s", async (release) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null));
    const capture = createPostHogCapture({ operations, env: { ...configured(), IRELAND_MCP_RELEASE: "f".repeat(40) }, release, fetch: send, onDelivery: vi.fn() });
    capture.capture(event);
    await capture.flush();
    const properties = JSON.parse(String(send.mock.calls[0]![1]!.body)).batch[0].properties;
    expect(validatedRelease(release)).toBe(/^[a-f0-9]{7,40}$/.test(release) ? release : undefined);
    if (/^[a-f0-9]{7,40}$/.test(release)) expect(properties.release_commit).toBe(release);
    else expect(properties).not.toHaveProperty("release_commit");
  });

  it("does not use a stale environment release on an unstamped build", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null));
    const capture = createPostHogCapture({ operations, env: { ...configured(), IRELAND_MCP_RELEASE: "f".repeat(40) }, fetch: send });
    capture.capture(event);
    await capture.flush();
    expect(JSON.parse(String(send.mock.calls[0]![1]!.body)).batch[0].properties).not.toHaveProperty("release_commit");
  });

  it("counts queue overflow in one fixed-schema local summary without event data", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null));
    const diagnostic = vi.fn();
    const capture = createPostHogCapture({ operations, env: configured(), fetch: send, onDelivery: diagnostic });
    for (let count = 0; count < 53; count++) capture.capture({ ...event, tool: "private-secret" });
    await capture.flush();
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith({
      type: "posthog_delivery", attempted_count: 50, http_accepted_count: 50,
      dropped_http_count: 0, dropped_network_count: 0, dropped_timeout_count: 0, dropped_queue_full_count: 3
    });
    expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/private|test-ingestion-token|cso/);
    await capture.flush();
    expect(diagnostic).toHaveBeenCalledOnce();
  });

  it.each([400, 401, 429, 500])("counts HTTP %s as loss without reading its response message", async (status) => {
    const diagnostic = vi.fn();
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("private-token-error", { status }));
    const capture = createPostHogCapture({ operations, env: configured(), fetch: send, onDelivery: diagnostic });
    capture.capture(event);
    await expect(capture.flush()).resolves.toBeUndefined();
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith({
      type: "posthog_delivery", attempted_count: 1, http_accepted_count: 0,
      dropped_http_count: 1, dropped_network_count: 0, dropped_timeout_count: 0, dropped_queue_full_count: 0
    });
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("private");
  });

  it("distinguishes a bounded timeout from a network rejection", async () => {
    vi.useFakeTimers();
    const diagnostic = vi.fn();
    const send = vi.fn<typeof fetch>().mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new Error("private timeout details")));
    })).mockRejectedValueOnce(new Error("private-network-token"));
    const capture = createPostHogCapture({ operations, env: configured(), fetch: send, onDelivery: diagnostic });
    capture.capture(event);
    const flush = capture.flush();
    await vi.advanceTimersByTimeAsync(251);
    await flush;
    expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ dropped_timeout_count: 1, dropped_network_count: 0 }));
    capture.capture(event);
    await capture.flush();
    expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ dropped_timeout_count: 0, dropped_network_count: 1 }));
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("private");
  });

  it("keeps two failed batches within the existing 500 ms request budget", async () => {
    vi.useFakeTimers();
    const diagnostic = vi.fn();
    const send = vi.fn<typeof fetch>().mockImplementation(() => {
      if (send.mock.calls.length === 1) capture.capture(event);
      return new Promise(() => undefined);
    });
    const capture = createPostHogCapture({ operations, env: configured(), fetch: send, onDelivery: diagnostic });
    capture.capture(event);
    const started = Date.now();
    const flush = capture.flush();
    await vi.advanceTimersByTimeAsync(500);
    await expect(flush).resolves.toBeUndefined();
    expect(Date.now() - started).toBe(500);
    expect(send).toHaveBeenCalledTimes(2);
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ attempted_count: 2, dropped_timeout_count: 2 }));
  });

  it("does not emit loss diagnostics when explicitly disabled or fail on a faulty diagnostic sink", async () => {
    const env = { ...configured(), IRELAND_MCP_TELEMETRY: "on" };
    const diagnostic = vi.fn(() => { throw new Error("private sink error"); });
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 }));
    const capture = createPostHogCapture({ operations, env, fetch: send, onDelivery: diagnostic });
    capture.capture(event);
    await expect(capture.flush()).resolves.toBeUndefined();
    expect(diagnostic).toHaveBeenCalledOnce();
    for (let count = 0; count < 51; count++) capture.capture(event);
    env.IRELAND_MCP_TELEMETRY = "off";
    await capture.flush();
    expect(diagnostic).toHaveBeenCalledOnce();
  });

  it("discards queued events when telemetry is disabled before flush", async () => {
    const env = { ...configured(), IRELAND_MCP_TELEMETRY: "on" };
    const send = vi.fn();
    const capture = createPostHogCapture({ operations, env, fetch: send, onDelivery: vi.fn() });
    capture.capture(event);
    env.IRELAND_MCP_TELEMETRY = "off";
    await capture.flush();
    env.IRELAND_MCP_TELEMETRY = "on";
    await capture.flush();
    expect(send).not.toHaveBeenCalled();
  });
});
