#!/usr/bin/env bash
# Deploys the prebuilt app to the Flex Consumption function app created by `azd provision`.
# Why not `azd deploy`: it asks Flex for a remote Oryx build, which fails for this project.
# This builds locally, ships dist/ with production dependencies only, and skips the remote build.
# Needs: az login, plus an azd environment (or RESOURCE_GROUP and FUNCTION_APP set).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

rg="${RESOURCE_GROUP:-$(azd env get-value AZURE_RESOURCE_GROUP)}"
app="${FUNCTION_APP:-$(azd env get-value SERVICE_API_NAME)}"

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

# Record both sides of the build. Runtime environment settings cannot provide package identity.
revision_before="$(git rev-parse --verify HEAD 2>/dev/null || true)"
status_before="$(git status --porcelain --untracked-files=normal 2>/dev/null || printf git-status-unavailable)"
npm ci
npm run build
revision_after="$(git rev-parse --verify HEAD 2>/dev/null || true)"
status_after="$(git status --porcelain --untracked-files=normal 2>/dev/null || printf git-status-unavailable)"
release=""
if [[ "$revision_before" =~ ^[a-f0-9]{40}$ ]] && [[ "$revision_before" == "$revision_after" ]] && [[ -z "$status_before" ]] && [[ -z "$status_after" ]]; then
  release="$revision_before"
fi
# CI requires the actual built checkout to match its selected commit before any upload.
if [[ -n "${IRELAND_MCP_EXPECTED_REVISION:-}" ]] && [[ "$release" != "$IRELAND_MCP_EXPECTED_REVISION" ]]; then
  echo "Deployment stopped: the build is not a clean checkout of the expected Git revision." >&2
  exit 1
fi
cp -R dist host.json package.json package-lock.json "$stage/"
rm -rf "$stage/dist/test"
mkdir -p "$stage/dist/src/gateway"
if [[ -n "$release" ]]; then
  printf 'export const PACKAGED_RELEASE = "%s";\n' "$release" > "$stage/dist/src/gateway/release.js"
else
  printf 'export const PACKAGED_RELEASE = undefined;\n' > "$stage/dist/src/gateway/release.js"
  echo "Package release identity omitted: source is dirty or Git provenance is unavailable." >&2
fi
(
  cd "$stage/"
  npm ci --omit=dev --ignore-scripts
  # The Functions host must read the payload even when the caller uses umask 077.
  chmod -R a+rX dist host.json package.json package-lock.json node_modules
  zip -qr app.zip . -x app.zip
)

az functionapp deployment source config-zip -g "$rg" -n "$app" --src "$stage/app.zip" --build-remote false
echo "Deployed to https://$(az functionapp show -g "$rg" -n "$app" --query properties.defaultHostName -o tsv)/mcp"
