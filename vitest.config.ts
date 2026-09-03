import { defineConfig } from "vitest/config";

// Standalone vitest config — intentionally does NOT load the Cloudflare/PWA plugins
// so unit tests run fast in plain Node.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true,
    // Catalog files issue 1000+ app.request calls per describe; keep a generous ceiling.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
