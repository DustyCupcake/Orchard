import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 20000,
    testTimeout: 20000,
    // These are integration tests against a real, shared Postgres — each
    // file truncates the DB between tests, so files can't run in
    // parallel without racing each other's truncates.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
