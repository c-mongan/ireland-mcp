const MAX_ROWS = 5;
const MAX_TEXT = 300;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim() ? value.slice(0, MAX_TEXT) : "Not reported";
const number = (value, unit = "") => typeof value === "number" && Number.isFinite(value)
  ? `${new Intl.NumberFormat("en-IE", { maximumFractionDigits: 2 }).format(value)}${unit}` : "Not reported";
const money = (value) => typeof value === "number" && Number.isFinite(value)
  ? new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value) : "Not reported";

export function safeSourceUrl(value) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function decodeToolPayload(result) {
  const value = result?.structuredContent ?? result?.content?.filter?.((item) => item.type === "text").map((item) => item.text || "").join("\n") ?? result;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function retrievalTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) return "Not reported";
  return `${new Intl.DateTimeFormat("en-IE", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value))} UTC`;
}

/** A deterministic preview of documented source fields. It does not generate an answer. */
export function buildResultView(payload, { source, operation, isError = false } = {}) {
  const envelope = record(payload) ? payload : {};
  const data = envelope.data;
  const model = {
    title: isError ? "The source returned an error" : "Response received",
    description: isError ? "No data preview is shown. Inspect the raw response for the source error." : "A readable preview is not available for this response. Inspect the raw response.",
    provenance: { publisher: text(envelope.source), url: safeSourceUrl(envelope.url), licence: text(envelope.licence), retrieved: retrievalTime(envelope.retrieved_at), attribution: typeof envelope.attribution === "string" ? text(envelope.attribution) : undefined },
    notices: [],
    tables: []
  };
  if (envelope.cached === true) model.notices.push("Cached response. The data was served from the server cache.");
  if (envelope.stale === true) model.notices.push("Stale response. Check the publisher before using this data.");
  if (envelope.truncated === true || (record(data) && data.truncated === true)) model.notices.push("Truncated response. Some data was omitted. Narrow the query or inspect the raw response.");
  if (envelope.partial === true || (record(data) && data.partial === true)) model.notices.push("Partial response. Some requested data is missing.");
  if (isError) return model;
  if (typeof envelope.operation === "string" && envelope.operation !== operation) {
    model.notices.push("The response names a different operation. Inspect the raw response before using it.");
    return model;
  }

  function table(title, columns, items, row, fields) {
    if (!Array.isArray(items)) return false;
    const valid = items.filter((item) => record(item) && fields.some((field) => typeof item[field] === "string" || (typeof item[field] === "number" && Number.isFinite(item[field]))));
    if (valid.length !== items.length) model.notices.push("Some returned entries have an unexpected format. Inspect the raw response.");
    if (items.length && !valid.length) return false;
    model.tables.push({ title, columns, rows: valid.slice(0, MAX_ROWS).map(row) });
    if (valid.length > MAX_ROWS) model.notices.push(`Showing the first ${MAX_ROWS} entries in ${title.toLowerCase()}. More entries are in the raw response.`);
    return true;
  }

  const key = `${source}/${operation}`;
  if (key === "cso/cso_get_data" && record(data) && data.code === "RIQ02" && table("Published figures", ["Location", "Period", "Figure", "Context"], data.rows, (item) => [
    text(item.Location), text(item.Quarter), data.code === "RIQ02" && item.value === 0 ? "Insufficient published data" : typeof item.value === "number" && Number.isFinite(item.value) ? `${number(item.value)} ${text(item.unit)}` : "Not reported",
    [item["Number of Bedrooms"], item["Property Type"]].filter((value) => typeof value === "string").map(text).join(" · ") || "Inspect raw response"
  ], ["value", "Quarter", "Location"])) {
    model.title = text(data.title);
    model.description = "Historical registered-tenancy statistics for the selected period. These are not current asking rents or all market rents. RTB uses 0.00 where published data is insufficient.";
  } else if (key === "cso/cso_search_tables" && table("CSO tables", ["Table", "Code", "Released"], data, (item) => [text(item.title), text(item.code), text(item.released)], ["title", "code"])) {
    model.title = data.length ? "CSO table search" : "No tables in this response";
    model.description = "These are table search results. Ask your connected assistant to retrieve a table to inspect its figures.";
  } else if (key === "luas/luas_get_forecast" && record(data) && Array.isArray(data.inbound) && Array.isArray(data.outbound)) {
    const row = (item) => [text(item.destination), number(item.due_in_min, " min")];
    const inbound = table("Inbound trams", ["Destination", "Due in"], data.inbound, row, ["destination", "due_in_min"]);
    const outbound = table("Outbound trams", ["Destination", "Due in"], data.outbound, row, ["destination", "due_in_min"]);
    if (inbound && outbound) {
      model.title = `Luas arrivals${record(data.stop) && typeof data.stop.name === "string" ? ` at ${text(data.stop.name)}` : ""}`;
      model.description = typeof data.message === "string" && data.message.trim() ? text(data.message) : "Forecast arrival times returned by Luas. Times can change.";
    } else { model.tables = []; }
  } else if (key === "met-eireann/met_get_warnings" && record(data) && table("Weather warnings", ["Warning", "Level", "Starts", "Ends"], data.warnings, (item) => [text(item.headline ?? item.type ?? item.description), text(item.level), text(item.onset), text(item.expiry)], ["headline", "type", "description", "level"])) {
    model.title = data.warnings.length ? "Weather warnings in this response" : "No warning entries in this preview";
    model.description = "Check the publisher for full warning details, affected areas and current advice.";
    if (typeof data.count === "number" && data.count !== data.warnings.length) model.notices.push("The reported warning count differs from the entries included. This preview may be incomplete. Inspect the source and raw response.");
  } else if (key === "irish-rail/rail_get_departures" && record(data) && table("Train departures", ["Destination", "Due in", "Expected", "Status"], data.departures, (item) => [text(item.destination), number(item.due_in_min, " min"), text(item.expected_departure), text(item.status)], ["destination", "train_code", "expected_departure"])) {
    model.title = `Train departures${record(data.station) && typeof data.station.name === "string" ? ` from ${text(data.station.name)}` : ""}`;
    model.description = "Departures returned for the requested station and time window. Check the operator before travel.";
  } else if (key === "eirgrid/grid_get_status" && record(data) && ["demand_mw", "wind_mw", "wind_share_pct", "co2_g_per_kwh"].some((field) => typeof data[field] === "number" && Number.isFinite(data[field]))) {
    model.title = "Electricity grid readings";
    model.description = `Region reported: ${text(data.region)}. Each reading has its own source time; retrieval time is separate.${typeof data.note === "string" ? ` ${text(data.note)}` : ""}`;
    model.tables.push({ title: "Grid readings", columns: ["Reading", "Value", "Source time"], rows: [
      ["Demand", number(data.demand_mw, " MW"), text(data.demand_time)],
      ["Wind generation", number(data.wind_mw, " MW"), text(data.wind_time)],
      ["Wind share of demand", number(data.wind_share_pct, "%"), text(data.wind_share_time)],
      ["Carbon intensity", number(data.co2_g_per_kwh, " gCO₂/kWh"), text(data.co2_time)]
    ] });
    if ([data.demand_mw, data.wind_mw, data.wind_share_pct, data.co2_g_per_kwh].some((value) => typeof value !== "number" || !Number.isFinite(value))) model.notices.push("Some grid readings are not reported. Missing readings are not zero.");
  } else if (key === "ppr/ppr_price_stats" && record(data) && typeof data.count === "number" && Number.isInteger(data.count) && data.count >= 0) {
    model.title = "Property sale statistics";
    model.description = `${number(data.count)} sales reported for the supplied filters. This is a sale-price summary, not a valuation.`;
    model.tables.push({ title: "Reported sale prices", columns: ["Measure", "Value"], rows: [
      ["Median", money(data.median_eur)], ["Mean", money(data.mean_eur)], ["Lower quartile", money(data.p25_eur)], ["Upper quartile", money(data.p75_eur)],
      ["Sale dates", `${text(data.first_sale)} to ${text(data.last_sale)}`]
    ] });
  }
  return model;
}

