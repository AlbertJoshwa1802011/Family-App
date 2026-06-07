import { Hono } from "hono";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import type { HonoEnv } from "./types";
import { authRoutes } from "./routes/auth";
import { familyRoutes } from "./routes/families";
import { documentRoutes } from "./routes/documents";
import { notificationRoutes } from "./routes/notifications";
import { runExpiryReminders } from "./cron";

const app = new Hono<HonoEnv>();

// Scope middleware to /api/* — static-asset/SPA responses are served by the ASSETS
// binding (with headers from public/_headers), not through this Worker pipeline.
app.use("/api/*", logger());
app.use("/api/*", secureHeaders());

// --- API routes (everything else falls through to static assets) ---
const api = new Hono<HonoEnv>();

api.get("/health", (c) =>
  c.json({ ok: true, service: "family-vault", time: Date.now() }),
);

api.route("/auth", authRoutes);
api.route("/families", familyRoutes);
api.route("/documents", documentRoutes);
api.route("/notifications", notificationRoutes);

// Unknown API routes must return JSON 404 (NOT the SPA index.html).
api.all("*", (c) => c.json({ error: "not_found" }, 404));

app.route("/api", api);

// Consistent JSON error shape for API; rethrow otherwise.
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message || "error" }, err.status);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: "internal_error" }, 500);
});

// Exported for unit tests.
export { app };

export default {
  fetch: app.fetch,

  // Daily expiry-reminder cron (see wrangler.jsonc triggers.crons).
  async scheduled(
    _event: ScheduledController,
    env: HonoEnv["Bindings"],
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(runExpiryReminders(env));
  },
} satisfies ExportedHandler<HonoEnv["Bindings"]>;
