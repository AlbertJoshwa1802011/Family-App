import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

// Plugin order matters: react first, then cloudflare (owns Worker + assets wiring),
// tailwind, and PWA last so it can see the final client build.
export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    tailwindcss(),
    VitePWA({
      // `prompt` (not autoUpdate): the app has upload/edit forms we don't want a
      // forced skipWaiting to clobber. We show a "new version" toast instead.
      registerType: "prompt",
      injectRegister: null,
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        cleanupOutdatedCaches: true,
        // The Worker owns /api/*; never let the SPA navigation fallback or the SW
        // intercept API calls.
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Document list & metadata: show instantly from cache, refresh in background.
            urlPattern: ({ url }: { url: URL }) =>
              url.pathname.startsWith("/api/documents") ||
              url.pathname.startsWith("/api/families"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "api-metadata",
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
      manifest: {
        name: "Family Vault",
        short_name: "Vault",
        description:
          "Securely store your family's important documents and never miss an expiry.",
        theme_color: "#0f766e",
        background_color: "#0b1220",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      devOptions: {
        // Keep the SW off in dev to avoid caching surprises during HMR.
        enabled: false,
      },
    }),
  ],
});
