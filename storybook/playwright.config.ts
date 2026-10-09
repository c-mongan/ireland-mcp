import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "stories.spec.ts",
  use: { baseURL: "http://127.0.0.1:46183" },
  webServer: {
    command: "python3 -m http.server 46183 --bind 127.0.0.1 --directory storybook-static",
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    url: "http://127.0.0.1:46183",
    reuseExistingServer: false
  }
});
