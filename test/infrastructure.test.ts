import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_ALLOWED_ORIGINS, isOriginAllowed, parseAllowedOrigins } from "../src/gateway/origin.js";

const readInfra = (name: string) => readFileSync(new URL(`../infra/${name}`, import.meta.url), "utf8");
const main = readInfra("main.bicep");
const service = readInfra("service.bicep");
const domains = readInfra("production-domains.bicep");
const dns = readInfra("dns-zone.bicep");
const availability = readInfra("availability.bicep");
const production = JSON.parse(readInfra("production.parameters.json")).parameters;
const azd = JSON.parse(readInfra("main.parameters.json")).parameters;

describe("Production infrastructure replay contracts", () => {
  it("keeps only production domain and monitoring adoption opt-in", () => {
    expect(main).toContain("param enableProductionDomains bool = false");
    expect(main).toContain("module domains 'production-domains.bicep' = if (enableProductionDomains)");
    expect(main).toContain("module availability 'availability.bicep' = if (enableProductionDomains)");
    expect(service).not.toContain("enablePlatformCors");
    expect(main).not.toContain("enablePlatformCors");
    expect(azd.enableProductionDomains.value).toBe("${ENABLE_PRODUCTION_DOMAINS=false}");
  });

  it("pins the observed production identities and public SWA ownership token", () => {
    expect(production).toMatchObject({
      environmentName: { value: "ireland-mcp" },
      location: { value: "northeurope" },
      resourceNameSuffix: { value: "aofsjpwgy4hva" },
      maximumInstanceCount: { value: 10 },
      enableProductionDomains: { value: true },
      canonicalSiteUrl: { value: "https://irishopendata.ie" },
      staticWebAppValidationToken: { value: "_h6b8rofq6ozlaihstd6ok0u95bkmf6z" }
    });
    expect(domains).toContain("name: 'swa-ireland-mcp'");
    expect(domains).toContain("location: 'westeurope'");
    expect(domains).toContain("sku: { name: 'Free', tier: 'Free' }");
    expect(domains).toContain("repositoryUrl: 'https://github.com/c-mongan/ireland-mcp'");
    expect(domains).toContain("branch: 'main'");
    expect(domains).toContain("provider: 'GitHub'");
    expect(domains).not.toContain("repositoryToken:");
  });

  it("preserves observed settings and lets managed canonical settings override extras", () => {
    const baseline = service.split("var baseSettings = {")[1]?.split("\n}")[0] ?? "";
    const keys = [...baseline.matchAll(/^\s+(\w+):/gm)].map((match) => match[1]);
    expect(keys).toEqual([
      "AzureWebJobsStorage__accountName",
      "AzureWebJobsStorage__credential",
      "APPLICATIONINSIGHTS_CONNECTION_STRING",
      "APPLICATIONINSIGHTS_AUTHENTICATION_STRING",
      "CACHE_TABLE_NAME",
      "PPR_CONTAINER",
      "RATE_LIMIT_PER_MINUTE",
      "OTEL_SERVICE_NAME"
    ]);
    expect(service).toContain("@secure()\nparam additionalAppSettings object = {}");
    expect(service).toContain("union(additionalAppSettings, baseSettings, originSettings, canonicalSettings, ntaSettings)");
    expect(service).toContain("{ CANONICAL_SITE_URL: canonicalSiteUrl }");
    expect(main).toContain("empty(canonicalSiteUrl) && enableProductionDomains ? 'https://irishopendata.ie'");
  });

  it("mirrors the app default and replacement/extension CORS contract without credentials", () => {
    const defaults = service.split("var defaultAllowedOrigins = [")[1]?.split("\n]")[0] ?? "";
    expect([...defaults.matchAll(/'([^']+)'/g)].map((match) => match[1])).toEqual(DEFAULT_ALLOWED_ORIGINS);
    expect(service).toContain("contains(additionalAppSettings, 'MCP_ALLOWED_ORIGINS')");
    expect(service).toContain("var rawOrigins = trim(effectiveOriginSetting)");
    expect(service).toContain("var extendOrigins = startsWith(rawOrigins, '+')");
    expect(service).toContain("empty(rawOrigins) ? defaultAllowedOrigins : extendOrigins ? concat(defaultAllowedOrigins, configuredOrigins) : configuredOrigins");
    expect(service).toContain("supportCredentials: false");
    expect(parseAllowedOrigins(" https://example.com/ ")).toEqual(["https://example.com"]);
    expect(parseAllowedOrigins("+https://example.com/")).toContain("https://irishopendata.com");
    expect(parseAllowedOrigins("+https://example.com/")).toContain("https://example.com");
  });

  it("does not turn application wildcard patterns into permissive platform wildcards", () => {
    expect(service).toContain("!empty(entry) && !contains(entry, '*')");
    expect(service).toContain("contains(effectiveOrigins, '*') ? ['*']");
    expect(service).toContain("func normalizeOrigin(origin string) string => toLower(");
    expect(service).toContain("endsWith(value, '/') ? substring(value, 0, max(0, length(value) - 1))");
    expect(DEFAULT_ALLOWED_ORIGINS).not.toContain("*");
    expect(parseAllowedOrigins("+*")).toContain("*");
    expect(production.mcpAllowedOrigins).toBeUndefined();
    expect(service).toContain("var platformOrigins = contains(effectiveOrigins, '*') ? ['*'] : union(concreteBrowserOrigins, [])");
    expect(service).not.toContain("enableProductionDomains");
  });

  it("uses existing app config for concrete browser ports and webview origins", () => {
    const concrete = (raw: string | undefined) =>
      parseAllowedOrigins(raw).filter((entry) => entry.length > 0 && !entry.includes("*"));
    expect(concrete(undefined)).toEqual([
      "https://claude.ai",
      "https://chatgpt.com",
      "http://localhost",
      "http://127.0.0.1",
      "https://lemon-meadow-03b2b8903.3.azurestaticapps.net",
      "https://irishopendata.ie",
      "https://www.irishopendata.ie",
      "https://irishopendata.com",
      "https://www.irishopendata.com"
    ]);
    expect(concrete("+http://localhost:7071")).toContain("http://localhost:7071");
    expect(concrete("+vscode-webview://explicit-client")).toContain("vscode-webview://explicit-client");
    expect(concrete("https://irishopendata.com")).toEqual(["https://irishopendata.com"]);
    expect(concrete("https://*.example.com")).toEqual([]);
    expect(isOriginAllowed("http://localhost:7071", DEFAULT_ALLOWED_ORIGINS)).toBe(true);
    expect(isOriginAllowed("http://localhost:7071", parseAllowedOrigins("https://irishopendata.com"))).toBe(false);
  });

  it("manages both zones and binds both apexes plus mcp.ie without changing nameservers or CAA", () => {
    expect(domains).toContain("zoneName: 'irishopendata.com'");
    expect(domains).toContain("zoneName: 'irishopendata.ie'");
    expect(dns).toContain("name in ['@', '_dnsauth']");
    expect(dns).toContain("TXTRecords: [{ value: [staticWebAppValidationToken] }]");
    expect(dns).not.toContain("Microsoft.Network/dnsZones/NS@");
    expect(dns).not.toContain("Microsoft.Network/dnsZones/CAA@");
    expect([...domains.matchAll(/hostname: '([^']+)'/g)].map((match) => match[1])).toEqual([
      "mcp.irishopendata.com",
      "www.irishopendata.com",
      "mcp.irishopendata.ie"
    ]);
    expect(domains).toContain("name: 'irishopendata.com'\n  properties: { validationMethod: 'dns-txt-token' }");
    expect(domains).toContain("name: 'irishopendata.ie'\n  properties: { validationMethod: 'dns-txt-token' }");
    expect(domains).toContain("staticWebAppValidationToken: ieStaticWebAppValidationToken");
  });

  it("uses site-scoped certificates before SNI bindings without disabling existing TLS", () => {
    expect(service).toContain("siteScopedCertificatesEnabled: true");
    expect(domains).toContain("Microsoft.Web/sites/certificates@2024-11-01");
    expect(domains).toContain("certificateName: 'mcp-irishopendata-com'");
    expect(domains).toContain("certificateName: 'www-irishopendata-com'");
    expect(domains).toContain("certificateName: 'mcp-irishopendata-ie'");
    expect(domains).toContain("properties: { canonicalName: host.hostname }");
    expect(domains).toContain("thumbprint: certificates[i].properties.thumbprint");
    expect(domains).toContain("sslState: 'SniEnabled'");
    expect(domains).not.toMatch(/sslState:\s*'Disabled'/);
    const certificates = domains.split("resource certificates ")[1]?.split("resource bindings ")[0] ?? "";
    expect(certificates).toContain("dependsOn: [comDns, ieDns]");
    expect(certificates).not.toContain("dependsOn: [bindings]");
  });

  it("creates only site and initialize probes and reuses the original health-test identity", () => {
    expect([...availability.matchAll(/url: '([^']+)'/g)].map((match) => match[1])).toEqual([
      "https://irishopendata.com",
      "https://mcp.irishopendata.com/mcp"
    ]);
    expect([...availability.matchAll(/method: '([^']+)'/g)].map((match) => match[1])).toEqual(["GET", "POST"]);
    expect(availability).not.toContain("irishopendata-com-healthz");
    expect(service).toContain("name: 'healthz-${token}'");
    expect(service).toContain("RequestUrl: empty(healthCheckUrl) ? 'https://${app.properties.defaultHostName}/healthz' : healthCheckUrl");
    expect(main).toContain("healthCheckUrl: enableProductionDomains ? 'https://mcp.irishopendata.com/healthz' : ''");
    expect(main).toContain("healthTestName: service.outputs.healthTestName");
    expect(availability).toContain("{ name: healthTestName, displayName: 'mcp.irishopendata.com /healthz' }");
    expect(availability).toContain("for test in monitoredTests");
    expect(availability).toContain("webTestId: resourceId('Microsoft.Insights/webtests', test.name)");
    const body = availability.match(/body: base64\('([^']+)'\)/)?.[1] ?? "";
    expect(JSON.parse(body)).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {} }
    });
    expect(availability).toContain("{ key: 'Accept', value: 'application/json, text/event-stream' }");
    expect(availability).toContain("content: '\"name\":\"ireland-mcp\"'");
    expect(availability).toContain("RequestBody: test.body");
    expect(availability).toContain("kind: 'standard'");
    expect(availability).toContain("Frequency: 900");
    expect(availability).toContain("FollowRedirects: false");
    expect(availability).toContain("SSLCheck: true");
    expect(availability).toContain("SSLCertRemainingLifetimeCheck: 7");
  });

  it("adds two-location alerts and accepts the budget recipient only at deployment time", () => {
    expect(main).toContain("param availabilityAlertEmail string = ''");
    expect(availability).toContain("param alertEmail string = ''");
    expect(availability).toContain("emailAddress: alertEmail");
    expect(availability).toContain("failedLocationCount: 2");
    expect(availability).toContain("windowSize: 'PT15M'");
    expect(availability).toContain("actionGroupId: id");
    expect(azd.availabilityAlertEmail.value).toBe("${AVAILABILITY_CONTACT_EMAIL=}");
    expect(production.availabilityAlertEmail).toBeUndefined();
    expect(readInfra("production.parameters.json")).not.toMatch(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
    expect(production.budgetContactEmail).toBeUndefined();
    expect(production.monthlyBudget.value).toBe(20);
    expect(production.budgetStartDate.value).toBe("2026-10-01");
  });
});
