import { defineConfig } from "vitest/config";

// Standalone vitest config — intentionally does NOT load the Cloudflare/PWA plugins
// so unit tests run fast in plain Node. Component tests (*.test.tsx) opt into a DOM
// per-file with a `@vitest-environment jsdom` docblock.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup/dom.ts"],
    globals: true,
  },
});
