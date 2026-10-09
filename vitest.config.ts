import { configDefaults, defineConfig } from "vitest/config";
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
    // Extended from configDefaults rather than set, because assigning
    // `exclude` replaces vitest's own list (node_modules, dist, …) rather
    // than adding to it.
    //
    // `.claude/worktrees/` holds git worktrees, and a worktree is a whole
    // second checkout of this repository — including its tests. Vitest's
    // default include glob is `**/*.test.ts`, which matched all 95 of them,
    // so the suite silently ran ~191 files instead of 96: every test twice,
    // the duplicate copies pinned to a different commit's source, and a
    // failure in a worktree that CI has never heard of reporting as a
    // failure here. Same root cause as `.claude` being missing from
    // .dockerignore, and it is why a run can go red for reasons that have
    // nothing to do with the working tree.
    exclude: [...configDefaults.exclude, ".claude/**"],
    // Test environment needs SESSION_SECRET for token-based email functionality
    env: {
      SESSION_SECRET: "test-secret-not-for-production-1234567890abcdef",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
