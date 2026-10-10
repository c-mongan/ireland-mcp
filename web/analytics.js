const HOSTS = new Set(["https://eu.i.posthog.com", "https://us.i.posthog.com"]);
const CLIENTS = new Set(["vscode", "cursor", "claude", "chatgpt", "copilot", "gemini", "windsurf", "generic", "endpoint"]);

function privacyBlocked() {
  return navigator.globalPrivacyControl === true ||
    [navigator.doNotTrack, window.doNotTrack].some((value) => value === "1" || value === "yes");
}

/** Count known actions only. Do not pass query arguments, result text, or exception objects here. */
export function safeProperties(event, input, operations) {
  if (event === "ireland_query_completed") {
    const known = operations.has(input.source);
    return {
      source: known ? input.source : "_OTHER",
      operation: known && operations.get(input.source).has(input.operation) ? input.operation : "_OTHER",
      outcome: input.outcome === "ok" ? "ok" : "error",
      duration_ms: Number.isFinite(input.duration_ms) ? Math.max(0, Math.min(120000, Math.round(input.duration_ms))) : 0
    };
  }
  if (event === "ireland_theme_changed" && ["light", "dark"].includes(input.theme)) return { theme: input.theme };
  if (event === "ireland_install_action" && CLIENTS.has(input.client) && ["select", "copy", "open"].includes(input.action)) {
    return { client: input.client, action: input.action };
  }
}

export function createAnalytics({ operations = new Map(), fetch: send = window.fetch.bind(window) } = {}) {
  let config;
  let enabled = false;
  let identity;
  let windowStart = 0;
  let sentCount = 0;
  const pending = new Set();
  function disable() {
    enabled = false;
    identity = undefined;
    for (const controller of pending) controller.abort();
  }
  function configure(value) {
    disable();
    config = value?.enabled === true && typeof value.token === "string" && value.token.length > 0 && HOSTS.has(value.host)
      ? { token: value.token, host: value.host, ...(typeof value.release === "string" && /^[a-f0-9]{7,40}$/.test(value.release) ? { release_commit: value.release } : {}) } : undefined;
  }
  function setEnabled(value) {
    if (!value || !config || privacyBlocked()) { disable(); return false; }
    identity ||= crypto.randomUUID();
    enabled = true;
    return true;
  }
  function capture(event, input = {}) {
    if (!enabled || !config || privacyBlocked()) { if (privacyBlocked()) disable(); return; }
    const properties = safeProperties(event, input, operations);
    if (!properties || pending.size >= 2) return;
    if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); sentCount = 0; }
    if (sentCount >= 30) return;
    sentCount++;
    const controller = new AbortController();
    pending.add(controller);
    const timeout = setTimeout(() => controller.abort(), 2000);
    // No browser SDK: no page URLs, referrers, cookies, persistence, replay, or automatic capture.
    Promise.resolve().then(() => {
      if (controller.signal.aborted || !enabled || privacyBlocked()) return;
      return send(`${config.host}/i/v0/e/`, {
        method: "POST", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error",
        signal: controller.signal, headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: config.token, event, distinct_id: identity,
          properties: { ...properties, ...(config.release_commit ? { release_commit: config.release_commit } : {}), surface: "web", schema_version: 1, $process_person_profile: false, $geoip_disable: true, $ip: "0.0.0.0" }
        })
      });
    }).then((response) => response?.body?.cancel()).catch(() => undefined).finally(() => {
      clearTimeout(timeout);
      pending.delete(controller);
    });
  }
  async function init(button) {
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-pressed", "false");
      button.textContent = "Loading usage metrics…";
    }
    try {
      const response = await send("/analytics-config.json", {
        credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(2000)
      });
      if (response.ok) configure(await response.json());
    } catch { /* Missing configuration leaves all capture off. */ }
    if (!button) return;
    function render() {
      const blocked = privacyBlocked();
      if (blocked) disable();
      button.disabled = !config || blocked;
      button.setAttribute("aria-pressed", String(enabled));
      button.textContent = blocked ? "Usage metrics blocked by privacy settings" : !config ? "Usage metrics unavailable" : enabled ? "Disable usage metrics" : "Enable usage metrics";
    }
    button.addEventListener("click", () => { setEnabled(!enabled); render(); });
    document.addEventListener("visibilitychange", render);
    render();
  }
  return { configure, setEnabled, capture, init };
}
