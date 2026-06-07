import { defineConfig } from "vitest/config";

// Standalone vitest config — intentionally does NOT load the Cloudflare/PWA plugins
// so unit tests run fast in plain Node.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true,
  },
});
