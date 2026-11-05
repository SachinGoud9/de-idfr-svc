import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // index.ts is process wiring (signals, exit codes), exercised by running the service.
      exclude: ["src/index.ts"],
      reporter: ["text-summary", "lcov"],
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
});
