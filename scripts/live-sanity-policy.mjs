// Exit policy for the live smoke run. Kept separate from live-sanity.mjs so it can be unit-tested without network.
import { assessResult } from "./live-result.mjs";

/** Optional stored-corpus probes. Enabling the integration must not silently skip missing registration. */
export function optionalLegalCases(domains, legalEnabled) {
  const advertised = new Set(domains.flatMap((domain) => (domain.sources ?? []).map((source) => source.id)));
  return [
    ["irish-legal", "irish_legal_get_provision", { year: 1997, number: 20, section: "19", version_type: "enacted" },
      (data) => data.id === "eisb:1997/act/20/s19" && data.source_id === "eisb" && data.version_type === "enacted" && data.text.length > 50 && data.warnings.length > 0],
    ["citizens-info", "citizens_info_search", { query: "annual leave", limit: 2 },
      (data) => data.hits.length > 0 && data.hits.every((hit) => hit.source_id === "citizens-info" && hit.source_type === "guidance" && hit.warnings.length > 0)]
  ].filter(([source]) => legalEnabled === "true" || advertised.has(source));
}

/** A timestamped empty NTA feed is valid. No invented entity counters are required. */
export const ntaSummarySample = (data) => typeof data.feed_timestamp === "string"
  && Number.isFinite(Date.parse(data.feed_timestamp))
  && [data.trips, data.cancelled, data.added].every((count) => Number.isInteger(count) && count >= 0)
  && data.cancelled + data.added <= data.trips;

/** Shared response validation precedes the source-specific sample check on both MCP surfaces. */
export function assessSmokeResult(result, { source, tool, check, raw = false, typed = false, ms = 0 }) {
  const assessed = assessResult(result, raw ? tool : `${source}/${tool}`, { requireOperationTag: !typed });
  const body = assessed.body;
  const base = { source, tool, ms };
  if (assessed.status !== "PASS") {
    const errorNote = result?.isError && body?.error ? `${body.error.code}: ${body.error.message}` : undefined;
    const failure = { ...base, status: "FAIL", note: assessed.reason ?? errorNote ?? `Result status: ${assessed.status}.` };
    // Only structured transport evidence from a correctly routed error is degradation.
    // It is still a failing live check after the HTTP client's bounded retry is exhausted.
    const transport = body?.error?.upstream_failure;
    const routed = (body?.operation === undefined || body.operation === tool)
      && (result?._meta?.["ireland/source"] === undefined || result._meta["ireland/source"] === source)
      && (result?._meta?.["ireland/operation"] === undefined || result._meta["ireland/operation"] === tool);
    if (result?.isError && routed && body?.error?.code === "UPSTREAM_DOWN"
      && ["timeout", "network", "http"].includes(transport?.kind)
      && Number.isInteger(transport.attempts) && transport.attempts > 0) {
      return { ...failure, status: "DEGRADED", note: `${failure.note} [${transport.kind}; attempts=${transport.attempts}${transport.status ? `; HTTP=${transport.status}` : ""}${transport.timeout_ms ? `; timeout_ms=${transport.timeout_ms}` : ""}]` };
    }
    // Known outages must be actual tool errors. Successful malformed data must never become WARN.
    return result?.isError && assessed.status === "HOSTED_BLOCKED" ? classify(failure) : failure;
  }
  try {
    return check(raw ? body : body.data)
      ? { ...base, status: "PASS", note: "" }
      : { ...base, status: "FAIL", note: "Source sample failed its expected-value check." };
  } catch {
    return { ...base, status: "FAIL", note: "Source sample could not be checked." };
  }
}

/** Sources with a specific known cloud-runner failure eligible for WARN. */
export const KNOWN_FLAKY = {
  kohesio: "Kohesio returns HTTP 403 to some cloud-hosted IPs (GitHub runners); it works from residential IPs."
};

/** At most this many known-flaky warnings are tolerated before the run fails anyway. */
export const MAX_TOLERATED_FLAKY = 1;

/**
 * Downgrades only the normalized Kohesio cloud-runner HTTP 403 to WARN.
 * Other outages, timeouts and unexpected handler/schema failures still fail.
 */
export function classify(result, knownFlaky = KNOWN_FLAKY) {
  if (result.status !== "FAIL") return result;
  const reason = knownFlaky[result.source];
  if (!reason || result.source !== "kohesio"
    || result.note !== "UPSTREAM_DOWN: Kohesio returned HTTP 403.") return result;
  return { ...result, status: "WARN", note: `${result.note} Known flaky: ${reason}` };
}

/** Returns the process exit code: 0 when everything passed or only tolerated known-flaky warnings remain. */
export function exitCode(results, maxTolerated = MAX_TOLERATED_FLAKY) {
  if (results.some((r) => r.status === "FAIL" || r.status === "DEGRADED")) return 1;
  return results.filter((r) => r.status === "WARN").length > maxTolerated ? 1 : 0;
}


/** One bounded real operation per new adapter; no subscription key means an explicit skip. */
export const publicSourceCases = [
  ["failte-ireland", "failte_search", { dataset: "accommodation", county: "Galway", limit: 2 },
    d => d.records?.length > 0 && d.records.every(r => typeof r.name === "string" && r.name.length > 0)],
  ["tfi-static", "tfi_static_search_stops", { name: "Dublin", limit: 2 },
    d => d.stops?.length > 0 && d.stops.every(s => typeof s.atco_code === "string" && s.atco_code.length > 0 && s.name)],
  ["gsi", "groundwater_vulnerability_at", { lat: 53.3498, lon: -6.2603, limit: 10 },
    d => d.status === "matched" && d.areas?.length > 0 && d.areas.every(a => typeof a.category === "string" && a.category.length > 0)],
  ["logainm", "logainm_search_places", { query: "Dublin", limit: 2 },
    d => d.places?.length > 0 && d.places.every(p => Number.isInteger(p.id) && p.id > 0 && p.names?.some(n => n.wording)),
    { needsEnv: "LOGAINM_API_KEY" }]
];
