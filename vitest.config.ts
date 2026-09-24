import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests only; the browser tests in e2e/ run with Playwright (npm run e2e).
    include: ["test/**/*.test.ts"],
    // The OCR, tracing and Worker-simulator tests are each heavy. Running them all at
    // once on Windows occasionally crashed the Worker simulator's process (exit code
    // 0xC0000409), so at most three test files run at the same time, and `npm test` runs the
    // Worker-simulator tests (test/api.test.ts) on their own after the rest.
    maxWorkers: 3,
    // Several tests build complete maps (terrain, rivers, towns, symbols); give them room
    // when the machine is busy running other test files at the same time.
    testTimeout: 30000,
  },
});
