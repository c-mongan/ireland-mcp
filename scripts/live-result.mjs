// Shared acceptance checks for live MCP results. A successful transport is not proof of valid data.
import { operationContracts } from "./live-contracts.mjs";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const array = (value) => Array.isArray(value);

export function assessResult(result, label = "") {
  let body;
  try { body = JSON.parse(result?.content?.find((part) => part.type === "text")?.text ?? ""); }
  catch { return { status: "FAIL", body: {}, reason: "Missing or invalid JSON tool result." }; }
  const fail = (reason) => ({ status: "FAIL", body, reason });
  if (!object(body)) return fail("Tool result must be a JSON object.");
  if (result.isError) {
    const code = body.error?.code;
    if (label.startsWith("nta/") && code === "NOT_CONFIGURED") return { status: "NOT_CONFIGURED", body };
    if (label.startsWith("kohesio/") && code === "UPSTREAM_DOWN" && /HTTP 403/.test(body.error?.message ?? "")) {
      return { status: "HOSTED_BLOCKED", body };
    }
    return fail(body.error?.message ?? "Tool returned an error.");
  }
  if (body.error) return fail("Error payload was not marked isError.");
  if (label === "ireland_catalogue") {
    return array(body.domains) && body.domains.length > 0 ? { status: "PASS", body } : fail("Missing catalogue domains.");
  }
  if (label === "ireland_about") {
    return nonempty(body.name) && array(body.sources) && body.sources.length > 0 ? { status: "PASS", body } : fail("Missing server/source details.");
  }
  if (label === "ireland_describe") {
    return nonempty(body.operation) && object(body.input_schema) && object(body.call) ? { status: "PASS", body } : fail("Missing operation schema.");
  }
  if (label === "search") {
    return array(body.results) && body.results.length > 0 && body.results.every((row) => nonempty(row.id) && nonempty(row.title) && nonempty(row.url))
      ? { status: "PASS", body } : fail("Search sample lacks identified results.");
  }
  if (label === "fetch") {
    return [body.id, body.title, body.text, body.url].every(nonempty) ? { status: "PASS", body } : fail("Fetch sample lacks document content.");
  }
  for (const field of ["source", "url", "licence", "attribution", "retrieved_at"]) {
    if (!nonempty(body[field])) return fail(`Missing evidence field: ${field}.`);
  }
  if (!Number.isFinite(Date.parse(body.retrieved_at))) return fail("Invalid retrieval timestamp.");
  if (typeof body.cached !== "boolean" || typeof body.truncated !== "boolean") return fail("Missing cache/truncation flags.");
  if (label.includes("/") && body.operation !== label.split("/")[1]) return fail("Result does not identify the requested operation.");
  const data = body.data;
  if (!array(data) && (!object(data) || Object.keys(data).length === 0)) return fail("Missing domain data.");
  const operation = body.operation ?? (label === "nearby" ? "nearby" : undefined);
  const check = Object.hasOwn(operationContracts, operation) ? operationContracts[operation] : undefined;
  if (!check || !check(data)) return fail(`Domain sample failed its acceptance check: ${operation ?? "unknown operation"}.`);
  if (["nearby", "ireland_snapshot"].includes(operation) && Object.values(data).some((value) => object(value) && value.error)) {
    return { status: "DEGRADED", body, reason: "A combined-source section is unavailable." };
  }
  if (body.stale === true) return { status: "DEGRADED", body, reason: "Stale cache is not fresh live proof." };
  return { status: "PASS", body };
}
