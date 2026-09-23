import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The OCR, tracing and Worker-simulator tests are each heavy. Running them all at
    // once on Windows occasionally crashed the Worker simulator's process (exit code
    // 0xC0000409), so at most three test files run at the same time.
    maxWorkers: 3,
  },
});
