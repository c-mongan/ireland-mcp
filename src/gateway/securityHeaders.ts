/** API responses need no browser capabilities. HSTS deliberately excludes pending subdomains. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
});
