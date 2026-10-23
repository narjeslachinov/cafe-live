import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false, // one shared server and a login rate limiter: run files one by one
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});