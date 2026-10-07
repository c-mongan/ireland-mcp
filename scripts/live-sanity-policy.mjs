// Exit policy for the live smoke run. Kept separate from live-sanity.mjs so it can be unit-tested without network.

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
