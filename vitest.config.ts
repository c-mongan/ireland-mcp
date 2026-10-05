import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/gateway/**", "src/sources/**", "src/cross/**"],
      exclude: ["**/*.test.ts", "**/fixtures/**", "src/sources/ppr/buildIndexCli.ts"],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 }
    }
  }
});
