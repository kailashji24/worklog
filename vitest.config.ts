import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests run in plain Node (no Cloudflare dev plugin).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
  },
});
