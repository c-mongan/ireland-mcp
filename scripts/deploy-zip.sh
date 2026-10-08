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

npm ci
npm run build
cp -R dist host.json package.json package-lock.json "$stage/"
rm -rf "$stage/dist/test"
(
  cd "$stage/"
  npm ci --omit=dev --ignore-scripts
  # The Functions host must read the payload even when the caller uses umask 077.
  chmod -R a+rX dist host.json package.json package-lock.json node_modules
  zip -qr app.zip . -x app.zip
)

az functionapp deployment source config-zip -g "$rg" -n "$app" --src "$stage/app.zip" --build-remote false
echo "Deployed to https://$(az functionapp show -g "$rg" -n "$app" --query properties.defaultHostName -o tsv)/mcp"
