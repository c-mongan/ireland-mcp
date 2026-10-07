// Exit policy for the live smoke run. Kept separate from live-sanity.mjs so it can be unit-tested without network.

/** Sources whose upstream is known to block or flap from cloud runners. Failures are reported as WARN, not FAIL. */
export const KNOWN_FLAKY = {
  kohesio: "Kohesio returns HTTP 403 to some cloud-hosted IPs (GitHub runners); it works from residential IPs."
};

/** At most this many known-flaky warnings are tolerated before the run fails anyway. */
export const MAX_TOLERATED_FLAKY = 1;

/**
 * Downgrades an isolated upstream failure from a known-flaky source to WARN.
 * Only UPSTREAM_DOWN qualifies: a wrong answer or a schema break still fails.
 */
export function classify(result, knownFlaky = KNOWN_FLAKY) {
  if (result.status !== "FAIL") return result;
  const reason = knownFlaky[result.source];
  if (!reason || !String(result.note ?? "").startsWith("UPSTREAM_DOWN")) return result;
  return { ...result, status: "WARN", note: `${result.note} Known flaky: ${reason}` };
}

/** Returns the process exit code: 0 when everything passed or only tolerated known-flaky warnings remain. */
export function exitCode(results, maxTolerated = MAX_TOLERATED_FLAKY) {
  if (results.some((r) => r.status === "FAIL")) return 1;
  return results.filter((r) => r.status === "WARN").length > maxTolerated ? 1 : 0;
}
