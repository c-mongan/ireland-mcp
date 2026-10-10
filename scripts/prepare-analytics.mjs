import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const hosts = new Set(["https://eu.i.posthog.com", "https://us.i.posthog.com"]);

/** Generate deployment configuration without writing a token to source control. */
export function analyticsConfig(env) {
  const token = env.IRELAND_MCP_POSTHOG_KEY;
  if (env.IRELAND_MCP_POSTHOG_WEB_ENABLED !== "true" || !token) return { enabled: false };
  const host = env.IRELAND_MCP_POSTHOG_HOST;
  if (!hosts.has(host)) throw new Error("Use an official PostHog ingestion host.");
  const release = env.IRELAND_MCP_RELEASE;
  return { enabled: true, token, host, ...(/^[a-f0-9]{7,40}$/.test(release ?? "") ? { release } : {}) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = analyticsConfig(process.env);
  await writeFile(new URL("../web/analytics-config.json", import.meta.url), `${JSON.stringify(config)}\n`);
  console.log(`Browser metrics configuration: ${config.enabled ? "available with visitor opt-in" : "disabled"}.`);
}
