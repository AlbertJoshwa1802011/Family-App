import { Hono } from "hono";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { requestId } from "hono/request-id";
import { HTTPException } from "hono/http-exception";
import type { HonoEnv } from "./types";
import { authRoutes } from "./routes/auth";
import { familyRoutes } from "./routes/families";
import { documentRoutes } from "./routes/documents";
import { notificationRoutes } from "./routes/notifications";
import { eventRoutes } from "./routes/events";
import { taskRoutes } from "./routes/tasks";
import { contactRoutes } from "./routes/contacts";
import { occasionRoutes } from "./routes/occasions";
import { messageRoutes } from "./routes/messages";
import { runExpiryReminders } from "./cron";
import { getDb } from "./db/client";
import { purgeExpiredSessions } from "./lib/session";
import { runDocumentExtraction } from "./lib/extract";
import { requireValidOrigin } from "./middleware/requireValidOrigin";
import { rateLimit } from "./middleware/rateLimit";

// 1 MiB cap on JSON request bodies. File uploads go to a dedicated multipart
// route with its own (larger) streaming limit; this protects every metadata
// endpoint from a memory-exhaustion DoS via a giant JSON payload.
const JSON_BODY_LIMIT = 1024 * 1024;

const app = new Hono<HonoEnv>();

// Scope middleware to /api/* — static-asset/SPA responses are served by the ASSETS
// binding (with headers from public/_headers), not through this Worker pipeline.
app.use("/api/*", requestId());
app.use("/api/*", logger());
app.use("/api/*", secureHeaders());
// CSRF: credentialed state-changing requests must come from our own origin.
app.use("/api/*", requireValidOrigin);
// Rate limiting (per-IP, KV-backed; no-ops without KV). The OAuth endpoints are
// the abuse surface and get the tightest bucket; all other state-changing
// requests share a looser bucket. (Session checks like GET /auth/me are NOT
// rate-limited — refetch-on-focus must never 429 a valid user into a logout.)
app.use(
  "/api/auth/google/*",
  rateLimit({ limit: 30, windowSecs: 60, keyPrefix: "auth" }),
);
app.use(
  "/api/*",
  rateLimit({ limit: 120, windowSecs: 60, keyPrefix: "mut", unsafeOnly: true }),
);
// Reject oversized JSON bodies before any handler runs (memory-safety).
app.use(
  "/api/*",
  bodyLimit({
    maxSize: JSON_BODY_LIMIT,
    onError: (c) => c.json({ error: "payload_too_large" }, 413),
  }),
);

// --- API routes (everything else falls through to static assets) ---
const api = new Hono<HonoEnv>();

api.get("/health", (c) =>
  c.json({ ok: true, service: "family-vault", time: Date.now() }),
);

api.route("/auth", authRoutes);
api.route("/families", familyRoutes);
api.route("/documents", documentRoutes);
api.route("/notifications", notificationRoutes);
api.route("/events", eventRoutes);
api.route("/tasks", taskRoutes);
api.route("/contacts", contactRoutes);
api.route("/occasions", occasionRoutes);
api.route("/messages", messageRoutes);

// Unknown API routes must return JSON 404 (NOT the SPA index.html).
api.all("*", (c) => c.json({ error: "not_found" }, 404));

app.route("/api", api);

// Consistent JSON error shape for API; never leak internals to the client.
app.onError((err, c) => {
  // requestId is set by the requestId() middleware on /api/*; correlate logs ↔ clients.
  const reqId = c.get("requestId");
  if (err instanceof HTTPException) {
    return c.json({ error: err.message || "error", requestId: reqId }, err.status);
  }
  // Log the full error server-side (with the request id) but return a generic message.
  console.error(`[${reqId ?? "no-id"}] Unhandled error:`, err);
  return c.json({ error: "internal_error", requestId: reqId }, 500);
});

// Exported for unit tests.
export { app };

export default {
  fetch: app.fetch,

  // Daily maintenance cron (see wrangler.jsonc triggers.crons):
  // expiry/event reminders + expired-session purge.
  async scheduled(
    _event: ScheduledController,
    env: HonoEnv["Bindings"],
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(runExpiryReminders(env));
    ctx.waitUntil(purgeExpiredSessions(getDb(env)));
    // Background document extraction (no-op unless an OCR provider is configured).
    ctx.waitUntil(runDocumentExtraction(getDb(env), env));
  },
} satisfies ExportedHandler<HonoEnv["Bindings"]>;
