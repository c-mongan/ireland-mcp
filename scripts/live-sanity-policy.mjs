// Exit policy for the live smoke run. Kept separate from live-sanity.mjs so it can be unit-tested without network.
import { assessResult } from "./live-result.mjs";

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
  if (results.some((r) => r.status === "FAIL")) return 1;
  return results.filter((r) => r.status === "WARN").length > maxTolerated ? 1 : 0;
}
