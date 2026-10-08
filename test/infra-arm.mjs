import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const template = JSON.parse(execFileSync("az", [
  "bicep", "build", "--file",
  fileURLToPath(new URL("../infra/production-domains.bicep", import.meta.url)),
  "--stdout"
], { encoding: "utf8" }));
const certificates = template.resources.find((resource) => resource.type === "Microsoft.Web/sites/certificates");
const bindings = template.resources.find((resource) => resource.type === "Microsoft.Web/sites/hostNameBindings");

test("managed certificate writes cannot overlap on the same Function site", () => {
  assert.equal(certificates.copy.mode, "serial");
  assert.equal(certificates.copy.batchSize, 1);
});

test("hostname binding writes cannot race the App Service site lock", () => {
  assert.equal(bindings.copy.mode, "serial");
  assert.equal(bindings.copy.batchSize, 1);
});

test("all certificate writes finish before any hostname binding starts", () => {
  assert.ok(bindings.dependsOn.includes(certificates.copy.name));
});