export function renderResultView(container, model) {
  const doc = container.ownerDocument;
  const element = (tag, content, className) => {
    const node = doc.createElement(tag);
    if (content !== undefined) node.textContent = content;
    if (className) node.className = className;
    return node;
  };
  container.replaceChildren(element("h4", model.title), element("p", model.description, "result-description"));
  if (model.notices.length) {
    const notices = element("ul", undefined, "result-notices");
    notices.append(...model.notices.map((notice) => element("li", notice)));
    container.append(notices);
  }
  for (const group of model.tables) {
    const scroll = element("div", undefined, "result-table-scroll");
    scroll.tabIndex = 0; scroll.setAttribute("role", "region"); scroll.setAttribute("aria-label", group.title);
    const table = element("table", undefined, "result-table");
    table.append(element("caption", group.title));
    const head = element("thead");
    const heading = element("tr");
    for (const label of group.columns) { const cell = element("th", label); cell.scope = "col"; heading.append(cell); }
    head.append(heading);
    const body = element("tbody");
    for (const row of group.rows) { const line = element("tr"); line.append(...row.map((value) => element("td", value))); body.append(line); }
    if (!group.rows.length) { const line = element("tr"); const cell = element("td", "No entries in this response."); cell.colSpan = group.columns.length; line.append(cell); body.append(line); }
    table.append(head, body); scroll.append(table); container.append(scroll);
  }
  const provenance = element("dl", undefined, "result-provenance");
  for (const [label, value] of [["Publisher", model.provenance.publisher], ["Licence", model.provenance.licence], ["Retrieved", model.provenance.retrieved]]) {
    const group = element("div"); group.append(element("dt", label), element("dd", value)); provenance.append(group);
  }
  container.append(provenance);
  if (model.provenance.url) {
    const link = element("a", model.provenance.url); link.href = model.provenance.url; link.rel = "noreferrer"; link.dataset.resultAction = "open_source"; link.setAttribute("aria-label", "Open the source response"); container.append(link);
  } else { container.append(element("p", "No safe source URL was supplied.", "result-description")); }
  if (model.provenance.attribution) container.append(element("p", model.provenance.attribution, "result-attribution"));
}
