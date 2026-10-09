import { defineConfig } from "vitest/config";
import path from "path";

// Runs only the integration tests (*.int.test.ts) against real infrastructure.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
